from datetime import datetime, timezone

from airwatch.models import Observation
from airwatch.synthetic import SyntheticWorld, Waypoint


def fly(airport, waypoints: list[Waypoint], key="SYN-TEST", start=1_760_000_000.0, dt=3.0) -> list[Observation]:
    """Sample a waypoint path into clean observations (no noise, no dropouts)."""
    samples, _ = SyntheticWorld.sample_path(waypoints, start, dt)
    out = []
    for t, x, y, alt, gs, trk in samples:
        lat, lon = airport.frame.to_latlon(x, y)
        out.append(Observation("test", f"{key}-{int(t * 1000)}", datetime.fromtimestamp(t, tz=timezone.utc), key,
                               lat, lon, round(alt / 25) * 25, None, gs, trk))
    return out
