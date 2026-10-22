begin;
select plan(17);

insert into auth.users (id, aud, role, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner-a@example.test', '', '{"display_name":"Owner A"}', now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'owner-b@example.test', '', '{"display_name":"Owner B"}', now(), now())
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
insert into public.routes (id, origin, destination) values
  ('a0000000-0000-0000-0000-000000000001', 'Rua Um, 100', 'Aeroporto Fortaleza');
insert into public.routes (id, user_id, origin, destination) values
  ('b0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Rua Dois, 200', 'Centro Fortaleza');
insert into public.price_observations (id, route_id, platform, price, observed_at)
values ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'uber', 15, now());

select is((select count(*)::int from public.routes), 1, 'owner only sees own routes');
select is((select count(*)::int from public.price_observations), 1, 'owner only sees own observations');
select is((select count(*)::int from public.profiles), 1, 'owner only sees own profile');
select throws_ok($$insert into public.routes (user_id, origin, destination) values ('20000000-0000-0000-0000-000000000002', 'Rua Três, 300', 'Centro Fortaleza')$$, '42501', null, 'cannot insert a route for a different user');
select throws_ok($$update public.routes set user_id = '20000000-0000-0000-0000-000000000002' where id = 'a0000000-0000-0000-0000-000000000001'$$, '42501', null, 'cannot reassign an owned route to another user');
select throws_ok($$insert into public.price_observations (route_id, platform, price, observed_at, source_type) values ('a0000000-0000-0000-0000-000000000001', 'uber', 20, now(), 'demo')$$, '42501', null, 'browser cannot insert demo rows');
select throws_ok($$insert into public.price_observations (route_id, platform, price, observed_at, source_type) values ('a0000000-0000-0000-0000-000000000001', 'uber', 20, now(), 'authorized_api')$$, '42501', null, 'browser cannot claim authorized API source');
select throws_ok($$insert into public.price_observations (user_id, route_id, platform, price, observed_at) values ('20000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'uber', 20, now())$$, '42501', null, 'cannot insert observation for another user');
select throws_ok($$insert into public.routes (origin, destination) values ('x', 'Aeroporto Fortaleza')$$, '23514', null, 'database validates minimum address length');
select throws_ok($$insert into public.price_observations (route_id, platform, price, observed_at) values ('a0000000-0000-0000-0000-000000000001', 'uber', 0, now())$$, '23514', null, 'database rejects non-positive prices');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select is((select count(*)::int from public.routes), 1, 'second owner sees only own route');
select is((select count(*)::int from public.price_observations), 0, 'second owner cannot see first owner observations');
select is((select count(*)::int from public.routes where id = 'a0000000-0000-0000-0000-000000000001'), 0, 'foreign route is filtered by RLS predicate');
select throws_ok($$insert into public.price_observations (route_id, platform, price, observed_at) values ('a0000000-0000-0000-0000-000000000001', 'uber', 22, now())$$, '23503', null, 'composite foreign key prevents linking another users route');
select throws_ok($$insert into public.prediction_results (route_id, platform, period_start, period_end, bucket_day_of_week, bucket_hour, predicted_median_brl, sample_size, based_on_source_types, algorithm_version) values ('b0000000-0000-0000-0000-000000000002', 'uber', now(), now() + interval '1 hour', 1, 9, 20, 2, array['demo']::public.observation_source_type[], 'test')$$, '42501', null, 'prediction writes are server-only');
select is((select count(*)::int from public.real_valid_price_observations), 0, 'real view excludes demo and remains row scoped');
reset role;
select throws_ok($$insert into public.prediction_results (user_id, route_id, platform, period_start, period_end, bucket_day_of_week, bucket_hour, predicted_median_brl, sample_size, based_on_source_types, algorithm_version) values ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'uber', now(), now() + interval '1 hour', 1, 9, 20, 2, array['demo']::public.observation_source_type[], 'test')$$, '23514', null, 'database excludes demo from predictions');

select * from finish();
rollback;
