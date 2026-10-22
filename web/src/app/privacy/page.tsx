import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/Site";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <PageShell title="Privacy notice" intro="Erie AirWatch reports on aircraft activity in aggregate. It is designed not to single out people.">
      <h2 className="text-xl font-semibold">Visitors</h2>
      <p>
        You do not need an account. We do not use advertising or tracking cookies. Our hosting provider keeps standard
        server logs (such as IP address and time of request) for security and abuse prevention, for up to 30 days.
        If you send a correction request, we keep your message and any contact details you choose to give until the
        request is resolved, then delete the contact details.
      </p>
      <h2 className="text-xl font-semibold">Aircraft and pilots</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>Public pages show aggregated counts. They do not show pilot names, owner details, addresses or links to registration lookups.</li>
        <li>Positions on the public map are delayed, rounded and labelled with a pseudonym that changes daily, not a tail number or ICAO address.</li>
        <li>We honor data-provider display restrictions and privacy programs. The FAA&rsquo;s LADD and PIA programs exist, but they do not hide every raw broadcast, so we apply our own limits as well.</li>
        <li>Repeat-activity figures are counts only. They are not a list of aircraft.</li>
      </ul>
      <h2 className="text-xl font-semibold">Residents</h2>
      <p>
        Neighborhood zones are broad areas chosen by the project administrator. We do not collect or store home addresses
        or precise household locations.
      </p>
      <h2 className="text-xl font-semibold">Corrections</h2>
      <p>
        If something on this site is wrong, or you believe a finding should not be published, please{" "}
        <Link href="/corrections" className="underline">send a correction request</Link>. An administrator reviews every
        request; confirmed corrections are applied, logged and noted on any affected report.
      </p>
    </PageShell>
  );
}
