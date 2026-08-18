"use client";

import type { ManagedRecord24 } from "../lib/baseline-client";
import { placementLabel, topologyForRelease, type Placement } from "../lib/release-analysis";
import type { ManagedDeploymentProfile, ManagedHostProfile } from "../lib/topology-model";
import Link from "./app-link";

type Props = {
  releaseName: string;
  rows: ManagedRecord24[];
  hostProfiles: ManagedHostProfile[];
  deploymentProfiles: ManagedDeploymentProfile[];
  onEditHost?: (placement: Placement) => void;
  onEditDeployment?: (placement: Placement) => void;
};

function Layer({ label, value, provenance }: { label: string; value: string; provenance: "source" | "managed" }) {
  return <div className={`topology-layer topology-${provenance}`}><span>{label}</span><strong>{value || "Not reported"}</strong><small>{provenance === "source" ? "24-column source" : "Government-managed extension"}</small></div>;
}

export function TopologyStack({ releaseName, rows, hostProfiles, deploymentProfiles, onEditHost, onEditDeployment }: Props) {
  const hosts = topologyForRelease(rows, releaseName, hostProfiles, deploymentProfiles);
  if (!hosts.length) return <article className="domain-card empty-state"><h3>No topology nodes in this release</h3><p>Import or add source occurrences with a ReleaseName to generate the baseline topology.</p></article>;
  return <section className="topology-stack-list">{hosts.map((host) => <article className="topology-stack-card" key={host.id}><header><div><span className="eyebrow">SOURCE HOST</span><h3>{placementLabel(host)}</h3></div>{onEditHost && <button className="ghost-button" type="button" onClick={() => onEditHost(host.placements[0])}>Edit host context</button>}</header><div className="topology-host-layers"><Layer label="Installation location" value={host.profile?.installationLocation || ""} provenance="managed" /><Layer label="Facility / enclave" value={host.profile?.facilityOrEnclave || ""} provenance="managed" /><Layer label="Rack / blade" value={[host.profile?.equipmentRack, host.profile?.hardwareBlade].filter(Boolean).join(" / ")} provenance="managed" /><Layer label="Tier / resource / host" value={placementLabel(host)} provenance="source" /></div><div className="topology-applications">{host.placements.map((placement) => <article className="topology-application" key={placement.occurrenceId}><div className="topology-application-head"><div><span className="record-type">Application deployment</span><h4>{placement.productId ? <Link href={`/products/${encodeURIComponent(placement.productId)}`}>{placement.productName}</Link> : placement.productName}</h4></div>{onEditDeployment && <button className="ghost-button" type="button" onClick={() => onEditDeployment(placement)}>Add detail</button>}</div><div className="topology-app-grid"><Layer label="VM" value={placement.profile?.virtualMachine || ""} provenance="managed" /><Layer label="Runtime / container" value={[placement.containerized, placement.containerTechnology, placement.containerType].filter(Boolean).join(" / ")} provenance="source" /><Layer label="Container instance" value={placement.profile?.containerInstance || ""} provenance="managed" /><Layer label="Application version" value={placement.profile?.applicationVersion || ""} provenance="managed" /></div>{placement.profile?.installationIdentifier || placement.profile?.deploymentRole ? <p className="entity-meta">{[placement.profile.installationIdentifier && `Install: ${placement.profile.installationIdentifier}`, placement.profile.deploymentRole && `Role: ${placement.profile.deploymentRole}`].filter(Boolean).join(" · ")}</p> : null}</article>)}</div></article>)}</section>;
}
