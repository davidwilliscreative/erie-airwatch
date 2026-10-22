drop function if exists airwatch.zone_segment_hits(uuid, timestamptz, timestamptz, numeric);
drop function if exists public.submit_correction(text, text, text);
drop view if exists public.settings_public, public.methodology_public, public.reports_public, public.coverage_daily,
  public.events_public, public.hourly_metrics_public, public.recent_positions, public.source_status,
  public.zones_public, public.runways_public, public.airports_public;
drop function if exists airwatch.is_publishable(airwatch.events);
