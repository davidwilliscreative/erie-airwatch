"""Build the demo data files the website reads when no database is configured.

The snapshot is produced by the real pipeline (synthetic generator -> detector
-> aggregates), so the demo dashboard exercises the same code paths and
definitions the live system will use.
"""

from __future__ import annotations

import hashlib
import json
import random
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .aggregate import PublicationPolicy, hourly_metrics, is_publishable
from .config import Airport
from .detection.pipeline import ALGORITHM_VERSION, DEFAULT_THRESHOLDS, detect
from .evaluate import evaluate_synthetic
from .synthetic import generate


def _iso(t: float | datetime) -> str:
    dt = t if isinstance(t, datetime) else datetime.fromtimestamp(t, tz=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _pseudonym(key: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}|{key}".encode()).hexdigest()[:6]


def build(airport: Airport, end_day: date, days: int = 14, seed: int = 7, policy: PublicationPolicy = PublicationPolicy()):
    start_day = end_day - timedelta(days=days - 1)
    ds = generate(airport, start_day, days, seed)
    result = detect(ds.observations, airport, ds.outages)
    events = result.events
    rng = random.Random(seed)
    tz = ZoneInfo(airport.timezone)

    # Pretend a reviewer has worked through part of the queue so the demo shows every state.
    for e in events:
        if e.kind == "overflight":
            continue
        r = rng.random()
        if r < 0.35:
            e.review_status = "approved"
        elif r < 0.38:
            e.review_status = "rejected"

    hourly = hourly_metrics(airport, ds.observations, events, ds.outages, ds.start, ds.end, policy)

    # Daily repeat activity: aircraft with 3+ publishable circuits in a local day (counts only, no IDs).
    per_day: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for e in events:
        if e.kind == "circuit" and is_publishable(e, policy):
            per_day[e.start.astimezone(tz).date().isoformat()][e.aircraft_key] += 1
    day_list = [(start_day + timedelta(days=i)).isoformat() for i in range(days)]
    daily = [
        {"day": d, "repeatCircuitAircraft": sum(1 for n in per_day[d].values() if n >= 3),
         "maxCircuitsOneAircraft": max(per_day[d].values(), default=0)}
        for d in day_list
    ]

    # Playback window: the busiest 90 minutes of the final day.
    last_day_obs = [o for o in ds.observations if o.ts.astimezone(tz).date() == end_day]
    best_t, best_n = None, -1
    for h in range(8, 18):
        t0 = datetime(end_day.year, end_day.month, end_day.day, h, tzinfo=tz).timestamp()
        n = len({o.aircraft_key for o in last_day_obs if t0 <= o.t < t0 + 5400})
        if n > best_n:
            best_t, best_n = t0, n
    win0, win1 = best_t, best_t + 5400
    salt = f"demo-{end_day.isoformat()}"
    positions = []
    last_bucket: dict[str, int] = {}
    for o in ds.observations:
        if not (win0 <= o.t < win1):
            continue
        b = int(o.t // 10)
        if last_bucket.get(o.aircraft_key) == b:
            continue
        last_bucket[o.aircraft_key] = b
        positions.append({"t": _iso(o.t), "id": _pseudonym(o.aircraft_key, salt), "lat": o.lat, "lon": o.lon,
                          "alt": o.alt_baro_ft, "gs": o.groundspeed_kt, "trk": o.track_deg})

    def public_event(e):
        return {"id": e.event_id, "kind": e.kind, "start": _iso(e.start), "end": _iso(e.end), "runway": e.runway,
                "zoneId": e.zone_id, "confidence": e.confidence, "confidenceLabel": e.confidence_label,
                "reviewStatus": e.review_status, "minAltFt": e.min_alt_ft, "maxAltFt": e.max_alt_ft}

    recent_events = [public_event(e) for e in events if is_publishable(e, policy) and win0 - 3600 <= e.start.timestamp() < win1]

    evaluation = evaluate_synthetic(airport, ds, events)
    coverage_days = []
    for d in day_list:
        s = datetime.fromisoformat(d).replace(tzinfo=tz).timestamp()
        lost = sum(max(0.0, min(s + 86400, b) - max(s, a)) for a, b in ds.outages)
        coverage_days.append({"day": d, "outageMinutes": round(lost / 60), "outages": sum(1 for a, b in ds.outages if s <= a < s + 86400)})

    gen_at = datetime.now(timezone.utc).replace(microsecond=0)
    dashboard = {
        "mode": "demo",
        "generatedAt": _iso(gen_at),
        "asOf": _iso(win1),
        "airport": {
            "id": airport.id, "icao": airport.icao, "name": airport.name, "city": airport.raw.get("city"),
            "timezone": airport.timezone, "lat": airport.lat, "lon": airport.lon,
            "elevationFt": airport.elevation_ft, "patternAltitudeFt": airport.pattern_altitude_ft,
            "patternVerified": airport.raw["pattern"].get("verified", False),
            "runways": [
                {"id": r.id, "ends": [{"ident": e.ident, "lat": e.lat, "lon": e.lon, "patternDirection": e.pattern_direction} for e in r.ends]}
                for r in airport.runways
            ],
        },
        "zones": [{"id": z.id, "slug": z.slug, "label": z.label, "synthetic": z.synthetic,
                   "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in z.ring]]}} for z in airport.zones],
        "source": {"name": "Synthetic demonstration data", "kind": "synthetic", "status": "demo",
                   "freshnessExpectationS": 60, "lastObservationAt": _iso(ds.observations[-1].ts),
                   "licenseNote": "Generated locally. No third-party aviation data is collected or displayed."},
        "range": {"start": _iso(ds.start), "end": _iso(ds.end), "days": day_list},
        "policy": {"mode": policy.mode, "minConfidence": policy.min_confidence},
        "hourly": [{"hour": _iso(r["hour"]), "metric": r["metric"], "zoneId": r["zone_id"], "value": r["value"]} for r in hourly],
        "daily": daily,
        "coverage": coverage_days,
        "playback": {"start": _iso(win0), "end": _iso(win1), "positions": positions},
        "recentEvents": recent_events,
        "methodology": {"algorithmVersion": ALGORITHM_VERSION, "thresholds": DEFAULT_THRESHOLDS.to_dict(),
                        "syntheticEvaluation": evaluation},
    }

    # Admin review queue: every non-overflight candidate in the final 3 days, plus a sample of overflights.
    cutoff = ds.end - timedelta(days=3)
    obs_by_id = {o.source_event_id: o for o in ds.observations}
    review_events = [e for e in events if e.start >= cutoff and e.kind != "overflight"]
    ovf = [e for e in events if e.start >= cutoff and e.kind == "overflight"]
    review_events += rng.sample(ovf, min(40, len(ovf)))
    review = []
    tracks = {t.track_id: t for t in result.tracks}
    for e in sorted(review_events, key=lambda e: e.start):
        tr = tracks[e.track_id]
        ctx = [o for o in tr.points if e.start.timestamp() - 90 <= o.t <= e.end.timestamp() + 90]
        evid = set(e.evidence_ids)
        review.append({
            **public_event(e),
            "aircraftLabel": f"Aircraft {_pseudonym(e.aircraft_key, 'review')}",
            "algorithmVersion": e.algorithm_version,
            "details": e.details,
            "points": [{"t": _iso(o.t), "lat": o.lat, "lon": o.lon, "alt": o.alt_baro_ft, "gs": o.groundspeed_kt,
                        "evidence": o.source_event_id in evid} for o in ctx],
        })
    assert all(i in obs_by_id for e in review_events for i in e.evidence_ids)
    return dashboard, {"generatedAt": _iso(gen_at), "events": review}, evaluation


def write(out_dir: Path, airport: Airport, end_day: date, days: int = 14, seed: int = 7) -> dict:
    dash, review, evaluation = build(airport, end_day, days, seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "dashboard.json").write_text(json.dumps(dash, separators=(",", ":")))
    (out_dir / "review.json").write_text(json.dumps(review, separators=(",", ":")))
    return {"dashboard_bytes": (out_dir / "dashboard.json").stat().st_size,
            "review_bytes": (out_dir / "review.json").stat().st_size,
            "positions": len(dash["playback"]["positions"]), "review_events": len(review["events"]),
            "evaluation": {k: {m: v[m] for m in ("precision", "recall")} for k, v in evaluation["scores"].items()}}
