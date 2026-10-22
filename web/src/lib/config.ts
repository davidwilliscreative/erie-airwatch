export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const AIRPORT_ICAO = process.env.AIRWATCH_AIRPORT ?? "KEIK";

/** Live mode needs a Supabase project. Without one the site serves the synthetic demo snapshot. */
export const isLive = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** The demo admin (browser-only review state) is available in development, or when explicitly enabled. */
export const demoAdminEnabled =
  !isLive && (process.env.NODE_ENV !== "production" || process.env.AIRWATCH_DEMO_ADMIN === "1");

export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/positron";
