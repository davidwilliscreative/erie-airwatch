"""The always-on ingestion loop.

One iteration: check the quota budget, fetch from the provider since the last
checkpoint, validate and normalize records, de-duplicate, store, record a
coverage window, then advance the checkpoint. Failures back off exponentially
and are recorded as coverage gaps so the public site never shows missing data
as zero activity.
"""

from __future__ import annotations

import json
import logging
import random
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable

from .config import Airport
from .models import Observation
from .providers.base import ProviderAdapter, ProviderError, ProviderNotAuthorized, RateLimited
from .store import Store

log = logging.getLogger("airwatch.ingest")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        d = {"ts": datetime.now(timezone.utc).isoformat(), "level": record.levelname, "logger": record.name,
             "msg": record.getMessage()}
        d.update(getattr(record, "fields", {}))
        return json.dumps(d, default=str)


def setup_logging(level: str = "INFO") -> None:
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    logging.basicConfig(level=level, handlers=[h], force=True)


def _log(level: int, msg: str, **fields) -> None:
    log.log(level, msg, extra={"fields": fields})


@dataclass
class QuotaBudget:
    """A per-period request budget, e.g. 10,000 requests per 30 days."""

    max_units: int
    period_days: int = 30
    reserve_fraction: float = 0.05  # keep a little headroom for manual backfills

    def period_key(self, now: datetime) -> str:
        epoch_day = int(now.timestamp() // 86400)
        return f"p{self.period_days}-{epoch_day // self.period_days}"

    def allowed(self, used: int) -> bool:
        return used < self.max_units * (1 - self.reserve_fraction)

    def interval_for(self, now: datetime) -> float:
        """The polling interval that spreads the budget evenly over the period."""
        return self.period_days * 86400 / (self.max_units * (1 - self.reserve_fraction))


@dataclass
class Backoff:
    base_s: float = 2.0
    cap_s: float = 300.0
    attempt: int = 0
    rng: random.Random = field(default_factory=lambda: random.Random(0))

    def next_delay(self, hint: float | None = None) -> float:
        self.attempt += 1
        d = min(self.cap_s, self.base_s * 2 ** (self.attempt - 1))
        d = d * (0.5 + self.rng.random() / 2)  # jitter
        return max(d, hint or 0)

    def reset(self) -> None:
        self.attempt = 0


@dataclass
class Metrics:
    polls: int = 0
    ok: int = 0
    failures: int = 0
    rate_limited: int = 0
    records: int = 0
    stored: int = 0
    duplicates: int = 0
    rejected: int = 0
    quota_skips: int = 0


def validate(o: Observation, airport: Airport, now: datetime) -> str | None:
    """Return a rejection reason, or None if the observation is plausible."""
    if not (-90 <= o.lat <= 90 and -180 <= o.lon <= 180):
        return "bad_coordinates"
    if o.ts.tzinfo is None:
        return "naive_timestamp"
    if o.ts > now + timedelta(seconds=60):
        return "future_timestamp"
    if o.ts < now - timedelta(days=2):
        return "stale_timestamp"
    alt = o.alt_baro_ft if o.alt_baro_ft is not None else o.alt_geom_ft
    if alt is not None and not (-2000 <= alt <= 60000):
        return "bad_altitude"
    if o.groundspeed_kt is not None and not (0 <= o.groundspeed_kt <= 800):
        return "bad_groundspeed"
    lat0, lon0, lat1, lon1 = airport.bbox(buffer_nm=2)
    if not (lat0 <= o.lat <= lat1 and lon0 <= o.lon <= lon1):
        return "outside_region"
    return None


class Worker:
    def __init__(self, airport: Airport, provider: ProviderAdapter, store: Store, *, budget: QuotaBudget,
                 interval_s: float | None = None, clock: Callable[[], datetime] | None = None,
                 sleep: Callable[[float], None] = time.sleep):
        self.airport = airport
        self.provider = provider
        self.store = store
        self.budget = budget
        self.interval_s = interval_s or budget.interval_for(datetime.now(timezone.utc))
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.sleep = sleep
        self.backoff = Backoff()
        self.metrics = Metrics()
        self.ckpt_name = f"ingest:{airport.icao}:{provider.info.name}"
        self.last_success: datetime | None = None

    def poll_once(self) -> float:
        """Run one poll. Returns how long to wait before the next one."""
        now = self.clock()
        period = self.budget.period_key(now)
        used = self.store.quota_usage(self.provider.info.name, period)
        if not self.budget.allowed(used):
            self.metrics.quota_skips += 1
            _log(logging.WARNING, "quota budget exhausted; skipping poll", used=used, max=self.budget.max_units)
            self.store.add_coverage_window({"window_start": now, "window_end": now, "ok": False, "error": "quota_exhausted"})
            return max(self.interval_s, 600)

        self.metrics.polls += 1
        cursor = self.store.get_checkpoint(self.ckpt_name)
        t0 = time.monotonic()
        try:
            resp = self.provider.fetch(self.airport.bbox(buffer_nm=1), cursor, now)
        except ProviderNotAuthorized:
            raise
        except RateLimited as e:
            self.metrics.rate_limited += 1
            delay = self.backoff.next_delay(e.retry_after_s)
            self._record_failure(now, "rate_limited", t0)
            _log(logging.WARNING, "rate limited", retry_in_s=round(delay, 1))
            return delay
        except ProviderError as e:
            self.metrics.failures += 1
            delay = self.backoff.next_delay()
            self._record_failure(now, str(e), t0)
            _log(logging.ERROR, "provider error", error=str(e), retry_in_s=round(delay, 1), attempt=self.backoff.attempt)
            return delay

        self.store.add_quota_usage(self.provider.info.name, period, resp.cost_units)
        good: list[Observation] = []
        seen: set[tuple] = set()
        for rec in resp.records:
            try:
                o = self.provider.normalize(rec)
            except (KeyError, TypeError, ValueError):
                self.metrics.rejected += 1
                continue
            reason = validate(o, self.airport, now)
            if reason:
                self.metrics.rejected += 1
                continue
            if o.dedupe_key in seen:
                self.metrics.duplicates += 1
                continue
            seen.add(o.dedupe_key)
            good.append(o)
        stored = self.store.add_observations(good)
        self.metrics.duplicates += len(good) - stored
        self.metrics.records += len(resp.records)
        self.metrics.stored += stored
        self.metrics.ok += 1
        latency_ms = int((time.monotonic() - t0) * 1000)
        gap_s = (now - self.last_success).total_seconds() if self.last_success else None
        start = self.last_success or now - timedelta(seconds=self.interval_s)
        self.store.add_coverage_window({"window_start": start, "window_end": now, "ok": True, "latency_ms": latency_ms,
                                        "records": len(resp.records), "new_records": stored, "gap_s": gap_s})
        # Advance the checkpoint only after the data is stored, so a crash replays rather than skips.
        if resp.cursor is not None:
            self.store.set_checkpoint(self.ckpt_name, resp.cursor)
        self.last_success = now
        self.backoff.reset()
        _log(logging.INFO, "poll ok", records=len(resp.records), stored=stored, latency_ms=latency_ms)
        return self.interval_s

    def _record_failure(self, now: datetime, error: str, t0: float) -> None:
        self.store.add_coverage_window({"window_start": now, "window_end": now, "ok": False, "error": error,
                                        "latency_ms": int((time.monotonic() - t0) * 1000)})

    def run(self, max_iterations: int | None = None) -> Metrics:
        i = 0
        while max_iterations is None or i < max_iterations:
            delay = self.poll_once()
            i += 1
            if max_iterations is None or i < max_iterations:
                self.sleep(delay)
        return self.metrics
