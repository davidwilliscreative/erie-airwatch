"use client";

import { useEffect, useState } from "react";

import { Card } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { DashboardData } from "@/lib/types";

type ReportRow = { id: string; kind: string; period_start: string; period_end: string; status: string; version: number };

export default function AdminSettings({ mode, data }: { mode: "demo" | "live"; data: DashboardData }) {
  const live = mode === "live";
  const [msg, setMsg] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const airportId = data.airport.id;

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    if (!live) return setMsg("Demo mode: connect Supabase to save changes.");
    const { error } = await fn();
    setMsg(error ? `Error: ${error.message}` : ok);
  };

  useEffect(() => {
    if (!live) return;
    supabaseBrowser().rpc("admin_list_reports", { p_airport: airportId })
      .then(({ data: rows }) => setReports((rows as ReportRow[]) ?? []));
  }, [live, msg, airportId]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {msg && <p role="status" className="rounded-lg bg-accent-soft p-3 text-sm text-accent lg:col-span-2">{msg}</p>}
      <Card title="Publication policy" subtitle="What the public site counts">
        <form className="space-y-3 text-sm" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(() => supabaseBrowser().rpc("admin_set_policy", { p_airport: airportId, p_mode: f.get("mode"), p_min_conf: Number(f.get("min")), p_delay_min: Number(f.get("delay")) }), "Policy saved and logged.");
        }}>
          <label className="block">Mode
            <select name="mode" defaultValue={data.policy.mode} className="mt-1 block w-full rounded border border-line bg-surface p-2">
              <option value="reviewed_only">Reviewed only (recommended until validation passes)</option>
              <option value="qualified">Reviewed + unreviewed above minimum data quality</option>
            </select>
          </label>
          <label className="block">Minimum data-quality score (0–1)
            <input name="min" type="number" step="0.05" min="0" max="1" defaultValue={data.policy.minConfidence} className="mt-1 block w-full rounded border border-line bg-surface p-2" />
          </label>
          <label className="block">Public map delay (minutes)
            <input name="delay" type="number" min="0" max="120" defaultValue={5} className="mt-1 block w-full rounded border border-line bg-surface p-2" />
          </label>
          <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink">Save policy</button>
        </form>
      </Card>

      <Card title="Neighborhood zones" subtitle="All current zones are placeholders until you approve real boundaries and labels">
        <ul className="mb-4 space-y-1 text-sm">{data.zones.map((z) => <li key={z.id}>{z.label} <span className="text-ink-3">({z.slug}{z.synthetic ? ", placeholder" : ""})</span></li>)}</ul>
        <form className="space-y-2 text-sm" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          let geo: unknown;
          try { geo = JSON.parse(String(f.get("geojson"))); } catch { return setMsg("GeoJSON is not valid JSON."); }
          run(() => supabaseBrowser().rpc("admin_upsert_zone", { p_airport: airportId, p_slug: f.get("slug"), p_label: f.get("label"), p_geojson: geo, p_public: true }), "Zone saved. Reprocess history so counts use the new boundary.");
        }}>
          <input name="slug" required placeholder="slug, e.g. vista-ridge" className="block w-full rounded border border-line bg-surface p-2" />
          <input name="label" required placeholder="Public label" className="block w-full rounded border border-line bg-surface p-2" />
          <textarea name="geojson" required rows={4} placeholder='{"type":"Polygon","coordinates":[[[lon,lat],...]]}' className="block w-full rounded border border-line bg-surface p-2 font-mono text-xs" />
          <button className="rounded-md border border-line px-3 py-2">Save zone</button>
        </form>
      </Card>

      <Card title="Reports" subtitle="Draft → approved → published. Publishing requires approval." className="lg:col-span-2">
        <form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(() => supabaseBrowser().rpc("admin_create_report", { p_airport: airportId, p_kind: f.get("kind"), p_start: new Date(String(f.get("start"))).toISOString(), p_end: new Date(String(f.get("end"))).toISOString() }), "Draft report created.");
        }}>
          <label>Kind<select name="kind" className="ml-1 rounded border border-line bg-surface p-2"><option>weekly</option><option>monthly</option></select></label>
          <label>Start<input name="start" type="date" required className="ml-1 rounded border border-line bg-surface p-2" /></label>
          <label>End<input name="end" type="date" required className="ml-1 rounded border border-line bg-surface p-2" /></label>
          <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink">Create draft</button>
        </form>
        <table className="mt-4 w-full text-sm">
          <tbody>
            {!live && <tr><td className="py-2 text-ink-3">Demo reports are generated from the snapshot and shown on the public Reports page.</td></tr>}
            {reports.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1.5">{r.kind} {r.period_start.slice(0, 10)} – {r.period_end.slice(0, 10)} (v{r.version})</td>
                <td>{r.status}</td>
                <td className="space-x-2 text-right">
                  {r.status === "draft" && <button className="underline" onClick={() => run(() => supabaseBrowser().rpc("admin_set_report_status", { p_report: r.id, p_status: "approved" }), "Approved.")}>Approve</button>}
                  {r.status === "approved" && <button className="underline" onClick={() => run(() => supabaseBrowser().rpc("admin_set_report_status", { p_report: r.id, p_status: "published" }), "Published.")}>Publish</button>}
                  {r.status === "published" && <button className="underline" onClick={() => { const note = prompt("Reason for withdrawal or correction"); if (note) run(() => supabaseBrowser().rpc("admin_set_report_status", { p_report: r.id, p_status: "withdrawn", p_note: note }), "Withdrawn and noted."); }}>Withdraw</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
