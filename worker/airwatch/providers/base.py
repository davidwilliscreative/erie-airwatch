"""The ProviderAdapter contract.

Every data source (a licensed API, a local receiver, the fake test provider)
sits behind this interface. Vendor-specific field names never leave the
adapter: `normalize` turns one raw record into an `Observation`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime

from ..models import Observation


class ProviderError(Exception):
    """A retryable failure (network, 5xx, malformed response)."""


class RateLimited(ProviderError):
    def __init__(self, retry_after_s: float | None = None):
        super().__init__(f"rate limited (retry after {retry_after_s}s)")
        self.retry_after_s = retry_after_s


class ProviderNotAuthorized(Exception):
    """Raised when a provider is used without a confirmed licence. Not retryable."""


@dataclass
class ProviderResponse:
    fetched_at: datetime
    records: list[dict]
    cost_units: int = 1
    cursor: str | None = None
    raw: dict | None = None  # only kept when the licence allows raw retention
    meta: dict = field(default_factory=dict)


@dataclass(frozen=True)
class SourceInfo:
    name: str
    license_ref: str | None
    allows_public_display: bool
    allows_raw_retention: bool
    allows_aircraft_id_display: bool
    freshness_expectation_s: int


class ProviderAdapter(ABC):
    info: SourceInfo

    @abstractmethod
    def fetch(self, bbox: tuple[float, float, float, float], cursor: str | None, now: datetime) -> ProviderResponse:
        """Fetch records inside bbox (min_lat, min_lon, max_lat, max_lon) newer than cursor."""

    @abstractmethod
    def normalize(self, record: dict) -> Observation:
        """Convert one vendor record into a normalized Observation (UTC)."""
