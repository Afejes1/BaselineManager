"use client";

import Link from "../../components/app-link";
import { AnalyticsWorkbench } from "../../components/analytics-workbench";
import { DomainPageShell } from "../../components/domain-shell";
import { PROGRAM_HANDLING_MARKING } from "../../lib/output-handling";

export default function AnalyticsPage() {
  return <DomainPageShell
    title="Analytics"
    subtitle="Baseline posture, decision pressure, traceability, and release change in one analyst view."
    contextMode="filter"
    actions={<><Link className="ghost-button" href="/reports">Leadership reports</Link><button className="ghost-button" type="button" onClick={() => window.print()}>Print analysis</button></>}
  >
    <section className="decision-principle"><strong>{PROGRAM_HANDLING_MARKING}</strong><span>Printed analysis is a working view of the governed application dataset; verify its source dates and approvals before distribution or decision.</span></section>
    <AnalyticsWorkbench />
  </DomainPageShell>;
}
