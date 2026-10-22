"""Versioned event detection: overflights, circuits and likely touch-and-go candidates.

The pipeline is deterministic: the same observations, thresholds and version
always yield the same events with the same IDs, so history can be recomputed
when definitions change (see docs/methodology-changelog.md).

Vocabulary is deliberate. ADS-B positions cannot prove runway contact, so the
strongest touch-and-go label is "likely_touch_and_go". Circuits are "candidate"
circuits until a reviewer approves them.
"""

from __future__ import annotations

import math
import statistics
import uuid
from dataclasses import asdict, dataclass, field
from typing import Iterable, Sequence

from shapely.geometry import LineString, Point, Polygon

from ..config import Airport, angle_diff
from ..models import Event, Observation, Track, utc
from .geometry import RunwayFrame, runway_frames

ALGORITHM_VERSION = "1.0.0"
_NS = uuid.UUID("5b0e3a52-3f7e-4f3c-9d6a-2c1b0a9e8f71")


@dataclass(frozen=True)
class Thresholds:
    session_gap_s: float = 600.0          # split a track after this much silence
    max_implied_speed_mps: float = 300.0  # split on impossible jumps
    track_gap_s: float = 60.0             # gaps longer than this are recorded on the track
    # Runway pass
    pass_half_width_m: float = 200.0
    pass_beyond_end_m: float = 600.0
    pass_max_agl_ft: float = 400.0
    pass_max_internal_gap_s: float = 45.0
    approach_window_s: float = 120.0
    tg_max_agl_ft: float = 100.0          # must get this low to be a touch-and-go candidate
    tg_min_groundspeed_kt: float = 35.0   # below this we assume a full stop
    tg_max_duration_s: float = 90.0
    aligned_deg: float = 35.0
    # Circuit
    circuit_min_s: float = 150.0
    circuit_max_s: float = 900.0
    circuit_max_dist_m: float = 5000.0
    circuit_max_agl_ft: float = 2000.0
    downwind_min_offset_m: float = 400.0
    downwind_max_offset_m: float = 3500.0
    # Overflight
    overflight_max_gap_s: float = 120.0
    overflight_cooldown_s: float = 120.0
    # Confidence
    high_confidence: float = 0.75
    medium_confidence: float = 0.5

    def to_dict(self) -> dict:
        return asdict(self)


DEFAULT_THRESHOLDS = Thresholds()


# ---------------------------------------------------------------------------
# Tracks
# ---------------------------------------------------------------------------

def build_tracks(observations: Iterable[Observation], airport: Airport, th: Thresholds = DEFAULT_THRESHOLDS) -> list[Track]:
    frame = airport.frame
    fence = airport.geofence_radius_m
    by_ac: dict[str, list[Observation]] = {}
    for o in observations:
        x, y = frame.to_xy(o.lat, o.lon)
        if math.hypot(x, y) <= fence:
            by_ac.setdefault(o.aircraft_key, []).append(o)

    tracks: list[Track] = []
    for key, pts in sorted(by_ac.items()):
        pts.sort(key=lambda o: o.ts)
        cur: list[Observation] = []
        for o in pts:
            if cur:
                prev = cur[-1]
                dt = o.t - prev.t
                if dt <= 0:
                    continue
                px, py = frame.to_xy(prev.lat, prev.lon)
                ox, oy = frame.to_xy(o.lat, o.lon)
                if dt > th.session_gap_s or math.hypot(ox - px, oy - py) / dt > th.max_implied_speed_mps:
                    tracks.append(_make_track(key, cur, th))
                    cur = []
            cur.append(o)
        if cur:
            tracks.append(_make_track(key, cur, th))
    return [t for t in tracks if len(t.points) >= 3]


def _make_track(key: str, pts: list[Observation], th: Thresholds) -> Track:
    tid = str(uuid.uuid5(_NS, f"track|{key}|{int(pts[0].t * 1000)}"))
    gaps = [(a.t, b.t) for a, b in zip(pts, pts[1:]) if b.t - a.t > th.track_gap_s]
    return Track(tid, key, list(pts), gaps)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@dataclass
class _P:
    o: Observation
    t: float
    x: float
    y: float
    agl: float
    gs: float
    trk: float


def _prep(track: Track, airport: Airport) -> list[_P]:
    out = []
    for o in track.points:
        x, y = airport.frame.to_xy(o.lat, o.lon)
        alt = o.alt_baro_ft if o.alt_baro_ft is not None else (o.alt_geom_ft or 0)
        out.append(_P(o, o.t, x, y, alt - airport.elevation_ft, o.groundspeed_kt or 0.0, o.track_deg or 0.0))
    return out


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


def _density_score(ps: Sequence[_P]) -> float:
    if len(ps) < 2:
        return 0.0
    med = statistics.median(b.t - a.t for a, b in zip(ps, ps[1:]))
    return _clamp((20 - med) / 15)


def _continuity_score(ps: Sequence[_P], ideal_gap: float = 10.0, worst_gap: float = 90.0) -> float:
    if len(ps) < 2:
        return 0.0
    mg = max(b.t - a.t for a, b in zip(ps, ps[1:]))
    return _clamp(1 - (mg - ideal_gap) / (worst_gap - ideal_gap))


def _altitude_score(ps: Sequence[_P]) -> float:
    pairs = [(a, b) for a, b in zip(ps, ps[1:]) if b.t > a.t]
    if not pairs:
        return 0.5
    ok = sum(1 for a, b in pairs if abs(b.agl - a.agl) / (b.t - a.t) <= 50)
    return ok / len(pairs)


def _coverage_score(start: float, end: float, outages: Sequence[tuple[float, float]]) -> float:
    span = max(end - start, 1.0)
    lost = sum(max(0.0, min(end, b) - max(start, a)) for a, b in outages)
    return _clamp(1 - lost / span)


def _label(score: float, th: Thresholds) -> str:
    return "high" if score >= th.high_confidence else "medium" if score >= th.medium_confidence else "low"


def _event_id(kind: str, track_id: str, start: float, extra: str = "") -> str:
    return str(uuid.uuid5(_NS, f"{ALGORITHM_VERSION}|{kind}|{track_id}|{int(start * 1000)}|{extra}"))


def _circ_mean(degs: Sequence[float]) -> float:
    s = sum(math.sin(math.radians(d)) for d in degs)
    c = sum(math.cos(math.radians(d)) for d in degs)
    return math.degrees(math.atan2(s, c)) % 360


# ---------------------------------------------------------------------------
# Runway passes and touch-and-go candidates
# ---------------------------------------------------------------------------

@dataclass
class RunwayPass:
    frame: RunwayFrame
    points: list[_P]
    i0: int
    i1: int
    classification: str = "unknown"
    approach: bool = False
    departure: bool = False
    min_agl: float = 0.0
    min_gs: float = 0.0
    details: dict = field(default_factory=dict)

    @property
    def start(self) -> float:
        return self.points[0].t

    @property
    def end(self) -> float:
        return self.points[-1].t


def find_runway_passes(ps: list[_P], airport: Airport, th: Thresholds = DEFAULT_THRESHOLDS) -> list[RunwayPass]:
    frames = runway_frames(airport)
    passes: list[RunwayPass] = []
    for rw in airport.runways:
        rw_frames = [f for f in frames if f.runway is rw]
        ref = rw_frames[0]
        inside = []
        for i, p in enumerate(ps):
            u, v = ref.to_uv(p.x, p.y)
            inside.append(abs(v) <= th.pass_half_width_m and abs(u) <= ref.half + th.pass_beyond_end_m and p.agl <= th.pass_max_agl_ft)
        i = 0
        while i < len(ps):
            if not inside[i]:
                i += 1
                continue
            j = i
            while j + 1 < len(ps) and inside[j + 1] and ps[j + 1].t - ps[j].t <= th.pass_max_internal_gap_s:
                j += 1
            seg = ps[i : j + 1]
            mean_trk = _circ_mean([p.trk for p in seg])
            best = min(rw_frames, key=lambda f: angle_diff(mean_trk, f.heading))
            if angle_diff(mean_trk, best.heading) <= 45:
                passes.append(_classify_pass(RunwayPass(best, seg, i, j), ps, th))
            i = j + 1
    passes.sort(key=lambda p: p.start)
    return passes


def _classify_pass(rp: RunwayPass, ps: list[_P], th: Thresholds) -> RunwayPass:
    fr = rp.frame
    before = [p for p in ps[: rp.i0] if rp.start - p.t <= th.approach_window_s]
    after = [p for p in ps[rp.i1 + 1 :] if p.t - rp.end <= th.approach_window_s]

    def aligned(p: _P) -> bool:
        return angle_diff(p.trk, fr.heading) <= th.aligned_deg

    appr = [p for p in before if aligned(p) and abs(fr.to_uv(p.x, p.y)[1]) < 400 and fr.to_uv(p.x, p.y)[0] < -fr.half + 300]
    dep = [p for p in after if aligned(p) and abs(fr.to_uv(p.x, p.y)[1]) < 400 and fr.to_uv(p.x, p.y)[0] > -fr.half]
    # Approach: descending toward the threshold, or already arriving fast and low at the start of the pass.
    rp.approach = (len(appr) >= 1 and appr[0].agl >= appr[-1].agl - 25) or (rp.points[0].gs >= 55 and rp.points[0].agl >= 50)
    rp.departure = len(dep) >= 1 and dep[-1].agl > rp.points[-1].agl + 50
    rp.min_agl = min(p.agl for p in rp.points)
    rp.min_gs = min(p.gs for p in rp.points)
    dur = rp.end - rp.start
    track_ends_soon = rp.i1 == len(ps) - 1 or ps[rp.i1 + 1].t - rp.end > th.approach_window_s
    rp.details = {
        "duration_s": round(dur, 1),
        "min_agl_ft": rp.min_agl,
        "min_groundspeed_kt": rp.min_gs,
        "approach_points": len(appr),
        "departure_points": len(dep),
        "track_ends_after_pass": track_ends_soon,
    }
    if rp.min_gs < th.tg_min_groundspeed_kt:
        rp.classification = "probable_full_stop" if rp.approach else ("takeoff" if rp.departure else "unknown")
    elif rp.approach and rp.departure:
        if rp.min_agl <= th.tg_max_agl_ft and dur <= th.tg_max_duration_s:
            rp.classification = "likely_touch_and_go"
        else:
            rp.classification = "low_approach"
    elif rp.approach and track_ends_soon and rp.min_agl <= th.tg_max_agl_ft:
        rp.classification = "probable_full_stop"
    elif rp.departure and not rp.approach and rp.min_agl <= th.tg_max_agl_ft:
        rp.classification = "takeoff"
    return rp


def _pass_event(rp: RunwayPass, track: Track, outages, th: Thresholds) -> Event | None:
    if rp.classification not in ("likely_touch_and_go", "probable_full_stop", "low_approach"):
        return None
    pts = rp.points
    prox = _clamp(1 - statistics.mean(abs(rp.frame.to_uv(p.x, p.y)[1]) for p in pts) / th.pass_half_width_m)
    window = [p for p in _prep_cached(track) if rp.start - 60 <= p.t <= rp.end + 60]
    comps = {
        "density": _density_score(window),
        "continuity": _continuity_score(window, 10, 60),
        "altitude": _altitude_score(window),
        "runway_proximity": prox,
        "coverage": _coverage_score(rp.start - 60, rp.end + 60, outages),
    }
    w = {"density": 0.3, "continuity": 0.3, "altitude": 0.1, "runway_proximity": 0.2, "coverage": 0.1}
    score = sum(comps[k] * w[k] for k in w)
    return Event(
        event_id=_event_id(rp.classification, track.track_id, rp.start),
        kind=rp.classification,
        aircraft_key=track.aircraft_key,
        track_id=track.track_id,
        start=utc(rp.start),
        end=utc(rp.end),
        algorithm_version=ALGORITHM_VERSION,
        confidence=round(score, 3),
        confidence_label=_label(score, th),
        runway=rp.frame.end.ident,
        min_alt_ft=min(p.o.alt_baro_ft or 0 for p in pts),
        max_alt_ft=max(p.o.alt_baro_ft or 0 for p in pts),
        evidence_ids=[p.o.source_event_id for p in window],
        details={**rp.details, "confidence_components": {k: round(v, 3) for k, v in comps.items()}},
    )


# ---------------------------------------------------------------------------
# Circuits
# ---------------------------------------------------------------------------

LEGS = ("upwind", "crosswind", "downwind", "base", "final")


def classify_leg(p: _P, fr: RunwayFrame, th: Thresholds = DEFAULT_THRESHOLDS) -> str:
    u, v = fr.to_uv(p.x, p.y)
    d_al = angle_diff(p.trk, fr.heading)
    d_op = angle_diff(p.trk, fr.heading + 180)
    if d_al <= th.aligned_deg and abs(v) < 600:
        return "final" if u < -fr.half else "upwind"
    if d_op <= th.aligned_deg and th.downwind_min_offset_m < abs(v) < th.downwind_max_offset_m:
        return "downwind"
    if 50 <= d_al <= 130:
        if u < -fr.half - 300:
            return "base"
        if u > fr.half:
            return "crosswind"
    return "other"


def _sequence(legs: list[str]) -> list[str]:
    seq: list[str] = []
    for leg in legs:
        if leg != "other" and (not seq or seq[-1] != leg):
            seq.append(leg)
    return seq


def _has_order(seq: list[str], wanted: Sequence[str]) -> bool:
    it = iter(seq)
    return all(any(s == w for s in it) for w in wanted)


def find_circuits(track: Track, passes: list[RunwayPass], airport: Airport, outages, th: Thresholds = DEFAULT_THRESHOLDS) -> list[Event]:
    ps = _prep_cached(track)
    events = []
    leaving = ("likely_touch_and_go", "low_approach", "takeoff")
    arriving = ("likely_touch_and_go", "low_approach", "probable_full_stop")
    for a, b in zip(passes, passes[1:]):
        if a.classification not in leaving or b.classification not in arriving:
            continue
        if a.frame.end.ident != b.frame.end.ident:
            continue
        fr = a.frame
        t0, t1 = a.end, b.start
        dur = t1 - t0
        if not th.circuit_min_s <= dur <= th.circuit_max_s:
            continue
        seg = [p for p in ps if t0 <= p.t <= t1]
        if len(seg) < 4:
            continue
        mx, my = fr.mx, fr.my
        if max(math.hypot(p.x - mx, p.y - my) for p in seg) > th.circuit_max_dist_m:
            continue
        if max(p.agl for p in seg) > th.circuit_max_agl_ft:
            continue
        legs = [classify_leg(p, fr, th) for p in seg]
        seq = _sequence(legs)
        if not _has_order(seq, ["downwind", "final"]):
            continue
        dw_sides = {1 if fr.to_uv(p.x, p.y)[1] > 0 else -1 for p, leg in zip(seg, legs) if leg == "downwind"}
        if len(dw_sides) != 1:
            continue
        side = dw_sides.pop()
        completeness = sum(1 for leg in LEGS if leg in seq) / len(LEGS)
        comps = {
            "density": _density_score(seg),
            "continuity": _continuity_score(seg, 15, 120),
            "altitude": _altitude_score(seg),
            "leg_completeness": completeness,
            "coverage": _coverage_score(t0, t1, outages),
        }
        w = {"density": 0.25, "continuity": 0.35, "altitude": 0.1, "leg_completeness": 0.2, "coverage": 0.1}
        score = sum(comps[k] * w[k] for k in w)
        events.append(
            Event(
                event_id=_event_id("circuit", track.track_id, t0),
                kind="circuit",
                aircraft_key=track.aircraft_key,
                track_id=track.track_id,
                start=utc(t0),
                end=utc(t1),
                algorithm_version=ALGORITHM_VERSION,
                confidence=round(score, 3),
                confidence_label=_label(score, th),
                runway=fr.end.ident,
                min_alt_ft=min(p.o.alt_baro_ft or 0 for p in seg),
                max_alt_ft=max(p.o.alt_baro_ft or 0 for p in seg),
                evidence_ids=[p.o.source_event_id for p in seg],
                details={
                    "legs": seq,
                    "pattern_side": "left" if side < 0 else "right",
                    "declared_pattern_side": fr.end.pattern_direction,
                    "duration_s": round(dur, 1),
                    "ended_with": b.classification,
                    "confidence_components": {k: round(v, 3) for k, v in comps.items()},
                },
            )
        )
    return events


# ---------------------------------------------------------------------------
# Overflights
# ---------------------------------------------------------------------------

def find_overflights(track: Track, airport: Airport, outages, th: Thresholds = DEFAULT_THRESHOLDS,
                     zones: dict[str, Polygon] | None = None) -> list[Event]:
    ps = _prep_cached(track)
    zones = zones if zones is not None else {z.id: z.polygon_xy(airport.frame) for z in airport.zones}
    events = []
    for zid, poly in zones.items():
        crossings: list[dict] = []
        cur: dict | None = None
        skipped = 0
        for a, b in zip(ps, ps[1:]):
            if b.t - a.t > th.overflight_max_gap_s:
                if cur:
                    crossings.append(cur)
                    cur = None
                if poly.contains(Point(a.x, a.y)) or poly.contains(Point(b.x, b.y)) or LineString([(a.x, a.y), (b.x, b.y)]).intersects(poly):
                    skipped += 1
                continue
            hit = LineString([(a.x, a.y), (b.x, b.y)]).intersects(poly)
            if hit:
                if cur is None:
                    cur = {"pts": [a, b], "gaps": 0}
                else:
                    cur["pts"].append(b)
            elif cur is not None:
                crossings.append(cur)
                cur = None
        if cur:
            crossings.append(cur)
        merged: list[dict] = []
        for c in crossings:
            if merged and c["pts"][0].t - merged[-1]["pts"][-1].t <= th.overflight_cooldown_s:
                merged[-1]["pts"].extend(c["pts"])
                merged[-1]["merged"] = merged[-1].get("merged", 1) + 1
            else:
                merged.append(c)
        for c in merged:
            pts = c["pts"]
            t0, t1 = pts[0].t, pts[-1].t
            comps = {
                "density": _density_score(pts),
                "continuity": _continuity_score(pts, 10, th.overflight_max_gap_s),
                "altitude": _altitude_score(pts),
                "coverage": _coverage_score(t0, t1, outages),
            }
            w = {"density": 0.3, "continuity": 0.4, "altitude": 0.1, "coverage": 0.2}
            score = sum(comps[k] * w[k] for k in w)
            alts = [p.o.alt_baro_ft or 0 for p in pts]
            events.append(
                Event(
                    event_id=_event_id("overflight", track.track_id, t0, zid),
                    kind="overflight",
                    aircraft_key=track.aircraft_key,
                    track_id=track.track_id,
                    start=utc(t0),
                    end=utc(t1),
                    algorithm_version=ALGORITHM_VERSION,
                    confidence=round(score, 3),
                    confidence_label=_label(score, th),
                    zone_id=zid,
                    min_alt_ft=min(alts),
                    max_alt_ft=max(alts),
                    evidence_ids=[p.o.source_event_id for p in pts],
                    details={
                        "altitude_type": "barometric_msl",
                        "min_agl_estimate_ft": round(min(alts) - airport.elevation_ft),
                        "merged_passes": c.get("merged", 1),
                        "segments_skipped_for_gaps": skipped,
                        "confidence_components": {k: round(v, 3) for k, v in comps.items()},
                    },
                )
            )
    return events


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

_cache: dict[str, list[_P]] = {}
_cache_airport: list[Airport] = []


def _prep_cached(track: Track) -> list[_P]:
    ps = _cache.get(track.track_id)
    if ps is None:
        ps = _prep(track, _cache_airport[0])
        _cache[track.track_id] = ps
    return ps


@dataclass
class DetectionResult:
    tracks: list[Track]
    events: list[Event]
    algorithm_version: str
    thresholds: dict


def detect(observations: Iterable[Observation], airport: Airport, outages: Sequence[tuple[float, float]] = (),
           th: Thresholds = DEFAULT_THRESHOLDS) -> DetectionResult:
    _cache.clear()
    _cache_airport[:] = [airport]
    tracks = build_tracks(observations, airport, th)
    zones = {z.id: z.polygon_xy(airport.frame) for z in airport.zones}
    events: list[Event] = []
    for tr in tracks:
        ps = _prep_cached(tr)
        passes = find_runway_passes(ps, airport, th)
        for rp in passes:
            ev = _pass_event(rp, tr, outages, th)
            if ev:
                events.append(ev)
        events += find_circuits(tr, passes, airport, outages, th)
        events += find_overflights(tr, airport, outages, th, zones)
    events.sort(key=lambda e: (e.start, e.kind, e.event_id))
    _cache.clear()
    return DetectionResult(tracks, events, ALGORITHM_VERSION, th.to_dict())
