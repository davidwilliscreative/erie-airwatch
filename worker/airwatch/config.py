"""Airport configuration and a local metric coordinate frame.

All geometry in config files is WGS84 (EPSG:4326). Detection works in a local
east/north frame in metres centred on the airport reference point, which is
accurate to well under a metre within the ~15 km geofence we use.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

from shapely.geometry import Polygon

EARTH_RADIUS_M = 6_371_008.8
FT_PER_M = 3.280839895
M_PER_NM = 1852.0
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_DIR = REPO_ROOT / "config" / "airports"


@dataclass(frozen=True)
class LocalFrame:
    lat0: float
    lon0: float

    def to_xy(self, lat: float, lon: float) -> tuple[float, float]:
        x = math.radians(lon - self.lon0) * EARTH_RADIUS_M * math.cos(math.radians(self.lat0))
        y = math.radians(lat - self.lat0) * EARTH_RADIUS_M
        return x, y

    def to_latlon(self, x: float, y: float) -> tuple[float, float]:
        lat = self.lat0 + math.degrees(y / EARTH_RADIUS_M)
        lon = self.lon0 + math.degrees(x / (EARTH_RADIUS_M * math.cos(math.radians(self.lat0))))
        return lat, lon


@dataclass(frozen=True)
class RunwayEnd:
    ident: str
    lat: float
    lon: float
    elevation_ft: float
    landing_heading_deg: float
    pattern_direction: str  # "left" | "right"


@dataclass(frozen=True)
class Runway:
    id: str
    length_ft: float
    ends: tuple[RunwayEnd, RunwayEnd]

    def midpoint_xy(self, frame: LocalFrame) -> tuple[float, float]:
        a = frame.to_xy(self.ends[0].lat, self.ends[0].lon)
        b = frame.to_xy(self.ends[1].lat, self.ends[1].lon)
        return (a[0] + b[0]) / 2, (a[1] + b[1]) / 2

    @property
    def half_length_m(self) -> float:
        return self.length_ft / FT_PER_M / 2


@dataclass(frozen=True)
class Zone:
    id: str
    slug: str
    label: str
    ring: tuple[tuple[float, float], ...]  # (lon, lat)
    synthetic: bool = False

    def polygon_xy(self, frame: LocalFrame) -> Polygon:
        return Polygon([frame.to_xy(lat, lon) for lon, lat in self.ring])


@dataclass(frozen=True)
class Airport:
    id: str
    icao: str
    name: str
    timezone: str
    lat: float
    lon: float
    elevation_ft: float
    pattern_altitude_ft: float
    geofence_radius_nm: float
    runways: tuple[Runway, ...]
    zones: tuple[Zone, ...]
    active: bool = True
    raw: dict = field(default_factory=dict, compare=False, repr=False)

    @property
    def frame(self) -> LocalFrame:
        return LocalFrame(self.lat, self.lon)

    @property
    def geofence_radius_m(self) -> float:
        return self.geofence_radius_nm * M_PER_NM

    def bbox(self, buffer_nm: float = 0.0) -> tuple[float, float, float, float]:
        """(min_lat, min_lon, max_lat, max_lon) around the geofence."""
        r = (self.geofence_radius_nm + buffer_nm) * M_PER_NM
        lat_min, lon_min = self.frame.to_latlon(-r, -r)
        lat_max, lon_max = self.frame.to_latlon(r, r)
        return lat_min, lon_min, lat_max, lon_max


def airport_from_dict(d: dict) -> Airport:
    runways = []
    for r in d["runways"]:
        ends = tuple(
            RunwayEnd(
                ident=e["ident"],
                lat=e["lat"],
                lon=e["lon"],
                elevation_ft=e["elevation_ft_msl"],
                landing_heading_deg=e["landing_heading_deg"],
                pattern_direction=e.get("pattern_direction", "left"),
            )
            for e in r["ends"]
        )
        runways.append(Runway(id=r["id"], length_ft=r["length_ft"], ends=ends))  # type: ignore[arg-type]
    zones = tuple(
        Zone(
            id=z["id"],
            slug=z["slug"],
            label=z["label"],
            ring=tuple(tuple(p) for p in z["geometry"]["coordinates"][0]),
            synthetic=z.get("synthetic", False),
        )
        for z in d.get("zones", [])
    )
    ref = d["reference"]
    return Airport(
        id=d["id"],
        icao=d["icao"],
        name=d["name"],
        timezone=d["timezone"],
        lat=ref["lat"],
        lon=ref["lon"],
        elevation_ft=ref["elevation_ft_msl"],
        pattern_altitude_ft=d["pattern"]["altitude_ft_msl"],
        geofence_radius_nm=d.get("geofence_radius_nm", 8),
        runways=tuple(runways),
        zones=zones,
        active=d.get("active", True),
        raw=d,
    )


def load_airport(icao: str = "KEIK", config_dir: Path | None = None) -> Airport:
    path = (config_dir or DEFAULT_CONFIG_DIR) / f"{icao.lower()}.json"
    return airport_from_dict(json.loads(path.read_text()))


def angle_diff(a: float, b: float) -> float:
    """Smallest absolute difference between two headings in degrees (0..180)."""
    d = (a - b) % 360.0
    return min(d, 360.0 - d)
