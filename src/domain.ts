import { z } from 'zod'

export const routeSchema = z.object({
  id: z.string().min(1),
  origin: z.string().trim().min(3, 'Informe a origem (mínimo de 3 caracteres).').max(160),
  destination: z.string().trim().min(3, 'Informe o destino (mínimo de 3 caracteres).').max(160),
  category: z.string().trim().max(80).optional().default(''),
})
export const observationSchema = z.object({
  id: z.string().min(1), routeId: z.string().min(1), platform: z.enum(['Uber', '99']),
  category: z.string().trim().max(80).optional().default(''),
  price: z.number().finite().positive('Informe um preço maior que zero.').max(100000),
  observedAt: z.string().datetime({ offset: true }), source: z.literal('manual').default('manual'),
})
export const routeInputSchema = routeSchema.omit({ id: true })
export const observationInputSchema = observationSchema.omit({ id: true, source: true })
export type Route = z.infer<typeof routeSchema>
export type Observation = z.infer<typeof observationSchema>
export type RouteInput = z.input<typeof routeInputSchema>
export type ObservationInput = z.input<typeof observationInputSchema>
export type AppData = { routes: Route[]; observations: Observation[] }

export const emptyData: AppData = { routes: [], observations: [] }
export function loadData(): AppData {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('precocerto:v1') ?? 'null')
    if (!value || typeof value !== 'object') return emptyData
    const candidate = value as { routes?: unknown; observations?: unknown }
    const routes = z.array(routeSchema).safeParse(candidate.routes ?? [])
    const observations = z.array(observationSchema).safeParse(candidate.observations ?? [])
    if (!routes.success || !observations.success) return emptyData
    return { routes: routes.data, observations: observations.data }
  } catch { return emptyData }
}
export function saveData(data: AppData): void { localStorage.setItem('precocerto:v1', JSON.stringify(data)) }
export function formatPrice(price: number): string { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price) }
export function formatFortaleza(date: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', ...options }).format(new Date(date))
}
export function toFortalezaIso(input: string): string {
  return new Date(`${input}:00-03:00`).toISOString()
}
export function fromFortalezaIso(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
export function exportCsv(data: AppData): string {
  const rows = [['origem', 'destino', 'plataforma', 'categoria', 'preco', 'observado_em'], ...data.observations.flatMap((item) => {
    const route = data.routes.find((r) => r.id === item.routeId)
    return route ? [[route.origin, route.destination, item.platform, item.category, item.price, item.observedAt]] : []
  })]
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}
function parseCsvRow(line: string): string[] {
  const values: string[] = []; let current = ''; let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!
    if (char === '"' && quoted && line[i + 1] === '"') { current += '"'; i += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { values.push(current); current = '' }
    else current += char
  }
  if (quoted) throw new Error('Arquivo CSV contém aspas sem fechamento.')
  values.push(current); return values
}
export function importCsv(csv: string, existing: AppData): AppData {
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  if (lines.length < 2 || lines.length > 10001) throw new Error('O CSV precisa conter cabeçalho e até 10.000 registros.')
  const header = parseCsvRow(lines[0]!).map((v) => v.trim().toLowerCase())
  const expected = ['origem', 'destino', 'plataforma', 'categoria', 'preco', 'observado_em']
  if (header.join('|') !== expected.join('|')) throw new Error(`Cabeçalho inválido. Use: ${expected.join(', ')}`)
  const routes = [...existing.routes]; const observations = [...existing.observations]
  for (const [index, line] of lines.slice(1).entries()) {
    if (!line.trim()) continue
    const row = parseCsvRow(line)
    if (row.length !== 6) throw new Error(`Linha ${index + 2}: esperado 6 campos.`)
    const [origin, destination, platform, category, priceText, observedAt] = row as [string, string, string, string, string, string]
    const route = routes.find((r) => r.origin === origin && r.destination === destination && r.category === category) ?? routeSchema.parse({ id: crypto.randomUUID(), origin, destination, category })
    if (!routes.some((r) => r.id === route.id)) routes.push(route)
    const parsed = observationSchema.parse({ id: crypto.randomUUID(), routeId: route.id, platform, category, price: Number(priceText), observedAt, source: 'manual' })
    observations.push(parsed)
  }
  return { routes, observations }
}
