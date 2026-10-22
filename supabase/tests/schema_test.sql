-- Schema, RLS and RPC tests. Run with scripts/test-db.sh (local PostGIS) after seed.sql.
\set ON_ERROR_STOP on
set search_path = public, extensions;

-- Fixtures: two observations (one duplicate attempt), events in each review state, an admin and a non-admin.
insert into airwatch.admin_users values ('11111111-1111-1111-1111-111111111111', 'admin');
insert into airwatch.observations (airport_id, source_id, source_event_id, ts, aircraft_key, geom, alt_baro_ft)
select a.id, s.id, 'fx-1', now() - interval '10 minutes', 'abc123', st_setsrid(st_makepoint(-105.048, 40.010), 4326), 6100
from airwatch.airports a, airwatch.sources s where a.icao = 'KEIK' and s.name = 'synthetic';
insert into airwatch.observations (airport_id, source_id, source_event_id, ts, aircraft_key, geom, alt_baro_ft)
select a.id, s.id, 'fx-1', now() - interval '10 minutes', 'abc123', st_setsrid(st_makepoint(-105.048, 40.010), 4326), 6100
from airwatch.airports a, airwatch.sources s where a.icao = 'KEIK' and s.name = 'synthetic'
on conflict do nothing;
do $$ begin
  assert (select count(*) from airwatch.observations where source_event_id = 'fx-1') = 1, 'duplicate observation was stored';
end $$;

insert into airwatch.events (id, airport_id, kind, track_id, aircraft_key, start_ts, end_ts, algorithm_version, confidence, confidence_label, review_status)
select v.id::uuid, a.id, 'circuit', gen_random_uuid(), 'abc123', now() - interval '1 hour', now() - interval '50 minutes', '1.0.0', v.conf, v.lab, v.status
from airwatch.airports a,
  (values ('aaaaaaaa-0000-0000-0000-000000000001', 0.9, 'high', 'approved'),
          ('aaaaaaaa-0000-0000-0000-000000000002', 0.9, 'high', 'pending'),
          ('aaaaaaaa-0000-0000-0000-000000000003', 0.9, 'high', 'rejected'),
          ('aaaaaaaa-0000-0000-0000-000000000004', 0.3, 'low', 'approved')) v(id, conf, lab, status)
where a.icao = 'KEIK';

-- 1. Anonymous visitors cannot touch base tables.
set role anon;
do $$ begin
  begin
    perform 1 from airwatch.observations limit 1;
    assert false, 'anon could read airwatch.observations';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 2. Anonymous visitors can read public views, which expose no aircraft identifiers.
do $$ begin
  assert (select count(*) from public.airports_public) = 1, 'airport view';
  assert (select count(*) from public.zones_public) = 3, 'zones view';
  assert (select count(*) from public.recent_positions) = 1, 'recent positions view';
  assert not exists (select 1 from information_schema.columns where table_name = 'recent_positions'
                     and column_name in ('aircraft_key', 'callsign')), 'identifiers leaked in recent_positions';
  -- reviewed_only: only the approved, adequately-confident event is public.
  assert (select array_agg(id::text) from public.events_public) = array['aaaaaaaa-0000-0000-0000-000000000001'], 'reviewed_only policy';
end $$;

-- 3. Admin RPCs are not callable by anon at all.
do $$ begin
  begin
    perform public.admin_review_queue();
    assert false, 'anon called admin rpc';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 4. Signed-in but not an admin: refused.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal2"}', false);
do $$ begin
  begin
    perform public.admin_review_queue();
    assert false, 'non-admin called admin rpc';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 5. Admin without MFA (aal1): refused.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal1"}', false);
do $$ begin
  begin
    perform public.admin_review_queue();
    assert false, 'admin without MFA called admin rpc';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6. Admin with MFA: review queue works, reviews are audited, reports need approval before publishing.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}', false);
do $$
declare r uuid; ap uuid;
begin
  assert (select count(*) from public.admin_review_queue('pending')) = 1, 'review queue';
  perform public.admin_review_event('aaaaaaaa-0000-0000-0000-000000000002', 'approved', 'true_positive', 'looks right');
  assert (select count(*) from airwatch.audit_log where action = 'review_event') = 1, 'audit log';
  select id into ap from public.airports_public;
  r := public.admin_create_report(ap, 'weekly', now() - interval '7 days', now());
  begin
    perform public.admin_set_report_status(r, 'published');
    assert false, 'published without approval';
  exception when raise_exception then null;
  end;
  perform public.admin_set_report_status(r, 'approved');
  perform public.admin_set_report_status(r, 'published');
end $$;
reset role;

do $$ begin
  assert (select count(*) from public.events_public) = 2, 'approved event now public';
  assert (select count(*) from public.reports_public) = 1, 'published report visible';
  assert (select count(*) from airwatch.audit_log) >= 4, 'report actions audited';
end $$;

-- 7. Qualified mode publishes confident unreviewed events but never rejected or low-confidence ones.
update airwatch.settings set publication_mode = 'qualified';
do $$ begin
  assert (select count(*) from public.events_public where review_status = 'rejected') = 0, 'rejected leaked';
  assert (select count(*) from public.events_public where confidence < 0.5) = 0, 'low confidence leaked';
end $$;
update airwatch.settings set publication_mode = 'reviewed_only';

-- 8. Public correction requests: anon may submit, but may not read them back.
set role anon;
select public.submit_correction('The zone label for Sample Zone A is wrong.', null, '/methodology') is not null as submitted;
do $$ begin
  begin
    perform 1 from airwatch.correction_requests;
    assert false, 'anon read correction requests';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Clean up fixtures so the demo load starts clean.
delete from airwatch.reports; delete from airwatch.audit_log; delete from airwatch.events;
delete from airwatch.observations; delete from airwatch.correction_requests; delete from airwatch.admin_users;
select 'schema tests passed' as result;
