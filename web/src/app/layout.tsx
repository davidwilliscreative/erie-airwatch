import type { Metadata, Viewport } from "next";

import { DemoRibbon, SiteFooter, SiteHeader } from "@/components/Site";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Erie AirWatch", template: "%s · Erie AirWatch" },
  description:
    "Public, read-only aircraft activity and neighborhood overflight dashboard for Erie Municipal Airport (KEIK), with published methodology and data-quality disclosures.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#111614" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <DemoRibbon />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
