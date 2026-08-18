import { env } from "cloudflare:workers";
import { audit, ensureActor, PROGRAM_ID, requireWriter, WORKSPACE_ID } from "./governance-server";
import type { TopologyExtensions } from "./topology-model";

type Database = typeof env.DB;
type Actor = Awaited<ReturnType<typeof ensureActor>>;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;

type HostRow = {
  id: string; release_id: string; configuration_node_id: string; installation_location: string | null; facility_or_enclave: string | null; equipment_rack: string | null; hardware_blade: string | null; virtualization_platform: string | null; source_reference: string | null; notes: string | null; updated_at: string;
};
type DeploymentRow = {
  id: string; baseline_occurrence_id: string; release_id: string; configuration_node_id: string | null; product_id: string | null; virtual_machine: string | null; container_instance: string | null; application_version: string | null; installation_identifier: string | null; deployment_role: string | null; source_reference: string | null; notes: string | null; updated_at: string;
};

export async function topologyExtensions(db: Database, releaseId?: string): Promise<TopologyExtensions> {
  const safeReleaseId = clean(releaseId);
  const [hosts, deployments] = await Promise.all([
    safeReleaseId
      ? db.prepare("SELECT id,release_id,configuration_node_id,installation_location,facility_or_enclave,equipment_rack,hardware_blade,virtualization_platform,source_reference,notes,updated_at FROM managed_host_profile WHERE program_id=? AND release_id=? ORDER BY updated_at DESC").bind(PROGRAM_ID, safeReleaseId).all<HostRow>()
      : db.prepare("SELECT id,release_id,configuration_node_id,installation_location,facility_or_enclave,equipment_rack,hardware_blade,virtualization_platform,source_reference,notes,updated_at FROM managed_host_profile WHERE program_id=? ORDER BY updated_at DESC").bind(PROGRAM_ID).all<HostRow>(),
    safeReleaseId
      ? db.prepare("SELECT id,baseline_occurrence_id,release_id,configuration_node_id,product_id,virtual_machine,container_instance,application_version,installation_identifier,deployment_role,source_reference,notes,updated_at FROM managed_deployment_profile WHERE program_id=? AND release_id=? ORDER BY updated_at DESC").bind(PROGRAM_ID, safeReleaseId).all<DeploymentRow>()
      : db.prepare("SELECT id,baseline_occurrence_id,release_id,configuration_node_id,product_id,virtual_machine,container_instance,application_version,installation_identifier,deployment_role,source_reference,notes,updated_at FROM managed_deployment_profile WHERE program_id=? ORDER BY updated_at DESC").bind(PROGRAM_ID).all<DeploymentRow>(),
  ]);
  return {
    hostProfiles: hosts.results.map((row) => ({ id: row.id, releaseId: row.release_id, configurationNodeId: row.configuration_node_id, installationLocation: row.installation_location, facilityOrEnclave: row.facility_or_enclave, equipmentRack: row.equipment_rack, hardwareBlade: row.hardware_blade, virtualizationPlatform: row.virtualization_platform, sourceReference: row.source_reference, notes: row.notes, updatedAt: row.updated_at })),
    deploymentProfiles: deployments.results.map((row) => ({ id: row.id, baselineOccurrenceId: row.baseline_occurrence_id, releaseId: row.release_id, configurationNodeId: row.configuration_node_id, productId: row.product_id, virtualMachine: row.virtual_machine, containerInstance: row.container_instance, applicationVersion: row.application_version, installationIdentifier: row.installation_identifier, deploymentRole: row.deployment_role, sourceReference: row.source_reference, notes: row.notes, updatedAt: row.updated_at })),
  };
}

type OccurrenceReference = { id: string; release_id: string | null; configuration_node_id: string | null; product_id: string | null };

async function checkedOccurrence(db: Database, occurrenceId: string) {
  const occurrence = await db.prepare("SELECT id,release_id,configuration_node_id,product_id FROM baseline_occurrence WHERE id=? AND workspace_id=? AND program_id=?").bind(occurrenceId, WORKSPACE_ID, PROGRAM_ID).first<OccurrenceReference>();
  if (!occurrence?.release_id || !occurrence.configuration_node_id) throw new Error("Choose a materialized release occurrence before adding topology details.");
  return occurrence;
}

export async function saveHostProfile(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const occurrence = await checkedOccurrence(db, clean(body.baselineOccurrenceId));
  const at = now();
  const next = { installationLocation: nullable(body.installationLocation), facilityOrEnclave: nullable(body.facilityOrEnclave), equipmentRack: nullable(body.equipmentRack), hardwareBlade: nullable(body.hardwareBlade), virtualizationPlatform: nullable(body.virtualizationPlatform), sourceReference: nullable(body.sourceReference), notes: nullable(body.notes) };
  const current = await db.prepare("SELECT id FROM managed_host_profile WHERE release_id=? AND configuration_node_id=?").bind(occurrence.release_id, occurrence.configuration_node_id).first<{ id: string }>();
  const profileId = current?.id || id("host-profile");
  await db.batch([
    db.prepare("INSERT INTO managed_host_profile (id,program_id,release_id,configuration_node_id,installation_location,facility_or_enclave,equipment_rack,hardware_blade,virtualization_platform,source_reference,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(release_id,configuration_node_id) DO UPDATE SET installation_location=excluded.installation_location,facility_or_enclave=excluded.facility_or_enclave,equipment_rack=excluded.equipment_rack,hardware_blade=excluded.hardware_blade,virtualization_platform=excluded.virtualization_platform,source_reference=excluded.source_reference,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(profileId, PROGRAM_ID, occurrence.release_id, occurrence.configuration_node_id, next.installationLocation, next.facilityOrEnclave, next.equipmentRack, next.hardwareBlade, next.virtualizationPlatform, next.sourceReference, next.notes, actor.id, at, at),
    audit(db, actor, current ? "managed_host_profile_updated" : "managed_host_profile_created", "configuration_node", occurrence.configuration_node_id, { ...next, releaseId: occurrence.release_id }),
  ]);
  return profileId;
}

export async function saveDeploymentProfile(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const occurrence = await checkedOccurrence(db, clean(body.baselineOccurrenceId));
  const at = now();
  const next = { virtualMachine: nullable(body.virtualMachine), containerInstance: nullable(body.containerInstance), applicationVersion: nullable(body.applicationVersion), installationIdentifier: nullable(body.installationIdentifier), deploymentRole: nullable(body.deploymentRole), sourceReference: nullable(body.sourceReference), notes: nullable(body.notes) };
  const current = await db.prepare("SELECT id FROM managed_deployment_profile WHERE baseline_occurrence_id=?").bind(occurrence.id).first<{ id: string }>();
  const profileId = current?.id || id("deployment-profile");
  await db.batch([
    db.prepare("INSERT INTO managed_deployment_profile (id,program_id,baseline_occurrence_id,release_id,configuration_node_id,product_id,virtual_machine,container_instance,application_version,installation_identifier,deployment_role,source_reference,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_occurrence_id) DO UPDATE SET virtual_machine=excluded.virtual_machine,container_instance=excluded.container_instance,application_version=excluded.application_version,installation_identifier=excluded.installation_identifier,deployment_role=excluded.deployment_role,source_reference=excluded.source_reference,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(profileId, PROGRAM_ID, occurrence.id, occurrence.release_id, occurrence.configuration_node_id, occurrence.product_id, next.virtualMachine, next.containerInstance, next.applicationVersion, next.installationIdentifier, next.deploymentRole, next.sourceReference, next.notes, actor.id, at, at),
    audit(db, actor, current ? "managed_deployment_profile_updated" : "managed_deployment_profile_created", "occurrence", occurrence.id, { ...next, releaseId: occurrence.release_id }),
  ]);
  return profileId;
}
