-- Erie AirWatch core schema.
-- Base tables live in the private `airwatch` schema, which is NOT exposed through
-- the Supabase API. The public website reads only the views in 0003, and the
-- admin UI goes through the checked RPC functions in 0004.
--
-- Conventions: UUID keys, timestamptz in UTC, WGS84 geometry (EPSG:4326),
-- airport_id on every airport-scoped table even though only KEIK is enabled.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists airwatch;

create table airwatch.airports (
  id uuid primary key default gen_random_uuid(),
  icao text not null unique check (icao ~ '^[A-Z0-9]{3,4}$'),
  name text not null,
  timezone text not null,
  reference geometry(Point, 4326) not null,
  elevation_ft numeric not null,
  pattern_altitude_ft numeric,
  pattern_verified boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table airwatch.runways (
  id uuid primary key default gen_random_uuid(),
  airport_id uuid not null references airwatch.airports(id) on delete cascade,
  ident text not null,                              -- e.g. '15/33'
  length_ft numeric not null,
  width_ft numeric,
  centerline geometry(LineString, 4326) not null,
  ends jsonb not null,                              -- [{ident, lat, lon, elevation_ft_msl, landing_heading_deg, pattern_direction}]
  source text not null,
  version text not null,
  created_at timestamptz not null default now(),
  unique (airport_id, ident, version)
);

create table airwatch.zones (
  id uuid primary key default gen_random_uuid(),
  airport_id uuid not null references airwatch.airports(id) on delete cascade,
  slug text not null,
  label text not null,
  geom geometry(Polygon, 4326) not null check (st_isvalid(geom)),
  is_public boolean not null default true,
  synthetic boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (airport_id, slug)
);
create index zones_geom_idx on airwatch.zones using gist (geom);

create table airwatch.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  provider text not null,
  license_ref text,
  allows_public_display boolean not null default false,
  allows_raw_retention boolean not null default false,
  allows_aircraft_id_display boolean not null default false,
  raw_retention_days integer,
  observation_retention_days integer not null default 400,
  freshness_expectation_s integer not null default 60,
  active boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

-- High-volume table. If it grows past tens of millions of rows, convert to
-- monthly range partitions on ts (see docs/adr/0003-database.md).
create table airwatch.observations (
  id uuid primary key default gen_random_uuid(),
  airport_id uuid not null references airwatch.airports(id),
  source_id uuid not null references airwatch.sources(id),
  source_event_id text not null,
  ts timestamptz not null,
  aircraft_key text not null,                        -- ICAO hex only where the licence permits; else a pseudonym
  geom geometry(Point, 4326) not null,
  alt_baro_ft numeric,
  alt_geom_ft numeric,
  groundspeed_kt numeric,
  track_deg numeric,
  vertical_rate_fpm numeric,
  on_ground boolean,
  callsign text,
  quality_flags text[] not null default '{}',
  ingested_at timestamptz not null default now(),
  unique (source_id, source_event_id),
  unique (source_id, aircraft_key, ts)
);
create index observations_airport_ts_idx on airwatch.observations (airport_id, ts);
create index observations_aircraft_ts_idx on airwatch.observations (aircraft_key, ts);
create index observations_geom_idx on airwatch.observations using gist (geom);

create table airwatch.raw_responses (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references airwatch.sources(id),
  fetched_at timestamptz not null,
  body jsonb not null
);

create table airwatch.tracks (
  id uuid primary key,
  airport_id uuid not null references airwatch.airports(id),
  aircraft_key text not null,
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  point_count integer not null,
  gap_summary jsonb not null default '[]'::jsonb,
  source_ids uuid[] not null default '{}',
  algorithm_version text not null
);
create index tracks_airport_start_idx on airwatch.tracks (airport_id, start_ts);

create table airwatch.events (
  id uuid primary key,                                -- deterministic: uuid5(version, kind, track, start, zone)
  airport_id uuid not null references airwatch.airports(id),
  kind text not null check (kind in ('overflight', 'circuit', 'likely_touch_and_go', 'probable_full_stop', 'low_approach')),
  track_id uuid not null,
  aircraft_key text not null,
  zone_id uuid references airwatch.zones(id),
  runway text,
  start_ts timestamptz not null,
  end_ts timestamptz not null check (end_ts >= start_ts),
  algorithm_version text not null,
  confidence numeric not null check (confidence between 0 and 1),
  confidence_label text not null check (confidence_label in ('low', 'medium', 'high')),
  min_alt_ft numeric,
  max_alt_ft numeric,
  evidence_source_event_ids text[] not null default '{}',
  details jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected', 'needs_more_data')),
  validation_label text check (validation_label in ('true_positive', 'false_positive', 'unsure')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index events_airport_start_idx on airwatch.events (airport_id, start_ts);
create index events_review_idx on airwatch.events (review_status, kind);
create index events_zone_idx on airwatch.events (zone_id, start_ts) where zone_id is not null;

-- Reviewer-labelled examples the detector did NOT flag (missed events, non-events),
-- so recall can be measured, not just precision.
create table airwatch.validation_examples (
  id uuid primary key default gen_random_uuid(),
  airport_id uuid not null references airwatch.airports(id),
  kind text not null,
  label text not null check (label in ('missed_event', 'non_event')),
  aircraft_key text,
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  runway text,
  note text,
  labeled_by uuid,
  created_at timestamptz not null default now()
);

create table airwatch.coverage_windows (
  id bigint generated always as identity primary key,
  airport_id uuid not null references airwatch.airports(id),
  source_id uuid not null references airwatch.sources(id),
  window_start timestamptz not null,
  window_end timestamptz not null,
  ok boolean not null,
  latency_ms integer,
  records integer not null default 0,
  new_records integer not null default 0,
  gap_s numeric,
  error text
);
create index coverage_windows_airport_idx on airwatch.coverage_windows (airport_id, window_end);

create table airwatch.checkpoints (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table airwatch.quota_usage (
  source_id uuid not null references airwatch.sources(id),
  period text not null,
  units integer not null default 0,
  primary key (source_id, period)
);

-- Cached public aggregates written by the processing job.
create table airwatch.hourly_metrics (
  airport_id uuid not null references airwatch.airports(id),
  hour_start timestamptz not null,
  metric text not null,
  zone_id uuid references airwatch.zones(id),
  value integer not null
);
create unique index hourly_metrics_key on airwatch.hourly_metrics
  (airport_id, hour_start, metric, coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table airwatch.settings (
  airport_id uuid primary key references airwatch.airports(id),
  publication_mode text not null default 'reviewed_only' check (publication_mode in ('reviewed_only', 'qualified')),
  min_public_confidence numeric not null default 0.5 check (min_public_confidence between 0 and 1),
  public_position_delay_minutes integer not null default 5 check (public_position_delay_minutes >= 0),
  public_position_window_minutes integer not null default 30 check (public_position_window_minutes between 1 and 120),
  updated_at timestamptz not null default now()
);

create table airwatch.methodology_versions (
  version text primary key,
  released_at timestamptz not null default now(),
  thresholds jsonb not null,
  changelog text not null
);

create table airwatch.reports (
  id uuid primary key default gen_random_uuid(),
  airport_id uuid not null references airwatch.airports(id),
  kind text not null check (kind in ('weekly', 'monthly', 'custom')),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  metrics jsonb not null,
  methodology_version text not null references airwatch.methodology_versions(version),
  status text not null default 'draft' check (status in ('draft', 'approved', 'published', 'withdrawn')),
  version integer not null default 1,
  corrections jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  published_at timestamptz,
  csv_path text,
  pdf_path text
);

create table airwatch.correction_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  page text check (length(page) <= 300),
  message text not null check (length(message) between 10 and 4000),
  contact text check (length(contact) <= 200),
  status text not null default 'new' check (status in ('new', 'in_review', 'resolved', 'dismissed')),
  resolution_note text
);

create table airwatch.admin_users (
  user_id uuid primary key,                         -- references auth.users(id) on Supabase
  role text not null check (role in ('admin', 'reviewer')),
  created_at timestamptz not null default now()
);

create table airwatch.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  note text
);
create index audit_log_at_idx on airwatch.audit_log (at desc);

-- Worker role: connects directly with DATABASE_URL, writes ingest/processing tables only.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'airwatch_worker') then
    create role airwatch_worker nologin;
  end if;
end $$;
grant usage on schema airwatch to airwatch_worker;
grant usage on schema extensions to airwatch_worker;
grant select on all tables in schema airwatch to airwatch_worker;
grant insert, update on airwatch.observations, airwatch.raw_responses, airwatch.tracks, airwatch.coverage_windows,
  airwatch.checkpoints, airwatch.quota_usage to airwatch_worker;
grant insert, update (confidence, confidence_label, details, evidence_source_event_ids) on airwatch.events to airwatch_worker;
grant insert, delete on airwatch.hourly_metrics to airwatch_worker;
