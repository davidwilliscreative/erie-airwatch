"""Hourly public aggregates and the publication policy.

The public site reads these cached aggregates, never raw observations.
Only events that pass `is_publishable` are counted.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .config import Airport
from .models import Event, Observation

COUNTED_KINDS = ("circuit", "likely_touch_and_go", "probable_full_stop", "low_approach")
ALT_BANDS = ((None, 1000, "lt1000"), (1000, 2000, "1000_2000"), (2000, 3000, "2000_3000"), (3000, None, "gt3000"))


@dataclass(frozen=True)
class PublicationPolicy:
    """reviewed_only: only reviewer-approved events are public.
    qualified: approved events plus unreviewed events at or above min_confidence.
    Rejected events and low-confidence events are never public."""

    mode: str = "qualified"
    min_confidence: float = 0.5


def is_publishable(e: Event, policy: PublicationPolicy) -> bool:
    if e.review_status == "rejected" or e.confidence < policy.min_confidence:
        return False
    if e.review_status == "approved":
        return True
    return policy.mode == "qualified" and e.review_status == "pending"


def alt_band(agl_ft: float) -> str:
    for lo, hi, name in ALT_BANDS:
        if (lo is None or agl_ft >= lo) and (hi is None or agl_ft < hi):
            return name
    return "gt3000"


def _hour(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def hourly_metrics(airport: Airport, observations: list[Observation], events: list[Event],
                   outages: list[tuple[float, float]], start: datetime, end: datetime,
                   policy: PublicationPolicy = PublicationPolicy()) -> list[dict]:
    counts: dict[tuple, int] = defaultdict(int)
    aircraft: dict[datetime, set] = defaultdict(set)
    for o in observations:
        h = _hour(o.ts)
        aircraft[h].add(o.aircraft_key)
        counts[(h, "observations", None)] += 1
    for h, keys in aircraft.items():
        counts[(h, "observed_aircraft", None)] = len(keys)
    # Distinct aircraft per local day, stored at the UTC instant of local midnight.
    tz = ZoneInfo(airport.timezone)
    per_day: dict[datetime, set] = defaultdict(set)
    for o in observations:
        local = o.ts.astimezone(tz)
        per_day[local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)].add(o.aircraft_key)
    for d, keys in per_day.items():
        counts[(d, "observed_aircraft_day", None)] = len(keys)
    for e in events:
        if not is_publishable(e, policy):
            continue
        h = _hour(e.start)
        if e.kind == "overflight":
            counts[(h, "overflights", e.zone_id)] += 1
            counts[(h, f"overflights_band:{alt_band((e.min_alt_ft or 0) - airport.elevation_ft)}", e.zone_id)] += 1
        elif e.kind in COUNTED_KINDS:
            counts[(h, e.kind, None)] += 1
            counts[(h, f"{e.kind}:rwy{e.runway}", None)] += 1
    h = _hour(start)
    while h < end:
        lost = sum(max(0.0, min(h.timestamp() + 3600, b) - max(h.timestamp(), a)) for a, b in outages)
        counts[(h, "coverage_pct", None)] = round(100 * (1 - lost / 3600))
        h += timedelta(hours=1)
    return [
        {"hour": h, "metric": m, "zone_id": z, "value": v}
        for (h, m, z), v in sorted(counts.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2] or ""))
        if start <= h < end
    ]


def outages_from_coverage(windows: list[dict], expected_interval_s: float) -> list[tuple[float, float]]:
    """Turn coverage windows into outage intervals: failed polls and gaps between successes."""
    ok = sorted(w["window_end"].timestamp() for w in windows if w["ok"])
    out = []
    for a, b in zip(ok, ok[1:]):
        if b - a > expected_interval_s * 2.5:
            out.append((a + expected_interval_s, b))
    return out
