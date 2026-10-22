import "server-only";

import { createClient } from "@supabase/supabase-js";

import { isLive, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { getDashboardData } from "./data";
import { fmtDay } from "./format";
import { inRange, localDay } from "./metrics";
import type { DashboardData } from "./types";

export interface ReportMetrics {
  totals: Record<string, number>;
  zones: { zone_id: string; label: string; metric: string; total: number }[];
  mean_coverage_pct: number | null;
}

export interface PublicReport {
  id: string;
  kind: "weekly" | "monthly" | "custom";
  periodStart: string; // local day, inclusive
  periodEnd: string; // local day, inclusive
  title: string;
  metrics: ReportMetrics;
  methodologyVersion: string;
  version: number;
  corrections: { at: string; note: string }[];
  generatedAt: string;
  publishedAt: string | null;
  synthetic: boolean;
}

export function metricsFor(data: DashboardData, days: string[]): ReportMetrics {
  const rows = inRange(data.hourly, { days, zoneId: null, tz: data.airport.timezone });
  const totals: Record<string, number> = {};
  const zones = new Map<string, number>();
  let covSum = 0;
  let covN = 0;
  for (const r of rows) {
    if (r.metric === "coverage_pct") { covSum += r.value; covN++; continue; }
    if (r.metric === "observed_aircraft" || r.metric === "observations") continue;
    if (r.zoneId) zones.set(`${r.zoneId}|${r.metric}`, (zones.get(`${r.zoneId}|${r.metric}`) ?? 0) + r.value);
    else totals[r.metric] = (totals[r.metric] ?? 0) + r.value;
  }
  const label = (id: string) => data.zones.find((z) => z.id === id)?.label ?? id;
  return {
    totals,
    zones: [...zones.entries()].map(([k, total]) => {
      const [zone_id, metric] = k.split("|");
      return { zone_id, label: label(zone_id), metric, total };
    }).sort((a, b) => a.label.localeCompare(b.label) || a.metric.localeCompare(b.metric)),
    mean_coverage_pct: covN ? Math.round(covSum / covN) : null,
  };
}

export async function getReports(): Promise<PublicReport[]> {
  const data = await getDashboardData();
  if (!isLive) {
    // Demo: one weekly report per complete week in the snapshot.
    const days = data.range.days;
    const out: PublicReport[] = [];
    for (let i = days.length - 7; i >= 0; i -= 7) {
      const week = days.slice(i, i + 7);
      out.push({
        id: `demo-week-${week[0]}`, kind: "weekly", periodStart: week[0], periodEnd: week[6],
        title: `Week of ${fmtDay(week[0], { month: "long", day: "numeric", year: "numeric" })}`,
        metrics: metricsFor(data, week), methodologyVersion: data.methodology.algorithmVersion, version: 1,
        corrections: [], generatedAt: data.generatedAt, publishedAt: data.generatedAt, synthetic: true,
      });
    }
    return out;
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: rows, error } = await sb.from("reports_public").select("*").eq("airport_id", data.airport.id)
    .order("period_start", { ascending: false }).limit(104);
  if (error) throw error;
  const tz = data.airport.timezone;
  return (rows ?? []).map((r) => {
    const start = localDay(r.period_start, tz);
    const end = localDay(new Date(Date.parse(r.period_end) - 1000).toISOString(), tz);
    return {
      id: r.id, kind: r.kind, periodStart: start, periodEnd: end,
      title: `${r.kind === "monthly" ? "Month" : "Week"} of ${fmtDay(start, { month: "long", day: "numeric", year: "numeric" })}`,
      metrics: r.metrics, methodologyVersion: r.methodology_version, version: r.version, corrections: r.corrections ?? [],
      generatedAt: r.generated_at, publishedAt: r.published_at, synthetic: false,
    };
  });
}

export async function getReport(id: string) {
  return (await getReports()).find((r) => r.id === id) ?? null;
}

export const METRIC_LABEL: Record<string, string> = {
  observed_aircraft_day: "Aircraft observed (distinct per day, summed)",
  circuit: "Candidate circuits",
  likely_touch_and_go: "Likely touch-and-go events",
  probable_full_stop: "Probable full-stop landings",
  low_approach: "Low approaches / go-arounds",
  overflights: "Zone overflights",
  "overflights_band:lt1000": "Overflights below 1,000 ft (est. above field)",
  "overflights_band:1000_2000": "Overflights 1,000–2,000 ft",
  "overflights_band:2000_3000": "Overflights 2,000–3,000 ft",
  "overflights_band:gt3000": "Overflights above 3,000 ft",
};

export function metricLabel(m: string): string {
  if (METRIC_LABEL[m]) return METRIC_LABEL[m];
  const rw = m.match(/^(.*):rwy(.*)$/);
  if (rw) return `${METRIC_LABEL[rw[1]] ?? rw[1]}, runway ${rw[2]}`;
  return m;
}

export function reportCsv(r: PublicReport, airportName: string): string {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [
    ["report", r.title], ["airport", airportName], ["period_start_local", r.periodStart], ["period_end_local", r.periodEnd],
    ["methodology_version", r.methodologyVersion], ["report_version", r.version], ["generated_at_utc", r.generatedAt],
    ["mean_data_coverage_pct", r.metrics.mean_coverage_pct ?? "n/a"],
    ["data", r.synthetic ? "SYNTHETIC DEMONSTRATION DATA - not real aircraft activity" : "Observed via licensed source; see methodology"],
    [],
    ["scope", "metric", "label", "value"],
    ...Object.entries(r.metrics.totals).sort().map(([m, v]) => ["airport", m, metricLabel(m), v]),
    ...r.metrics.zones.map((z) => [z.label, z.metric, metricLabel(z.metric), z.total]),
  ];
  return lines.map((l) => l.map(esc).join(",")).join("\n") + "\n";
}
