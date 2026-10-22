"""Normalized data structures shared by providers, ingestion and detection."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone


@dataclass(frozen=True)
class Observation:
    """One normalized position report. Timestamps are always UTC."""

    source: str
    source_event_id: str
    ts: datetime
    aircraft_key: str  # ICAO hex when permitted, otherwise a provider-stable pseudonym
    lat: float
    lon: float
    alt_baro_ft: float | None = None
    alt_geom_ft: float | None = None
    groundspeed_kt: float | None = None
    track_deg: float | None = None
    vertical_rate_fpm: float | None = None
    on_ground: bool | None = None
    callsign: str | None = None
    quality_flags: tuple[str, ...] = ()

    @property
    def dedupe_key(self) -> tuple[str, str, int]:
        return (self.source, self.aircraft_key, int(self.ts.timestamp() * 1000))

    @property
    def t(self) -> float:
        return self.ts.timestamp()

    def to_dict(self) -> dict:
        d = asdict(self)
        d["ts"] = self.ts.astimezone(timezone.utc).isoformat()
        d["quality_flags"] = list(self.quality_flags)
        return d


@dataclass
class Track:
    """A normalized aircraft session: contiguous observations of one aircraft."""

    track_id: str
    aircraft_key: str
    points: list[Observation]
    gaps: list[tuple[float, float]] = field(default_factory=list)  # (start_t, end_t) of gaps > threshold

    @property
    def start(self) -> datetime:
        return self.points[0].ts

    @property
    def end(self) -> datetime:
        return self.points[-1].ts


@dataclass
class Event:
    """A candidate finding. Never a confirmed fact: see `kind` and `confidence`."""

    event_id: str
    kind: str  # "overflight" | "circuit" | "likely_touch_and_go" | "probable_full_stop" | "low_approach"
    aircraft_key: str
    track_id: str
    start: datetime
    end: datetime
    algorithm_version: str
    confidence: float
    confidence_label: str
    runway: str | None = None
    zone_id: str | None = None
    min_alt_ft: float | None = None
    max_alt_ft: float | None = None
    evidence_ids: list[str] = field(default_factory=list)
    details: dict = field(default_factory=dict)
    review_status: str = "pending"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["start"] = self.start.isoformat()
        d["end"] = self.end.isoformat()
        return d


def utc(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, tz=timezone.utc)
