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
  return <DomainPageShell title="Topology Explorer" subtitle="A layered deployment view of source baseline facts and explicitly governed extensions." releaseScope={effectiveReleaseName || "Choose a release"} actions={<select value={effectiveReleaseName} onChange={(event) => setReleaseName(event.target.value)} aria-label="Topology release"><option value="">Choose release</option>{releases.map((release) => <option key={release}>{release}</option>)}</select>}>
    {loading ? <section className="domain-section"><p className="empty">Loading source topology…</p></section> : error ? <section className="domain-section"><p className="error-copy">{error}</p></section> : <><section className="kpi-grid" aria-label="Topology overview"><div className="kpi-card"><span>Source hosts</span><strong>{overview.configurationNodes}</strong><small>Tier / resource / host placements</small></div><div className="kpi-card"><span>Applications</span><strong>{overview.products}</strong><small>Canonical products in the release</small></div><div className="kpi-card"><span>Host context</span><strong>{extensions.hostProfiles.length}</strong><small>Managed location / asset profiles</small></div><div className="kpi-card"><span>Deployment detail</span><strong>{extensions.deploymentProfiles.length}</strong><small>Managed VM / version profiles</small></div></section><section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">TOPOLOGY READING GUIDE</span><h3>Known source facts and governed additions</h3></div><Link href={effectiveReleaseName ? `/releases/${encodeURIComponent(effectiveReleaseName)}` : "/releases"}>Open release workspace</Link></div><p className="entity-meta">Green layers are directly reported by the retained 24-column workbook. Blue layers are optional Government-managed details. “Not reported” means the system has not inferred a value.</p>{extensionLoading ? <p className="empty">Loading managed topology detail…</p> : extensionError ? <p className="error-copy">{extensionError}</p> : <TopologyStack releaseName={effectiveReleaseName} rows={rows} hostProfiles={extensions.hostProfiles} deploymentProfiles={extensions.deploymentProfiles} />}</section></>}
  </DomainPageShell>;
}
