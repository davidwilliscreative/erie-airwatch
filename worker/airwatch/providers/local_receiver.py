"""Contract for a future local ADS-B receiver (readsb / dump1090 `aircraft.json`).

A small uploader next to the receiver POSTs batches to the ingestion endpoint
(see supabase/functions/receiver-ingest). This adapter turns those batches into
the same normalized Observation schema the API providers use.

Source priority when both a licensed API and a receiver see the same aircraft
within 2 s and 50 m: keep the receiver point (lower latency, our own coverage)
and record the API point as `quality_flags=("duplicate_of_receiver",)` only if
the licence allows raw retention. See docs/adr/0005-receiver-reconciliation.md.
"""

from __future__ import annotations

from datetime import datetime, timezone

from ..models import Observation
from .base import ProviderAdapter, ProviderResponse, SourceInfo


class LocalReceiverAdapter(ProviderAdapter):
    def __init__(self, receiver_id: str):
        self.receiver_id = receiver_id
        self.info = SourceInfo(f"receiver:{receiver_id}", "own-receiver", True, True, False, 10)
        self._queue: list[dict] = []

    def accept_batch(self, payload: dict) -> int:
        """Accept a readsb-style payload: {"now": epoch_s, "aircraft": [...]}"""
        now = float(payload["now"])
        n = 0
        for ac in payload.get("aircraft", []):
            if "lat" not in ac or "lon" not in ac or ac.get("seen_pos", 0) > 10:
                continue
            ac = dict(ac, _t=now - float(ac.get("seen_pos", 0)))
            self._queue.append(ac)
            n += 1
        return n

    def fetch(self, bbox, cursor, now):
        lat0, lon0, lat1, lon1 = bbox
        recs = [r for r in self._queue if lat0 <= r["lat"] <= lat1 and lon0 <= r["lon"] <= lon1]
        self._queue.clear()
        return ProviderResponse(fetched_at=now, records=recs, cost_units=0)

    def normalize(self, r: dict) -> Observation:
        alt = r.get("alt_baro")
        ground = alt == "ground"
        return Observation(
            source=self.info.name,
            source_event_id=f"{self.receiver_id}-{r['hex']}-{int(r['_t'] * 1000)}",
            ts=datetime.fromtimestamp(r["_t"], tz=timezone.utc),
            aircraft_key=r["hex"].lower(),
            lat=float(r["lat"]), lon=float(r["lon"]),
            alt_baro_ft=None if ground or alt is None else float(alt),
            alt_geom_ft=r.get("alt_geom"),
            groundspeed_kt=r.get("gs"), track_deg=r.get("track"),
            vertical_rate_fpm=r.get("baro_rate"), on_ground=ground,
            callsign=(r.get("flight") or "").strip() or None,
        )
