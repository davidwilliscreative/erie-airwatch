# Provider licence checklist

Complete this in writing with the vendor before any real data is collected. Record the signed reference in
`airwatch.sources.license_ref` and set the permission flags to match.

| Question | Why it matters | Answer |
|---|---|---|
| Is continuous automated collection allowed? | The worker polls around the clock | |
| May derived metrics (counts, trends) be published publicly? | That is the whole site | |
| May positions be displayed publicly, and with what delay? | The replay map | |
| May aircraft identifiers (ICAO hex, registration) be stored? Displayed? | We do not display them; storage still needs permission | |
| May raw responses be retained, and for how long? | `raw_responses`, reprocessing history | |
| Retention limits on derived data after termination? | Published reports must stay up | |
| Geography and altitude limits of the feed | KEIK geofence is 8 nm radius | |
| Sample rate: snapshot interval, or trace/stream resolution? | Touch-and-go detection needs ~2–10 s spacing | |
| Request / credit quota and overage behaviour | Set `QuotaBudget` accordingly | |
| Uptime and latency commitments | Freshness labels and alerting | |
| Nonprofit / community pricing available? | Budget | |
| Attribution wording required on the site | Footer and reports | |
| Termination, data portability | Exit plan | |
| Monthly / annual cost and minimum commitment | Budget | |

As of the PRD (October 2026): OpenSky requires a prior written agreement for operational or automated use, even
non-commercial; ADS-B Exchange's community developer tier (about $10/month, 10,000 requests) is not licensed for
production public display; enterprise products have annual minimums. Re-verify all of this directly with vendors.

At 60 s polling one airport costs 43,200 requests per 30 days. `QuotaBudget.interval_for()` spreads any budget
evenly (10,000 requests/30 days ≈ one request every 4.3 minutes, far too sparse for circuit detection).
