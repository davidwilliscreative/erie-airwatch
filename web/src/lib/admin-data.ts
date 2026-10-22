import "server-only";

import { isLive } from "./config";
import { getDashboardData } from "./data";
import type { ReviewEvent } from "./types";

export async function getAdminContext() {
  const data = await getDashboardData();
  let events: ReviewEvent[] = [];
  if (!isLive) {
    // Large file, loaded only for admin pages.
    events = (await import("@/data/demo/review.json")).default.events as unknown as ReviewEvent[];
  }
  return { mode: (isLive ? "live" : "demo") as "live" | "demo", data, events };
}
