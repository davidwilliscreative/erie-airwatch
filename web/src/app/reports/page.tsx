import type { Metadata } from "next";

import { Badge, Card } from "@/components/ui";
import { fmtDay, fmtNumber } from "@/lib/format";
import { getReports } from "@/lib/reports";

export const metadata: Metadata = { title: "Reports" };
export const revalidate = 300;

export default async function ReportsPage() {
  const reports = await getReports();
  return (
    <main id="main" className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Community reports</h1>
      <p className="mt-3 max-w-2xl text-lg text-ink-2">
        Weekly summaries approved by an administrator before publication. Each report is a frozen snapshot with its
        methodology version, so figures stay reproducible after definitions change.
      </p>
      <div className="mt-8 space-y-4">
        {reports.length === 0 && <p className="text-ink-3">No reports have been published yet.</p>}
        {reports.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{r.title}</h2>
                  {r.synthetic && <Badge tone="caution">Synthetic demo</Badge>}
                  <Badge>v{r.version}</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-3">
                  {fmtDay(r.periodStart)} – {fmtDay(r.periodEnd)} · methodology {r.methodologyVersion} · data coverage {r.metrics.mean_coverage_pct ?? "n/a"}%
                </p>
                <dl className="tabular mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <div><dt className="text-ink-3">Circuits</dt><dd className="font-semibold">{fmtNumber(r.metrics.totals.circuit ?? 0)}</dd></div>
                  <div><dt className="text-ink-3">Likely touch-and-go</dt><dd className="font-semibold">{fmtNumber(r.metrics.totals.likely_touch_and_go ?? 0)}</dd></div>
                  <div><dt className="text-ink-3">Full stops</dt><dd className="font-semibold">{fmtNumber(r.metrics.totals.probable_full_stop ?? 0)}</dd></div>
                  <div><dt className="text-ink-3">Zone overflights</dt><dd className="font-semibold">{fmtNumber(r.metrics.zones.filter((z) => z.metric === "overflights").reduce((s, z) => s + z.total, 0))}</dd></div>
                </dl>
                {r.corrections.length > 0 && <p className="mt-2 text-sm text-caution">{r.corrections.length} correction(s) noted in this version.</p>}
              </div>
              <div className="flex gap-2">
                <a className="rounded-md border border-line px-3 py-2 text-sm hover:bg-surface-2" href={`/reports/${r.id}/csv`}>CSV</a>
                <a className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink" href={`/reports/${r.id}/pdf`}>PDF</a>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}
