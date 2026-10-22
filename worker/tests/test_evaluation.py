"""Regression guard on held-out synthetic days. Synthetic scores say nothing about real-world accuracy."""

from datetime import date

from airwatch.detection.pipeline import detect
from airwatch.evaluate import evaluate_synthetic
from airwatch.synthetic import generate


def test_synthetic_benchmark(airport):
    ds = generate(airport, date(2026, 8, 3), 5, seed=1234)
    res = evaluate_synthetic(airport, ds, detect(ds.observations, airport, ds.outages).events)
    s = res["scores"]
    assert s["likely_touch_and_go"]["precision"] >= 0.9
    assert s["likely_touch_and_go"]["recall"] >= 0.7
    assert s["circuit"]["precision"] >= 0.95
    assert s["overflight"]["precision"] >= 0.95
