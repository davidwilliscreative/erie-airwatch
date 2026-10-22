import "server-only";

import { createClient } from "@supabase/supabase-js";

import demo from "@/data/demo/dashboard.json";

import { AIRPORT_ICAO, isLive, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { CoverageDay, DashboardData, HourlyRow, Position, PublicEvent, Zone } from "./types";

const DAYS = 14;

export async function getDashboardData(): Promise<DashboardData> {
  if (!isLive) return demo as unknown as DashboardData;
  try {
    return await loadLive();
  } catch (err) {
    // The public site must stay up during a database or source outage.
    console.error("live data unavailable, falling back to an offline view", err);
    return { ...(demo as unknown as DashboardData), mode: "live", hourly: [], daily: [], coverage: [],
      playback: { start: new Date().toISOString(), end: new Date().toISOString(), positions: [] }, recentEvents: [],
      source: { name: "Unavailable", kind: "licensed", status: "offline", freshnessExpectationS: 60,
        lastObservationAt: null, licenseNote: "The data service is temporarily unavailable." } };
  }
}

async function loadLive(): Promise<DashboardData> {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: ap, error } = await sb.from("airports_public").select("*").eq("icao", AIRPORT_ICAO).single();
  if (error || !ap) throw error ?? new Error("airport not found");

  const end = new Date();
  const start = new Date(end.getTime() - DAYS * 86400_000);
  const [runways, zones, status, settings, positions, events, coverage, methodology] = await Promise.all([
    sb.from("runways_public").select("*").eq("airport_id", ap.id),
    sb.from("zones_public").select("*").eq("airport_id", ap.id),
    sb.from("source_status").select("*").eq("airport_id", ap.id),
    sb.from("settings_public").select("*").eq("airport_id", ap.id).maybeSingle(),
    sb.from("recent_positions").select("*").eq("airport_id", ap.id).order("ts").limit(5000),
    sb.from("events_public").select("*").eq("airport_id", ap.id).gte("start_ts", new Date(end.getTime() - 3 * 3600_000).toISOString()).order("start_ts", { ascending: false }).limit(200),
    sb.from("coverage_daily").select("*").eq("airport_id", ap.id).gte("day", start.toISOString().slice(0, 10)),
    sb.from("methodology_public").select("*").order("released_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  // Hourly aggregates, paged (PostgREST caps each response).
  const hourly: HourlyRow[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error: e } = await sb.from("hourly_metrics_public").select("hour_start,metric,zone_id,value")
      .eq("airport_id", ap.id).gte("hour_start", start.toISOString()).order("hour_start").range(from, from + 999);
    if (e) throw e;
    hourly.push(...(data ?? []).map((r) => ({ hour: r.hour_start, metric: r.metric, zoneId: r.zone_id, value: r.value })));
    if (!data || data.length < 1000) break;
  }

  const src = status.data?.[0];
  const days: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    days.push(new Intl.DateTimeFormat("en-CA", { timeZone: ap.timezone }).format(new Date(end.getTime() - i * 86400_000)));
  }
  const pos: Position[] = (positions.data ?? []).map((p) => ({ t: p.ts, id: p.pseudonym, lat: p.lat, lon: p.lon,
    alt: p.alt_baro_ft, gs: p.groundspeed_kt, trk: p.track_deg }));

  return {
    mode: "live",
    generatedAt: end.toISOString(),
    asOf: src?.last_observation ?? end.toISOString(),
    airport: {
      id: ap.id, icao: ap.icao, name: ap.name, timezone: ap.timezone, lat: ap.lat, lon: ap.lon,
      elevationFt: Number(ap.elevation_ft), patternAltitudeFt: ap.pattern_altitude_ft, patternVerified: ap.pattern_verified,
      runways: (runways.data ?? []).map((r) => ({ id: r.ident, ends: (r.ends as { ident: string; lat: number; lon: number; pattern_direction: "left" | "right" }[])
        .map((e) => ({ ident: e.ident, lat: e.lat, lon: e.lon, patternDirection: e.pattern_direction })) })),
    },
    zones: (zones.data ?? []).map((z) => ({ id: z.id, slug: z.slug, label: z.label, synthetic: z.synthetic, geometry: z.geometry })) as Zone[],
    source: {
      name: src?.source_name ?? "No source", kind: src?.provider === "internal" ? "synthetic" : "licensed",
      status: src?.status ?? "offline", freshnessExpectationS: src?.freshness_expectation_s ?? 60,
      lastObservationAt: src?.last_observation ?? null, licenseNote: "",
    },
    range: { start: start.toISOString(), end: end.toISOString(), days },
    policy: { mode: settings.data?.publication_mode ?? "reviewed_only", minConfidence: Number(settings.data?.min_public_confidence ?? 0.5) },
    hourly,
    daily: [],
    coverage: (coverage.data ?? []).map((c) => ({ day: c.day, outageMinutes: Number(c.gap_minutes), outages: c.polls - c.ok_polls })) as CoverageDay[],
    playback: { start: pos[0]?.t ?? end.toISOString(), end: pos.at(-1)?.t ?? end.toISOString(), positions: pos },
    recentEvents: (events.data ?? []).map((e) => ({ id: e.id, kind: e.kind, start: e.start_ts, end: e.end_ts, runway: e.runway,
      zoneId: e.zone_id, confidence: Number(e.confidence), confidenceLabel: e.confidence_label, reviewStatus: e.review_status,
      minAltFt: e.min_alt_ft, maxAltFt: e.max_alt_ft })) as PublicEvent[],
    methodology: { algorithmVersion: methodology.data?.version ?? "unknown", thresholds: methodology.data?.thresholds ?? {} },
  };
}
