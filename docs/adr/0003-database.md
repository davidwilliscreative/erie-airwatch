# ADR 0003: Private schema, public views, checked RPCs

**Decision.** Base tables live in schema `airwatch`, which is not exposed through the Supabase API. Anonymous
visitors can read only `public.*_public` views and a few other views that expose aggregates, published findings and
delayed, rounded, pseudonymised positions. Admin actions are `security definer` functions that check
`admin_users` membership **and** an MFA session (`aal = aal2`) and write `audit_log`. RLS is enabled on every table
as a second line of defence. The worker connects directly as a member of `airwatch_worker`, which can write
ingestion tables but cannot review events or touch reports.

**Partitioning.** `observations` is a plain table with (airport_id, ts), (aircraft_key, ts) and GiST indexes. At
5 s sampling and ~40 flights/day KEIK produces on the order of 10–20 million rows a year; convert to monthly range
partitions on `ts` when it passes ~50 million rows, and drop old partitions for retention.

**Retention.** Raw provider responses only when `sources.allows_raw_retention`; observations per
`sources.observation_retention_days`; events and aggregates kept for published reports.
