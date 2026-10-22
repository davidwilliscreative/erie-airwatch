-- Read-only public API. These views run with their owner's rights and expose only
-- aggregated or deliberately coarsened data. Base tables stay private.

create or replace function airwatch.is_publishable(e airwatch.events) returns boolean
language sql stable security definer set search_path = '' as $$
  select e.review_status <> 'rejected'
     and e.confidence >= s.min_public_confidence
     and (e.review_status = 'approved' or (s.publication_mode = 'qualified' and e.review_status = 'pending'))
  from airwatch.settings s where s.airport_id = e.airport_id
$$;

create or replace view public.airports_public as
select a.id, a.icao, a.name, a.timezone, st_y(a.reference) as lat, st_x(a.reference) as lon,
       a.elevation_ft, a.pattern_altitude_ft, a.pattern_verified
from airwatch.airports a where a.active;

create or replace view public.runways_public as
select r.id, r.airport_id, r.ident, r.length_ft, r.ends, st_asgeojson(r.centerline)::jsonb as centerline, r.source, r.version
from airwatch.runways r join airwatch.airports a on a.id = r.airport_id where a.active;

create or replace view public.zones_public as
select z.id, z.airport_id, z.slug, z.label, z.synthetic, z.version, st_asgeojson(z.geom, 6)::jsonb as geometry
from airwatch.zones z join airwatch.airports a on a.id = z.airport_id where a.active and z.is_public;

-- Feed freshness: live / delayed / offline, computed from the latest successful poll.
create or replace view public.source_status as
with last as (
  select cw.airport_id, cw.source_id, max(cw.window_end) filter (where cw.ok) as last_success,
         max(cw.window_end) as last_attempt
  from airwatch.coverage_windows cw group by 1, 2
), last_obs as (
  select o.airport_id, o.source_id, max(o.ts) as last_observation
  from airwatch.observations o where o.ts > now() - interval '2 days' group by 1, 2
)
select l.airport_id, s.name as source_name, s.provider, s.freshness_expectation_s, l.last_success, l.last_attempt,
       lo.last_observation,
       case
         when l.last_success is null or now() - l.last_success > make_interval(secs => s.freshness_expectation_s * 15) then 'offline'
         when now() - l.last_success > make_interval(secs => s.freshness_expectation_s * 3) then 'delayed'
         else 'live'
       end as status
from last l join airwatch.sources s on s.id = l.source_id
left join last_obs lo on lo.airport_id = l.airport_id and lo.source_id = l.source_id
where s.allows_public_display;

-- Recent positions: delayed, time-bounded, downsampled to one point per aircraft per 15 s,
-- and keyed by a pseudonym that changes daily. No hex codes or callsigns.
create or replace view public.recent_positions as
select distinct on (o.aircraft_key, floor(extract(epoch from o.ts) / 15))
  o.airport_id,
  left(encode(extensions.digest(o.aircraft_key || current_date::text || o.airport_id::text, 'sha256'), 'hex'), 6) as pseudonym,
  o.ts, round(st_y(o.geom)::numeric, 4) as lat, round(st_x(o.geom)::numeric, 4) as lon,
  o.alt_baro_ft, o.groundspeed_kt, o.track_deg
from airwatch.observations o
join airwatch.sources src on src.id = o.source_id and src.allows_public_display
join airwatch.settings st on st.airport_id = o.airport_id
where o.ts > now() - make_interval(mins => st.public_position_delay_minutes + st.public_position_window_minutes)
  and o.ts <= now() - make_interval(mins => st.public_position_delay_minutes)
order by o.aircraft_key, floor(extract(epoch from o.ts) / 15), o.ts;

create or replace view public.hourly_metrics_public as
select m.airport_id, m.hour_start, m.metric, m.zone_id, m.value
from airwatch.hourly_metrics m join airwatch.airports a on a.id = m.airport_id where a.active;

create or replace view public.events_public as
select e.id, e.airport_id, e.kind, e.zone_id, e.runway, e.start_ts, e.end_ts, e.algorithm_version,
       e.confidence, e.confidence_label, e.review_status, e.min_alt_ft, e.max_alt_ft
from airwatch.events e
where airwatch.is_publishable(e) and e.start_ts > now() - interval '400 days';

create or replace view public.coverage_daily as
select cw.airport_id, (cw.window_end at time zone a.timezone)::date as day,
       count(*) as polls, count(*) filter (where cw.ok) as ok_polls,
       round(coalesce(sum(cw.gap_s) filter (where cw.gap_s > s.freshness_expectation_s * 2.5), 0) / 60) as gap_minutes
from airwatch.coverage_windows cw
join airwatch.airports a on a.id = cw.airport_id
join airwatch.sources s on s.id = cw.source_id
group by 1, 2;

create or replace view public.reports_public as
select r.id, r.airport_id, r.kind, r.period_start, r.period_end, r.metrics, r.methodology_version, r.version,
       r.corrections, r.generated_at, r.published_at
from airwatch.reports r where r.status = 'published';

create or replace view public.methodology_public as
select version, released_at, thresholds, changelog from airwatch.methodology_versions;

create or replace view public.settings_public as
select airport_id, publication_mode, min_public_confidence, public_position_delay_minutes from airwatch.settings;

do $$
declare v text;
begin
  foreach v in array array['airports_public', 'runways_public', 'zones_public', 'source_status', 'recent_positions',
    'hourly_metrics_public', 'events_public', 'coverage_daily', 'reports_public', 'methodology_public', 'settings_public'] loop
    execute format('revoke all on public.%I from public', v);
    execute format('grant select on public.%I to anon, authenticated', v);
  end loop;
end $$;

-- Public correction requests (rate-limited by the website before this is called).
create or replace function public.submit_correction(p_message text, p_contact text default null, p_page text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (select count(*) from airwatch.correction_requests where created_at > now() - interval '1 hour') > 50 then
    raise exception 'too many requests, try again later';
  end if;
  insert into airwatch.correction_requests (message, contact, page)
  values (left(trim(p_message), 4000), nullif(left(trim(p_contact), 200), ''), left(p_page, 300))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.submit_correction(text, text, text) from public;
grant execute on function public.submit_correction(text, text, text) to anon, authenticated;

-- PostGIS cross-check for the Python detector: zone crossings from consecutive observation segments.
create or replace function airwatch.zone_segment_hits(p_airport uuid, p_start timestamptz, p_end timestamptz, p_max_gap_s numeric default 120)
returns table (zone_id uuid, aircraft_key text, segments bigint)
language sql stable set search_path = '' as $$
  with seg as (
    select o.aircraft_key, o.ts, o.geom,
           lag(o.geom) over w as prev_geom, lag(o.ts) over w as prev_ts
    from airwatch.observations o
    where o.airport_id = p_airport and o.ts >= p_start and o.ts < p_end
    window w as (partition by o.aircraft_key order by o.ts)
  )
  select z.id, s.aircraft_key, count(*)
  from seg s join airwatch.zones z on z.airport_id = p_airport
   and extensions.st_intersects(z.geom, extensions.st_makeline(s.prev_geom, s.geom))
  where s.prev_geom is not null and extract(epoch from s.ts - s.prev_ts) <= p_max_gap_s
  group by 1, 2
$$;
