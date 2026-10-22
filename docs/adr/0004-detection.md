# ADR 0004: Deterministic, versioned detection

**Decision.** Detection is a pure function of observations, airport config and a frozen `Thresholds` object, tagged
with `ALGORITHM_VERSION`. Steps: geofence and split tracks on gaps/impossible jumps → find runway passes in a
runway-relative frame → classify each pass (likely touch-and-go, probable full stop, low approach, takeoff) →
detect circuits between passes with a leg sequence (downwind then final, base optional) → count zone crossings by
segment/polygon intersection with a gap limit and re-entry cooldown → score data quality.

**Why not a learned model.** Auditable thresholds are easier to explain publicly and to defend; a model can be
evaluated later against the same labelled set.

**Changing definitions.** Bump the version, add a `methodology_versions` row and a changelog entry, run
`python -m airwatch process --since <date>`, and reissue affected reports with a new version.
