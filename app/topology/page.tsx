"use client";

import { useMemo } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { TopologyStack } from "../../components/topology-stack";
import { useWorkspaceContext } from "../../components/workspace-context";
import { releaseOverview } from "../../lib/release-analysis";
import { useTopologyExtensions } from "../../lib/topology-client";

export default function TopologyPage() {
  const { rows, scopedRows, releaseLens, loading, error } = useWorkspaceContext();
  const effectiveReleaseName = releaseLens || "";
  const releaseId = rows.find((row) => String(row.ReleaseName || "").trim() === effectiveReleaseName)?.__meta.releaseId || undefined;
  const { extensions, loading: extensionLoading, error: extensionError } = useTopologyExtensions(releaseId);
  const overview = useMemo(() => releaseOverview(rows, effectiveReleaseName), [effectiveReleaseName, rows]);
  return <DomainPageShell title="Deployment Topology" subtitle="Where products are installed for the selected release." releaseScope={effectiveReleaseName || "Select a release"} contextMode="filter">
    {loading ? <section className="domain-section"><p className="empty">Loading deployment records…</p></section> : error ? <section className="domain-section"><p className="error-copy">{error}</p></section> : !effectiveReleaseName ? <section className="domain-section empty-state"><h3>Select a release lens</h3><p>Deployment topology is a release-specific view. Set the Release Lens in the header.</p><Link href="/releases">Open releases</Link></section> : <><section className="kpi-grid" aria-label="Topology overview"><div className="kpi-card"><span>Baseline hosts</span><strong>{overview.configurationNodes}</strong><small>Tier / resource / host placements</small></div><div className="kpi-card"><span>Products</span><strong>{overview.products}</strong><small>Present in this release</small></div><div className="kpi-card"><span>Location details</span><strong>{extensions.hostProfiles.length}</strong><small>Additional modeled properties</small></div><div className="kpi-card"><span>Deployment details</span><strong>{extensions.deploymentProfiles.length}</strong><small>Additional modeled properties</small></div></section><section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">HOW TO READ THIS VIEW</span><h3>Unified release deployment model</h3></div><Link href={`/releases/${encodeURIComponent(effectiveReleaseName)}`}>Open release</Link></div><p className="entity-meta">Each block is part of the current working baseline. Colors identify architecture layers. “Not reported” means no value has been entered; source and confidence are recorded through linked evidence.</p>{extensionLoading ? <p className="empty">Loading modeled details…</p> : extensionError ? <p className="error-copy">{extensionError}</p> : <TopologyStack releaseName={effectiveReleaseName} rows={scopedRows} hostProfiles={extensions.hostProfiles} deploymentProfiles={extensions.deploymentProfiles} />}</section></>}
  </DomainPageShell>;
}
