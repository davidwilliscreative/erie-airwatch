"""Runs only inside scripts/test-db.sh, after a synthetic load through PostgresStore."""

import os
import sys
from pathlib import Path

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from airwatch.config import load_airport  # noqa: E402

DSN = os.environ.get("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


@pytest.fixture(scope="module")
def cur():
    with psycopg.connect(DSN) as conn:
        yield conn.cursor()


def test_load_produced_data(cur):
    cur.execute("select count(*) from airwatch.observations")
    assert cur.fetchone()[0] > 1000
    cur.execute("select kind, count(*) from airwatch.events group by 1")
    kinds = dict(cur.fetchall())
    assert kinds.get("circuit", 0) > 0 and kinds.get("likely_touch_and_go", 0) > 0 and kinds.get("overflight", 0) > 0
    cur.execute("select count(*) from airwatch.hourly_metrics where metric = 'coverage_pct'")
    assert cur.fetchone()[0] >= 72


def test_coverage_windows_record_outages(cur):
    cur.execute("select count(*) from airwatch.coverage_windows where ok and gap_s > 150")
    assert cur.fetchone()[0] > 0  # the synthetic outages show up as gaps, not as zero traffic


def test_postgis_agrees_with_python_on_zone_crossings(cur):
    ap = load_airport()
    cur.execute("select min(ts), max(ts) + interval '1 second' from airwatch.observations")
    start, end = cur.fetchone()
    cur.execute("select zone_id::text, aircraft_key from airwatch.zone_segment_hits(%s, %s, %s, 120)", (ap.id, start, end))
    postgis = set(cur.fetchall())
    cur.execute("select distinct zone_id::text, aircraft_key from airwatch.events where kind = 'overflight'")
    python = set(cur.fetchall())
    jaccard = len(postgis & python) / len(postgis | python)
    assert jaccard >= 0.98, (len(postgis), len(python), postgis ^ python)


def test_worker_cannot_review_or_publish(cur):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        cur.execute("update airwatch.events set review_status = 'approved'")
    cur.connection.rollback()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        cur.execute("insert into airwatch.reports (airport_id, kind, period_start, period_end, metrics, methodology_version) "
                    "select id, 'weekly', now(), now() + interval '1 day', '{}', '1.0.0' from airwatch.airports")
    cur.connection.rollback()
