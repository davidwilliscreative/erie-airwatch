import { createClient } from "@supabase/supabase-js";

import { isLive, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { rateLimited } from "@/lib/ratelimit";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  let body: { message?: string; contact?: string; page?: string; website?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (body.website) return Response.json({ ok: true }); // honeypot field: silently drop bots
  const message = (body.message ?? "").trim();
  if (message.length < 10 || message.length > 4000) {
    return Response.json({ error: "Please write between 10 and 4,000 characters." }, { status: 400 });
  }
  if (!isLive) return Response.json({ ok: true, demo: true });
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await sb.rpc("submit_correction", { p_message: message, p_contact: body.contact ?? null, p_page: body.page ?? null });
  if (error) return Response.json({ error: "Could not save your request. Please try again later." }, { status: 503 });
  return Response.json({ ok: true });
}
