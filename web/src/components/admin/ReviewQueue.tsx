"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui";
import { CONFIDENCE_LABEL, fmtDateTime, KIND_LABEL } from "@/lib/format";
import type { Airport, EventKind, ReviewEvent, ReviewStatus, Zone } from "@/lib/types";

import { PlanView, Profile } from "./EvidencePlot";
import { type Decision, liveEvidence, liveQueue, liveReview, loadDemoDecisions, saveDemoDecision, type ValidationLabel } from "./store";

const STATUSES: ReviewStatus[] = ["pending", "approved", "rejected", "needs_more_data"];

export default function ReviewQueue({ mode, airport, zones, initial }: {
  mode: "demo" | "live"; airport: Airport; zones: Zone[]; initial: ReviewEvent[];
}) {
  const [events, setEvents] = useState<ReviewEvent[]>(initial);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [kind, setKind] = useState<EventKind | "">("");
  const [conf, setConf] = useState<"" | "low" | "medium" | "high">("");
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState<ValidationLabel | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tz = airport.timezone;

  useEffect(() => {
    if (mode === "demo") setDecisions(loadDemoDecisions());
  }, [mode]);

  useEffect(() => {
    if (mode !== "live") return;
    liveQueue(status).then(setEvents).catch((e) => setError(String(e.message ?? e)));
  }, [mode, status]);

  const effective = useCallback((e: ReviewEvent): ReviewStatus => decisions[e.id]?.status ?? e.reviewStatus, [decisions]);

  const list = useMemo(
    () => events
      .filter((e) => (mode === "live" ? true : effective(e) === status))
      .filter((e) => !kind || e.kind === kind)
      .filter((e) => !conf || e.confidenceLabel === conf)
      .sort((a, b) => a.confidence - b.confidence || a.start.localeCompare(b.start)),
    [events, mode, status, kind, conf, effective],
  );

  const current = list.find((e) => e.id === selected) ?? list[0] ?? null;

  useEffect(() => {
    if (!current) return;
    setLabel(decisions[current.id]?.label ?? null);
    setNote(decisions[current.id]?.note ?? "");
    if (mode === "live" && current.points.length === 0) {
      liveEvidence(current.id)
        .then((pts) => setEvents((evs) => evs.map((e) => (e.id === current.id ? { ...e, points: pts } : e))))
        .catch((e) => setError(String(e.message ?? e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const decide = useCallback(async (s: ReviewStatus) => {
    if (!current) return;
    const d: Decision = { status: s, label: label ?? (s === "approved" ? "true_positive" : s === "rejected" ? "false_positive" : null), note, at: new Date().toISOString() };
    try {
      if (mode === "live") {
        await liveReview(current.id, d);
        setEvents((evs) => evs.filter((e) => e.id !== current.id));
      } else {
        saveDemoDecision(current.id, d);
      }
      setDecisions((all) => ({ ...all, [current.id]: d }));
      const idx = list.findIndex((e) => e.id === current.id);
      setSelected(list[idx + 1]?.id ?? null);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [current, label, note, mode, list]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const idx = list.findIndex((x) => x.id === current?.id);
      if (e.key === "j") setSelected(list[Math.min(idx + 1, list.length - 1)]?.id ?? null);
      else if (e.key === "k") setSelected(list[Math.max(idx - 1, 0)]?.id ?? null);
      else if (e.key === "a") decide("approved");
      else if (e.key === "r") decide("rejected");
      else if (e.key === "n") decide("needs_more_data");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, current, decide]);

  const zone = current?.zoneId ? zones.find((z) => z.id === current.zoneId) ?? null : null;
  const comps = (current?.details?.confidence_components ?? {}) as Record<string, number>;
  const otherDetails = Object.entries(current?.details ?? {}).filter(([k]) => k !== "confidence_components");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <fieldset className="flex rounded-lg border border-line bg-surface p-0.5">
          <legend className="sr-only">Review status</legend>
          {STATUSES.map((s) => (
            <label key={s} className={`cursor-pointer rounded-md px-3 py-1.5 ${status === s ? "bg-accent text-accent-ink" : "text-ink-2"}`}>
              <input type="radio" className="sr-only" checked={status === s} onChange={() => { setStatus(s); setSelected(null); }} />
              {s.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
        <select value={kind} onChange={(e) => setKind(e.target.value as EventKind | "")} className="rounded-lg border border-line bg-surface px-2 py-1.5" aria-label="Finding type">
          <option value="">All types</option>
          {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select value={conf} onChange={(e) => setConf(e.target.value as typeof conf)} className="rounded-lg border border-line bg-surface px-2 py-1.5" aria-label="Data quality">
          <option value="">Any data quality</option>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
        <span className="text-ink-3">{list.length} findings · keys: j/k move, a approve, r reject, n needs more data</span>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-caution-soft p-3 text-sm text-caution">{error}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[22rem_1fr]">
        <ul className="max-h-[70vh] overflow-auto rounded-xl border border-line bg-surface" aria-label="Findings">
          {list.length === 0 && <li className="p-4 text-sm text-ink-3">Nothing here.</li>}
          {list.map((e) => (
            <li key={e.id}>
              <button
                type="button" onClick={() => setSelected(e.id)}
                className={`block w-full border-b border-line px-3 py-2 text-left text-sm hover:bg-surface-2 ${current?.id === e.id ? "bg-accent-soft" : ""}`}
                aria-current={current?.id === e.id}
              >
                <span className="font-medium">{KIND_LABEL[e.kind]}</span>{e.runway ? ` · rwy ${e.runway}` : ""}
                <span className="block text-ink-3">{fmtDateTime(e.start, tz, { weekday: "short" })} · score {e.confidence.toFixed(2)}</span>
              </button>
            </li>
          ))}
        </ul>

        {current ? (
          <section className="rounded-xl border border-line bg-surface p-4" aria-label="Finding detail">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{KIND_LABEL[current.kind]}</h2>
              <Badge tone={current.confidenceLabel === "high" ? "live" : "caution"}>{CONFIDENCE_LABEL[current.confidenceLabel]} ({current.confidence.toFixed(2)})</Badge>
              <Badge>{effective(current).replaceAll("_", " ")}</Badge>
              <Badge>algorithm {current.algorithmVersion}</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-3">
              {current.aircraftLabel} · {fmtDateTime(current.start, tz, { weekday: "short", second: "2-digit" })} to {fmtDateTime(current.end, tz, { second: "2-digit" })}
              {current.runway && ` · runway ${current.runway}`}{zone && ` · ${zone.label}`}
            </p>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div>
                <PlanView airport={airport} zone={zone} points={current.points} />
                <p className="mt-1 text-xs text-ink-3">Filled dots are the evidence points; hollow dots are 90 s of context either side.</p>
              </div>
              <div>
                <Profile airport={airport} points={current.points} />
                <h3 className="mt-3 text-sm font-semibold">Data-quality components</h3>
                <dl className="tabular mt-1 grid grid-cols-2 gap-x-4 text-sm">
                  {Object.entries(comps).map(([k, v]) => <div key={k} className="flex justify-between border-b border-line py-0.5"><dt className="text-ink-2">{k.replaceAll("_", " ")}</dt><dd>{v}</dd></div>)}
                </dl>
                <h3 className="mt-3 text-sm font-semibold">Detector details</h3>
                <dl className="mt-1 text-sm">
                  {otherDetails.map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-line py-0.5"><dt className="text-ink-2">{k.replaceAll("_", " ")}</dt><dd className="text-right">{Array.isArray(v) ? v.join(" → ") : String(v)}</dd></div>)}
                </dl>
              </div>
            </div>

            <fieldset className="mt-4">
              <legend className="text-sm font-semibold">Is the detector right? (used for validation)</legend>
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                {(["true_positive", "false_positive", "unsure"] as ValidationLabel[]).map((l) => (
                  <label key={l} className="flex items-center gap-1">
                    <input type="radio" name="label" checked={label === l} onChange={() => setLabel(l)} /> {l.replaceAll("_", " ")}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mt-3 block text-sm">
              <span className="font-semibold">Note (kept in the audit log)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line bg-surface p-2" />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => decide("approved")} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Approve for publication</button>
              <button type="button" onClick={() => decide("rejected")} className="rounded-md border border-line px-3 py-2 text-sm">Reject</button>
              <button type="button" onClick={() => decide("needs_more_data")} className="rounded-md border border-line px-3 py-2 text-sm">Needs more data</button>
            </div>
          </section>
        ) : <p className="text-ink-3">Select a finding.</p>}
      </div>
    </div>
  );
}
