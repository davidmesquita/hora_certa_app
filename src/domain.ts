import { z } from 'zod'

export const routeSchema = z.object({
  id: z.string().uuid(),
  origin: z.string().trim().min(3, 'Informe a origem (mínimo de 3 caracteres).').max(160),
  destination: z.string().trim().min(3, 'Informe o destino (mínimo de 3 caracteres).').max(160),
  category: z.string().trim().max(80).optional().default(''),
})
export const observationSchema = z.object({
  id: z.string().uuid(), routeId: z.string().uuid(), platform: z.enum(['Uber', '99']),
  category: z.string().trim().max(80).optional().default(''),
  price: z.number().finite().positive('Informe um preço maior que zero.').max(100000),
  observedAt: z.string().datetime({ offset: true }), sourceType: z.enum(['manual', 'authorized_api', 'demo']).default('manual'),
  validityStatus: z.enum(['valid', 'invalid', 'needs_review']).default('valid'),
})
export const routeInputSchema = routeSchema.omit({ id: true })
export const observationInputSchema = observationSchema.omit({ id: true, sourceType: true, validityStatus: true })
export type Route = z.infer<typeof routeSchema>
export type Observation = z.infer<typeof observationSchema>
export type RouteInput = z.input<typeof routeInputSchema>
export type ObservationInput = z.input<typeof observationInputSchema>
export type AppData = { routes: Route[]; observations: Observation[] }

export const emptyData: AppData = { routes: [], observations: [] }
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
  const rows = [['origem', 'destino', 'categoria_rota', 'plataforma', 'categoria', 'preco', 'observado_em', 'source_type', 'validity_status'], ...data.observations.flatMap((item) => {
    const route = data.routes.find((r) => r.id === item.routeId)
    return route ? [[route.origin, route.destination, route.category, item.platform, item.category, item.price, item.observedAt, item.sourceType, item.validityStatus]] : []
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
  const legacyMetadataHeader = [...expected, 'source_type', 'validity_status']
  const currentHeader = ['origem', 'destino', 'categoria_rota', 'plataforma', 'categoria', 'preco', 'observado_em', 'source_type', 'validity_status']
  const hasCurrentFormat = header.join('|') === currentHeader.join('|')
  const hasLegacyMetadata = header.join('|') === legacyMetadataHeader.join('|')
  const isLegacy = header.join('|') === expected.join('|')
  if (!hasCurrentFormat && !hasLegacyMetadata && !isLegacy) throw new Error(`Cabeçalho inválido. Use: ${currentHeader.join(', ')}`)
  const routes = [...existing.routes]; const observations = [...existing.observations]
  for (const [index, line] of lines.slice(1).entries()) {
    if (!line.trim()) continue
    const row = parseCsvRow(line)
    if (row.length !== (hasCurrentFormat ? 9 : hasLegacyMetadata ? 8 : 6)) throw new Error(`Linha ${index + 2}: quantidade de campos inválida.`)
    const [origin, destination, routeCategory, platform, category, priceText, observedAt, sourceType, validityStatus] = hasCurrentFormat
      ? row
      : [row[0], row[1], '', row[2], row[3], row[4], row[5], row[6], row[7]]
    if ((hasCurrentFormat || hasLegacyMetadata) && (sourceType !== 'manual' || validityStatus !== 'valid')) throw new Error(`Linha ${index + 2}: a importação aceita apenas registros manuais válidos.`)
    const route = routes.find((r) => r.origin === origin && r.destination === destination && r.category === routeCategory) ?? routeSchema.parse({ id: crypto.randomUUID(), origin, destination, category: routeCategory })
    if (!routes.some((r) => r.id === route.id)) routes.push(route)
    const parsed = observationSchema.parse({ id: crypto.randomUUID(), routeId: route.id, platform, category, price: Number(priceText), observedAt, sourceType: 'manual', validityStatus: 'valid' })
    observations.push(parsed)
  }
  return { routes, observations }
}
