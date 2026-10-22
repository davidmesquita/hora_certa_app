import { describe, expect, it } from 'vitest'
import type { Observation } from './domain'
import { calculateForecasts, formatWindow, median } from './forecast'

const routeId = 'a0000000-0000-4000-8000-000000000001'
const asOf = new Date('2026-05-01T12:00:00.000Z')
function item(id: number, observedAt: string, price: number, patch: Partial<Observation> = {}): Observation {
  return { id: `b0000000-0000-4000-8000-${String(id).padStart(12, '0')}`, routeId, platform: 'Uber', category: 'UberX', price, observedAt, sourceType: 'manual', validityStatus: 'valid', ...patch }
}
function weeklySample(): Observation[] {
  const cheapDates = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']
  const expensiveDates = ['2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24', '2026-03-31']
  return [
    ...cheapDates.map((date, index) => item(index + 1, `${date}T08:00:00-03:00`, [8, 9, 8, 10, 9][index]!)),
    ...expensiveDates.map((date, index) => item(index + 10, `${date}T15:00:00-03:00`, [18, 20, 22, 20, 20][index]!)),
  ]
}

describe('motor de previsão histórica', () => {
  it('calcula mediana, quartis e recomenda faixa abaixo do baseline', () => {
    const [result] = calculateForecasts(weeklySample(), asOf)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(result?.status).toBe('ready')
    expect(result?.baselineMedian).toBe(14)
    expect(result?.sampleCount).toBe(10)
    expect(result?.distinctDays).toBe(10)
    expect(result?.recommendations[0]).toMatchObject({ weekday: 1, startMinute: 480, sampleCount: 5, distinctDays: 5, median: 9, p25: 8, p75: 9, confidence: 'baixa' })
    expect(formatWindow(result!.recommendations[0]!)).toContain('segunda-feira · 08:00–08:30')
  })

  it('expõe estado insuficiente para poucas amostras', () => {
    const [result] = calculateForecasts(weeklySample().slice(0, 4), asOf)
    expect(result?.status).toBe('insufficient')
    expect(result?.recommendations).toHaveLength(0)
    expect(result?.reason).toContain('8 observações')
  })

  it('marca dados antigos como desatualizados', () => {
    const oldDates = ['2025-12-01', '2025-12-08', '2025-12-15', '2025-12-22', '2025-12-29']
    const sample = [...oldDates.map((date, i) => item(i + 1, `${date}T08:00:00-03:00`, 10)), ...oldDates.map((date, i) => item(i + 10, `${date}T15:00:00-03:00`, 20))]
    const [result] = calculateForecasts(sample, asOf)
    expect(result?.status).toBe('stale')
    expect(result?.reason).toContain('Atualize o histórico')
  })

  it('não mistura categorias distintas', () => {
    const mixed = [...weeklySample(), ...weeklySample().map((entry) => ({ ...entry, id: `c${entry.id.slice(1)}`, category: '99Pop' }))]
    const result = calculateForecasts(mixed, asOf)
    expect(result).toHaveLength(2)
    expect(new Set(result.map((group) => group.category))).toEqual(new Set(['UberX', '99Pop']))
    expect(result.every((group) => group.status === 'ready')).toBe(true)
  })

  it('exclui demonstrações, inválidos e toda observação na data-limite ou posterior', () => {
    const sample = weeklySample()
    const count = sample.length
    sample.push(item(40, '2026-04-30T10:00:00-03:00', 0.1, { sourceType: 'demo' }))
    sample.push(item(41, '2026-04-30T10:00:00-03:00', 0.1, { validityStatus: 'invalid' }))
    sample.push(item(42, asOf.toISOString(), 0.1))
    sample.push(item(43, '2026-05-02T10:00:00-03:00', 0.1))
    const [result] = calculateForecasts(sample, asOf)
    expect(result?.sampleCount).toBe(count)
    expect(result?.chart.every((point) => new Date(point.observedAt) < asOf)).toBe(true)
    expect(result?.baselineMedian).toBe(14)
  })

  it('separa plataformas e nunca agrega categorias para comparar apps', () => {
    const sample = weeklySample()
    const otherPlatform = sample.map((entry) => ({ ...entry, id: `c${entry.id.slice(1)}`, platform: '99' as const, category: '99Pop' }))
    const result = calculateForecasts([...sample, ...otherPlatform], asOf)
    expect(result).toHaveLength(2)
    expect(result.map((group) => [group.platform, group.category])).toEqual([['99', '99Pop'], ['Uber', 'UberX']])
  })

  it('não recomenda janela cujo histórico recente ficou acima do baseline', () => {
    const risingRecent = [...weeklySample(), ...['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27'].map((date, i) => item(50 + i, `${date}T08:00:00-03:00`, 30))]
    const [result] = calculateForecasts(risingRecent, asOf)
    expect(result?.status).toBe('insufficient')
    expect(result?.recommendations).toHaveLength(0)
  })
})
