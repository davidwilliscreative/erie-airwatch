"""Idempotent processing job: observations -> tracks/events -> hourly aggregates.

Reprocesses a sliding window behind a persisted checkpoint. Running it twice
over the same window produces the same event IDs and the same aggregates.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .aggregate import PublicationPolicy, hourly_metrics, outages_from_coverage
from .config import Airport
from .detection.pipeline import ALGORITHM_VERSION, detect
from .store import Store

log = logging.getLogger("airwatch.jobs")
LOOKBACK = timedelta(minutes=45)  # re-read enough history to finish circuits that straddle the window edge


def process_window(airport: Airport, store: Store, start: datetime, end: datetime, *,
                   expected_interval_s: float = 60, policy: PublicationPolicy = PublicationPolicy()) -> dict:
    # Aggregates are rebuilt from local midnight so per-day distinct counts stay correct.
    day0 = start.astimezone(ZoneInfo(airport.timezone)).replace(hour=0, minute=0, second=0, microsecond=0)
    day0 = day0.astimezone(timezone.utc)
    read_from = min(start - LOOKBACK, day0)
    obs = store.observations_between(read_from, end)
    outages = outages_from_coverage(store.coverage_windows(read_from, end), expected_interval_s)
    result = detect(obs, airport, outages)
    events = [e for e in result.events if start <= e.start < end]
    new = store.upsert_events(events)
    day_events = [e for e in result.events if day0 <= e.start < end]
    statuses = store.review_statuses([e.event_id for e in day_events])  # reviewer decisions drive publication
    for e in day_events:
        e.review_status = statuses.get(e.event_id, e.review_status)
    in_window = [o for o in obs if o.ts >= day0]
    store.replace_hourly_metrics(day0, end, hourly_metrics(airport, in_window, day_events, outages, day0, end, policy))
    return {"observations": len(obs), "events": len(events), "new_events": new, "algorithm_version": ALGORITHM_VERSION}


def process_pending(airport: Airport, store: Store, now: datetime | None = None, **kw) -> dict | None:
    now = now or datetime.now(timezone.utc)
    name = f"process:{airport.icao}:{ALGORITHM_VERSION}"
    ck = store.get_checkpoint(name)
    start = datetime.fromisoformat(ck) if ck else now - timedelta(hours=24)
    end = now - timedelta(minutes=5)  # leave time for late-arriving points
    if end <= start:
        return None
    out = process_window(airport, store, start, end, **kw)
    store.set_checkpoint(name, end.isoformat())
    log.info("processed window", extra={"fields": {**out, "start": start.isoformat(), "end": end.isoformat()}})
    return out
