"""Runway-relative coordinates used by both the detector and the synthetic generator."""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..config import Airport, Runway, RunwayEnd


@dataclass(frozen=True)
class RunwayFrame:
    """Coordinates relative to a landing runway end.

    u: metres along the landing direction, 0 at runway midpoint
       (threshold is at -half_length, departure end at +half_length)
    v: metres to the right of the landing direction (left traffic flies v < 0)
    """

    runway: Runway
    end: RunwayEnd
    mx: float
    my: float

    @classmethod
    def build(cls, airport: Airport, runway: Runway, end: RunwayEnd) -> "RunwayFrame":
        mx, my = runway.midpoint_xy(airport.frame)
        return cls(runway, end, mx, my)

    @property
    def heading(self) -> float:
        return self.end.landing_heading_deg

    @property
    def half(self) -> float:
        return self.runway.half_length_m

    @property
    def side(self) -> int:
        """-1 for left traffic, +1 for right traffic."""
        return -1 if self.end.pattern_direction == "left" else 1

    def to_uv(self, x: float, y: float) -> tuple[float, float]:
        h = math.radians(self.heading)
        dx, dy = x - self.mx, y - self.my
        u = dx * math.sin(h) + dy * math.cos(h)
        v = dx * math.cos(h) - dy * math.sin(h)
        return u, v

    def to_xy(self, u: float, v: float) -> tuple[float, float]:
        h = math.radians(self.heading)
        x = self.mx + u * math.sin(h) + v * math.cos(h)
        y = self.my + u * math.cos(h) - v * math.sin(h)
        return x, y


def runway_frames(airport: Airport) -> list[RunwayFrame]:
    return [RunwayFrame.build(airport, rw, end) for rw in airport.runways for end in rw.ends]


def bearing_xy(x0: float, y0: float, x1: float, y1: float) -> float:
    return math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360.0
