import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { AppData } from '../domain'

const { fakeDb } = vi.hoisted(() => ({ fakeDb: { routes: [] as AppData['routes'], observations: [] as AppData['observations'] } }))

vi.mock('../lib/supabase', () => {
  const session = { access_token: 'test-token', token_type: 'bearer', expires_in: 3600, refresh_token: 'test-refresh', user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }
  return { supabase: { auth: {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (callback: (event: string, next: unknown) => void) => { queueMicrotask(() => callback('SIGNED_IN', session)); return { data: { subscription: { unsubscribe: () => undefined } } } },
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ error: null }),
    signUp: async () => ({ data: { session }, error: null }),
  } } }
})

vi.mock('../lib/repository', () => ({
  loadUserData: async () => structuredClone(fakeDb),
  createRoute: async (_client: unknown, input: Omit<AppData['routes'][number], 'id'>) => {
    const route = { ...input, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(fakeDb.routes.length + 1).padStart(12, '0')}` }
    fakeDb.routes.push(route); return route
  },
  updateRoute: async (_client: unknown, id: string, input: Omit<AppData['routes'][number], 'id'>) => {
    const route = { ...input, id }; fakeDb.routes = fakeDb.routes.map((item) => item.id === id ? route : item); return route
  },
  deleteRoute: async (_client: unknown, id: string) => { fakeDb.routes = fakeDb.routes.filter((route) => route.id !== id); fakeDb.observations = fakeDb.observations.filter((item) => item.routeId !== id) },
  createObservation: async (_client: unknown, input: Omit<AppData['observations'][number], 'id' | 'sourceType' | 'validityStatus'>) => {
    const observation = { ...input, id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(fakeDb.observations.length + 1).padStart(12, '0')}`, sourceType: 'manual' as const, validityStatus: 'valid' as const }
    fakeDb.observations.push(observation); return observation
  },
  deleteObservation: async (_client: unknown, id: string) => { fakeDb.observations = fakeDb.observations.filter((item) => item.id !== id) },
  clearRideRecords: async () => { fakeDb.routes = []; fakeDb.observations = [] },
}))

import App from '../ui/App'

function mount(path = '/') { return render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>) }
describe('PreçoCerto conectado', () => {
  beforeEach(() => { fakeDb.routes = []; fakeDb.observations = []; sessionStorage.clear() })
  it('cadastra uma rota', async () => {
    const user = userEvent.setup(); mount('/rotas'); await user.click(await screen.findByRole('button',{name:'Nova rota'})); await user.type(screen.getByLabelText('Origem'),'Aldeota, Fortaleza'); await user.type(screen.getByLabelText('Destino'),'Aeroporto de Fortaleza'); await user.click(screen.getByRole('button',{name:'Salvar rota'})); expect(await screen.findByText('Aldeota, Fortaleza')).toBeInTheDocument(); expect(screen.getByText('Aeroporto de Fortaleza')).toBeInTheDocument()
  })
  it('registra preço manual para rota cadastrada', async () => {
    const user = userEvent.setup(); mount('/rotas'); await user.click(await screen.findByRole('button',{name:'Nova rota'})); await user.type(screen.getByLabelText('Origem'),'Centro'); await user.type(screen.getByLabelText('Destino'),'Aeroporto'); await user.click(screen.getByRole('button',{name:'Salvar rota'})); await screen.findByText('Centro'); await user.click(screen.getAllByRole('button',{name:'Registrar preço'})[1]!); await user.selectOptions(screen.getByLabelText('Plataforma'),'99'); await user.type(screen.getByLabelText('Preço observado (R$)'),'21.50'); await user.click(screen.getByRole('button',{name:'Salvar preço'})); expect(await screen.findByText('Preço manual salvo no Supabase.')).toBeInTheDocument(); expect(fakeDb.observations).toHaveLength(1)
  })
  it('exibe validação em formulário de rota', async () => {
    const user = userEvent.setup(); mount('/rotas'); await user.click(await screen.findByRole('button',{name:'Nova rota'})); await user.type(screen.getByLabelText('Origem'),'x'); await user.type(screen.getByLabelText('Destino'),'Aeroporto'); await user.click(screen.getByRole('button',{name:'Salvar rota'})); expect(await screen.findByText(/mínimo de 3 caracteres/i)).toBeInTheDocument()
  })
})
