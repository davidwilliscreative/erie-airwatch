# Operations: deploy, monitor, recover

## 1. Supabase
1. Create a project. In **Database → Extensions**, PostGIS is installed by the migration.
2. Install the Supabase CLI, then from the repo root: `supabase link --project-ref <ref>` and `supabase db push`
   (applies `supabase/migrations`). Run `supabase/seed.sql` once in the SQL editor.
3. **Auth → Providers:** keep Email, turn **off** public sign-ups. **Auth → MFA:** enable TOTP.
4. Create your admin user (Auth → Users → Invite), then in the SQL editor:
   `insert into airwatch.admin_users (user_id, role) values ('<user uuid>', 'admin');`
5. Create the worker login: `create role airwatch_worker_login login password '<strong password>' in role airwatch_worker;`
   Its connection string is the worker's `DATABASE_URL`. Keep it only on the worker host.
6. Rollback: run the files in `supabase/rollback/` newest first. The last one deletes all data; back up first
   (Database → Backups, or `pg_dump`).

## 2. Website (Vercel)
1. Import the repo, set the root directory to `web/`.
2. Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the anon key is public by
   design; RLS and the private schema protect the data). Optional: `NEXT_PUBLIC_MAP_STYLE_URL`.
   Without Supabase variables the site serves the synthetic demo and `/admin` returns 404 in production
   (set `AIRWATCH_DEMO_ADMIN=1` to show the browser-only demo admin).
3. Turn on Vercel Firewall rate limiting for `/api/*` and `/reports/*`.

## 3. Worker host (Railway / Fly.io)
- Build from `worker/Dockerfile`. Command: `python -m airwatch run --store postgres --provider fake` while testing.
- Schedule `python -m airwatch process --store postgres` every 5 minutes (cron or a second process).
- Secrets: `DATABASE_URL`, and later `AIRWATCH_PROVIDER_API_KEY`, `AIRWATCH_PROVIDER_LICENSE_REF`,
  `AIRWATCH_ENABLE_LICENSED_PROVIDER=yes` only after the licence is signed.

## 4. Monitoring
- Logs are one JSON object per line (`level`, `msg`, `records`, `latency_ms`, `retry_in_s`...). Alert on
  `level=ERROR` bursts and on `quota budget exhausted`.
- Uptime: an external check (Better Stack, UptimeRobot, Checkly) on `/` and on `public.source_status`
  (alert when `status <> 'live'` for 15 minutes).
- Cost: watch Supabase database size and egress, Vercel function invocations, map tile requests, provider credits.

## 5. Launch gates (from the PRD)
- [ ] Signed licence covering collection, storage, derived metrics and public display
- [ ] Seven-day unattended ingestion run, gaps documented, usage under plan limits
- [ ] ≥100 reviewed candidates and non-events across both runway directions (Admin → Validation)
- [ ] No exposed keys, addresses or operator details; correction process live
- [ ] Freshness and coverage indicators verified during a simulated source outage
- [ ] Runway coordinates and pattern directions replaced with official data; real zones approved
