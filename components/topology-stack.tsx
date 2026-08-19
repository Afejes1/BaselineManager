"use client";

import type { ReactNode } from "react";
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

type Provenance = "source" | "managed" | "mixed";
type StackLevel = "application" | "workload" | "runtime" | "vm" | "host" | "hardware" | "facility" | "location";

function StackBlock({ level, label, value, detail, provenance, action }: { level: StackLevel; label: string; value: ReactNode; detail: string; provenance: Provenance; action?: ReactNode }) {
  return <section className={`topology-block topology-block-${level} topology-${provenance}`}>
    <div className="topology-block-heading"><span>{label}</span>{action}</div>
    <strong>{value}</strong>
    <small>{detail}</small>
  </section>;
}

function sourceRuntime(placement: Placement) {
  return [placement.containerized, placement.containerTechnology, placement.containerType].filter(Boolean).join(" / ") || "Not reported";
}

function deploymentName(placement: Placement) {
  return placement.productId ? <Link href={`/products/${encodeURIComponent(placement.productId)}`}>{placement.productName}</Link> : "Host record only";
}

function DeploymentPyramid({ placement, onEditDeployment }: { placement: Placement; onEditDeployment?: (placement: Placement) => void }) {
  const profile = placement.profile;
  const version = profile?.applicationVersion || "Not reported";
  const installation = profile?.installationLocation || "Not reported";
  const facility = profile?.facilityOrEnclave || "Not reported";
  const rack = [profile?.equipmentRack, profile?.hardwareBlade].filter(Boolean).join(" / ") || "Not reported";
  const productDetail = placement.productId ? `Reported product · Government detail: ${version}` : "Host record only · No product reported";

  return <article className="topology-pyramid" aria-label={`Layered deployment stack for ${placement.productName || placementLabel(placement)}`}>
    <StackBlock
      level="application"
      label="Application / version"
      value={deploymentName(placement)}
      detail={productDetail}
      provenance="mixed"
      action={onEditDeployment ? <button className="topology-edit-button" type="button" onClick={() => onEditDeployment(placement)}>Edit</button> : undefined}
    />
    <StackBlock level="workload" label="Container instance" value={profile?.containerInstance || "Not reported"} detail="Government-managed extension" provenance="managed" />
    <StackBlock level="runtime" label="Runtime / container" value={sourceRuntime(placement)} detail="A2O Tech Stack source" provenance="source" />
    <StackBlock level="vm" label="Virtual machine" value={profile?.virtualMachine || "Not reported"} detail="Government-managed extension" provenance="managed" />
    <StackBlock level="host" label="Tier / resource / host" value={placementLabel(placement)} detail="A2O Tech Stack source" provenance="source" />
    <StackBlock level="hardware" label="Rack / blade" value={rack} detail="Government-managed extension" provenance="managed" />
    <StackBlock level="facility" label="Facility / enclave" value={facility} detail="Government-managed extension" provenance="managed" />
    <StackBlock level="location" label="Installation location" value={installation} detail="Government-managed extension · physical foundation" provenance="managed" />
    {profile?.installationIdentifier || profile?.deploymentRole ? <p className="topology-pyramid-meta">{[profile.installationIdentifier && `Install: ${profile.installationIdentifier}`, profile.deploymentRole && `Role: ${profile.deploymentRole}`].filter(Boolean).join(" · ")}</p> : null}
  </article>;
}

export function TopologyStack({ releaseName, rows, hostProfiles, deploymentProfiles, onEditHost, onEditDeployment }: Props) {
  const hosts = topologyForRelease(rows, releaseName, hostProfiles, deploymentProfiles);
  if (!hosts.length) return <article className="domain-card empty-state"><h3>No deployment records in this release</h3><p>Import or add baseline records with a ReleaseName.</p></article>;

  return <section className="topology-stack-list">
    <div className="topology-reading-guide"><strong>Read each stack from bottom to top</strong><span>Installation location → hardware → source host → VM → runtime → workload → application</span><i><b className="topology-key-managed" /> Government-managed extension <b className="topology-key-source" /> A2O Tech Stack data</i></div>
    {hosts.map((host) => <article className="topology-stack-card" key={host.id}>
      <header>
        <div><span className="eyebrow">SOURCE HOST</span><h3>{placementLabel(host)}</h3><p>{host.placements.length} deployment{host.placements.length === 1 ? "" : "s"} on this source host</p></div>
        {onEditHost && <button className="ghost-button" type="button" onClick={() => onEditHost(host.placements[0])}>Edit host context</button>}
      </header>
      <div className="topology-pyramid-grid">{host.placements.map((placement) => <DeploymentPyramid key={placement.occurrenceId} placement={placement} onEditDeployment={onEditDeployment} />)}</div>
    </article>)}
  </section>;
}
