"use client";

// Admin data access. Live mode calls the MFA-gated Supabase RPCs; demo mode keeps
// decisions in this browser only, so nothing a demo visitor does is shared or published.
import { supabaseBrowser } from "@/lib/supabase/client";
import type { ReviewEvent, ReviewStatus } from "@/lib/types";

export type ValidationLabel = "true_positive" | "false_positive" | "unsure";
export interface Decision { status: ReviewStatus; label: ValidationLabel | null; note: string; at: string }

const KEY = "airwatch-demo-reviews-v1";

export function loadDemoDecisions(): Record<string, Decision> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveDemoDecision(id: string, d: Decision) {
  try {
    const all = loadDemoDecisions();
    all[id] = d;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: decision lives only in memory for this session */
  }
}

export async function liveQueue(status: string): Promise<ReviewEvent[]> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("admin_review_queue", { p_status: status, p_limit: 200 });
  if (error) throw error;
  return (data ?? []).map((e: Record<string, unknown>) => ({
    id: e.id, kind: e.kind, start: e.start_ts, end: e.end_ts, runway: e.runway, zoneId: e.zone_id,
    confidence: Number(e.confidence), confidenceLabel: e.confidence_label, reviewStatus: e.review_status,
    minAltFt: e.min_alt_ft, maxAltFt: e.max_alt_ft, aircraftLabel: `Aircraft ${String(e.aircraft_key).slice(0, 6)}`,
    algorithmVersion: e.algorithm_version, details: e.details ?? {}, points: [],
  })) as ReviewEvent[];
}

export async function liveEvidence(id: string) {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("admin_event_evidence", { p_event: id });
  if (error) throw error;
  return (data ?? []).map((p: Record<string, unknown>) => ({ t: p.ts as string, lat: p.lat as number, lon: p.lon as number,
    alt: p.alt_baro_ft as number | null, gs: p.groundspeed_kt as number | null, evidence: Boolean(p.is_evidence) }));
}

export async function liveReview(id: string, d: Decision) {
  const sb = supabaseBrowser();
  const { error } = await sb.rpc("admin_review_event", { p_event: id, p_status: d.status, p_label: d.label, p_note: d.note || null });
  if (error) throw error;
}
