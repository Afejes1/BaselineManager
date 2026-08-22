"use client";

import Link from "../../components/app-link";
import { AnalyticsWorkbench } from "../../components/analytics-workbench";
import { DomainPageShell } from "../../components/domain-shell";

export default function AnalyticsPage() {
  return <DomainPageShell
    title="Analytics"
    subtitle="Baseline posture, decision pressure, traceability, and release change in one analyst view."
    contextMode="filter"
    actions={<><Link className="ghost-button" href="/reports">Leadership reports</Link><button className="ghost-button" type="button" onClick={() => window.print()}>Print analysis</button></>}
  >
    <AnalyticsWorkbench />
  </DomainPageShell>;
}
