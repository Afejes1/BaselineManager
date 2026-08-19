"use client";

import { useMemo, useState } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { TopologyStack } from "../../components/topology-stack";
import { useBaselineWorkspace } from "../../lib/baseline-client";
import { releaseNames, releaseOverview } from "../../lib/release-analysis";
import { useTopologyExtensions } from "../../lib/topology-client";

export default function TopologyPage() {
  const { rows, loading, error } = useBaselineWorkspace();
  const releases = useMemo(() => releaseNames(rows), [rows]);
  const [releaseName, setReleaseName] = useState("");
  const effectiveReleaseName = releaseName || releases[releases.length - 1] || "";
  const releaseId = rows.find((row) => String(row.ReleaseName || "").trim() === effectiveReleaseName)?.__meta.releaseId || undefined;
  const { extensions, loading: extensionLoading, error: extensionError } = useTopologyExtensions(releaseId);
  const overview = useMemo(() => releaseOverview(rows, effectiveReleaseName), [effectiveReleaseName, rows]);
  return <DomainPageShell title="Deployment Topology" subtitle="Where products are installed for the selected release." releaseScope={effectiveReleaseName || "Select a release"} actions={<select value={effectiveReleaseName} onChange={(event) => setReleaseName(event.target.value)} aria-label="Topology release"><option value="">Choose release</option>{releases.map((release) => <option key={release}>{release}</option>)}</select>}>
    {loading ? <section className="domain-section"><p className="empty">Loading deployment records…</p></section> : error ? <section className="domain-section"><p className="error-copy">{error}</p></section> : <><section className="kpi-grid" aria-label="Topology overview"><div className="kpi-card"><span>Reported hosts</span><strong>{overview.configurationNodes}</strong><small>Tier / resource / host placements</small></div><div className="kpi-card"><span>Products</span><strong>{overview.products}</strong><small>Reported in this release</small></div><div className="kpi-card"><span>Location details</span><strong>{extensions.hostProfiles.length}</strong><small>Government-managed</small></div><div className="kpi-card"><span>Deployment details</span><strong>{extensions.deploymentProfiles.length}</strong><small>Government-managed</small></div></section><section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">HOW TO READ THIS VIEW</span><h3>Reported data and Government-managed detail</h3></div><Link href={effectiveReleaseName ? `/releases/${encodeURIComponent(effectiveReleaseName)}` : "/releases"}>Open release</Link></div><p className="entity-meta">Green blocks are reported in the 24-column workbook. Blue blocks are Government-managed details. “Not reported” means no value has been entered.</p>{extensionLoading ? <p className="empty">Loading Government-managed details…</p> : extensionError ? <p className="error-copy">{extensionError}</p> : <TopologyStack releaseName={effectiveReleaseName} rows={rows} hostProfiles={extensions.hostProfiles} deploymentProfiles={extensions.deploymentProfiles} />}</section></>}
  </DomainPageShell>;
}
