"use client";

import Link from "./app-link";
import { useTopologyExtensions } from "../lib/topology-client";
import type { InfrastructureNodeType } from "../lib/topology-model";

const nodeTypeLabels: Record<InfrastructureNodeType, string> = {
  ups: "UPS",
  network_switch: "Network switch",
  chassis: "Chassis",
  blade: "Blade",
  physical_server: "Physical server",
  storage_array: "Storage array",
  logical_drive: "Logical drive",
  virtual_machine: "Virtual machine",
  appliance: "Appliance",
  other: "Other infrastructure",
};

const readable = (value: string | null | undefined) => value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not recorded";
const measured = (value: number | null, unit: string) => value == null ? "Not recorded" : `${value.toLocaleString()} ${unit}`;

export function BaselineConfigurationRelationships({ occurrenceId, productId }: { occurrenceId: string; productId?: string | null }) {
  const { extensions, loading, error } = useTopologyExtensions();
  const portfolio = extensions.infrastructure;
  const installations = portfolio.installations.filter((item) => item.baselineOccurrenceId === occurrenceId);
  const stateById = new Map(portfolio.states.map((item) => [item.id, item]));
  const nodeById = new Map(portfolio.nodes.map((item) => [item.id, item]));
  const platformById = new Map(portfolio.platforms.map((item) => [item.id, item]));
  const releaseById = new Map(portfolio.releases.map((item) => [item.id, item]));
  const referenceById = new Map(portfolio.referenceValues.map((item) => [item.id, item]));

  if (loading) return <section className="domain-card"><h5>Governed system configuration</h5><p>Loading canonical infrastructure relationships…</p></section>;
  if (error) return <section className="domain-card"><h5>Governed system configuration</h5><p className="error-copy">{error}</p></section>;
  if (!installations.length) return <section className="domain-card"><h5>Governed system configuration</h5><p>No Product installation is hard-linked to this baseline record.</p><p className="entity-meta">The Tier, Resource, and Host values above remain baseline fields until an analyst links this row to a governed Platform, infrastructure node, and Product installation.</p><p className="entity-actions">{productId ? <Link className="mini-action" href={`/products/${encodeURIComponent(productId)}`}>Open Product configuration</Link> : null}<Link className="mini-action" href="/topology">Open Deployment Topology</Link></p></section>;

  return <section className="domain-section"><div className="section-heading"><h4>Governed system configuration</h4><span>{installations.length} hard-linked installation{installations.length === 1 ? "" : "s"}</span></div><div className="domain-list">{installations.map((installation) => {
    const state = stateById.get(installation.nodeStateId);
    const node = state ? nodeById.get(state.infrastructureNodeId) : undefined;
    const platform = platformById.get(installation.platformId);
    const release = releaseById.get(installation.releaseId);
    const storageMedium = state?.storageMediumId ? referenceById.get(state.storageMediumId) : undefined;
    const fileSystem = state?.fileSystemValueId ? referenceById.get(state.fileSystemValueId) : undefined;
    const focus = encodeURIComponent(`infrastructure_installation:${installation.id}`);
    const releaseName = release?.name || state?.releaseName || "Unknown Release";
    const platformHref = platform ? `/platforms/${encodeURIComponent(platform.id)}?release=${encodeURIComponent(releaseName)}&focus=${focus}` : "/platforms";
    return <article className="domain-card" key={installation.id}>
      <div className="section-toolbar"><div><span className="eyebrow">{releaseName.toUpperCase()} · {readable(installation.installationRole).toUpperCase()}</span><h3>{installation.productName}</h3></div><span className={`status-pill status-${installation.deploymentStatus}`}>{readable(installation.deploymentStatus)}</span></div>
      <div className="record-facts">
        <div><dt>Platform</dt><dd>{platform ? <Link href={platformHref}>{platform.code} · {platform.name}</Link> : "Not linked"}</dd></div>
        <div><dt>Infrastructure node</dt><dd>{node ? <Link href={platformHref}>{node.code} · {node.name}</Link> : "Identity not found"}</dd></div>
        <div><dt>Node type</dt><dd>{node ? nodeTypeLabels[node.nodeType] : "Not recorded"}</dd></div>
        <div><dt>Node state</dt><dd>{state ? `${readable(state.lifecycleStatus)} · ${readable(state.operatingState)}` : "Not recorded"}</dd></div>
        <div><dt>Version / instance</dt><dd>{installation.version || "Not recorded"}{installation.instanceName ? ` · ${installation.instanceName}` : ""}</dd></div>
        <div><dt>CPU / memory</dt><dd>{state ? `${measured(state.cpuCores, "cores")} · ${measured(state.memoryGb, "GB RAM")}` : "Not recorded"}</dd></div>
        <div><dt>Storage</dt><dd>{state ? `${measured(state.storageGb, "GB")} · ${storageMedium ? `${storageMedium.code} · ${storageMedium.name}` : state.storageType || "medium not recorded"}` : "Not recorded"}</dd></div>
        <div><dt>Drive / file system</dt><dd>{state ? `${state.driveLetter || "Mount not recorded"} · ${fileSystem ? `${fileSystem.code} · ${fileSystem.name}` : state.fileSystem || "file system not recorded"}` : "Not recorded"}</dd></div>
        <div><dt>Manufacturer</dt><dd>{node?.manufacturerName || "Not recorded"}</dd></div>
        <div><dt>Hardware Product</dt><dd>{node?.hardwareProductName || "Not cataloged"}</dd></div>
        <div><dt>Asset identity</dt><dd>{[node?.assetTag, node?.serialNumber].filter(Boolean).join(" · ") || "Not recorded"}</dd></div>
        <div><dt>Supporting source</dt><dd>{installation.sourceReference || state?.sourceReference || "Not recorded"}{installation.sourceAsOf || state?.sourceAsOf ? ` · as of ${installation.sourceAsOf || state?.sourceAsOf}` : ""}</dd></div>
      </div>
      <p className="entity-actions"><Link className="mini-action" href={platformHref}>Open Platform configuration</Link><Link className="mini-action" href={`/releases/${encodeURIComponent(releaseName)}?tab=topology&focus=${focus}`}>Open Release topology</Link><Link className="mini-action" href={`/products/${encodeURIComponent(installation.productId)}`}>Open Product</Link></p>
    </article>;
  })}</div></section>;
}
