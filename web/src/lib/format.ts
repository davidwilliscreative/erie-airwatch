import type { ConfidenceLabel, EventKind, FeedStatus } from "./types";

export const KIND_LABEL: Record<EventKind, string> = {
  overflight: "Zone overflight",
  circuit: "Candidate circuit",
  likely_touch_and_go: "Likely touch-and-go",
  probable_full_stop: "Probable full-stop landing",
  low_approach: "Low approach / go-around",
};

// How sure the label is allowed to sound. "Confirmed" is deliberately absent:
// ADS-B positions alone cannot confirm runway contact.
export const KIND_QUALIFIER: Record<EventKind, "Observed" | "Estimated" | "Likely"> = {
  overflight: "Observed",
  circuit: "Estimated",
  likely_touch_and_go: "Likely",
  probable_full_stop: "Likely",
  low_approach: "Estimated",
};

export const CONFIDENCE_LABEL: Record<ConfidenceLabel, string> = {
  high: "High data quality",
  medium: "Medium data quality",
  low: "Low data quality",
};

export const STATUS_LABEL: Record<FeedStatus, string> = {
  demo: "Demo data",
  live: "Live",
  delayed: "Delayed",
  offline: "Offline",
};

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtDateTime(iso: string, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...opts,
  }).format(new Date(iso));
}

export function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function fmtDay(day: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  // Day strings are local calendar dates; format them at noon UTC so no timezone shifts the date.
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(`${day}T12:00:00Z`));
}

export function fmtAge(fromIso: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(fromIso).getTime()) / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function pct(n: number | null | undefined): string {
  return n == null ? "n/a" : `${Math.round(n * 100)}%`;
}
