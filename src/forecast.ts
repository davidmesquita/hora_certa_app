import type { Observation } from './domain'

export type Confidence = 'baixa' | 'média' | 'alta'
export type ForecastWindow = {
  weekday: number
  startMinute: number
  sampleCount: number
  distinctDays: number
  median: number
  p25: number
  p75: number
  iqr: number
  dispersionRatio: number
  recentMedian: number | null
  recentSampleCount: number
  latestAt: string
  confidence: Confidence
}
export type ForecastGroup = {
  routeId: string
  platform: Observation['platform']
  category: string
  status: 'ready' | 'insufficient' | 'stale'
  reason: string
  sampleCount: number
  distinctDays: number
  latestAt: string | null
  baselineMedian: number | null
  recentMedian: number | null
  windows: ForecastWindow[]
  recommendations: ForecastWindow[]
  chart: Array<{ observedAt: string; price: number }>
}

const TIME_ZONE = 'America/Fortaleza'
const MIN_GROUP_SAMPLES = 8
const MIN_GROUP_DAYS = 5
const MIN_WINDOW_SAMPLES = 5
const MIN_WINDOW_DAYS = 3
const LOOKBACK_DAYS = 180
const RECENT_DAYS = 60
const MAX_AGE_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
const weekdayNames = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

function quantile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}

export function median(values: number[]): number {
  if (!values.length) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  return quantile(sorted, 0.5)
}

function partsForFortaleza(date: Date): { weekday: number; minuteOfDay: number; localDate: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const hour = Number(get('hour'))
  return {
    weekday: weekdays.indexOf(get('weekday')),
    minuteOfDay: hour * 60 + Number(get('minute')),
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

function normalizedCategory(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR')
}

function getConfidence(sampleCount: number, distinctDays: number, ageDays: number, dispersionRatio: number): Confidence {
  if (sampleCount >= 20 && distinctDays >= 12 && ageDays <= 21 && dispersionRatio <= 0.18) return 'alta'
  if (sampleCount >= 10 && distinctDays >= 6 && ageDays <= 45 && dispersionRatio <= 0.3) return 'média'
  return 'baixa'
}

function summarizeWindow(items: Observation[], weekday: number, startMinute: number, asOf: Date, recentStart: number): ForecastWindow {
  const prices = items.map((item) => item.price).sort((a, b) => a - b)
  const p25 = quantile(prices, 0.25)
  const p75 = quantile(prices, 0.75)
  const distinctDays = new Set(items.map((item) => partsForFortaleza(new Date(item.observedAt)).localDate)).size
  const latestAt = items.reduce((latest, item) => item.observedAt > latest ? item.observedAt : latest, items[0]!.observedAt)
  const ageDays = Math.max(0, (asOf.getTime() - new Date(latestAt).getTime()) / DAY_MS)
  const windowMedian = quantile(prices, 0.5)
  const recentPrices = items.filter((item) => new Date(item.observedAt).getTime() >= recentStart).map((item) => item.price)
  const iqr = p75 - p25
  return {
    weekday,
    startMinute,
    sampleCount: items.length,
    distinctDays,
    median: windowMedian,
    p25,
    p75,
    iqr,
    dispersionRatio: windowMedian === 0 ? 0 : iqr / windowMedian,
    recentMedian: recentPrices.length >= 3 ? median(recentPrices) : null,
    recentSampleCount: recentPrices.length,
    latestAt,
    confidence: getConfidence(items.length, distinctDays, ageDays, windowMedian === 0 ? 0 : iqr / windowMedian),
  }
}

function summarizeGroup(items: Observation[], routeId: string, platform: Observation['platform'], category: string, asOf: Date): ForecastGroup {
  const prices = items.map((item) => item.price)
  const latestAt = items.reduce((latest, item) => item.observedAt > latest ? item.observedAt : latest, items[0]!.observedAt)
  const latestAge = Math.max(0, (asOf.getTime() - new Date(latestAt).getTime()) / DAY_MS)
  const localDays = new Set(items.map((item) => partsForFortaleza(new Date(item.observedAt)).localDate)).size
  const recentStart = asOf.getTime() - RECENT_DAYS * DAY_MS
  const recentPrices = items.filter((item) => new Date(item.observedAt).getTime() >= recentStart).map((item) => item.price)
  const buckets = new Map<string, Observation[]>()
  for (const item of items) {
    const local = partsForFortaleza(new Date(item.observedAt))
    const startMinute = Math.floor(local.minuteOfDay / 30) * 30
    const key = `${local.weekday}:${startMinute}`
    buckets.set(key, [...(buckets.get(key) ?? []), item])
  }
  const windows = [...buckets.entries()].flatMap(([key, bucket]) => {
    const [weekday, startMinute] = key.split(':').map(Number)
    const days = new Set(bucket.map((item) => partsForFortaleza(new Date(item.observedAt)).localDate)).size
    if (bucket.length < MIN_WINDOW_SAMPLES || days < MIN_WINDOW_DAYS) return []
    return [summarizeWindow(bucket, weekday!, startMinute!, asOf, recentStart)]
  }).sort((a, b) => a.median - b.median || b.distinctDays - a.distinctDays || b.sampleCount - a.sampleCount)
  const shared = {
    routeId, platform, category, sampleCount: items.length, distinctDays: localDays, latestAt,
  baselineMedian: median(prices), recentMedian: recentPrices.length >= 3 ? median(recentPrices) : null,
    windows,
    chart: items.map((item) => ({ observedAt: item.observedAt, price: item.price })).sort((a, b) => a.observedAt.localeCompare(b.observedAt)),
  }
  if (latestAge > MAX_AGE_DAYS) return { ...shared, status: 'stale', reason: `A observação mais recente tem ${Math.floor(latestAge)} dias. Atualize o histórico para estimar horários atuais.`, recommendations: [] }
  if (items.length < MIN_GROUP_SAMPLES || localDays < MIN_GROUP_DAYS) return { ...shared, status: 'insufficient', reason: `São necessárias pelo menos ${MIN_GROUP_SAMPLES} observações em ${MIN_GROUP_DAYS} dias distintos para avaliar este grupo.`, recommendations: [] }
  if (!windows.length) return { ...shared, status: 'insufficient', reason: `Nenhuma faixa de 30 minutos tem ao menos ${MIN_WINDOW_SAMPLES} observações distribuídas em ${MIN_WINDOW_DAYS} dias.`, recommendations: [] }
  const recommendations = windows
    .filter((window) => window.median < shared.baselineMedian! && (window.recentMedian === null || window.recentMedian < shared.baselineMedian!))
    .sort((a, b) => ((a.median + (a.recentMedian ?? a.median)) / 2) - ((b.median + (b.recentMedian ?? b.median)) / 2) || a.median - b.median)
  if (!recommendations.length) return { ...shared, status: 'insufficient', reason: 'As faixas avaliáveis não ficaram consistentemente abaixo da mediana geral; não há horário econômico identificado.', recommendations: [] }
  return { ...shared, status: 'ready', reason: 'Estimativa histórica; preços futuros podem variar.', recommendations: recommendations.slice(0, 3) }
}

/** Produces independent route/platform/category forecasts using only data strictly before `asOf`. */
export function calculateForecasts(observations: Observation[], asOf = new Date()): ForecastGroup[] {
  const cutoff = asOf.getTime()
  const lookbackStart = cutoff - LOOKBACK_DAYS * DAY_MS
  const eligible = observations.filter((item) => {
    const observed = new Date(item.observedAt).getTime()
    return Number.isFinite(observed) && observed < cutoff && observed >= lookbackStart && item.validityStatus === 'valid' && item.sourceType !== 'demo'
  })
  const groups = new Map<string, Observation[]>()
  for (const item of eligible) {
    const key = `${item.routeId}|${item.platform}|${normalizedCategory(item.category)}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.values()].map((items) => summarizeGroup(items, items[0]!.routeId, items[0]!.platform, items[0]!.category, asOf))
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.category.localeCompare(b.category))
}

export function formatWindow(window: Pick<ForecastWindow, 'weekday' | 'startMinute'>): string {
  const hour = Math.floor(window.startMinute / 60).toString().padStart(2, '0')
  const minute = (window.startMinute % 60).toString().padStart(2, '0')
  const endMinute = (window.startMinute + 30) % (24 * 60)
  const end = `${Math.floor(endMinute / 60).toString().padStart(2, '0')}:${(endMinute % 60).toString().padStart(2, '0')}`
  return `${weekdayNames[window.weekday]} · ${hour}:${minute}–${end}`
}
