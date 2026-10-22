import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from airwatch.config import load_airport  # noqa: E402


@pytest.fixture(scope="session")
def airport():
    return load_airport("KEIK")
