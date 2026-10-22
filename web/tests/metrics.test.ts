import { describe, expect, it } from "vitest";

import demo from "../src/data/demo/dashboard.json";
import { fmtDay } from "../src/lib/format";
import { altitudeBands, byDay, byHourOfDay, inRange, localDay, localHour, sumMetric, totals } from "../src/lib/metrics";
import type { DashboardData, HourlyRow } from "../src/lib/types";

const TZ = "America/Denver";
const rows: HourlyRow[] = [
  { hour: "2026-10-21T18:00:00Z", metric: "circuit", zoneId: null, value: 3 }, // 12:00 MDT
  { hour: "2026-10-21T18:00:00Z", metric: "overflights", zoneId: "a", value: 2 },
  { hour: "2026-10-21T18:00:00Z", metric: "overflights", zoneId: "b", value: 5 },
  { hour: "2026-10-22T05:00:00Z", metric: "circuit", zoneId: null, value: 1 }, // 23:00 MDT on the 21st
  { hour: "2026-10-22T06:00:00Z", metric: "circuit", zoneId: null, value: 7 }, // 00:00 MDT on the 22nd
  { hour: "2026-10-21T18:00:00Z", metric: "coverage_pct", zoneId: null, value: 90 },
  { hour: "2026-10-21T19:00:00Z", metric: "coverage_pct", zoneId: null, value: 100 },
  { hour: "2026-10-21T18:00:00Z", metric: "overflights_band:lt1000", zoneId: "a", value: 2 },
];

describe("local time handling", () => {
  it("assigns UTC hours to the airport's local day and hour", () => {
    expect(localDay("2026-10-22T05:00:00Z", TZ)).toBe("2026-10-21");
    expect(localDay("2026-10-22T06:00:00Z", TZ)).toBe("2026-10-22");
    expect(localHour("2026-10-21T18:00:00Z", TZ)).toBe(12);
  });
  it("formats calendar days without shifting them", () => {
    expect(fmtDay("2026-10-21", { month: "numeric", day: "numeric" })).toBe("10/21");
  });
});

describe("aggregation", () => {
  const f = { days: ["2026-10-21"], zoneId: null, tz: TZ };
  it("filters by local day", () => {
    expect(sumMetric(inRange(rows, f), "circuit")).toBe(4);
  });
  it("sums all zones or one zone", () => {
    const r = inRange(rows, f);
    expect(totals(r, null).overflights).toBe(7);
    expect(totals(r, "a").overflights).toBe(2);
  });
  it("averages coverage over hours, never treating missing hours as full", () => {
    expect(totals(inRange(rows, f), null).coveragePct).toBe(95);
    expect(totals([], null).coveragePct).toBeNull();
  });
  it("buckets by hour of day and by day", () => {
    expect(byHourOfDay(rows, "circuit", TZ)[12]).toBe(3);
    expect(byHourOfDay(rows, "circuit", TZ)[23]).toBe(1);
    expect(byDay(rows, "circuit", { days: ["2026-10-21", "2026-10-22"], zoneId: null, tz: TZ })).toEqual([4, 7]);
  });
  it("reports altitude bands per zone", () => {
    expect(altitudeBands(rows, "a")[0].value).toBe(2);
    expect(altitudeBands(rows, "b")[0].value).toBe(0);
  });
});

describe("demo snapshot", () => {
  const d = demo as unknown as DashboardData;
  it("is clearly marked synthetic", () => {
    expect(d.mode).toBe("demo");
    expect(d.source.kind).toBe("synthetic");
    expect(d.zones.every((z) => z.synthetic)).toBe(true);
  });
  it("never exposes aircraft identifiers publicly", () => {
    const json = JSON.stringify({ playback: d.playback, recentEvents: d.recentEvents });
    expect(json).not.toMatch(/SYN-[0-9A-F]{4}/);
    expect(d.playback.positions.every((p) => /^[0-9a-f]{6}$/.test(p.id))).toBe(true);
  });
  it("only lists publishable findings", () => {
    expect(d.recentEvents.every((e) => e.reviewStatus !== "rejected" && e.confidence >= d.policy.minConfidence)).toBe(true);
  });
});
