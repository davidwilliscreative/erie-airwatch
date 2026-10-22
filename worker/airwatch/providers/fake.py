"""A deterministic in-memory provider backed by synthetic data, for tests and demos."""

from __future__ import annotations

import random
from datetime import datetime, timezone

from ..models import Observation
from .base import ProviderAdapter, ProviderError, ProviderResponse, RateLimited, SourceInfo


class FakeProvider(ProviderAdapter):
    info = SourceInfo(
        name="synthetic",
        license_ref="internal-synthetic",
        allows_public_display=True,
        allows_raw_retention=True,
        allows_aircraft_id_display=False,
        freshness_expectation_s=60,
    )

    def __init__(self, observations: list[Observation], *, fail_rate: float = 0.0, rate_limit_every: int = 0,
                 seed: int = 1, duplicate_rate: float = 0.0):
        self._obs = sorted(observations, key=lambda o: o.ts)
        self._rng = random.Random(seed)
        self.fail_rate = fail_rate
        self.rate_limit_every = rate_limit_every
        self.duplicate_rate = duplicate_rate
        self.calls = 0

    def fetch(self, bbox, cursor, now):
        self.calls += 1
        if self.rate_limit_every and self.calls % self.rate_limit_every == 0:
            raise RateLimited(retry_after_s=5)
        if self._rng.random() < self.fail_rate:
            raise ProviderError("simulated upstream 503")
        since = float(cursor) if cursor else float("-inf")
        lat0, lon0, lat1, lon1 = bbox
        recs = [
            self._to_record(o)
            for o in self._obs
            if since < o.t <= now.timestamp() and lat0 <= o.lat <= lat1 and lon0 <= o.lon <= lon1
        ]
        # Real feeds resend points; the worker must de-duplicate.
        recs += [r for r in recs if self._rng.random() < self.duplicate_rate]
        new_cursor = str(max((r["t"] for r in recs), default=since)) if recs else cursor
        return ProviderResponse(fetched_at=now, records=recs, cursor=new_cursor, meta={"count": len(recs)})

    @staticmethod
    def _to_record(o: Observation) -> dict:
        return {
            "id": o.source_event_id, "t": o.t, "hex": o.aircraft_key, "lat": o.lat, "lon": o.lon,
            "alt_baro": o.alt_baro_ft, "alt_geom": o.alt_geom_ft, "gs": o.groundspeed_kt,
            "track": o.track_deg, "baro_rate": o.vertical_rate_fpm, "ground": o.on_ground,
        }

    def normalize(self, r: dict) -> Observation:
        return Observation(
            source=self.info.name,
            source_event_id=r["id"],
            ts=datetime.fromtimestamp(r["t"], tz=timezone.utc),
            aircraft_key=r["hex"],
            lat=r["lat"], lon=r["lon"],
            alt_baro_ft=r.get("alt_baro"), alt_geom_ft=r.get("alt_geom"),
            groundspeed_kt=r.get("gs"), track_deg=r.get("track"),
            vertical_rate_fpm=r.get("baro_rate"), on_ground=r.get("ground"),
            quality_flags=("synthetic",),
        )
