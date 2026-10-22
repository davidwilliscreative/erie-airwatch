import random

from airwatch.detection.pipeline import detect
from airwatch.synthetic import SyntheticWorld, Waypoint

from .helpers import fly


def world(airport, seed=3):
    w = SyntheticWorld(airport, seed)
    return w, w.frames["15"]


def kinds(events):
    out = {}
    for e in events:
        out[e.kind] = out.get(e.kind, 0) + 1
    return out


def test_three_circuits_two_touch_and_goes(airport):
    w, fr = world(airport)
    wps = w._takeoff(fr)
    for i in range(3):
        wps += w._circuit_air(fr, 1200)
        wps += w._full_stop(fr) if i == 2 else w._touch_and_go(fr)
    ev = detect(fly(airport, wps), airport).events
    k = kinds(ev)
    assert k.get("circuit") == 3
    assert k.get("likely_touch_and_go") == 2
    assert k.get("probable_full_stop") == 1
    assert all(e.runway == "15" for e in ev if e.kind != "overflight")
    circuit = next(e for e in ev if e.kind == "circuit")
    assert circuit.details["pattern_side"] == "left"
    assert {"downwind", "final"} <= set(circuit.details["legs"])


def test_go_around_above_threshold_is_low_approach_not_touch_and_go(airport):
    w, fr = world(airport)
    H = fr.half
    wps = w._takeoff(fr) + w._circuit_air(fr, 1200) + [
        w._wp(fr, -H + 200, 0, 340, 70), w._wp(fr, -H + 700, 0, 300, 72), w._wp(fr, H, 0, 650, 78),
        w._wp(fr, H + 2500, 0, 1500, 90),
    ]
    k = kinds(detect(fly(airport, wps), airport).events)
    assert k.get("likely_touch_and_go", 0) == 0
    assert k.get("low_approach") == 1


def test_high_transit_is_never_a_circuit(airport):
    w, fr = world(airport)
    for seed in range(5):
        w.rng = random.Random(seed)
        wps, _ = w._transit(fr, "X")
        k = kinds(detect(fly(airport, wps, key=f"T{seed}"), airport).events)
        assert set(k) <= {"overflight"}


def test_arbitrary_loops_are_not_circuits(airport):
    w, fr = world(airport)
    wps, _ = w._maneuvering(fr, "X")
    k = kinds(detect(fly(airport, wps), airport).events)
    assert "circuit" not in k and "likely_touch_and_go" not in k


def test_detection_is_deterministic(airport):
    w, fr = world(airport)
    wps, _ = w._training(fr, "X")
    obs = fly(airport, wps)
    a = [(e.event_id, e.confidence) for e in detect(obs, airport).events]
    b = [(e.event_id, e.confidence) for e in detect(list(reversed(obs)), airport).events]
    assert a == b and a


def test_overflight_counted_once_per_pass(airport):
    zone = airport.zones[2]
    poly = zone.polygon_xy(airport.frame)
    c = poly.centroid
    path = [Waypoint(c.x - 6000, c.y, 8000, 120), Waypoint(c.x + 6000, c.y, 8000, 120)]
    ev = [e for e in detect(fly(airport, path, dt=2), airport).events if e.kind == "overflight"]
    assert [e.zone_id for e in ev] == [zone.id]
    assert ev[0].details["min_agl_estimate_ft"] > 2500


def test_reentry_within_cooldown_is_merged(airport):
    zone = airport.zones[2]
    c = zone.polygon_xy(airport.frame).centroid
    # In, out briefly, back in: one pass.
    path = [Waypoint(c.x - 3000, c.y, 8000, 100), Waypoint(c.x, c.y, 8000, 100),
            Waypoint(c.x, c.y + 1200, 8000, 100), Waypoint(c.x, c.y - 3000, 8000, 100)]
    ev = [e for e in detect(fly(airport, path, dt=2), airport).events if e.kind == "overflight" and e.zone_id == zone.id]
    assert len(ev) == 1


def test_long_gap_over_zone_is_not_counted(airport):
    zone = airport.zones[2]
    c = zone.polygon_xy(airport.frame).centroid
    path = [Waypoint(c.x - 12000, c.y, 8000, 120), Waypoint(c.x + 12000, c.y, 8000, 120)]
    obs = fly(airport, path, dt=2)
    # Drop everything within 5 km of the zone centre (a ~160 s hole, longer than the 120 s
    # interpolation limit): the crossing is a data gap, neither zero nor one.
    keep = []
    for o in obs:
        x, y = airport.frame.to_xy(o.lat, o.lon)
        if abs(x - c.x) > 5000:
            keep.append(o)
    ev = [e for e in detect(keep, airport).events if e.kind == "overflight" and e.zone_id == zone.id]
    assert ev == []


def test_sparse_sampling_lowers_confidence(airport):
    w, fr = world(airport)
    wps = w._takeoff(fr) + w._circuit_air(fr, 1200) + w._touch_and_go(fr) + w._circuit_air(fr, 1200) + w._full_stop(fr)
    dense = [e for e in detect(fly(airport, wps, dt=2), airport).events if e.kind == "circuit"]
    sparse = [e for e in detect(fly(airport, wps, dt=18), airport).events if e.kind == "circuit"]
    assert dense and sparse
    assert max(e.confidence for e in sparse) < min(e.confidence for e in dense)
