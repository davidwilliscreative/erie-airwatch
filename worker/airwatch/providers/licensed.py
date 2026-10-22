"""Placeholder for a licensed commercial provider.

This adapter deliberately refuses to run. Activating a real provider requires:
  1. a written licence covering continuous collection, storage, derived metrics
     and public display (docs/license-checklist.md), recorded in the `sources` table;
  2. AIRWATCH_PROVIDER_LICENSE_REF set to that licence reference;
  3. AIRWATCH_ENABLE_LICENSED_PROVIDER=yes, set deliberately by the project owner;
  4. an implementation of fetch/normalize for that vendor's documented API.
"""

from __future__ import annotations

import os

from .base import ProviderAdapter, ProviderNotAuthorized, SourceInfo


class LicensedProviderPlaceholder(ProviderAdapter):
    def __init__(self, name: str = "licensed-provider"):
        ref = os.environ.get("AIRWATCH_PROVIDER_LICENSE_REF")
        enabled = os.environ.get("AIRWATCH_ENABLE_LICENSED_PROVIDER") == "yes"
        if not (ref and enabled):
            raise ProviderNotAuthorized(
                "No confirmed licence. Set AIRWATCH_PROVIDER_LICENSE_REF and "
                "AIRWATCH_ENABLE_LICENSED_PROVIDER=yes only after the licence is signed."
            )
        self.api_key = os.environ.get("AIRWATCH_PROVIDER_API_KEY")  # server-side only, never logged
        self.info = SourceInfo(name, ref, False, False, False, 60)

    def fetch(self, bbox, cursor, now):
        raise NotImplementedError("Implement against the licensed vendor's documented API.")

    def normalize(self, record):
        raise NotImplementedError
