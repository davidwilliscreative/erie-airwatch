import type { Metadata } from "next";

import { PageShell } from "@/components/Site";

import CorrectionForm from "./CorrectionForm";

export const metadata: Metadata = { title: "Request a correction" };

export default function CorrectionsPage() {
  return (
    <PageShell title="Request a correction" intro="Tell us about an error, a misleading label, or a finding you think should not be published.">
      <p>
        An administrator reviews every request. Confirmed corrections are applied, written to the audit log, and noted on
        any affected report as a new version. Please do not include other people&rsquo;s personal information.
      </p>
      <CorrectionForm />
    </PageShell>
  );
}
