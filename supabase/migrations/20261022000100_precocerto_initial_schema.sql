-- PreçoCerto: tenant isolation is enforced by PostgreSQL RLS, not client filters.
create type public.ride_platform as enum ('uber', '99');
create type public.observation_source_type as enum ('manual', 'authorized_api', 'demo');
create type public.observation_validity as enum ('valid', 'invalid', 'needs_review');
create type public.integration_connection_state as enum ('not_configured', 'connected', 'error', 'revoked');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  origin text not null check (char_length(btrim(origin)) between 3 and 160),
  destination text not null check (char_length(btrim(destination)) between 3 and 160),
  category text not null default '' check (char_length(category) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.price_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  route_id uuid not null,
  platform public.ride_platform not null,
  category text not null default '' check (char_length(category) <= 80),
  price numeric(10, 2) not null check (price > 0 and price <= 100000),
  currency char(3) not null default 'BRL' check (currency = 'BRL'),
  observed_at timestamptz not null,
  source_type public.observation_source_type not null default 'manual',
  validity_status public.observation_validity not null default 'valid',
  validity_note text check (validity_note is null or char_length(validity_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invalid_observation_has_note check (validity_status <> 'invalid' or validity_note is not null),
  constraint price_route_belongs_to_same_user foreign key (user_id, route_id)
    references public.routes (user_id, id) on delete cascade
);

create table public.prediction_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  route_id uuid not null,
  platform public.ride_platform not null,
  category text not null default '' check (char_length(category) <= 80),
  period_start timestamptz not null,
  period_end timestamptz not null,
  bucket_day_of_week smallint not null check (bucket_day_of_week between 0 and 6),
  bucket_hour smallint not null check (bucket_hour between 0 and 23),
  predicted_median_brl numeric(10, 2) not null check (predicted_median_brl > 0 and predicted_median_brl <= 100000),
  sample_size integer not null check (sample_size > 0),
  based_on_source_types public.observation_source_type[] not null default array['manual']::public.observation_source_type[],
  algorithm_version text not null check (char_length(algorithm_version) between 1 and 80),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint prediction_period_is_ordered check (period_end > period_start),
  constraint prediction_excludes_demo check (
    cardinality(based_on_source_types) > 0 and not ('demo'::public.observation_source_type = any (based_on_source_types))
  ),
  constraint prediction_route_belongs_to_same_user foreign key (user_id, route_id)
    references public.routes (user_id, id) on delete cascade
);

create table public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  timezone_name text not null default 'America/Fortaleza' check (char_length(timezone_name) between 1 and 64),
  locale text not null default 'pt-BR' check (locale = 'pt-BR'),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.integration_status (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider public.ride_platform not null,
  status public.integration_connection_state not null default 'not_configured',
  status_message text check (status_message is null or char_length(status_message) <= 500),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create index routes_user_created_idx on public.routes (user_id, created_at desc);
create index price_observations_user_route_time_idx on public.price_observations (user_id, route_id, observed_at desc);
create index price_observations_user_platform_time_idx on public.price_observations (user_id, platform, observed_at desc);
create index price_observations_real_history_idx on public.price_observations (user_id, route_id, platform, observed_at desc)
  where source_type <> 'demo' and validity_status = 'valid';
create index prediction_results_user_route_time_idx on public.prediction_results (user_id, route_id, generated_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger routes_set_updated_at before update on public.routes
  for each row execute function public.set_updated_at();
create trigger price_observations_set_updated_at before update on public.price_observations
  for each row execute function public.set_updated_at();
create trigger user_preferences_set_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();
create trigger integration_status_set_updated_at before update on public.integration_status
  for each row execute function public.set_updated_at();

create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, pg_catalog.left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 100));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

-- Useful for projects where users existed before this migration was applied.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.routes enable row level security;
alter table public.price_observations enable row level security;
alter table public.prediction_results enable row level security;
alter table public.user_preferences enable row level security;
alter table public.integration_status enable row level security;

-- Remove ambient access first; only the authenticated role receives client grants.
revoke all on public.profiles, public.routes, public.price_observations,
  public.prediction_results, public.user_preferences, public.integration_status
  from public, anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.routes, public.price_observations,
  public.user_preferences, public.integration_status to authenticated;
grant select on public.prediction_results to authenticated;
-- Supabase's service_role is intended only for trusted server-side code.
grant all on public.profiles, public.routes, public.price_observations,
  public.prediction_results, public.user_preferences, public.integration_status
  to service_role;

create policy profiles_select_own on public.profiles for select to authenticated
  using ((select auth.uid()) is not null and id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) is not null and id = (select auth.uid()))
  with check ((select auth.uid()) is not null and id = (select auth.uid()));

create policy routes_select_own on public.routes for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy routes_insert_own on public.routes for insert to authenticated
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy routes_update_own on public.routes for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy routes_delete_own on public.routes for delete to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

-- Browser users can create and manage only manually observed rows. Trusted server
-- code may add authorized_api/demo rows with a server-only secret key.
create policy observations_select_own on public.price_observations for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy observations_insert_manual_own on public.price_observations for insert to authenticated
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()) and source_type = 'manual');
create policy observations_update_manual_own on public.price_observations for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()) and source_type = 'manual')
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()) and source_type = 'manual');
create policy observations_delete_own on public.price_observations for delete to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy predictions_select_own on public.prediction_results for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy preferences_select_own on public.user_preferences for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy preferences_insert_own on public.user_preferences for insert to authenticated
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy preferences_update_own on public.user_preferences for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy preferences_delete_own on public.user_preferences for delete to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy integration_status_select_own on public.integration_status for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy integration_status_insert_own on public.integration_status for insert to authenticated
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy integration_status_update_own on public.integration_status for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy integration_status_delete_own on public.integration_status for delete to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

-- RLS is evaluated as the querying user; demo and invalid rows never enter this
-- projection that is intended for future historical analysis.
create view public.real_valid_price_observations
with (security_invoker = true)
as
select id, user_id, route_id, platform, category, price, currency, observed_at, source_type
from public.price_observations
where source_type <> 'demo' and validity_status = 'valid';

revoke all on public.real_valid_price_observations from public, anon;
grant select on public.real_valid_price_observations to authenticated;

revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
