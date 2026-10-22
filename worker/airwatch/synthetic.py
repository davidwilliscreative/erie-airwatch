"""Synthetic but plausible KEIK traffic with ground truth.

Everything produced here is fake and labelled `source="synthetic"`. It exists so
the dashboard, the ingestion worker and the detector can be built and measured
before any aviation data licence is in place.

The generator flies simple paths in a runway-relative frame (see
`detection.geometry.RunwayFrame`), samples them like an ADS-B feed would
(irregular intervals, position noise, 25 ft altitude steps, dropouts close to
the ground, whole-feed outages) and records what "really" happened so the
detector can be scored.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .config import Airport, FT_PER_M
from .detection.geometry import RunwayFrame, bearing_xy, runway_frames
from .models import Observation

KT_TO_MPS = 0.514444


@dataclass
class Waypoint:
    x: float
    y: float
    alt_ft: float
    gs_kt: float
    tag: str | None = None


@dataclass
class TruthEvent:
    kind: str  # circuit | touch_and_go | full_stop | go_around | overflight
    aircraft_key: str
    flight_id: str
    start: float
    end: float
    runway: str | None = None
    zone_id: str | None = None


@dataclass
class SyntheticFlight:
    flight_id: str
    aircraft_key: str
    kind: str
    waypoints: list[Waypoint]
    start_t: float
    sample_interval_s: float
    runway: str | None = None


@dataclass
class SyntheticDataset:
    observations: list[Observation]
    truth: list[TruthEvent]
    outages: list[tuple[float, float]]
    flights: list[SyntheticFlight] = field(default_factory=list)
    start: datetime | None = None
    end: datetime | None = None


class SyntheticWorld:
    def __init__(self, airport: Airport, seed: int = 7):
        self.airport = airport
        self.rng = random.Random(seed)
        self.frames = {f.end.ident: f for f in runway_frames(airport)}
        self.fleet = [f"SYN-{self.rng.randrange(16**4):04X}" for _ in range(8)]
        self._n = 0

    # ---- path building -------------------------------------------------
    def _wp(self, fr: RunwayFrame, u: float, v: float, agl_ft: float, gs: float, tag: str | None = None) -> Waypoint:
        x, y = fr.to_xy(u, v)
        return Waypoint(x, y, self.airport.elevation_ft + agl_ft, gs, tag)

    def _takeoff(self, fr: RunwayFrame) -> list[Waypoint]:
        H = fr.half
        return [
            self._wp(fr, -H + 30, 0, 0, 5, "takeoff_roll"),
            self._wp(fr, -H + 250, 0, 0, 45),
            self._wp(fr, -H + 520, 0, 0, 62, "liftoff"),
            self._wp(fr, H, 0, 350, 72),
        ]

    def _circuit_air(self, fr: RunwayFrame, wide: float) -> list[Waypoint]:
        """From the departure end, around the pattern, to short final."""
        H, s, r = fr.half, fr.side, self.rng
        P = self.airport.pattern_altitude_ft - self.airport.elevation_ft
        j = lambda m: r.uniform(-m, m)  # noqa: E731
        return [
            self._wp(fr, H + 900 + j(150), j(40), 600 + j(80), 78),
            self._wp(fr, H + 1500 + j(150), s * 350, 800 + j(80), 82),
            self._wp(fr, H + 1600 + j(150), s * (wide * 0.8), 900 + j(60), 88),
            self._wp(fr, H + 1100 + j(150), s * wide, P + j(80), 92),
            self._wp(fr, -H - 400 + j(150), s * wide + j(60), P + j(60), 90),
            self._wp(fr, -H - 1300 + j(150), s * wide * 0.85, P - 250 + j(60), 82),
            self._wp(fr, -H - 2000 + j(120), s * 450, P - 450 + j(60), 76),
            self._wp(fr, -H - 1700 + j(80), j(20), 420 + j(40), 72),
            self._wp(fr, -H - 600, j(10), 140, 68),
        ]

    def _touch_and_go(self, fr: RunwayFrame) -> list[Waypoint]:
        H = fr.half
        return [
            self._wp(fr, -H + 280, 0, 0, 60, "touchdown"),
            self._wp(fr, -H + 800, 0, 0, 50),
            self._wp(fr, 0, 0, 0, 52),
            self._wp(fr, H - 450, 0, 0, 62, "liftoff"),
            self._wp(fr, H, 0, 180, 70),
        ]

    def _full_stop(self, fr: RunwayFrame) -> list[Waypoint]:
        H = fr.half
        return [
            self._wp(fr, -H + 280, 0, 0, 60, "touchdown"),
            self._wp(fr, -H + 800, 0, 0, 32),
            self._wp(fr, -H + 1150, 0, 0, 12, "full_stop"),
            self._wp(fr, -H + 1250, 30, 0, 8),
        ]

    def _go_around(self, fr: RunwayFrame) -> list[Waypoint]:
        H = fr.half
        low = self.rng.choice([60, 120, 200, 300])
        return [
            self._wp(fr, -H + 200, 0, low + 40, 70),
            self._wp(fr, -H + 700, 0, low, 72, "go_around"),
            self._wp(fr, H, 0, low + 350, 78),
        ]

    def _edge_point(self, bearing_deg: float, dist_m: float, alt_ft: float, gs: float) -> Waypoint:
        b = math.radians(bearing_deg)
        return Waypoint(dist_m * math.sin(b), dist_m * math.cos(b), alt_ft, gs)

    # ---- flight types ---------------------------------------------------
    def _training(self, fr: RunwayFrame, key: str) -> tuple[list[Waypoint], str]:
        wps = self._takeoff(fr)
        n = self.rng.randint(2, 7)
        wide = self.rng.uniform(900, 1500)
        for i in range(n):
            wps += [self._circuit_air(fr, wide + self.rng.uniform(-120, 120))][0]
            last = i == n - 1
            if last:
                wps += self._full_stop(fr)
            elif self.rng.random() < 0.12:
                wps += self._go_around(fr)
            else:
                wps += self._touch_and_go(fr)
        return wps, "training"

    def _departure(self, fr: RunwayFrame, key: str) -> tuple[list[Waypoint], str]:
        wps = self._takeoff(fr)
        wps.append(self._wp(fr, fr.half + 2500, 0, 1400, 95))
        out = (fr.heading + self.rng.uniform(-100, 100)) % 360
        wps.append(self._edge_point(out, 16_000, self.airport.elevation_ft + 3500, 115))
        return wps, "departure"

    def _arrival(self, fr: RunwayFrame, key: str) -> tuple[list[Waypoint], str]:
        H, s = fr.half, fr.side
        P = self.airport.pattern_altitude_ft - self.airport.elevation_ft
        wide = self.rng.uniform(900, 1400)
        entry_u = H + 600
        ex, ey = fr.to_xy(entry_u + 2500, s * (wide + 2500))
        start = Waypoint(ex * 4, ey * 4, self.airport.elevation_ft + 3000, 120)
        wps = [
            start,
            self._wp(fr, entry_u + 1500, s * (wide + 1500), P + 300, 100),
            self._wp(fr, entry_u, s * wide, P, 92),
            self._wp(fr, -H - 400, s * wide, P, 90),
            self._wp(fr, -H - 1300, s * wide * 0.85, P - 250, 82),
            self._wp(fr, -H - 2000, s * 450, P - 450, 76),
            self._wp(fr, -H - 1700, 0, 420, 72),
            self._wp(fr, -H - 600, 0, 140, 68),
        ]
        return wps + self._full_stop(fr), "arrival"

    def _transit(self, fr: RunwayFrame, key: str) -> tuple[list[Waypoint], str]:
        hdg = self.rng.uniform(0, 360)
        offset = self.rng.uniform(-6000, 6000)
        alt = self.rng.choice([7500, 8500, 9500, 10500]) + self.rng.uniform(-150, 150)
        gs = self.rng.uniform(110, 170)
        h = math.radians(hdg)
        ox, oy = offset * math.cos(h), -offset * math.sin(h)
        a = Waypoint(ox - 17_000 * math.sin(h), oy - 17_000 * math.cos(h), alt, gs)
        b = Waypoint(ox + 17_000 * math.sin(h), oy + 17_000 * math.cos(h), alt, gs)
        return [a, b], "transit"

    def _maneuvering(self, fr: RunwayFrame, key: str) -> tuple[list[Waypoint], str]:
        b = math.radians(self.rng.uniform(0, 360))
        cx, cy = 5500 * math.sin(b), 5500 * math.cos(b)
        alt = self.airport.elevation_ft + self.rng.uniform(1500, 2500)
        wps = [Waypoint(cx * 3, cy * 3, alt + 500, 110)]
        for k in range(self.rng.randint(2, 4)):
            for i in range(9):
                a = 2 * math.pi * i / 8
                wps.append(Waypoint(cx + 800 * math.cos(a), cy + 800 * math.sin(a), alt, 90))
        wps.append(Waypoint(-cx * 3, cy * 3, alt + 500, 110))
        return wps, "maneuvering"

    # ---- sampling -------------------------------------------------------
    @staticmethod
    def sample_path(wps: list[Waypoint], start_t: float, dt: float) -> tuple[list[tuple[float, float, float, float, float, float]], dict[int, float]]:
        """Return dense samples (t, x, y, alt, gs, track) and the time each waypoint is reached."""
        t = start_t
        samples = []
        wp_times = {0: start_t}
        carry = 0.0
        for i in range(len(wps) - 1):
            a, b = wps[i], wps[i + 1]
            dist = math.hypot(b.x - a.x, b.y - a.y)
            v = max((a.gs_kt + b.gs_kt) / 2 * KT_TO_MPS, 1.0)
            seg_dur = dist / v
            trk = bearing_xy(a.x, a.y, b.x, b.y)
            s = carry
            while s < seg_dur:
                f = s / seg_dur if seg_dur else 0
                samples.append(
                    (
                        t + s,
                        a.x + (b.x - a.x) * f,
                        a.y + (b.y - a.y) * f,
                        a.alt_ft + (b.alt_ft - a.alt_ft) * f,
                        a.gs_kt + (b.gs_kt - a.gs_kt) * f,
                        trk,
                    )
                )
                s += dt
            carry = s - seg_dur
            t += seg_dur
            wp_times[i + 1] = t
        return samples, wp_times

    def _truth_for(self, f: SyntheticFlight, wp_times: dict[int, float]) -> list[TruthEvent]:
        out: list[TruthEvent] = []
        last_liftoff: float | None = None
        for i, wp in enumerate(f.waypoints):
            t = wp_times[i]
            if wp.tag == "liftoff":
                last_liftoff = t
            elif wp.tag in ("touchdown", "go_around"):
                if last_liftoff is not None:
                    out.append(TruthEvent("circuit", f.aircraft_key, f.flight_id, last_liftoff, t, f.runway))
                    last_liftoff = None
                if wp.tag == "go_around":
                    out.append(TruthEvent("go_around", f.aircraft_key, f.flight_id, t, t, f.runway))
                    last_liftoff = t
            elif wp.tag == "full_stop":
                out.append(TruthEvent("full_stop", f.aircraft_key, f.flight_id, t, t, f.runway))
        # A touch-and-go is a touchdown followed by a liftoff without a full stop.
        tags = [(wp_times[i], wp.tag) for i, wp in enumerate(f.waypoints) if wp.tag]
        for (t0, a), (t1, b) in zip(tags, tags[1:]):
            if a == "touchdown" and b == "liftoff":
                out.append(TruthEvent("touch_and_go", f.aircraft_key, f.flight_id, t0, t1, f.runway))
        if f.kind != "training":
            out = [e for e in out if e.kind != "circuit"]
        return out

    # ---- day generation -------------------------------------------------
    def _new_flight(self, kind: str, fr: RunwayFrame, start_t: float) -> SyntheticFlight:
        self._n += 1
        key = self.rng.choice(self.fleet[:5]) if kind == "training" else (
            self.rng.choice(self.fleet) if kind in ("departure", "arrival") and self.rng.random() < 0.5
            else f"SYN-{self.rng.randrange(16**4):04X}"
        )
        builder = {
            "training": self._training,
            "departure": self._departure,
            "arrival": self._arrival,
            "transit": self._transit,
            "maneuvering": self._maneuvering,
        }[kind]
        wps, _ = builder(fr, key)
        dt = self.rng.choice([2, 3, 5, 5, 5, 8, 12, 20, 30])
        return SyntheticFlight(f"F{self._n:05d}", key, kind, wps, start_t, dt, fr.end.ident if kind != "transit" else None)

    def generate(self, start_day: date, days: int) -> SyntheticDataset:
        tz = ZoneInfo(self.airport.timezone)
        flights: list[SyntheticFlight] = []
        outages: list[tuple[float, float]] = []
        for d in range(days):
            day = start_day + timedelta(days=d)
            weekend = day.weekday() >= 5
            runway = self.rng.choice(list(self.frames))
            switch_hour = self.rng.choice([None, None, 13, 15])
            n = self.rng.randint(30, 44) if weekend else self.rng.randint(16, 28)
            for _ in range(n):
                hour = min(max(self.rng.gauss(12.5, 3.2), 6.5), 19.5)
                local = datetime(day.year, day.month, day.day, tzinfo=tz) + timedelta(hours=hour)
                rwy = runway
                if switch_hour and hour >= switch_hour:
                    rwy = [k for k in self.frames if k != runway][0]
                kind = self.rng.choices(
                    ["training", "departure", "arrival", "transit", "maneuvering"], [35, 20, 20, 20, 5]
                )[0]
                flights.append(self._new_flight(kind, self.frames[rwy], local.timestamp()))
            day_start = datetime(day.year, day.month, day.day, 7, tzinfo=tz).timestamp()
            for _ in range(self.rng.randint(1, 3)):
                s = day_start + self.rng.uniform(0, 12 * 3600)
                outages.append((s, s + self.rng.uniform(180, 720)))

        obs: list[Observation] = []
        truth: list[TruthEvent] = []
        elev = self.airport.elevation_ft
        fence = self.airport.geofence_radius_m * 1.3
        frame = self.airport.frame
        for f in flights:
            samples, wp_times = self.sample_path(f.waypoints, f.start_t, f.sample_interval_s)
            truth += self._truth_for(f, wp_times)
            prev_alt = None
            for t, x, y, alt, gs, trk in samples:
                if math.hypot(x, y) > fence:
                    continue
                if any(a <= t < b for a, b in outages):
                    continue
                agl = alt - elev
                if agl < 150 and self.rng.random() < 0.25:
                    continue  # receivers often miss aircraft close to the ground
                if self.rng.random() < 0.03:
                    continue
                nx, ny = x + self.rng.gauss(0, 8), y + self.rng.gauss(0, 8)
                lat, lon = frame.to_latlon(nx, ny)
                alt_r = round((alt + self.rng.choice([0, 0, 0, 25, -25])) / 25) * 25
                vr = 0.0 if prev_alt is None else (alt - prev_alt[1]) / max(t - prev_alt[0], 1) * 60
                prev_alt = (t, alt)
                obs.append(
                    Observation(
                        source="synthetic",
                        source_event_id=f"{f.flight_id}-{int(t * 1000)}",
                        ts=datetime.fromtimestamp(round(t, 1), tz=timezone.utc),
                        aircraft_key=f.aircraft_key,
                        lat=round(lat, 6),
                        lon=round(lon, 6),
                        alt_baro_ft=alt_r,
                        alt_geom_ft=alt_r + 75,
                        groundspeed_kt=round(gs + self.rng.gauss(0, 1.5), 1),
                        track_deg=round((trk + self.rng.gauss(0, 2)) % 360, 1),
                        vertical_rate_fpm=round(vr / 64) * 64,
                        on_ground=agl < 10 and gs < 70,
                        quality_flags=("synthetic",),
                    )
                )
        obs.sort(key=lambda o: o.ts)
        start = datetime.combine(start_day, datetime.min.time(), tzinfo=tz).astimezone(timezone.utc)
        return SyntheticDataset(obs, truth, outages, flights, start, start + timedelta(days=days))


def generate(airport: Airport, start_day: date, days: int, seed: int = 7) -> SyntheticDataset:
    return SyntheticWorld(airport, seed).generate(start_day, days)


__all__ = ["SyntheticWorld", "SyntheticDataset", "TruthEvent", "generate", "FT_PER_M"]
