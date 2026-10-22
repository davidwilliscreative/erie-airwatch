"use client";

import { useEffect, useState } from "react";

import { Card } from "@/components/ui";
import { KIND_LABEL, pct } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { EventKind, ReviewEvent } from "@/lib/types";

import { loadDemoDecisions } from "./store";

const TARGET = 100;

interface Row { kind: string; tp: number; fp: number; unsure: number; labelled: number; runways: Set<string> }

export default function ValidationPanel({ mode, events, airportId }: { mode: "demo" | "live"; events: ReviewEvent[]; airportId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "demo") {
      const d = loadDemoDecisions();
      const by = new Map<string, Row>();
      for (const e of events) {
        const lab = d[e.id]?.label;
        if (!lab) continue;
        const r = by.get(e.kind) ?? { kind: e.kind, tp: 0, fp: 0, unsure: 0, labelled: 0, runways: new Set<string>() };
        r.labelled++;
        if (lab === "true_positive") r.tp++; else if (lab === "false_positive") r.fp++; else r.unsure++;
        if (e.runway) r.runways.add(e.runway);
        by.set(e.kind, r);
      }
      setRows([...by.values()]);
      return;
    }
    supabaseBrowser().rpc("admin_validation_summary", { p_airport: airportId }).then(({ data, error: e }) => {
      if (e) return setError(e.message);
      const by = new Map<string, Row>();
      for (const x of data ?? []) {
        const r = by.get(x.kind) ?? { kind: x.kind, tp: 0, fp: 0, unsure: 0, labelled: 0, runways: new Set<string>() };
        r.tp += Number(x.true_positive); r.fp += Number(x.false_positive); r.unsure += Number(x.unsure); r.labelled += Number(x.labelled);
        by.set(x.kind, r);
      }
      setRows([...by.values()]);
    });
  }, [mode, events, airportId]);

  const total = rows.reduce((s, r) => s + r.labelled, 0);
  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-danger">{error}</p>}
      <Card title="Launch gate: labelled examples" subtitle={`At least ${TARGET} reviewed candidates and non-events, across both runway directions and varied coverage`}>
        <div className="h-3 rounded-full bg-surface-2"><div className="h-3 rounded-full bg-accent" style={{ width: `${Math.min(100, (total / TARGET) * 100)}%` }} /></div>
        <p className="tabular mt-2 text-sm">{total} of {TARGET} labelled</p>
      </Card>
      <Card title="Precision from reviewer labels" subtitle="Unsure labels are excluded. Recall also needs missed events, which reviewers add from the replay.">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-3"><tr><th className="py-1 font-normal">Finding</th><th className="font-normal">Labelled</th><th className="font-normal">Correct</th><th className="font-normal">Wrong</th><th className="font-normal">Precision</th><th className="font-normal">Runways seen</th></tr></thead>
          <tbody className="tabular">
            {rows.length === 0 && <tr><td colSpan={6} className="py-3 text-ink-3">No labels yet. Label findings in the review queue.</td></tr>}
            {rows.map((r) => (
              <tr key={r.kind} className="border-t border-line">
                <td className="py-1.5">{KIND_LABEL[r.kind as EventKind] ?? r.kind}</td><td>{r.labelled}</td><td>{r.tp}</td><td>{r.fp}</td>
                <td>{pct(r.tp + r.fp ? r.tp / (r.tp + r.fp) : null)}</td><td>{mode === "demo" ? [...r.runways].sort().join(", ") || "n/a" : "see DB"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
