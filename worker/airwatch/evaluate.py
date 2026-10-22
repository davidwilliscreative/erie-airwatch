"""Score detector output against ground truth (synthetic now, human labels later)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import timezone, datetime

from .config import Airport
from .detection import pipeline
from .models import Event, Observation, Track
from .synthetic import SyntheticDataset, SyntheticWorld, TruthEvent

KIND_MAP = {
    "likely_touch_and_go": "touch_and_go",
    "circuit": "circuit",
    "probable_full_stop": "full_stop",
    "overflight": "overflight",
}


@dataclass
class Score:
    kind: str
    tp: int = 0
    fp: int = 0
    fn: int = 0
    by_label: dict = field(default_factory=dict)

    @property
    def precision(self) -> float | None:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else None

    @property
    def recall(self) -> float | None:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else None

    def to_dict(self) -> dict:
        r = lambda v: None if v is None else round(v, 3)  # noqa: E731
        return {
            "kind": self.kind, "tp": self.tp, "fp": self.fp, "fn": self.fn,
            "precision": r(self.precision), "recall": r(self.recall),
            "false_positive_share": r(self.fp / (self.tp + self.fp)) if self.tp + self.fp else None,
            "by_confidence": {
                k: {**v, "precision": r(v["tp"] / (v["tp"] + v["fp"])) if v["tp"] + v["fp"] else None}
                for k, v in sorted(self.by_label.items())
            },
        }


def _matches(det: Event, tr: TruthEvent) -> bool:
    if det.aircraft_key != tr.aircraft_key:
        return False
    if det.kind == "overflight" and det.zone_id != tr.zone_id:
        return False
    ds, de = det.start.timestamp(), det.end.timestamp()
    if det.kind == "circuit":
        overlap = min(de, tr.end) - max(ds, tr.start)
        return overlap > 0.5 * max(tr.end - tr.start, 1)
    return ds - 60 <= tr.end and de + 60 >= tr.start


def overflight_truth(ds: SyntheticDataset, airport: Airport) -> list[TruthEvent]:
    """Zone crossings computed on noise-free, gap-free 1 s paths."""
    out = []
    pipeline._cache_airport[:] = [airport]
    zones = {z.id: z.polygon_xy(airport.frame) for z in airport.zones}
    for f in ds.flights:
        samples, _ = SyntheticWorld.sample_path(f.waypoints, f.start_t, 1.0)
        obs = []
        for t, x, y, alt, gs, trk in samples:
            lat, lon = airport.frame.to_latlon(x, y)
            obs.append(Observation("truth", f"{f.flight_id}-{t}", datetime.fromtimestamp(t, tz=timezone.utc),
                                   f.aircraft_key, lat, lon, alt, None, gs, trk))
        if len(obs) < 2:
            continue
        tr = Track(f"truth-{f.flight_id}", f.aircraft_key, obs)
        for e in pipeline.find_overflights(tr, airport, (), pipeline.DEFAULT_THRESHOLDS, zones):
            out.append(TruthEvent("overflight", f.aircraft_key, f.flight_id, e.start.timestamp(), e.end.timestamp(), zone_id=e.zone_id))
        pipeline._cache.pop(tr.track_id, None)
    return out


def score(events: list[Event], truth: list[TruthEvent]) -> dict[str, Score]:
    scores: dict[str, Score] = {}
    for det_kind, truth_kind in KIND_MAP.items():
        s = Score(det_kind)
        dets = [e for e in events if e.kind == det_kind]
        truths = [t for t in truth if t.kind == truth_kind]
        used: set[int] = set()
        for d in dets:
            hit = next((i for i, t in enumerate(truths) if i not in used and _matches(d, t)), None)
            lab = s.by_label.setdefault(d.confidence_label, {"tp": 0, "fp": 0})
            if hit is None:
                s.fp += 1
                lab["fp"] += 1
            else:
                used.add(hit)
                s.tp += 1
                lab["tp"] += 1
        s.fn = len(truths) - len(used)
        scores[det_kind] = s
    return scores


def evaluate_synthetic(airport: Airport, ds: SyntheticDataset, events: list[Event]) -> dict:
    truth = ds.truth + overflight_truth(ds, airport)
    scores = score(events, truth)
    # Near-miss non-events: go-arounds that the detector called touch-and-go.
    ga = [t for t in truth if t.kind == "go_around"]
    tg = [e for e in events if e.kind == "likely_touch_and_go"]
    ga_as_tg = sum(1 for g in ga if any(_matches(e, g) for e in tg))
    return {
        "scores": {k: v.to_dict() for k, v in scores.items()},
        "non_events": {"go_arounds": len(ga), "go_arounds_labelled_touch_and_go": ga_as_tg},
        "truth_counts": {k: sum(1 for t in truth if t.kind == k) for k in sorted({t.kind for t in truth})},
    }
