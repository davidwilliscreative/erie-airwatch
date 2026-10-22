"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CONFIDENCE_LABEL, fmtAge, fmtDateTime, fmtDay, fmtNumber, fmtTime, KIND_LABEL, KIND_QUALIFIER, STATUS_LABEL } from "@/lib/format";
import { altitudeBands, byDay, byHourOfDay, coverageFor, inRange, runwaySplit, totals, type Filter } from "@/lib/metrics";
import type { DashboardData } from "@/lib/types";

import { Badge, Bars, Card, HBar, Stat } from "./ui";

const AirportMap = dynamic(() => import("./AirportMap"), {
  ssr: false,
  loading: () => <div className="h-[360px] w-full animate-pulse rounded-lg bg-surface-2 sm:h-[460px]" />,
});

type Preset = "7d" | "14d" | "day";

export default function Dashboard({ data }: { data: DashboardData }) {
  const tz = data.airport.timezone;
  const allDays = data.range.days;
  const [preset, setPreset] = useState<Preset>("7d");
  const [day, setDay] = useState(allDays[allDays.length - 1]);
  const [zoneId, setZoneId] = useState<string | null>(null);

  const days = useMemo(() => (preset === "day" ? [day] : allDays.slice(preset === "7d" ? -7 : -14)), [preset, day, allDays]);
  const filter: Filter = { days, zoneId, tz };
  const rows = useMemo(() => inRange(data.hourly, { days, zoneId, tz }), [data.hourly, days, zoneId, tz]);
  const t = totals(rows, zoneId);
  const zone = data.zones.find((z) => z.id === zoneId) ?? null;
  const zoneName = zone ? zone.label : "all zones";
  const coverage = coverageFor(data.coverage, days);
  const outageMinutes = coverage.reduce((s, c) => s + c.outageMinutes, 0);
  // Flag days where outages could hide a meaningful amount of activity (15+ minutes).
  const gapDays = coverage.map((c, i) => (c.outageMinutes >= 15 ? i : -1)).filter((i) => i >= 0);
  const hours = Array.from({ length: 24 }, (_, h) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`));
  const circuitsByHour = byHourOfDay(rows, "circuit", tz);
  const overflightsByHour = byHourOfDay(rows, "overflights", tz, zoneId);
  const circuitsByDay = byDay(rows, "circuit", filter);
  const overflightsByDay = byDay(rows, "overflights", filter);
  const bands = altitudeBands(rows, zoneId);
  const bandMax = Math.max(...bands.map((b) => b.value));
  const rwy = runwaySplit(rows, "circuit");
  const daily = data.daily.filter((d) => days.includes(d.day));
  const repeat = daily.reduce((s, d) => s + d.repeatCircuitAircraft, 0);
  const isDemo = data.mode === "demo";
  const status = data.source.status;
  const statusTone = status === "live" ? "live" : status === "delayed" ? "caution" : status === "offline" ? "danger" : "caution";
  const rangeLabel = preset === "day" ? fmtDay(day, { weekday: "long", month: "long", day: "numeric" }) : `${fmtDay(days[0])} – ${fmtDay(days[days.length - 1])}`;

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      {/* Overview */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-accent">{data.airport.icao} · {data.airport.city ?? "Erie, Colorado"}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{data.airport.name} activity</h1>
          <p className="mt-1 max-w-2xl text-ink-2">
            Aircraft activity, traffic-pattern circuits and neighborhood overflights, with the data quality behind every number.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge tone={statusTone}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: "currentColor" }} aria-hidden="true" />
              {STATUS_LABEL[status]}
            </Badge>
            <span className="text-ink-2">{data.source.name}</span>
          </div>
          <p className="mt-1 text-ink-3">
            {data.source.lastObservationAt
              ? <>Latest observation {fmtDateTime(data.source.lastObservationAt, tz)}{!isDemo && <> ({fmtAge(data.source.lastObservationAt)})</>}</>
              : "No observations received yet"}
          </p>
          <p className="text-ink-3">
            Updated {fmtDateTime(data.generatedAt, tz)} · <Link href="/methodology" className="underline">Methodology</Link>
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="sticky top-0 z-10 -mx-4 mt-6 border-y border-line bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <div className="flex flex-wrap items-center gap-3">
          <fieldset className="flex rounded-lg border border-line bg-surface p-0.5 text-sm">
            <legend className="sr-only">Date range</legend>
            {(["day", "7d", "14d"] as Preset[]).map((p) => (
              <label key={p} className={`cursor-pointer rounded-md px-3 py-1.5 ${preset === p ? "bg-accent text-accent-ink" : "text-ink-2"}`}>
                <input type="radio" name="preset" value={p} checked={preset === p} onChange={() => setPreset(p)} className="sr-only" />
                {p === "day" ? "One day" : p === "7d" ? "7 days" : "14 days"}
              </label>
            ))}
          </fieldset>
          {preset === "day" && (
            <label className="text-sm">
              <span className="sr-only">Day</span>
              <select value={day} onChange={(e) => setDay(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1.5">
                {[...allDays].reverse().map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-2">Zone</span>
            <select value={zoneId ?? ""} onChange={(e) => setZoneId(e.target.value || null)} className="max-w-[16rem] rounded-lg border border-line bg-surface px-2 py-1.5">
              <option value="">All zones</option>
              {data.zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
          </label>
          <p className="text-sm text-ink-3">{rangeLabel}</p>
        </div>
      </div>

      {/* Headline metrics */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Aircraft observed" value={fmtNumber(t.aircraftDays)} qualifier="Observed" tone="sky" note="Distinct aircraft per day, summed" />
        <Stat label="Candidate circuits" value={fmtNumber(t.circuits)} qualifier="Estimated" tone="accent" note="Traffic-pattern loops" />
        <Stat label="Likely touch-and-go" value={fmtNumber(t.touchAndGo)} qualifier="Likely" tone="caution" note="Not confirmed runway contact" />
        <Stat label="Probable full stops" value={fmtNumber(t.fullStops)} qualifier="Likely" tone="caution" note="Landings that slowed to taxi speed" />
        <Stat label={`Overflights, ${zone ? "selected zone" : "all zones"}`} value={fmtNumber(t.overflights)} qualifier="Observed" tone="sky" note="One count per pass" />
        <Stat
          label="Data coverage" value={t.coveragePct == null ? "n/a" : `${t.coveragePct}%`}
          qualifier={outageMinutes > 0 ? "Gaps" : "Complete"} tone={outageMinutes > 0 ? "caution" : "live"}
          note={`${outageMinutes} min of feed outage`}
        />
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Counts include {data.policy.mode === "reviewed_only" ? "only reviewer-approved findings" : `reviewer-approved findings and unreviewed findings with data quality of at least ${Math.round(data.policy.minConfidence * 100)}%`}.
        Rejected and low-quality findings are never counted.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card
          title={isDemo ? "Replay: a busy 90 minutes" : "Recent positions"}
          subtitle={isDemo ? `Synthetic traffic, ${fmtDateTime(data.playback.start, tz)} to ${fmtTime(data.playback.end, tz)}` : "Delayed and downsampled for privacy and licensing"}
        >
          <AirportMap
            airport={data.airport} zones={data.zones} positions={data.playback.positions} selectedZone={zoneId}
            onSelectZone={(id) => setZoneId(id === zoneId ? null : id)} start={data.playback.start} end={data.playback.end} isDemo={isDemo}
          />
        </Card>

        <div className="space-y-6">
          <Card title="Overflight altitude" subtitle={`Estimated height above the field, ${zoneName}`}>
            <div className="space-y-2">
              {bands.map((b) => <HBar key={b.key} label={b.label} value={b.value} max={bandMax} />)}
            </div>
            <p className="mt-3 text-xs text-ink-3">
              Barometric altitude minus field elevation ({fmtNumber(data.airport.elevationFt)} ft). Terrain varies, so this is an estimate,
              not measured height or noise. Pattern altitude is {fmtNumber(data.airport.patternAltitudeFt ?? 0)} ft MSL
              {data.airport.patternVerified ? "" : " (to be verified against current airport procedures)"}.
            </p>
          </Card>
          <Card title="Runway use" subtitle="Candidate circuits by landing direction">
            <div className="space-y-2">
              {Object.keys(rwy).length === 0 && <p className="text-sm text-ink-3">No circuits in this range.</p>}
              {Object.entries(rwy).sort().map(([k, v]) => <HBar key={k} label={`Runway ${k}`} value={v} max={Math.max(...Object.values(rwy))} color="var(--chart-1)" />)}
            </div>
          </Card>
          {daily.length > 0 && (
            <Card title="Repeat activity" subtitle="Aircraft with 3 or more circuits in one day">
              <p className="tabular text-3xl font-semibold">{repeat}</p>
              <p className="mt-1 text-xs text-ink-3">Summed across days. Shown as counts only; individual aircraft are not identified. Repeat training is normal at a training airport and is not evidence of wrongdoing.</p>
            </Card>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Activity by hour of day" subtitle={`Candidate circuits (green) and overflights of ${zoneName} (blue), local time`}>
          <Bars values={circuitsByHour} labels={hours} ariaLabel="Candidate circuits by hour of day" every={3} height={110} />
          <div className="mt-4" />
          <Bars values={overflightsByHour} labels={hours} color="var(--chart-2)" ariaLabel={`Overflights of ${zoneName} by hour of day`} every={3} height={110} />
        </Card>
        <Card
          title="Activity by day"
          subtitle="Striped bars lost 15+ minutes of data that day, so their counts are a floor, not a total"
        >
          <Bars values={circuitsByDay} labels={days.map((d) => fmtDay(d, { month: "numeric", day: "numeric" }))} flagged={gapDays} ariaLabel="Candidate circuits by day" every={days.length > 7 ? 2 : 1} height={110} />
          <div className="mt-4" />
          <Bars values={overflightsByDay} labels={days.map((d) => fmtDay(d, { month: "numeric", day: "numeric" }))} flagged={gapDays} color="var(--chart-2)" ariaLabel={`Overflights of ${zoneName} by day`} every={days.length > 7 ? 2 : 1} height={110} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Data coverage" subtitle="When the feed was down, activity is unknown, not zero">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-3">
              <tr><th className="py-1 font-normal">Day</th><th className="py-1 font-normal">Outages</th><th className="py-1 text-right font-normal">Minutes missing</th></tr>
            </thead>
            <tbody className="tabular">
              {coverage.map((c) => (
                <tr key={c.day} className="border-t border-line">
                  <td className="py-1.5">{fmtDay(c.day)}</td>
                  <td className="py-1.5">{c.outages}</td>
                  <td className="py-1.5 text-right">{c.outageMinutes > 0 ? <Badge tone="caution">{c.outageMinutes} min</Badge> : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Findings near the replay window" subtitle="Each finding carries a data-quality label and review status">
          {data.recentEvents.length === 0 ? <p className="text-sm text-ink-3">No published findings in this window.</p> : (
            <ul className="max-h-[22rem] divide-y divide-line overflow-auto text-sm">
              {data.recentEvents.filter((e) => !zoneId || e.zoneId === zoneId || e.kind !== "overflight").slice(-40).reverse().map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">{KIND_LABEL[e.kind]}{e.runway ? `, runway ${e.runway}` : ""}{e.zoneId ? `, ${data.zones.find((z) => z.id === e.zoneId)?.label ?? "zone"}` : ""}</p>
                    <p className="text-ink-3">{fmtTime(e.start, tz)}{e.minAltFt != null ? ` · lowest ${fmtNumber(e.minAltFt)} ft MSL` : ""}</p>
                  </div>
                  <div className="flex gap-1">
                    <Badge tone={KIND_QUALIFIER[e.kind] === "Observed" ? "sky" : "caution"}>{KIND_QUALIFIER[e.kind]}</Badge>
                    <Badge tone={e.confidenceLabel === "high" ? "live" : "caution"}>{CONFIDENCE_LABEL[e.confidenceLabel]}</Badge>
                    {e.reviewStatus === "approved" && <Badge tone="accent">Reviewed</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
