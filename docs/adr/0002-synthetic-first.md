# ADR 0002: Synthetic data first, licence-gated providers

**Decision.** All development uses a simulator with ground truth. The licensed provider adapter refuses to start
unless `AIRWATCH_PROVIDER_LICENSE_REF` is set and `AIRWATCH_ENABLE_LICENSED_PROVIDER=yes`, and a vendor
implementation is written against that vendor's documented API.

**Why.** The PRD forbids fetching, storing or publishing third-party aviation data before licensing is verified. A
simulator also gives exact ground truth, so detector precision and recall are measurable from day one.

**Consequences.** Synthetic scores prove the pipeline is wired correctly, not that it is accurate on real traffic.
The site labels synthetic data on every page and in every report.
