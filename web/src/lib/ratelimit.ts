// Simple per-instance sliding-window rate limit. On Vercel, pair it with the platform firewall's rate limiting.
const hits = new Map<string, number[]>();

export function rateLimited(key: string, max = 5, windowMs = 60 * 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}
