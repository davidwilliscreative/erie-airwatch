import Link from "next/link";

import { isLive } from "@/lib/config";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/reports", label: "Reports" },
  { href: "/methodology", label: "Methodology" },
  { href: "/privacy", label: "Privacy" },
];

export function DemoRibbon() {
  if (isLive) return null;
  return (
    <div className="bg-caution-soft text-caution border-b border-line">
      <p className="mx-auto max-w-6xl px-4 py-2 text-sm">
        <strong>Demonstration.</strong> Every aircraft, flight and count on this site is synthetic. No real aviation
        data is collected or shown until a data licence is in place.
      </p>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <circle cx="14" cy="14" r="13" fill="var(--accent)" />
            <path d="M7 17 L14 6 L21 17" stroke="var(--accent-ink)" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 20 H18" stroke="var(--accent-ink)" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>Erie AirWatch</span>
        </Link>
        <nav aria-label="Main">
          <ul className="flex flex-wrap gap-1 text-sm">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="rounded-md px-3 py-2 text-ink-2 hover:bg-surface-2 hover:text-ink">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-ink-2 md:grid-cols-3">
        <div>
          <p className="font-semibold text-ink">Erie AirWatch</p>
          <p className="mt-1">
            An independent, read-only community dashboard for activity around Erie Municipal Airport (KEIK). Not
            affiliated with the airport, the Town of Erie or the FAA.
          </p>
        </div>
        <div>
          <p className="font-semibold text-ink">What this is not</p>
          <p className="mt-1">
            Positions from ADS-B do not measure noise, confirm runway contact, identify owners or establish that any
            rule was broken. Missing data is never counted as zero activity.
          </p>
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-ink">More</p>
          <p><Link className="underline" href="/methodology">Definitions and methodology</Link></p>
          <p><Link className="underline" href="/privacy">Privacy notice</Link></p>
          <p><Link className="underline" href="/corrections">Request a correction</Link></p>
        </div>
      </div>
    </footer>
  );
}

export function PageShell({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {intro && <div className="mt-3 text-lg text-ink-2">{intro}</div>}
      <div className="prose-like mt-8 space-y-6 leading-relaxed">{children}</div>
    </main>
  );
}
