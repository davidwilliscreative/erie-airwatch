from datetime import datetime, timedelta, timezone

import pytest

from airwatch.ingest import QuotaBudget, Worker, validate
from airwatch.jobs import process_window
from airwatch.models import Observation
from airwatch.providers import FakeProvider, LicensedProviderPlaceholder, ProviderNotAuthorized
from airwatch.store import MemoryStore
from airwatch.synthetic import generate


@pytest.fixture(scope="module")
def day(airport):
    return generate(airport, datetime(2026, 9, 5).date(), 1, seed=11)


def make_worker(airport, provider, store, start, budget=None):
    t = [start]
    w = Worker(airport, provider, store, budget=budget or QuotaBudget(10**6), interval_s=60,
               clock=lambda: t[0], sleep=lambda s: t.__setitem__(0, t[0] + timedelta(seconds=s)))
    return w, t


def test_restart_does_not_duplicate(airport, day):
    store = MemoryStore()
    start = day.start + timedelta(hours=10)
    w, t = make_worker(airport, FakeProvider(day.observations, duplicate_rate=0.1), store, start)
    w.run(60)
    n1 = len(store.obs)
    assert n1 > 0 and w.metrics.duplicates > 0
    # New worker, same store: resumes from the checkpoint.
    w2, _ = make_worker(airport, FakeProvider(day.observations, duplicate_rate=0.1), store, t[0])
    w2.run(1)
    assert len(store.obs) >= n1
    expected = sum(1 for o in day.observations if o.ts <= t[0])
    assert len(store.obs) == expected


def test_failures_back_off_and_are_recorded(airport, day):
    store = MemoryStore()
    w, t = make_worker(airport, FakeProvider(day.observations, fail_rate=1.0), store, day.start)
    delays = [w.poll_once() for _ in range(5)]
    assert delays == sorted(delays) and delays[-1] > delays[0]
    assert all(not c["ok"] for c in store.coverage)
    assert w.metrics.failures == 5 and not store.obs


def test_rate_limit_respects_retry_after(airport, day):
    w, _ = make_worker(airport, FakeProvider(day.observations, rate_limit_every=1), MemoryStore(), day.start)
    assert w.poll_once() >= 5
    assert w.metrics.rate_limited == 1


def test_quota_exhaustion_stops_polling(airport, day):
    store = MemoryStore()
    p = FakeProvider(day.observations)
    w, _ = make_worker(airport, p, store, day.start + timedelta(hours=9), budget=QuotaBudget(max_units=3))
    w.run(6)
    assert p.calls == 3  # polls continue while usage < 3 * (1 - 5% reserve) = 2.85
    assert w.metrics.quota_skips == 3


def test_quota_interval_spreads_budget():
    b = QuotaBudget(max_units=10_000, period_days=30, reserve_fraction=0)
    assert round(b.interval_for(datetime.now(timezone.utc))) == 259  # 30 days / 10k requests


def test_validation_rejects_bad_records(airport):
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    base = dict(source="t", source_event_id="x", aircraft_key="k", lat=airport.lat, lon=airport.lon)
    assert validate(Observation(ts=now, **base), airport, now) is None
    assert validate(Observation(ts=now + timedelta(minutes=5), **base), airport, now) == "future_timestamp"
    assert validate(Observation(ts=now, **{**base, "lat": 45.0}), airport, now) == "outside_region"
    assert validate(Observation(ts=now, alt_baro_ft=99999, **base), airport, now) == "bad_altitude"


def test_licensed_provider_refuses_without_licence(monkeypatch):
    monkeypatch.delenv("AIRWATCH_PROVIDER_LICENSE_REF", raising=False)
    monkeypatch.delenv("AIRWATCH_ENABLE_LICENSED_PROVIDER", raising=False)
    with pytest.raises(ProviderNotAuthorized):
        LicensedProviderPlaceholder()


def test_processing_is_idempotent(airport, day):
    store = MemoryStore()
    store.add_observations(day.observations)
    a = process_window(airport, store, day.start, day.end)
    ids = set(store.events)
    hourly = list(store.hourly)
    b = process_window(airport, store, day.start, day.end)
    assert a["events"] == b["events"] and b["new_events"] == 0
    assert set(store.events) == ids and store.hourly == hourly


def test_reprocessing_keeps_reviewer_decisions(airport, day):
    store = MemoryStore()
    store.add_observations(day.observations)
    process_window(airport, store, day.start, day.end)
    eid = next(iter(store.events))
    store.events[eid].review_status = "rejected"
    process_window(airport, store, day.start, day.end)
    assert store.events[eid].review_status == "rejected"


def test_aggregates_respect_reviewer_rejections(airport, day):
    store = MemoryStore()
    store.add_observations(day.observations)
    process_window(airport, store, day.start, day.end)
    total = lambda: sum(r["value"] for r in store.hourly if r["metric"] == "circuit")  # noqa: E731
    before = total()
    for e in store.events.values():
        if e.kind == "circuit":
            e.review_status = "rejected"
    process_window(airport, store, day.start, day.end)
    assert before > 0 and total() == 0
