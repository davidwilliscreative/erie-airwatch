"use client";

import { useState } from "react";

export default function CorrectionForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    const res = await fetch("/api/corrections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: f.get("message"), contact: f.get("contact"), page: f.get("page"), website: f.get("website") }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setState("sent"); setMsg(j.demo ? "Thanks. (Demo site: requests are not stored.)" : "Thanks. An administrator will review your request."); }
    else { setState("error"); setMsg(j.error ?? "Something went wrong."); }
  }
  if (state === "sent") return <p className="rounded-lg bg-accent-soft p-4 text-accent" role="status">{msg}</p>;
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">What is wrong?</span>
        <textarea name="message" required minLength={10} maxLength={4000} rows={6} className="mt-1 w-full rounded-lg border border-line bg-surface p-3" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Page or report it concerns (optional)</span>
        <input name="page" maxLength={300} className="mt-1 w-full rounded-lg border border-line bg-surface p-2" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">How can we reach you? (optional)</span>
        <input name="contact" maxLength={200} className="mt-1 w-full rounded-lg border border-line bg-surface p-2" />
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {state === "error" && <p className="text-danger" role="alert">{msg}</p>}
      <button disabled={state === "sending"} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-60">
        {state === "sending" ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
