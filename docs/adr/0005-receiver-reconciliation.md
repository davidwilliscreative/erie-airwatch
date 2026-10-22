# ADR 0005: Local receiver and source reconciliation (future)

**Decision.** A local readsb/dump1090 receiver posts `aircraft.json` batches through an authenticated uploader to an
ingestion endpoint (a Supabase Edge Function using a per-receiver secret; not yet built). `LocalReceiverAdapter`
normalises those batches to the same `Observation` schema.

**Duplicates.** Observations from different sources for the same aircraft within 2 s and 50 m are duplicates.
Priority: own receiver > licensed stream > licensed snapshot. Lower-priority duplicates are dropped before detection
(and stored only if the licence allows raw retention), so counts never double.

**Second airport.** Everything is keyed by `airport_id` and configured from `config/airports/<icao>.json`. The
detector has no Erie-specific constants; tests run against KEIK only for now. Enable another airport only after the
Erie workflow has passed the launch gates.
