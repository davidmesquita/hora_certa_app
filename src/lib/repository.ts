import type { SupabaseClient } from '@supabase/supabase-js'
import { observationInputSchema, observationSchema, routeInputSchema, routeSchema, type AppData, type Observation, type ObservationInput, type Route, type RouteInput } from '../domain'

type Client = SupabaseClient
type RouteRow = { id: string; origin: string; destination: string; category: string }
type ObservationRow = { id: string; route_id: string; platform: string; category: string; price: number | string; observed_at: string; source_type: string; validity_status: string }

function toRoute(row: RouteRow): Route {
  return { id: row.id, origin: row.origin, destination: row.destination, category: row.category }
}
function toObservation(row: ObservationRow): Observation {
  return {
    id: row.id,
    routeId: row.route_id,
    platform: row.platform === 'uber' ? 'Uber' : '99',
    category: row.category,
    price: Number(row.price),
    observedAt: row.observed_at,
    sourceType: row.source_type as Observation['sourceType'],
    validityStatus: row.validity_status as Observation['validityStatus'],
  }
}
function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

export async function loadUserData(client: Client): Promise<AppData> {
  const [routesResult, observationsResult] = await Promise.all([
    client.from('routes').select('id,origin,destination,category').order('created_at', { ascending: false }),
    client.from('price_observations')
      .select('id,route_id,platform,category,price,observed_at,source_type,validity_status')
      .neq('source_type', 'demo')
      .order('observed_at', { ascending: false }),
  ])
  throwIfError(routesResult.error)
  throwIfError(observationsResult.error)
  const routes = routeSchema.array().parse((routesResult.data as unknown as RouteRow[]).map(toRoute))
  const observations = observationSchema.array().parse((observationsResult.data as unknown as ObservationRow[]).map(toObservation))
  return { routes, observations }
}

export async function createRoute(client: Client, input: RouteInput): Promise<Route> {
  const values = routeInputSchema.parse(input)
  const { data, error } = await client.from('routes')
    .insert({ origin: values.origin, destination: values.destination, category: values.category ?? '' })
    .select('id,origin,destination,category').single()
  throwIfError(error)
  return toRoute(data as unknown as RouteRow)
}

export async function updateRoute(client: Client, id: string, input: RouteInput): Promise<Route> {
  const values = routeInputSchema.parse(input)
  const { data, error } = await client.from('routes')
    .update({ origin: values.origin, destination: values.destination, category: values.category ?? '' })
    .eq('id', id).select('id,origin,destination,category').single()
  throwIfError(error)
  return toRoute(data as unknown as RouteRow)
}

export async function deleteRoute(client: Client, id: string): Promise<void> {
  const { error } = await client.from('routes').delete().eq('id', id)
  throwIfError(error)
}

export async function createObservation(client: Client, input: ObservationInput): Promise<Observation> {
  const values = observationInputSchema.parse(input)
  const { data, error } = await client.from('price_observations').insert({
    route_id: values.routeId,
    platform: values.platform === 'Uber' ? 'uber' : '99',
    category: values.category ?? '',
    price: values.price,
    observed_at: values.observedAt,
    source_type: 'manual',
    validity_status: 'valid',
  }).select('id,route_id,platform,category,price,observed_at,source_type,validity_status').single()
  throwIfError(error)
  return toObservation(data as unknown as ObservationRow)
}

export async function deleteObservation(client: Client, id: string): Promise<void> {
  const { error } = await client.from('price_observations').delete().eq('id', id)
  throwIfError(error)
}

export async function clearRideRecords(client: Client): Promise<void> {
  const { error } = await client.from('routes').delete().not('id', 'is', null)
  throwIfError(error)
}
