# Erie AirWatch

A public, read-only dashboard of aircraft activity and neighborhood overflights around Erie Municipal Airport
(KEIK), with private, MFA-protected administration. Built from the *Erie AirWatch PRD and Claude Build Plan*.

> **Status: synthetic demo.** No third-party aviation data is collected, stored or shown. Every number comes from a
> built-in simulator until a data licence is signed (see `docs/license-checklist.md`).

| | |
|---|---|
| `web/` | Next.js site: dashboard, map replay, reports (CSV/PDF), methodology, privacy, corrections, admin |
| `worker/` | Python: provider adapters, ingestion loop, detection pipeline, aggregates, simulator |
| `supabase/` | Postgres/PostGIS migrations, RLS, public views, admin RPCs, seed, rollback, tests |
| `config/airports/keik.json` | Airport, runway, pattern and zone definitions (approximate; replace before real use) |
| `docs/` | Technical plan, architecture decisions, licence checklist, operations and launch gates |

## Run it on your computer

You need Node.js 20+ and Python 3.11+.

```bash
# 1. The website, with synthetic data (no database needed)
cd web
npm install
npm run dev
# open http://localhost:3000  (admin demo at http://localhost:3000/admin)

# 2. The worker and its tests
cd ../worker
pip install -r requirements.txt
python -m pytest -q                       # 25 tests
python -m airwatch evaluate               # detector precision/recall on synthetic ground truth
python -m airwatch run --iterations 90    # ingestion loop against the fake provider
python -m airwatch demo-snapshot          # regenerate the website's demo data
```

What you should see: the dashboard with a "Demonstration" banner, six headline numbers, a map you can replay,
charts, data coverage and recent findings. In the admin, findings sorted lowest-quality first with a plan view and
altitude profile of the evidence.

## Database tests (optional, needs PostgreSQL 16 + PostGIS)

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=... ./scripts/test-db.sh
```

This applies all migrations to a throwaway database, runs the RLS/permission tests (anonymous visitors cannot read
base tables; admin actions require role **and** MFA; reports need approval before publishing), loads three
synthetic days through the real worker, checks PostGIS and Python agree on zone crossings, then proves the rollback
scripts remove everything.

## Deploying

See `docs/operations.md` for Supabase, Vercel and worker-host steps, monitoring and the launch-gate checklist.

## Honesty rules built into the code

- "Likely touch-and-go", never "confirmed": ADS-B cannot prove runway contact.
- Every finding carries a data-quality score; low-quality findings are never public.
- Coverage gaps are shown beside every trend; missing data is never counted as zero.
- No aircraft identifiers, owners or pilot details on public pages; map positions are delayed and pseudonymised.
- Reviewer decisions, policy changes and report publication are written to an audit log.
