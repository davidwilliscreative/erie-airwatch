-- Row-level security. Defence in depth: the airwatch schema is not exposed via the
-- API at all, but every table still has RLS on with no anonymous policies.

-- Admin check: a listed admin/reviewer AND a multi-factor session (aal2).
create or replace function airwatch.current_role_name() returns text
language sql stable security definer set search_path = '' as $$
  select a.role from airwatch.admin_users a
  where a.user_id = auth.uid()
    and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create or replace function airwatch.is_reviewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(airwatch.current_role_name() in ('admin', 'reviewer'), false)
$$;

create or replace function airwatch.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(airwatch.current_role_name() = 'admin', false)
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'airports', 'runways', 'zones', 'sources', 'observations', 'raw_responses', 'tracks', 'events',
    'validation_examples', 'coverage_windows', 'checkpoints', 'quota_usage', 'hourly_metrics', 'settings',
    'methodology_versions', 'reports', 'correction_requests', 'admin_users', 'audit_log'
  ] loop
    execute format('alter table airwatch.%I enable row level security', t);
    -- Reviewers (MFA) may read everything.
    execute format('create policy reviewer_read on airwatch.%I for select to authenticated using (airwatch.is_reviewer())', t);
    -- The worker role reads everything and writes where table grants allow.
    execute format('create policy worker_all on airwatch.%I to airwatch_worker using (true) with check (true)', t);
  end loop;
end $$;

-- Admin writes (reviewers may only review events; see the RPCs in 0004).
create policy admin_write on airwatch.zones for all to authenticated using (airwatch.is_admin()) with check (airwatch.is_admin());
create policy admin_write on airwatch.settings for all to authenticated using (airwatch.is_admin()) with check (airwatch.is_admin());
create policy admin_write on airwatch.reports for all to authenticated using (airwatch.is_admin()) with check (airwatch.is_admin());
create policy admin_write on airwatch.sources for all to authenticated using (airwatch.is_admin()) with check (airwatch.is_admin());
create policy reviewer_update on airwatch.events for update to authenticated using (airwatch.is_reviewer()) with check (airwatch.is_reviewer());

grant usage on schema airwatch to authenticated;
grant select on all tables in schema airwatch to authenticated;
grant insert, update, delete on airwatch.zones, airwatch.settings, airwatch.reports, airwatch.sources to authenticated;
grant update (review_status, validation_label, reviewed_by, reviewed_at, review_note) on airwatch.events to authenticated;
revoke all on schema airwatch from anon;
