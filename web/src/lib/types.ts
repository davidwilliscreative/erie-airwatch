// Shapes shared by the demo snapshot (worker/airwatch/snapshot.py) and the live Supabase views.

export type DataMode = "demo" | "live";
export type FeedStatus = "demo" | "live" | "delayed" | "offline";
export type EventKind = "overflight" | "circuit" | "likely_touch_and_go" | "probable_full_stop" | "low_approach";
export type ConfidenceLabel = "low" | "medium" | "high";
export type ReviewStatus = "pending" | "approved" | "rejected" | "needs_more_data";

export interface RunwayEnd {
  ident: string;
  lat: number;
  lon: number;
  patternDirection: "left" | "right";
}

export interface Airport {
  id: string;
  icao: string;
  name: string;
  city?: string | null;
  timezone: string;
  lat: number;
  lon: number;
  elevationFt: number;
  patternAltitudeFt: number | null;
  patternVerified: boolean;
  runways: { id: string; ends: RunwayEnd[] }[];
}

export interface Zone {
  id: string;
  slug: string;
  label: string;
  synthetic: boolean;
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

export interface SourceStatus {
  name: string;
  kind: "synthetic" | "licensed" | "receiver";
  status: FeedStatus;
  freshnessExpectationS: number;
  lastObservationAt: string | null;
  licenseNote: string;
}

export interface HourlyRow {
  hour: string;
  metric: string;
  zoneId: string | null;
  value: number;
}

export interface DailyRow {
  day: string;
  repeatCircuitAircraft: number;
  maxCircuitsOneAircraft: number;
}

export interface CoverageDay {
  day: string;
  outageMinutes: number;
  outages: number;
}

export interface Position {
  t: string;
  id: string; // daily pseudonym, never an ICAO hex
  lat: number;
  lon: number;
  alt: number | null;
  gs: number | null;
  trk: number | null;
}

export interface PublicEvent {
  id: string;
  kind: EventKind;
  start: string;
  end: string;
  runway: string | null;
  zoneId: string | null;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  reviewStatus: ReviewStatus;
  minAltFt: number | null;
  maxAltFt: number | null;
}

export interface EvaluationScore {
  kind: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  false_positive_share: number | null;
  by_confidence: Record<string, { tp: number; fp: number; precision: number | null }>;
}

export interface DashboardData {
  mode: DataMode;
  generatedAt: string;
  asOf: string;
  airport: Airport;
  zones: Zone[];
  source: SourceStatus;
  range: { start: string; end: string; days: string[] };
  policy: { mode: "reviewed_only" | "qualified"; minConfidence: number };
  hourly: HourlyRow[];
  daily: DailyRow[];
  coverage: CoverageDay[];
  playback: { start: string; end: string; positions: Position[] };
  recentEvents: PublicEvent[];
  methodology: {
    algorithmVersion: string;
    thresholds: Record<string, number>;
    syntheticEvaluation?: {
      scores: Record<string, EvaluationScore>;
      non_events: { go_arounds: number; go_arounds_labelled_touch_and_go: number };
      truth_counts: Record<string, number>;
    };
  };
}

export interface ReviewPoint {
  t: string;
  lat: number;
  lon: number;
  alt: number | null;
  gs: number | null;
  evidence: boolean;
}

export interface ReviewEvent extends PublicEvent {
  aircraftLabel: string;
  algorithmVersion: string;
  details: Record<string, unknown>;
  points: ReviewPoint[];
}
