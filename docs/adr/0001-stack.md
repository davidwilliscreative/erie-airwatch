# ADR 0001: Stack

**Decision.** Next.js 15 (App Router, TypeScript, Tailwind 4) on Vercel for the public site; MapLibre GL for maps;
Supabase Postgres + PostGIS for storage and spatial queries; a separate always-on Python worker for ingestion and
analytics.

**Why.** Matches the PRD. Python has the strongest geospatial and testing ecosystem for the detector (Shapely,
pytest); Next.js gives cached static pages that stay up if the database is slow. MapLibre avoids per-view map
licence fees and works with any vector tile host (OpenFreeMap by default, configurable via `NEXT_PUBLIC_MAP_STYLE_URL`).

**Consequences.** Two runtimes to deploy. Shared definitions live in `config/airports/*.json` and in the database,
not duplicated in code.
