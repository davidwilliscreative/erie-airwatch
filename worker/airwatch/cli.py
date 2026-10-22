"""Command line entry point: `python -m airwatch <command>`."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .config import REPO_ROOT, load_airport


def cmd_demo_snapshot(a):
    from .snapshot import write

    end = date.fromisoformat(a.end_day) if a.end_day else date.today() - timedelta(days=1)
    info = write(Path(a.out), load_airport(a.airport), end, a.days, a.seed)
    print(json.dumps(info, indent=2))


def cmd_evaluate(a):
    from .detection.pipeline import detect
    from .evaluate import evaluate_synthetic
    from .synthetic import generate

    ap = load_airport(a.airport)
    ds = generate(ap, date.fromisoformat(a.start_day), a.days, a.seed)
    res = detect(ds.observations, ap, ds.outages)
    print(json.dumps(evaluate_synthetic(ap, ds, res.events), indent=2))


def _store(a, ap):
    if a.store == "postgres":
        from .store import PostgresStore

        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            sys.exit("DATABASE_URL is not set (use the worker role's connection string; keep it server-side)")
        return PostgresStore(dsn, ap.id, a.source)
    from .store import MemoryStore

    return MemoryStore()


def cmd_run(a):
    from .ingest import QuotaBudget, Worker, setup_logging
    from .jobs import process_pending
    from .providers import FakeProvider, LicensedProviderPlaceholder
    from .synthetic import generate

    setup_logging(a.log_level)
    ap = load_airport(a.airport)
    store = _store(a, ap)
    budget = QuotaBudget(max_units=a.quota, period_days=a.quota_days)
    if a.provider == "fake":
        # Replay a synthetic day against a simulated clock so the loop can be exercised end to end.
        day = date.today() - timedelta(days=1)
        ds = generate(ap, day, 1, a.seed)
        provider = FakeProvider(ds.observations, fail_rate=a.fail_rate, duplicate_rate=0.02)
        t = [ds.start + timedelta(hours=7)]
        clock = lambda: t[0]  # noqa: E731

        def sleep(s):
            t[0] += timedelta(seconds=s)
        worker = Worker(ap, provider, store, budget=budget, interval_s=a.interval, clock=clock, sleep=sleep)
        m = worker.run(a.iterations)
        print(json.dumps({"metrics": m.__dict__, "processed": process_pending(ap, store, now=t[0])}, default=str, indent=2))
    else:
        provider = LicensedProviderPlaceholder()  # raises unless the licence gate is satisfied
        Worker(ap, provider, store, budget=budget, interval_s=a.interval).run(a.iterations)


def cmd_load_demo(a):
    """Load a synthetic week into Postgres through the normal worker code path."""
    from .ingest import QuotaBudget, Worker, setup_logging
    from .jobs import process_window
    from .providers import FakeProvider
    from .synthetic import generate

    setup_logging("WARNING")
    ap = load_airport(a.airport)
    store = _store(a, ap)
    end = datetime.now(timezone.utc).date() - timedelta(days=1)
    ds = generate(ap, end - timedelta(days=a.days - 1), a.days, a.seed)
    provider = FakeProvider(ds.observations)
    t = [ds.start]
    w = Worker(ap, provider, store, budget=QuotaBudget(10**9), interval_s=60, clock=lambda: t[0],
               sleep=lambda s: None)
    while t[0] < ds.end:
        t[0] += timedelta(seconds=60)
        if not any(a0 <= t[0].timestamp() < b0 for a0, b0 in ds.outages):
            w.poll_once()
    print(json.dumps(process_window(ap, store, ds.start, ds.end), indent=2))


def main(argv=None):
    p = argparse.ArgumentParser(prog="airwatch", description="Erie AirWatch worker")
    p.add_argument("--airport", default="KEIK")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("demo-snapshot", help="write synthetic demo data for the website")
    s.add_argument("--out", default=str(REPO_ROOT / "web" / "src" / "data" / "demo"))
    s.add_argument("--days", type=int, default=14)
    s.add_argument("--end-day")
    s.add_argument("--seed", type=int, default=7)
    s.set_defaults(fn=cmd_demo_snapshot)

    s = sub.add_parser("evaluate", help="score the detector on synthetic ground truth")
    s.add_argument("--start-day", default="2026-09-01")
    s.add_argument("--days", type=int, default=14)
    s.add_argument("--seed", type=int, default=99)
    s.set_defaults(fn=cmd_evaluate)

    for name, fn in (("run", cmd_run), ("load-demo", cmd_load_demo)):
        s = sub.add_parser(name)
        s.add_argument("--store", choices=["memory", "postgres"], default="memory")
        s.add_argument("--source", default="synthetic")
        s.add_argument("--seed", type=int, default=7)
        s.add_argument("--days", type=int, default=7)
        if name == "run":
            s.add_argument("--provider", choices=["fake", "licensed"], default="fake")
            s.add_argument("--iterations", type=int, default=60)
            s.add_argument("--interval", type=float, default=60)
            s.add_argument("--quota", type=int, default=10_000)
            s.add_argument("--quota-days", type=int, default=30)
            s.add_argument("--fail-rate", type=float, default=0.05)
            s.add_argument("--log-level", default="INFO")
        s.set_defaults(fn=fn)

    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
