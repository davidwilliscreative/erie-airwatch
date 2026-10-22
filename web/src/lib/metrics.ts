// Pure functions over hourly aggregate rows. Kept framework-free so they can be unit tested.
import type { CoverageDay, HourlyRow } from "./types";

const dayFmt = new Map<string, Intl.DateTimeFormat>();
const hourFmt = new Map<string, Intl.DateTimeFormat>();

export function localDay(iso: string, tz: string): string {
  let f = dayFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFmt.set(tz, f);
  }
  return f.format(new Date(iso));
}

export function localHour(iso: string, tz: string): number {
  let f = hourFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" });
    hourFmt.set(tz, f);
  }
  return Number(f.format(new Date(iso))) % 24;
}

export interface Filter {
  days: string[]; // inclusive set of local days
  zoneId: string | null; // null = all zones
  tz: string;
}

export function inRange(rows: HourlyRow[], f: Filter): HourlyRow[] {
  const days = new Set(f.days);
  return rows.filter((r) => days.has(localDay(r.hour, f.tz)));
}

function zoneMatch(r: HourlyRow, zoneId: string | null): boolean {
  return zoneId == null ? true : r.zoneId === zoneId;
}

export function sumMetric(rows: HourlyRow[], metric: string, zoneId: string | null = null): number {
  return rows.reduce((s, r) => (r.metric === metric && zoneMatch(r, zoneId) ? s + r.value : s), 0);
}

export interface Totals {
  aircraftDays: number;
  circuits: number;
  touchAndGo: number;
  fullStops: number;
  lowApproaches: number;
  overflights: number;
  coveragePct: number | null;
  hours: number;
}

export function totals(rows: HourlyRow[], zoneId: string | null): Totals {
  const cov = rows.filter((r) => r.metric === "coverage_pct");
  return {
    aircraftDays: sumMetric(rows, "observed_aircraft_day"),
    circuits: sumMetric(rows, "circuit"),
    touchAndGo: sumMetric(rows, "likely_touch_and_go"),
    fullStops: sumMetric(rows, "probable_full_stop"),
    lowApproaches: sumMetric(rows, "low_approach"),
    overflights: sumMetric(rows, "overflights", zoneId),
    coveragePct: cov.length ? Math.round(cov.reduce((s, r) => s + r.value, 0) / cov.length) : null,
    hours: cov.length,
  };
}

/** Sum of a metric by local hour of day (0-23). */
export function byHourOfDay(rows: HourlyRow[], metric: string, tz: string, zoneId: string | null = null): number[] {
  const out = new Array(24).fill(0);
  for (const r of rows) if (r.metric === metric && zoneMatch(r, zoneId)) out[localHour(r.hour, tz)] += r.value;
  return out;
}

/** Sum of a metric by local day, in the order of `days`. */
export function byDay(rows: HourlyRow[], metric: string, f: Filter): number[] {
  const idx = new Map(f.days.map((d, i) => [d, i]));
  const out = new Array(f.days.length).fill(0);
  for (const r of rows) {
    if (r.metric !== metric || !zoneMatch(r, f.zoneId)) continue;
    const i = idx.get(localDay(r.hour, f.tz));
    if (i != null) out[i] += r.value;
  }
  return out;
}

export const ALT_BANDS = [
  { key: "lt1000", label: "Below 1,000 ft" },
  { key: "1000_2000", label: "1,000–2,000 ft" },
  { key: "2000_3000", label: "2,000–3,000 ft" },
  { key: "gt3000", label: "Above 3,000 ft" },
] as const;

export function altitudeBands(rows: HourlyRow[], zoneId: string | null): { key: string; label: string; value: number }[] {
  return ALT_BANDS.map((b) => ({ ...b, value: sumMetric(rows, `overflights_band:${b.key}`, zoneId) }));
}

export function runwaySplit(rows: HourlyRow[], kind: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.metric.startsWith(`${kind}:rwy`)) {
      const k = r.metric.slice(kind.length + 4);
      out[k] = (out[k] ?? 0) + r.value;
    }
  }
  return out;
}

export function coverageFor(coverage: CoverageDay[], days: string[]): CoverageDay[] {
  const s = new Set(days);
  return coverage.filter((c) => s.has(c.day));
}
