"use client";

import type { ReactNode } from "react";
import type { ManagedRecord24 } from "../lib/baseline-client";
import { placementLabel, topologyForRelease, type Placement, type TopologyHost } from "../lib/release-analysis";
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

type StackLevel = "application" | "workload" | "runtime" | "vm" | "host" | "hardware" | "facility" | "location";
type HostPlacement = Placement & { profile: ManagedDeploymentProfile | null };
type Foundation = {
  id: string;
  label: string;
  detail: string;
  installationLocation: string | null;
  facility: string | null;
  hardware: string | null;
  hosts: TopologyHost[];
};

const absentValues = new Set(["", "-", "n/a", "na", "none", "not reported", "unknown"]);
const clean = (value: unknown) => String(value ?? "").trim();
const normalized = (value: unknown) => clean(value).replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const present = (value: unknown) => !absentValues.has(normalized(value));
const display = (value: unknown) => present(value) ? clean(value) : null;

function StackBlock({ level, label, value, detail, action }: { level: StackLevel; label: string; value: ReactNode; detail: string; action?: ReactNode }) {
  return <section className={`topology-block topology-block-${level}`}>
    <div className="topology-block-heading"><span>{label}</span>{action}</div>
    <strong>{value}</strong>
    <small>{detail}</small>
  </section>;
}

function isContainerized(placement: HostPlacement) {
  const reported = normalized(placement.containerized);
  if (["no", "n", "false", "0", "n/a", "na", "not containerized"].includes(reported)) return false;
  if (["yes", "y", "true", "1", "containerized"].includes(reported)) return true;
  return [placement.containerTechnology, placement.containerType, placement.profile?.containerInstance].some(present);
}

function runtimeLabel(placement: HostPlacement) {
  const values = [display(placement.containerTechnology), display(placement.containerType)].filter((value): value is string => Boolean(value));
  return values.join(" / ") || "Containerized workload";
}

function deploymentName(placement: HostPlacement) {
  return placement.productId ? <Link href={`/products/${encodeURIComponent(placement.productId)}`}>{placement.productName}</Link> : "No product assigned";
}

function DeploymentStack({ placement, onEditDeployment }: { placement: HostPlacement; onEditDeployment?: (placement: Placement) => void }) {
  const profile = placement.profile;
  const containerized = isContainerized(placement);
  const virtualMachine = display(profile?.virtualMachine);
  const containerInstance = containerized ? display(profile?.containerInstance) : null;
  const applicationVersion = display(profile?.applicationVersion);
  const directToHost = !containerized && !virtualMachine;

  return <article className="topology-deployment-stack" aria-label={`Deployment stack for ${placement.productName || placementLabel(placement)}`}>
    <StackBlock
      level="application"
      label={placement.productId ? "Application / version" : "Unassigned deployment"}
      value={deploymentName(placement)}
      detail={placement.productId ? applicationVersion ? `Application version ${applicationVersion}` : "Application version not reported" : "Baseline host record has no Product link"}
      action={onEditDeployment ? <button className="topology-edit-button" type="button" onClick={() => onEditDeployment(placement)}>Edit</button> : undefined}
    />
    {containerInstance ? <StackBlock level="workload" label="Container instance" value={containerInstance} detail="Reported container, pod, or workload identity" /> : null}
    {containerized ? <StackBlock level="runtime" label="Runtime / container" value={runtimeLabel(placement)} detail={containerInstance ? "Container runtime profile" : "Containerized; instance identity not reported"} /> : null}
    {virtualMachine ? <StackBlock level="vm" label="Virtual machine" value={virtualMachine} detail="Reported virtual-machine identity" /> : null}
    {directToHost ? <p className="topology-direct-install">Direct installation on this baseline host. No VM or container layer is reported.</p> : null}
    {profile?.installationIdentifier || profile?.deploymentRole ? <p className="topology-pyramid-meta">{[profile.installationIdentifier && `Install: ${profile.installationIdentifier}`, profile.deploymentRole && `Role: ${profile.deploymentRole}`].filter(Boolean).join(" · ")}</p> : null}
  </article>;
}

function foundationFor(host: TopologyHost) {
  const installationLocation = display(host.profile?.installationLocation);
  const facility = display(host.profile?.facilityOrEnclave);
  const hardware = [display(host.profile?.equipmentRack), display(host.profile?.hardwareBlade)].filter((value): value is string => Boolean(value)).join(" / ") || null;
  const physicalKey = [installationLocation, facility, hardware].map(normalized).join("|");
  const fallbackKey = [host.tier, host.resource].map(normalized).join("|");
  const physicalParts = [installationLocation, facility, hardware].filter((value): value is string => Boolean(value));
  const fallbackParts = [display(host.tier), display(host.resource)].filter((value): value is string => Boolean(value));
  return {
    id: physicalParts.length ? `physical:${physicalKey}` : `reported-placement:${fallbackKey || normalized(host.id)}`,
    label: physicalParts.join(" / ") || `${fallbackParts.join(" / ") || "Unreported"} shared installation context`,
    detail: physicalParts.length ? "Shared reported physical foundation" : "No installation, facility, rack, or blade is reported. Related hosts are grouped by Tier and Resource.",
    installationLocation,
    facility,
    hardware,
  };
}

function groupFoundations(hosts: TopologyHost[]) {
  const groups = new Map<string, Foundation>();
  for (const host of hosts) {
    const candidate = foundationFor(host);
    const group = groups.get(candidate.id) || { ...candidate, hosts: [] };
    group.hosts.push(host);
    groups.set(candidate.id, group);
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }));
}

function FoundationCard({ foundation, onEditHost, onEditDeployment }: { foundation: Foundation; onEditHost?: (placement: Placement) => void; onEditDeployment?: (placement: Placement) => void }) {
  const placementCount = foundation.hosts.reduce((count, host) => count + host.placements.length, 0);
  const hasPhysicalLayer = Boolean(foundation.installationLocation || foundation.facility || foundation.hardware);
  return <article className="topology-foundation-card">
    <header className="topology-foundation-header">
      <div><span className="eyebrow">SHARED FOUNDATION</span><h3>{foundation.label}</h3><p>{foundation.detail}</p></div>
      <span>{foundation.hosts.length} baseline host{foundation.hosts.length === 1 ? "" : "s"} · {placementCount} deployment{placementCount === 1 ? "" : "s"}</span>
    </header>
    <div className="topology-foundation-layers">
      {foundation.installationLocation ? <StackBlock level="location" label="Installation location" value={foundation.installationLocation} detail="Shared installation or site foundation" /> : null}
      {foundation.facility ? <StackBlock level="facility" label="Facility / enclave" value={foundation.facility} detail="Shared facility or enclave context" /> : null}
      {foundation.hardware ? <StackBlock level="hardware" label="Rack / blade" value={foundation.hardware} detail="Shared recorded hardware placement" /> : null}
      {!hasPhysicalLayer ? <div className="topology-unreported-foundation"><strong>Installation context not reported</strong><span>The source did not provide physical-location fields. This is one shared foundation, not a separate empty stack for each application.</span></div> : null}
    </div>
    <div className="topology-host-grid">{foundation.hosts.map((host) => {
      const virtualizationPlatform = display(host.profile?.virtualizationPlatform);
      return <article className="topology-host-card" key={host.id}>
        <header><div><span className="eyebrow">BASELINE HOST</span><h4>{placementLabel(host)}</h4><p>{host.placements.length} deployment{host.placements.length === 1 ? "" : "s"} at this Tier / Resource / Host placement{virtualizationPlatform ? ` · virtualization platform ${virtualizationPlatform}` : ""}</p></div>{onEditHost && <button className="ghost-button" type="button" onClick={() => onEditHost(host.placements[0])}>Edit host context</button>}</header>
        <StackBlock level="host" label="Tier / resource / host" value={placementLabel(host)} detail="Release-specific baseline placement" />
        <div className="topology-deployment-grid">{host.placements.map((placement) => <DeploymentStack key={placement.occurrenceId} placement={placement} onEditDeployment={onEditDeployment} />)}</div>
      </article>;
    })}</div>
  </article>;
}

export function TopologyStack({ releaseName, rows, hostProfiles, deploymentProfiles, onEditHost, onEditDeployment }: Props) {
  const hosts = topologyForRelease(rows, releaseName, hostProfiles, deploymentProfiles);
  if (!hosts.length) return <article className="domain-card empty-state"><h3>No deployment records in this release</h3><p>Import or add baseline records with a ReleaseName.</p></article>;
  const foundations = groupFoundations(hosts);

  return <section className="topology-stack-list">
    <div className="topology-reading-guide"><strong>Read from shared foundation to application</strong><span>Installation context → baseline host → VM when reported → container runtime when reported → application.</span><i>Only recorded layers are drawn. An omitted layer is not invented from a blank source value.</i></div>
    {foundations.map((foundation) => <FoundationCard key={foundation.id} foundation={foundation} onEditHost={onEditHost} onEditDeployment={onEditDeployment} />)}
  </section>;
}
