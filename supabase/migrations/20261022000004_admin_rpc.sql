-- Admin and reviewer operations. Every function checks the caller's role and MFA
-- level, writes the audit log, and is callable only by signed-in users.

create or replace function airwatch.require_reviewer() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not airwatch.is_reviewer() then
    raise exception 'reviewer role with MFA (aal2) required' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function airwatch.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not airwatch.is_admin() then
    raise exception 'admin role with MFA (aal2) required' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function public.admin_whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id', auth.uid(), 'aal', auth.jwt() ->> 'aal', 'role', airwatch.current_role_name())
$$;

create or replace function public.admin_review_queue(p_status text default 'pending', p_kind text default null, p_limit int default 100)
returns setof airwatch.events
language plpgsql stable security definer set search_path = '' as $$
begin
  perform airwatch.require_reviewer();
  return query
    select * from airwatch.events e
    where e.review_status = p_status and (p_kind is null or e.kind = p_kind)
    order by e.confidence asc, e.start_ts desc
    limit least(p_limit, 500);
end $$;

create or replace function public.admin_event_evidence(p_event uuid)
returns table (source_event_id text, ts timestamptz, lat double precision, lon double precision, alt_baro_ft numeric,
               groundspeed_kt numeric, track_deg numeric, is_evidence boolean)
language plpgsql stable security definer set search_path = '' as $$
declare e airwatch.events;
begin
  perform airwatch.require_reviewer();
  select * into e from airwatch.events where id = p_event;
  if not found then raise exception 'event not found'; end if;
  return query
    select o.source_event_id, o.ts, extensions.st_y(o.geom), extensions.st_x(o.geom), o.alt_baro_ft, o.groundspeed_kt,
           o.track_deg, o.source_event_id = any (e.evidence_source_event_ids)
    from airwatch.observations o
    where o.airport_id = e.airport_id and o.aircraft_key = e.aircraft_key
      and o.ts between e.start_ts - interval '90 seconds' and e.end_ts + interval '90 seconds'
    order by o.ts;
end $$;

create or replace function public.admin_review_event(p_event uuid, p_status text, p_label text default null, p_note text default null)
returns airwatch.events
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_before airwatch.events; v_after airwatch.events;
begin
  v_actor := airwatch.require_reviewer();
  select * into v_before from airwatch.events where id = p_event for update;
  if not found then raise exception 'event not found'; end if;
  update airwatch.events set review_status = p_status, validation_label = p_label, review_note = p_note,
         reviewed_by = v_actor, reviewed_at = now()
  where id = p_event returning * into v_after;
  insert into airwatch.audit_log (actor, action, entity, entity_id, before, after, note)
  values (v_actor, 'review_event', 'events', p_event::text,
          jsonb_build_object('review_status', v_before.review_status, 'validation_label', v_before.validation_label),
          jsonb_build_object('review_status', v_after.review_status, 'validation_label', v_after.validation_label), p_note);
  return v_after;
end $$;

create or replace function public.admin_add_validation_example(p_airport uuid, p_kind text, p_label text, p_start timestamptz,
  p_end timestamptz, p_runway text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_id uuid;
begin
  v_actor := airwatch.require_reviewer();
  insert into airwatch.validation_examples (airport_id, kind, label, start_ts, end_ts, runway, note, labeled_by)
  values (p_airport, p_kind, p_label, p_start, p_end, p_runway, p_note, v_actor) returning id into v_id;
  insert into airwatch.audit_log (actor, action, entity, entity_id, note) values (v_actor, 'add_validation_example', 'validation_examples', v_id::text, p_note);
  return v_id;
end $$;

-- Precision/recall from reviewer labels, per kind and confidence label.
create or replace function public.admin_validation_summary(p_airport uuid)
returns table (kind text, confidence_label text, labelled bigint, true_positive bigint, false_positive bigint,
               unsure bigint, missed bigint, precision_score numeric, recall_score numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform airwatch.require_reviewer();
  return query
  with l as (
    select e.kind, e.confidence_label,
           count(*) filter (where e.validation_label is not null) as labelled,
           count(*) filter (where e.validation_label = 'true_positive') as tp,
           count(*) filter (where e.validation_label = 'false_positive') as fp,
           count(*) filter (where e.validation_label = 'unsure') as un
    from airwatch.events e where e.airport_id = p_airport group by 1, 2
  ), m as (
    select v.kind, count(*) as missed from airwatch.validation_examples v
    where v.airport_id = p_airport and v.label = 'missed_event' group by 1
  )
  select l.kind, l.confidence_label, l.labelled, l.tp, l.fp, l.un, coalesce(m.missed, 0),
         round(l.tp::numeric / nullif(l.tp + l.fp, 0), 3),
         round(sum(l.tp) over (partition by l.kind) / nullif(sum(l.tp) over (partition by l.kind) + coalesce(m.missed, 0), 0), 3)
  from l left join m on m.kind = l.kind order by 1, 2;
end $$;

create or replace function public.admin_coverage(p_airport uuid, p_hours int default 48)
returns table (window_start timestamptz, window_end timestamptz, ok boolean, latency_ms int, records int, new_records int, gap_s numeric, error text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform airwatch.require_reviewer();
  return query select c.window_start, c.window_end, c.ok, c.latency_ms, c.records, c.new_records, c.gap_s, c.error
    from airwatch.coverage_windows c
    where c.airport_id = p_airport and c.window_end > now() - make_interval(hours => least(p_hours, 24 * 14))
    order by c.window_end desc limit 2000;
end $$;

create or replace function public.admin_set_policy(p_airport uuid, p_mode text, p_min_conf numeric, p_delay_min int)
returns airwatch.settings language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_before airwatch.settings; v_after airwatch.settings;
begin
  v_actor := airwatch.require_admin();
  select * into v_before from airwatch.settings where airport_id = p_airport;
  update airwatch.settings set publication_mode = p_mode, min_public_confidence = p_min_conf,
         public_position_delay_minutes = p_delay_min, updated_at = now()
  where airport_id = p_airport returning * into v_after;
  insert into airwatch.audit_log (actor, action, entity, entity_id, before, after)
  values (v_actor, 'set_policy', 'settings', p_airport::text, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end $$;

create or replace function public.admin_upsert_zone(p_airport uuid, p_slug text, p_label text, p_geojson jsonb, p_public boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_id uuid; v_geom extensions.geometry;
begin
  v_actor := airwatch.require_admin();
  v_geom := extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson::text), 4326);
  if extensions.geometrytype(v_geom) <> 'POLYGON' or not extensions.st_isvalid(v_geom) then
    raise exception 'zone must be a valid polygon';
  end if;
  insert into airwatch.zones (airport_id, slug, label, geom, is_public)
  values (p_airport, p_slug, p_label, v_geom, p_public)
  on conflict (airport_id, slug) do update set label = excluded.label, geom = excluded.geom, is_public = excluded.is_public,
    version = airwatch.zones.version + 1, updated_at = now(), synthetic = false
  returning id into v_id;
  insert into airwatch.audit_log (actor, action, entity, entity_id, after)
  values (v_actor, 'upsert_zone', 'zones', v_id::text, jsonb_build_object('slug', p_slug, 'label', p_label));
  return v_id;
end $$;

-- Reports: snapshot metrics into a draft, then approve, then publish.
create or replace function airwatch.report_metrics(p_airport uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'totals', (select coalesce(jsonb_object_agg(metric, total), '{}') from (
        select metric, sum(value) as total from airwatch.hourly_metrics
        where airport_id = p_airport and hour_start >= p_start and hour_start < p_end and zone_id is null
          and metric not in ('coverage_pct', 'observed_aircraft') group by metric) t),
    'zones', (select coalesce(jsonb_agg(jsonb_build_object('zone_id', zone_id, 'label', label, 'metric', metric, 'total', total)), '[]') from (
        select m.zone_id, z.label, m.metric, sum(m.value) as total from airwatch.hourly_metrics m join airwatch.zones z on z.id = m.zone_id
        where m.airport_id = p_airport and m.hour_start >= p_start and m.hour_start < p_end group by 1, 2, 3) t),
    'mean_coverage_pct', (select round(avg(value)) from airwatch.hourly_metrics
        where airport_id = p_airport and hour_start >= p_start and hour_start < p_end and metric = 'coverage_pct'),
    'settings', (select to_jsonb(s) from airwatch.settings s where s.airport_id = p_airport)
  )
$$;

create or replace function public.admin_create_report(p_airport uuid, p_kind text, p_start timestamptz, p_end timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_id uuid; v_method text;
begin
  v_actor := airwatch.require_admin();
  select version into v_method from airwatch.methodology_versions order by released_at desc limit 1;
  insert into airwatch.reports (airport_id, kind, period_start, period_end, metrics, methodology_version)
  values (p_airport, p_kind, p_start, p_end, airwatch.report_metrics(p_airport, p_start, p_end), v_method)
  returning id into v_id;
  insert into airwatch.audit_log (actor, action, entity, entity_id) values (v_actor, 'create_report', 'reports', v_id::text);
  return v_id;
end $$;

create or replace function public.admin_set_report_status(p_report uuid, p_status text, p_note text default null)
returns airwatch.reports language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_before airwatch.reports; v_after airwatch.reports;
begin
  v_actor := airwatch.require_admin();
  select * into v_before from airwatch.reports where id = p_report for update;
  if not found then raise exception 'report not found'; end if;
  if p_status = 'published' and v_before.status not in ('approved', 'published') then
    raise exception 'a report must be approved before it is published';
  end if;
  update airwatch.reports set status = p_status,
    approved_by = case when p_status = 'approved' then v_actor else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    published_at = case when p_status = 'published' then now() else published_at end,
    corrections = case when p_note is not null then corrections || jsonb_build_array(jsonb_build_object('at', now(), 'note', p_note)) else corrections end
  where id = p_report returning * into v_after;
  insert into airwatch.audit_log (actor, action, entity, entity_id, before, after, note)
  values (v_actor, 'set_report_status', 'reports', p_report::text, jsonb_build_object('status', v_before.status),
          jsonb_build_object('status', v_after.status), p_note);
  return v_after;
end $$;

create or replace function public.admin_list_reports(p_airport uuid)
returns table (id uuid, kind text, period_start timestamptz, period_end timestamptz, status text, version int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform airwatch.require_admin();
  return query select r.id, r.kind, r.period_start, r.period_end, r.status, r.version
    from airwatch.reports r where r.airport_id = p_airport order by r.period_start desc limit 100;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_whoami()', 'admin_list_reports(uuid)', 'admin_review_queue(text, text, int)', 'admin_event_evidence(uuid)',
    'admin_review_event(uuid, text, text, text)',
    'admin_add_validation_example(uuid, text, text, timestamptz, timestamptz, text, text)',
    'admin_validation_summary(uuid)', 'admin_coverage(uuid, int)', 'admin_set_policy(uuid, text, numeric, int)',
    'admin_upsert_zone(uuid, text, text, jsonb, boolean)', 'admin_create_report(uuid, text, timestamptz, timestamptz)',
    'admin_set_report_status(uuid, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
