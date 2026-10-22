import type { Metadata } from "next";
import Link from "next/link";

import { isLive } from "@/lib/config";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

const TABS = [
  { href: "/admin", label: "Review queue" },
  { href: "/admin/validation", label: "Validation" },
  { href: "/admin/health", label: "Data health" },
  { href: "/admin/settings", label: "Settings & reports" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
        <nav aria-label="Admin"><ul className="flex flex-wrap gap-1 text-sm">
          {TABS.map((t) => <li key={t.href}><Link href={t.href} className="rounded-md px-3 py-2 text-ink-2 hover:bg-surface-2">{t.label}</Link></li>)}
        </ul></nav>
      </div>
      {!isLive && (
        <p className="mt-3 rounded-lg bg-caution-soft p-3 text-sm text-caution">
          Demo admin. No sign-in is required because there is no database: review decisions are stored in this browser
          only and change nothing anyone else sees. This page is disabled in production unless a Supabase project with
          MFA-protected admin accounts is configured.
        </p>
      )}
      <div className="mt-6">{children}</div>
    </main>
  );
}
