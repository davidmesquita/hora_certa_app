import { describe, expect, it } from 'vitest'
import { exportCsv, importCsv, observationInputSchema, routeInputSchema } from './domain'

describe('validação e cadastro de rotas', () => {
  it('aceita origem e destino descritivos e categoria opcional', () => {
    expect(routeInputSchema.parse({ origin: 'Rua A, 10', destination: 'Aeroporto', category: '' })).toEqual({ origin: 'Rua A, 10', destination: 'Aeroporto', category: '' })
  })
  it('rejeita origem curta', () => { expect(routeInputSchema.safeParse({ origin: 'x', destination: 'Aeroporto' }).success).toBe(false) })
})
describe('registro de preço', () => {
  it('aceita preço positivo e plataforma suportada', () => { expect(observationInputSchema.safeParse({ routeId: 'a0000000-0000-4000-8000-000000000001', platform: 'Uber', category: 'X', price: 18.5, observedAt: '2026-10-22T12:00:00.000Z' }).success).toBe(true) })
  it('rejeita preço não positivo', () => { expect(observationInputSchema.safeParse({ routeId: 'a0000000-0000-4000-8000-000000000001', platform: '99', category: '', price: 0, observedAt: '2026-10-22T12:00:00.000Z' }).success).toBe(false) })
  it('rejeita arquivo CSV com cabeçalho inválido', () => { expect(() => importCsv('rota,valor\nA,B', { routes: [], observations: [] })).toThrow('Cabeçalho inválido') })
  it('importa observação CSV validada e cria rota', () => { const result = importCsv('origem,destino,plataforma,categoria,preco,observado_em\r\n"Rua A, 10","Aeroporto","Uber","UberX",18.50,2026-10-22T12:00:00.000Z', { routes: [], observations: [] }); expect(result.routes).toHaveLength(1); expect(result.observations[0]?.price).toBe(18.5) })
  it('exporta e reimporta categoria de rota e metadados manuais', () => {
    const data = {
      routes: [{ id: 'a0000000-0000-4000-8000-000000000001', origin: 'Rua A, 10', destination: 'Aeroporto', category: 'Viagem' }],
      observations: [{ id: 'b0000000-0000-4000-8000-000000000001', routeId: 'a0000000-0000-4000-8000-000000000001', platform: 'Uber' as const, category: 'UberX', price: 18.5, observedAt: '2026-10-22T12:00:00.000Z', sourceType: 'manual' as const, validityStatus: 'valid' as const }],
    }
    const imported = importCsv(exportCsv(data), { routes: [], observations: [] })
    expect(imported.routes[0]?.category).toBe('Viagem')
    expect(imported.observations[0]).toMatchObject({ category: 'UberX', price: 18.5, sourceType: 'manual', validityStatus: 'valid' })
  })
})
