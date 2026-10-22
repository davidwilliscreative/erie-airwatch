"""Persistence for the worker. MemoryStore for tests, PostgresStore for Supabase.

Both are idempotent: inserting the same observation or event twice is a no-op,
so a restarted worker never duplicates records.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone

from .models import Event, Observation


class Store(ABC):
    @abstractmethod
    def add_observations(self, obs: list[Observation]) -> int: ...
    @abstractmethod
    def observations_between(self, start: datetime, end: datetime) -> list[Observation]: ...
    @abstractmethod
    def get_checkpoint(self, name: str) -> str | None: ...
    @abstractmethod
    def set_checkpoint(self, name: str, value: str) -> None: ...
    @abstractmethod
    def add_coverage_window(self, w: dict) -> None: ...
    @abstractmethod
    def coverage_windows(self, start: datetime, end: datetime) -> list[dict]: ...
    @abstractmethod
    def add_quota_usage(self, source: str, period: str, units: int) -> int: ...
    @abstractmethod
    def quota_usage(self, source: str, period: str) -> int: ...
    @abstractmethod
    def upsert_events(self, events: list[Event]) -> int: ...
    @abstractmethod
    def replace_hourly_metrics(self, start: datetime, end: datetime, rows: list[dict]) -> None: ...
    @abstractmethod
    def review_statuses(self, event_ids: list[str]) -> dict[str, str]: ...


class MemoryStore(Store):
    def __init__(self) -> None:
        self.obs: dict[tuple, Observation] = {}
        self.checkpoints: dict[str, str] = {}
        self.coverage: list[dict] = []
        self.quota: dict[tuple[str, str], int] = {}
        self.events: dict[str, Event] = {}
        self.hourly: list[dict] = []

    def add_observations(self, obs):
        n = 0
        for o in obs:
            if o.dedupe_key not in self.obs:
                self.obs[o.dedupe_key] = o
                n += 1
        return n

    def observations_between(self, start, end):
        return sorted((o for o in self.obs.values() if start <= o.ts < end), key=lambda o: o.ts)

    def get_checkpoint(self, name):
        return self.checkpoints.get(name)

    def set_checkpoint(self, name, value):
        self.checkpoints[name] = value

    def add_coverage_window(self, w):
        self.coverage.append(dict(w))

    def coverage_windows(self, start, end):
        return [w for w in self.coverage if w["window_end"] >= start and w["window_start"] < end]

    def add_quota_usage(self, source, period, units):
        k = (source, period)
        self.quota[k] = self.quota.get(k, 0) + units
        return self.quota[k]

    def quota_usage(self, source, period):
        return self.quota.get((source, period), 0)

    def upsert_events(self, events):
        n = 0
        for e in events:
            prev = self.events.get(e.event_id)
            if prev:
                e.review_status = prev.review_status  # never clobber a reviewer's decision
            else:
                n += 1
            self.events[e.event_id] = e
        return n

    def review_statuses(self, event_ids):
        return {i: self.events[i].review_status for i in event_ids if i in self.events}

    def replace_hourly_metrics(self, start, end, rows):
        self.hourly = [r for r in self.hourly if not (start <= r["hour"] < end)] + rows


class PostgresStore(Store):
    """Writes to the `airwatch` schema created by supabase/migrations.

    Uses a direct Postgres connection (DATABASE_URL) as the `airwatch_worker`
    role. That URL is a server-side secret: never ship it to the browser.
    """

    def __init__(self, dsn: str, airport_id: str, source_name: str):
        import psycopg

        self.conn = psycopg.connect(dsn, autocommit=True)
        self.airport_id = airport_id
        with self.conn.cursor() as cur:
            cur.execute("select id from airwatch.sources where name = %s", (source_name,))
            row = cur.fetchone()
            if not row:
                raise RuntimeError(f"source {source_name!r} is not registered in airwatch.sources")
            self.source_id = row[0]

    def add_observations(self, obs):
        if not obs:
            return 0
        sql = """
            insert into airwatch.observations
              (airport_id, source_id, source_event_id, ts, aircraft_key, geom, alt_baro_ft, alt_geom_ft,
               groundspeed_kt, track_deg, vertical_rate_fpm, on_ground, callsign, quality_flags)
            values (%s, %s, %s, %s, %s, extensions.st_setsrid(extensions.st_makepoint(%s, %s), 4326), %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict do nothing
        """
        rows = [
            (self.airport_id, self.source_id, o.source_event_id, o.ts, o.aircraft_key, o.lon, o.lat, o.alt_baro_ft,
             o.alt_geom_ft, o.groundspeed_kt, o.track_deg, o.vertical_rate_fpm, o.on_ground, o.callsign,
             list(o.quality_flags))
            for o in obs
        ]
        with self.conn.cursor() as cur:
            before = self._count(cur)
            cur.executemany(sql, rows)
            return self._count(cur) - before

    def _count(self, cur) -> int:
        cur.execute("select count(*) from airwatch.observations where source_id = %s", (self.source_id,))
        return cur.fetchone()[0]

    def observations_between(self, start, end):
        sql = """
            select s.name, o.source_event_id, o.ts, o.aircraft_key, extensions.st_y(o.geom), extensions.st_x(o.geom), o.alt_baro_ft,
                   o.alt_geom_ft, o.groundspeed_kt, o.track_deg, o.vertical_rate_fpm, o.on_ground, o.callsign,
                   o.quality_flags
            from airwatch.observations o join airwatch.sources s on s.id = o.source_id
            where o.airport_id = %s and o.ts >= %s and o.ts < %s order by o.ts
        """
        with self.conn.cursor() as cur:
            cur.execute(sql, (self.airport_id, start, end))
            return [
                Observation(r[0], r[1], r[2].astimezone(timezone.utc), r[3], r[4], r[5], _f(r[6]), _f(r[7]), _f(r[8]),
                            _f(r[9]), _f(r[10]), r[11], r[12], tuple(r[13] or ()))
                for r in cur.fetchall()
            ]

    def get_checkpoint(self, name):
        with self.conn.cursor() as cur:
            cur.execute("select value from airwatch.checkpoints where name = %s", (name,))
            row = cur.fetchone()
            return row[0] if row else None

    def set_checkpoint(self, name, value):
        with self.conn.cursor() as cur:
            cur.execute(
                "insert into airwatch.checkpoints (name, value) values (%s, %s) "
                "on conflict (name) do update set value = excluded.value, updated_at = now()",
                (name, value),
            )

    def add_coverage_window(self, w):
        with self.conn.cursor() as cur:
            cur.execute(
                """insert into airwatch.coverage_windows
                   (airport_id, source_id, window_start, window_end, ok, latency_ms, records, new_records, error, gap_s)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (self.airport_id, self.source_id, w["window_start"], w["window_end"], w["ok"], w.get("latency_ms"),
                 w.get("records", 0), w.get("new_records", 0), w.get("error"), w.get("gap_s")),
            )

    def coverage_windows(self, start, end):
        with self.conn.cursor() as cur:
            cur.execute(
                "select window_start, window_end, ok, gap_s from airwatch.coverage_windows "
                "where airport_id = %s and window_end >= %s and window_start < %s order by window_start",
                (self.airport_id, start, end),
            )
            return [dict(window_start=a, window_end=b, ok=c, gap_s=d) for a, b, c, d in cur.fetchall()]

    def add_quota_usage(self, source, period, units):
        with self.conn.cursor() as cur:
            cur.execute(
                """insert into airwatch.quota_usage (source_id, period, units) values (%s, %s, %s)
                   on conflict (source_id, period) do update set units = quota_usage.units + excluded.units
                   returning units""",
                (self.source_id, period, units),
            )
            return cur.fetchone()[0]

    def quota_usage(self, source, period):
        with self.conn.cursor() as cur:
            cur.execute("select units from airwatch.quota_usage where source_id = %s and period = %s", (self.source_id, period))
            row = cur.fetchone()
            return row[0] if row else 0

    def upsert_events(self, events):
        sql = """
            insert into airwatch.events
              (id, airport_id, kind, track_id, aircraft_key, zone_id, runway, start_ts, end_ts, algorithm_version,
               confidence, confidence_label, min_alt_ft, max_alt_ft, evidence_source_event_ids, details)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (id) do update set
              confidence = excluded.confidence, confidence_label = excluded.confidence_label,
              details = excluded.details, evidence_source_event_ids = excluded.evidence_source_event_ids
            returning (xmax = 0)
        """
        n = 0
        with self.conn.cursor() as cur:
            for e in events:
                cur.execute(sql, (e.event_id, self.airport_id, e.kind, e.track_id, e.aircraft_key, e.zone_id, e.runway,
                                  e.start, e.end, e.algorithm_version, e.confidence, e.confidence_label, e.min_alt_ft,
                                  e.max_alt_ft, e.evidence_ids, json.dumps(e.details)))
                n += 1 if cur.fetchone()[0] else 0
        return n

    def review_statuses(self, event_ids):
        with self.conn.cursor() as cur:
            cur.execute("select id::text, review_status from airwatch.events where id = any(%s::uuid[])", (event_ids,))
            return dict(cur.fetchall())

    def replace_hourly_metrics(self, start, end, rows):
        with self.conn.transaction(), self.conn.cursor() as cur:
            cur.execute("delete from airwatch.hourly_metrics where airport_id = %s and hour_start >= %s and hour_start < %s",
                        (self.airport_id, start, end))
            cur.executemany(
                "insert into airwatch.hourly_metrics (airport_id, hour_start, metric, zone_id, value) values (%s, %s, %s, %s, %s)",
                [(self.airport_id, r["hour"], r["metric"], r.get("zone_id"), r["value"]) for r in rows],
            )


def _f(v) -> float | None:
    """numeric columns arrive as Decimal; the detector works in floats."""
    return None if v is None else float(v)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()
