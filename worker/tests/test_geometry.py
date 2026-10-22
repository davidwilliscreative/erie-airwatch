import math

from airwatch.config import angle_diff
from airwatch.detection.geometry import runway_frames


def test_local_frame_round_trip(airport):
    f = airport.frame
    lat, lon = f.to_latlon(1234.0, -567.0)
    x, y = f.to_xy(lat, lon)
    assert math.isclose(x, 1234.0, abs_tol=0.01) and math.isclose(y, -567.0, abs_tol=0.01)


def test_runway_frame_puts_threshold_at_minus_half(airport):
    for fr in runway_frames(airport):
        tx, ty = airport.frame.to_xy(fr.end.lat, fr.end.lon)
        u, v = fr.to_uv(tx, ty)
        assert math.isclose(u, -fr.half, abs_tol=5)
        assert abs(v) < 5


def test_angle_diff_wraps():
    assert angle_diff(350, 10) == 20
    assert angle_diff(158, 338) == 180
