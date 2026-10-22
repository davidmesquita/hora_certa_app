// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const ownerA = '10000000-0000-0000-0000-000000000001'
const ownerB = '20000000-0000-0000-0000-000000000002'
const routeA = 'a0000000-0000-4000-8000-000000000001'
const routeCrud = 'a0000000-0000-4000-8000-000000000002'
let db: PGlite

async function asUser(userId: string): Promise<void> {
  await db.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', userId])
}
async function expectSqlState(action: () => Promise<unknown>, code: string): Promise<void> {
  let caught: unknown
  try { await action() } catch (error) { caught = error }
  expect(caught).toBeDefined()
  expect((caught as { code?: string }).code).toBe(code)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  const migration = await readFile(new URL('../supabase/migrations/20261022000100_precocerto_initial_schema.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.query('insert into auth.users (id, raw_user_meta_data) values ($1, $2), ($3, $4)', [ownerA, { display_name: 'A' }, ownerB, { display_name: 'B' }])
}, 30000)

afterAll(async () => { await db.close() })

describe('PostgreSQL Row Level Security policies', () => {
  it('applies all versioned DDL, enables RLS for every user table and denies anonymous access', async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select c.relname, c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in
        ('profiles','routes','price_observations','prediction_results','user_preferences','integration_status')
      order by c.relname
    `)
    expect(rls.rows).toHaveLength(6)
    expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true)
    await db.exec('set role anon')
    await expectSqlState(() => db.query('select * from public.routes'), '42501')
    await db.exec('reset role')
  })

  it('sets profile ownership from the auth.users trigger and defaults user_id from auth.uid()', async () => {
    const { rows } = await db.query<{ id: string }>('select id from public.profiles order by id')
    expect(rows.map((row) => row.id)).toEqual([ownerA, ownerB])
    await db.exec('set role authenticated')
    await asUser(ownerA)
    const route = await db.query<{ id: string }>(
      "insert into public.routes (id, origin, destination) values ($1, 'Rua Um, 100', 'Aeroporto Fortaleza') returning id",
      [routeA],
    )
    expect(route.rows[0]?.id).toBe(routeA)
    await db.exec('reset role')
  })

  it('isolates select operations and prevents cross-user inserts, updates and route links', async () => {
    await db.exec('set role authenticated')
    await asUser(ownerA)
    await db.query("insert into public.price_observations (route_id, platform, price, observed_at) values ($1, 'uber', 15, now())", [routeA])
    expect((await db.query<{ count: number }>('select count(*)::int as count from public.routes')).rows[0]?.count).toBe(1)
    expect((await db.query<{ count: number }>('select count(*)::int as count from public.price_observations')).rows[0]?.count).toBe(1)
    expect((await db.query<{ count: number }>('select count(*)::int as count from public.profiles')).rows[0]?.count).toBe(1)
    await expectSqlState(() => db.query("insert into public.routes (user_id, origin, destination) values ($1, 'Rua Três, 300', 'Centro Fortaleza')", [ownerB]), '42501')
    await expectSqlState(() => db.query('update public.routes set user_id = $1 where id = $2', [ownerB, routeA]), '42501')
    await asUser(ownerB)
    expect((await db.query<{ count: number }>('select count(*)::int as count from public.routes')).rows[0]?.count).toBe(0)
    expect((await db.query<{ count: number }>('select count(*)::int as count from public.price_observations')).rows[0]?.count).toBe(0)
    expect((await db.query<{ count: number }>('select count(*)::int as count from public.profiles')).rows[0]?.count).toBe(1)
    await expectSqlState(() => db.query("insert into public.price_observations (route_id, platform, price, observed_at) values ($1, 'uber', 20, now())", [routeA]), '23503')
    await db.exec('reset role')
  })

  it('rejects client supplied ownership and non-manual sources and validates observation values', async () => {
    await db.exec('set role authenticated')
    await asUser(ownerA)
    await expectSqlState(() => db.query("insert into public.price_observations (user_id, route_id, platform, price, observed_at) values ($1, $2, 'uber', 20, now())", [ownerB, routeA]), '42501')
    await expectSqlState(() => db.query("insert into public.price_observations (route_id, platform, price, observed_at, source_type) values ($1, 'uber', 20, now(), 'demo')", [routeA]), '42501')
    await expectSqlState(() => db.query("insert into public.price_observations (route_id, platform, price, observed_at, source_type) values ($1, 'uber', 20, now(), 'authorized_api')", [routeA]), '42501')
    await expectSqlState(() => db.query("insert into public.routes (origin, destination) values ('x', 'Aeroporto Fortaleza')"), '23514')
    await expectSqlState(() => db.query("insert into public.price_observations (route_id, platform, price, observed_at) values ($1, 'uber', 0, now())", [routeA]), '23514')
    await db.exec('reset role')
  })

  it('excludes demo observations from the real-data projection and forbids demo predictions', async () => {
    await db.exec('set role authenticated')
    await asUser(ownerA)
    await expectSqlState(() => db.query(`insert into public.prediction_results
      (route_id, platform, period_start, period_end, bucket_day_of_week, bucket_hour,
       predicted_median_brl, sample_size, based_on_source_types, algorithm_version)
      values ($1, 'uber', now(), now() + interval '1 hour', 1, 9, 20, 2, array['demo']::public.observation_source_type[], 'test')`, [routeA]), '42501')
    const realRows = await db.query<{ count: number }>('select count(*)::int as count from public.real_valid_price_observations')
    expect(realRows.rows[0]?.count).toBe(1)
    await db.exec('reset role')
  })

  it('allows an authenticated owner to update and delete their own records', async () => {
    await db.exec('set role authenticated')
    await asUser(ownerA)
    await db.query("insert into public.routes (id, origin, destination) values ($1, 'Rua CRUD, 10', 'Aeroporto CRUD')", [routeCrud])
    const inserted = await db.query<{ id: string }>("insert into public.price_observations (route_id, platform, price, observed_at) values ($1, '99', 17.5, now()) returning id", [routeCrud])
    const updatedRoute = await db.query("update public.routes set destination = 'Centro CRUD' where id = $1 returning id", [routeCrud])
    expect(updatedRoute.rows).toHaveLength(1)
    const updatedObservation = await db.query("update public.price_observations set validity_status = 'invalid', validity_note = 'Preço incompleto' where id = $1 returning id", [inserted.rows[0]?.id])
    expect(updatedObservation.rows).toHaveLength(1)
    const deletedObservation = await db.query('delete from public.price_observations where id = $1 returning id', [inserted.rows[0]?.id])
    expect(deletedObservation.rows).toHaveLength(1)
    const deletedRoute = await db.query('delete from public.routes where id = $1 returning id', [routeCrud])
    expect(deletedRoute.rows).toHaveLength(1)
    await db.query("insert into public.user_preferences (timezone_name) values ('America/Fortaleza')")
    const updatedPreference = await db.query("update public.user_preferences set theme = 'dark' where user_id = $1 returning user_id", [ownerA])
    expect(updatedPreference.rows).toHaveLength(1)
    expect((await db.query('delete from public.user_preferences where user_id = $1 returning user_id', [ownerA])).rows).toHaveLength(1)
    await db.query("insert into public.integration_status (provider) values ('uber')")
    const updatedIntegration = await db.query("update public.integration_status set status = 'error' where user_id = $1 and provider = 'uber' returning user_id", [ownerA])
    expect(updatedIntegration.rows).toHaveLength(1)
    expect((await db.query("delete from public.integration_status where user_id = $1 and provider = 'uber' returning user_id", [ownerA])).rows).toHaveLength(1)
    await db.exec('reset role')
  })
})
