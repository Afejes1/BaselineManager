"use client";

import { useMemo } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { TopologyStack } from "../../components/topology-stack";
import { InfrastructureTree } from "../../components/infrastructure-workspace";
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
    {loading ? <section className="domain-section"><p className="empty">Loading deployment records…</p></section> : error ? <section className="domain-section"><p className="error-copy">{error}</p></section> : !effectiveReleaseName ? <section className="domain-section empty-state"><h3>Select a release lens</h3><p>Deployment topology is a release-specific view. Set the Release Lens in the header.</p><Link href="/releases">Open releases</Link></section> : <><section className="kpi-grid" aria-label="Topology overview"><div className="kpi-card"><span>Infrastructure nodes</span><strong>{extensions.infrastructure.states.length || overview.configurationNodes}</strong><small>{extensions.infrastructure.states.length ? "Governed release configuration" : "Baseline host positions"}</small></div><div className="kpi-card"><span>Products</span><strong>{extensions.infrastructure.installations.length || overview.products}</strong><small>{extensions.infrastructure.installations.length ? "Governed installations" : "Present in baseline records"}</small></div><div className="kpi-card"><span>Platforms</span><strong>{new Set(extensions.infrastructure.states.map((item) => item.platformId)).size}</strong><small>Sites represented in this Release</small></div><div className="kpi-card"><span>Connections</span><strong>{extensions.infrastructure.connections.length}</strong><small>Network, power, storage, and management</small></div></section><section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">RELEASE SYSTEM CONFIGURATION</span><h3>Platform → hardware → VM → installed Product</h3></div><Link href={`/releases/${encodeURIComponent(effectiveReleaseName)}`}>Open release</Link></div><p className="entity-meta">The governed view uses normalized Platform, infrastructure-node, and Product relationships. Capacity and placement are specific to this Release. Missing values remain unknown; they are not displayed as invented layers.</p>{extensionLoading ? <p className="empty">Loading modeled details…</p> : extensionError ? <p className="error-copy">{extensionError}</p> : extensions.infrastructure.states.length && releaseId ? <InfrastructureTree portfolio={extensions.infrastructure} releaseId={releaseId} /> : <><div className="contract-strip"><strong>Compatibility view</strong><span>No governed infrastructure configuration is recorded for this Release. The retained baseline rows are shown below until they are mapped from a Platform page.</span></div><TopologyStack releaseName={effectiveReleaseName} rows={scopedRows} hostProfiles={extensions.hostProfiles} deploymentProfiles={extensions.deploymentProfiles} /></>}</section></>}
  </DomainPageShell>;
}
