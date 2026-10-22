import { Badge, Card } from "@/components/ui";
import { getAdminContext } from "@/lib/admin-data";
import { fmtDateTime, fmtDay, STATUS_LABEL } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const { mode, data } = await getAdminContext();
  const s = data.source;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Source" subtitle={s.licenseNote || undefined}>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-ink-2">Source</dt><dd>{s.name}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-2">Status</dt><dd><Badge tone={s.status === "live" ? "live" : "caution"}>{STATUS_LABEL[s.status]}</Badge></dd></div>
          <div className="flex justify-between"><dt className="text-ink-2">Expected freshness</dt><dd>{s.freshnessExpectationS} s</dd></div>
          <div className="flex justify-between"><dt className="text-ink-2">Latest observation</dt><dd>{s.lastObservationAt ? fmtDateTime(s.lastObservationAt, data.airport.timezone) : "none"}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-2">Algorithm</dt><dd>{data.methodology.algorithmVersion}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-ink-3">
          Ingest errors, retries and quota use are written by the worker as structured JSON logs and as rows in
          coverage_windows. {mode === "live" ? "The detailed poll log is available through the admin_coverage RPC." : "In demo mode the outages below come from the simulator."}
        </p>
      </Card>
      <Card title="Coverage by day" subtitle="Outages are shown publicly beside every trend">
        <table className="w-full text-sm">
          <tbody className="tabular">
            {[...data.coverage].reverse().map((c) => (
              <tr key={c.day} className="border-t border-line"><td className="py-1">{fmtDay(c.day)}</td><td>{c.outages} outage(s)</td><td className="text-right">{c.outageMinutes} min</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Reprocessing" className="lg:col-span-2">
        <p className="text-sm text-ink-2">
          Processing is deterministic and idempotent: event IDs come from the algorithm version, track and start time,
          and reviewer decisions survive reprocessing. To recompute history after a definition change, bump
          ALGORITHM_VERSION, add a methodology_versions row, and run <code className="rounded bg-surface-2 px-1">python -m airwatch process --since &lt;date&gt;</code> on the worker host.
        </p>
      </Card>
    </div>
  );
}
