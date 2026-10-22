import type { ReactNode } from "react";

export function Card({ title, subtitle, children, className = "", action }: {
  title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string; action?: ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "neutral" | "accent" | "caution" | "danger" | "live" | "sky";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent",
  caution: "bg-caution-soft text-caution",
  danger: "bg-surface-2 text-danger",
  live: "bg-accent-soft text-live",
  sky: "bg-surface-2 text-sky",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Stat({ label, value, qualifier, note, tone = "neutral" }: {
  label: string; value: ReactNode; qualifier?: string; note?: ReactNode; tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-2">{label}</p>
        {qualifier && <Badge tone={tone}>{qualifier}</Badge>}
      </div>
      <p className="tabular mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-3">{note}</p>}
    </div>
  );
}

/** Accessible bar chart built from HTML, so it reflows on small screens. */
export function Bars({ values, labels, color = "var(--chart-1)", flagged = [], ariaLabel, every = 1, unit = "", height = 140 }: {
  values: number[]; labels: string[]; color?: string; flagged?: number[]; ariaLabel: string; every?: number; unit?: string; height?: number;
}) {
  const max = Math.max(1, ...values);
  const flags = new Set(flagged);
  return (
    <figure>
      <div role="img" aria-label={ariaLabel} className="flex items-end gap-[3px]" style={{ height }}>
        {values.map((v, i) => (
          <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" title={`${labels[i]}: ${v}${unit}${flags.has(i) ? " (data gaps)" : ""}`}>
            <div
              className="w-full rounded-t-[3px]"
              style={{
                height: `${(v / max) * 100}%`,
                minHeight: v > 0 ? 2 : 0,
                background: flags.has(i) ? `repeating-linear-gradient(45deg, ${color}, ${color} 3px, transparent 3px, transparent 6px)` : color,
                outline: flags.has(i) ? `1px solid ${color}` : undefined,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-[10px] text-ink-3" aria-hidden="true">
        {labels.map((l, i) => (
          <span key={i} className="flex-1 overflow-hidden text-center whitespace-nowrap">{i % every === 0 ? l : ""}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {values.map((v, i) => (
            <tr key={i}><th scope="row">{labels[i]}</th><td>{v}{unit}{flags.has(i) ? " (data gaps)" : ""}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function HBar({ label, value, max, color = "var(--chart-2)" }: { label: string; value: number; max: number; color?: string }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-2 text-sm">
      <span className="text-ink-2">{label}</span>
      <div className="h-3 rounded-full bg-surface-2">
        <div className="h-3 rounded-full" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }} />
      </div>
      <span className="tabular text-right">{value}</span>
    </div>
  );
}
