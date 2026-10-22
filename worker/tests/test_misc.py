from datetime import datetime, timezone

from airwatch.aggregate import PublicationPolicy, is_publishable
from airwatch.models import Event
from airwatch.providers import LocalReceiverAdapter


def ev(conf, status="pending"):
    now = datetime.now(timezone.utc)
    return Event("e", "circuit", "k", "t", now, now, "1.0.0", conf, "x", review_status=status)


def test_publication_policy():
    q, r = PublicationPolicy("qualified", 0.5), PublicationPolicy("reviewed_only", 0.5)
    assert is_publishable(ev(0.8), q) and not is_publishable(ev(0.8), r)
    assert is_publishable(ev(0.8, "approved"), r)
    assert not is_publishable(ev(0.3, "approved"), r)  # low confidence is never public
    assert not is_publishable(ev(0.9, "rejected"), q)
    assert not is_publishable(ev(0.9, "needs_more_data"), q)


def test_local_receiver_parses_readsb(airport):
    a = LocalReceiverAdapter("rx1")
    n = a.accept_batch({"now": 1_760_000_000, "aircraft": [
        {"hex": "A1B2C3", "lat": airport.lat, "lon": airport.lon, "alt_baro": 6100, "gs": 90, "track": 338, "seen_pos": 1.2},
        {"hex": "ABCDEF", "lat": airport.lat, "lon": airport.lon, "alt_baro": "ground", "seen_pos": 0.5},
        {"hex": "000001"},  # no position
    ]})
    assert n == 2
    resp = a.fetch(airport.bbox(), None, datetime.now(timezone.utc))
    obs = [a.normalize(r) for r in resp.records]
    assert obs[0].aircraft_key == "a1b2c3" and obs[0].alt_baro_ft == 6100
    assert obs[1].on_ground and obs[1].alt_baro_ft is None
