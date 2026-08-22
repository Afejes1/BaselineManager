import { env } from "cloudflare:workers";
import { audit, ensureActor, PROGRAM_ID, requireWriter, WORKSPACE_ID } from "./governance-server";
import type { ConnectionType, InfrastructureLifecycle, InfrastructureNodeType, InfrastructureOperatingState, InstallationRole, InstallationStatus, ReleaseNodeLifecycle, TopologyExtensions } from "./topology-model";

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
    infrastructure: await infrastructurePortfolio(db, safeReleaseId || undefined),
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

const normalize = (value: unknown) => clean(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const numberOrNull = (value: unknown) => value === "" || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const nodeTypes = new Set<InfrastructureNodeType>(["ups", "network_switch", "chassis", "blade", "physical_server", "storage_array", "logical_drive", "virtual_machine", "appliance", "other"]);
const nodeLifecycles = new Set<InfrastructureLifecycle>(["active", "planned", "retired"]);
const releaseNodeLifecycles = new Set<ReleaseNodeLifecycle>(["planned", "active", "retired", "absent"]);
const operatingStates = new Set<InfrastructureOperatingState>(["unknown", "operational", "degraded", "offline", "not_installed"]);
const installationRoles = new Set<InstallationRole>(["operating_system", "hypervisor", "application", "middleware", "database", "runtime", "firmware", "agent", "other"]);
const installationStatuses = new Set<InstallationStatus>(["planned", "installed", "retired", "absent"]);
const connectionTypes = new Set<ConnectionType>(["network", "power", "storage", "cluster", "management", "other"]);

export async function infrastructurePortfolio(db: Database, releaseId?: string) {
  const whereState = releaseId ? " AND rs.release_id=?" : "";
  const whereInstall = releaseId ? " AND i.release_id=?" : "";
  const whereConnection = releaseId ? " AND c.release_id=?" : "";
  const bind = <T>(sqlText: string, value?: string) => value ? db.prepare(sqlText).bind(PROGRAM_ID, value).all<T>() : db.prepare(sqlText).bind(PROGRAM_ID).all<T>();
  const [nodes, states, installations, connections, platforms, releases, products, organizations, occurrences] = await Promise.all([
    db.prepare(`SELECT n.id,n.platform_id,n.node_type,n.code,n.name,n.manufacturer_organization_id,o.name AS manufacturer_name,n.hardware_product_id,p.canonical_name AS hardware_product_name,n.asset_tag,n.serial_number,n.lifecycle_status,n.description,n.updated_at FROM infrastructure_node n LEFT JOIN organization o ON o.id=n.manufacturer_organization_id LEFT JOIN product p ON p.id=n.hardware_product_id WHERE n.program_id=? ORDER BY n.platform_id,n.node_type,n.code`).bind(PROGRAM_ID).all<Record<string, unknown>>(),
    bind<Record<string, unknown>>(`SELECT rs.id,rs.release_id,r.name AS release_name,rs.platform_id,rs.infrastructure_node_id,rs.parent_state_id,rs.lifecycle_status,rs.operating_state,rs.cpu_cores,rs.memory_gb,rs.storage_gb,rs.storage_type,rs.drive_letter,rs.file_system,rs.source_reference,rs.source_as_of,rs.notes,rs.updated_at FROM release_infrastructure_node rs JOIN release r ON r.id=rs.release_id WHERE rs.program_id=?${whereState} ORDER BY r.name,rs.platform_id,rs.parent_state_id,rs.id`, releaseId),
    bind<Record<string, unknown>>(`SELECT i.id,i.release_id,i.platform_id,i.node_state_id,i.product_id,p.canonical_name AS product_name,p.product_type,i.baseline_occurrence_id,COALESCE(ext.source_key,sr.source_key) AS source_key,i.installation_role,i.instance_name,i.version,i.deployment_status,i.source_reference,i.source_as_of,i.notes,i.updated_at FROM infrastructure_product_installation i JOIN product p ON p.id=i.product_id LEFT JOIN baseline_occurrence bo ON bo.id=i.baseline_occurrence_id LEFT JOIN baseline_record_extension ext ON ext.baseline_occurrence_id=bo.id LEFT JOIN source_row_24 sr ON sr.id=bo.source_row_id WHERE i.program_id=?${whereInstall} ORDER BY p.canonical_name,i.instance_name`, releaseId),
    bind<Record<string, unknown>>(`SELECT c.id,c.release_id,c.platform_id,c.source_node_state_id,c.target_node_state_id,c.connection_type,c.label,c.status,c.capacity_mbps,c.source_reference,c.source_as_of,c.notes FROM infrastructure_connection c WHERE c.program_id=?${whereConnection} ORDER BY c.connection_type,c.label,c.id`, releaseId),
    db.prepare("SELECT id,code,name,platform_type,parent_id FROM platform WHERE program_id=? AND status<>'retired' ORDER BY code").bind(PROGRAM_ID).all<Record<string, unknown>>(),
    db.prepare("SELECT id,name FROM release WHERE program_id=? ORDER BY COALESCE(actual_date,target_date,name)").bind(PROGRAM_ID).all<Record<string, unknown>>(),
    db.prepare("SELECT id,canonical_name AS name,short_name,product_type FROM product WHERE program_id=? AND lifecycle_status='active' ORDER BY canonical_name").bind(PROGRAM_ID).all<Record<string, unknown>>(),
    db.prepare("SELECT id,name FROM organization WHERE program_id=? AND lifecycle_status='active' ORDER BY name").bind(PROGRAM_ID).all<Record<string, unknown>>(),
    db.prepare(`SELECT bo.id,bo.release_id,r.name AS release_name,bo.product_id,COALESCE(p.canonical_name,'Unnamed product') AS product_name,COALESCE(ext.source_key,sr.source_key,'No external key') AS source_key FROM baseline_occurrence bo JOIN release r ON r.id=bo.release_id LEFT JOIN product p ON p.id=bo.product_id LEFT JOIN baseline_record_extension ext ON ext.baseline_occurrence_id=bo.id LEFT JOIN source_row_24 sr ON sr.id=bo.source_row_id WHERE bo.program_id=? AND bo.workspace_id=? AND bo.lifecycle_status='active' ORDER BY r.name,p.canonical_name`).bind(PROGRAM_ID, WORKSPACE_ID).all<Record<string, unknown>>(),
  ]);
  return {
    nodes: nodes.results.map((row) => ({ id: String(row.id), platformId: String(row.platform_id), nodeType: row.node_type as InfrastructureNodeType, code: String(row.code), name: String(row.name), manufacturerOrganizationId: row.manufacturer_organization_id as string | null, manufacturerName: row.manufacturer_name as string | null, hardwareProductId: row.hardware_product_id as string | null, hardwareProductName: row.hardware_product_name as string | null, assetTag: row.asset_tag as string | null, serialNumber: row.serial_number as string | null, lifecycleStatus: row.lifecycle_status as InfrastructureLifecycle, description: row.description as string | null, updatedAt: String(row.updated_at) })),
    states: states.results.map((row) => ({ id: String(row.id), releaseId: String(row.release_id), releaseName: String(row.release_name), platformId: String(row.platform_id), infrastructureNodeId: String(row.infrastructure_node_id), parentStateId: row.parent_state_id as string | null, lifecycleStatus: row.lifecycle_status as ReleaseNodeLifecycle, operatingState: row.operating_state as InfrastructureOperatingState, cpuCores: row.cpu_cores == null ? null : Number(row.cpu_cores), memoryGb: row.memory_gb == null ? null : Number(row.memory_gb), storageGb: row.storage_gb == null ? null : Number(row.storage_gb), storageType: row.storage_type as string | null, driveLetter: row.drive_letter as string | null, fileSystem: row.file_system as string | null, sourceReference: row.source_reference as string | null, sourceAsOf: row.source_as_of as string | null, notes: row.notes as string | null, updatedAt: String(row.updated_at) })),
    installations: installations.results.map((row) => ({ id: String(row.id), releaseId: String(row.release_id), platformId: String(row.platform_id), nodeStateId: String(row.node_state_id), productId: String(row.product_id), productName: String(row.product_name), productType: row.product_type as string | null, baselineOccurrenceId: row.baseline_occurrence_id as string | null, sourceKey: row.source_key as string | null, installationRole: row.installation_role as InstallationRole, instanceName: row.instance_name as string | null, version: row.version as string | null, deploymentStatus: row.deployment_status as InstallationStatus, sourceReference: row.source_reference as string | null, sourceAsOf: row.source_as_of as string | null, notes: row.notes as string | null, updatedAt: String(row.updated_at) })),
    connections: connections.results.map((row) => ({ id: String(row.id), releaseId: String(row.release_id), platformId: String(row.platform_id), sourceNodeStateId: String(row.source_node_state_id), targetNodeStateId: String(row.target_node_state_id), connectionType: row.connection_type as ConnectionType, label: row.label as string | null, status: row.status as InfrastructureLifecycle, capacityMbps: row.capacity_mbps == null ? null : Number(row.capacity_mbps), sourceReference: row.source_reference as string | null, sourceAsOf: row.source_as_of as string | null, notes: row.notes as string | null })),
    platforms: platforms.results.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name), platformType: String(row.platform_type), parentId: row.parent_id as string | null })),
    releases: releases.results.map((row) => ({ id: String(row.id), name: String(row.name) })),
    products: products.results.map((row) => ({ id: String(row.id), name: String(row.name), shortName: row.short_name as string | null, productType: row.product_type as string | null })),
    organizations: organizations.results.map((row) => ({ id: String(row.id), name: String(row.name) })),
    occurrenceOptions: occurrences.results.map((row) => ({ id: String(row.id), releaseId: String(row.release_id), releaseName: String(row.release_name), productId: row.product_id as string | null, productName: String(row.product_name), sourceKey: String(row.source_key) })),
  };
}

async function requirePlatform(db: Database, platformId: string) {
  const platform = await db.prepare("SELECT id FROM platform WHERE id=? AND program_id=?").bind(platformId, PROGRAM_ID).first<{ id: string }>();
  if (!platform) throw new Error("Choose a governed Platform from this program.");
}

export async function saveInfrastructureNode(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const nodeId = clean(body.id) || id("infra-node");
  const platformId = clean(body.platformId);
  const nodeType = clean(body.nodeType) as InfrastructureNodeType;
  const code = clean(body.code);
  const name = clean(body.name);
  const lifecycleStatus = (clean(body.lifecycleStatus) || "active") as InfrastructureLifecycle;
  if (!platformId || !code || !name || !nodeTypes.has(nodeType) || !nodeLifecycles.has(lifecycleStatus)) throw new Error("Platform, node type, code, name, and lifecycle are required.");
  await requirePlatform(db, platformId);
  const current = await db.prepare("SELECT * FROM infrastructure_node WHERE id=? AND program_id=?").bind(nodeId, PROGRAM_ID).first<Record<string, unknown>>();
  if (current && current.platform_id !== platformId) throw new Error("An infrastructure identity cannot be moved between Platforms. Create a new identity for the other Platform.");
  const manufacturerOrganizationId = nullable(body.manufacturerOrganizationId);
  const hardwareProductId = nullable(body.hardwareProductId);
  if (manufacturerOrganizationId && !(await db.prepare("SELECT id FROM organization WHERE id=? AND program_id=?").bind(manufacturerOrganizationId, PROGRAM_ID).first())) throw new Error("Choose a governed manufacturer Organization.");
  if (hardwareProductId && !(await db.prepare("SELECT id FROM product WHERE id=? AND program_id=?").bind(hardwareProductId, PROGRAM_ID).first())) throw new Error("Choose a governed hardware Product.");
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO infrastructure_node (id,program_id,platform_id,node_type,code,normalized_code,name,normalized_name,manufacturer_organization_id,hardware_product_id,asset_tag,serial_number,lifecycle_status,description,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET node_type=excluded.node_type,code=excluded.code,normalized_code=excluded.normalized_code,name=excluded.name,normalized_name=excluded.normalized_name,manufacturer_organization_id=excluded.manufacturer_organization_id,hardware_product_id=excluded.hardware_product_id,asset_tag=excluded.asset_tag,serial_number=excluded.serial_number,lifecycle_status=excluded.lifecycle_status,description=excluded.description,updated_at=excluded.updated_at")
      .bind(nodeId, PROGRAM_ID, platformId, nodeType, code, normalize(code), name, normalize(name), manufacturerOrganizationId, hardwareProductId, nullable(body.assetTag), nullable(body.serialNumber), lifecycleStatus, nullable(body.description), actor.id, current?.created_at || at, at),
    audit(db, actor, current ? "infrastructure_node_updated" : "infrastructure_node_created", "infrastructure_node", nodeId, { platformId, nodeType, code, name, lifecycleStatus }, current || undefined),
  ]);
  return nodeId;
}

async function assertStateParent(db: Database, stateId: string, releaseId: string, platformId: string, parentStateId: string | null) {
  if (!parentStateId) return;
  if (parentStateId === stateId) throw new Error("An infrastructure node cannot contain itself.");
  const states = await db.prepare("SELECT id,parent_state_id,release_id,platform_id FROM release_infrastructure_node WHERE program_id=? AND release_id=?").bind(PROGRAM_ID, releaseId).all<{ id: string; parent_state_id: string | null; release_id: string; platform_id: string }>();
  const parent = states.results.find((item) => item.id === parentStateId);
  if (!parent || parent.platform_id !== platformId) throw new Error("The parent must be in the same Platform and Release.");
  const byId = new Map(states.results.map((item) => [item.id, item.parent_state_id]));
  const visited = new Set<string>();
  let cursor: string | null | undefined = parentStateId;
  while (cursor) {
    if (cursor === stateId) throw new Error("That parent would create an infrastructure hierarchy cycle.");
    if (visited.has(cursor)) throw new Error("The existing infrastructure hierarchy contains a cycle.");
    visited.add(cursor);
    cursor = byId.get(cursor);
  }
}

export async function saveReleaseInfrastructureNode(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const stateId = clean(body.id) || id("infra-state");
  const releaseId = clean(body.releaseId);
  const infrastructureNodeId = clean(body.infrastructureNodeId);
  const node = await db.prepare("SELECT id,platform_id FROM infrastructure_node WHERE id=? AND program_id=?").bind(infrastructureNodeId, PROGRAM_ID).first<{ id: string; platform_id: string }>();
  if (!node || !releaseId || !(await db.prepare("SELECT id FROM release WHERE id=? AND program_id=?").bind(releaseId, PROGRAM_ID).first())) throw new Error("Choose a governed infrastructure node and Release.");
  const lifecycleStatus = (clean(body.lifecycleStatus) || "active") as ReleaseNodeLifecycle;
  const operatingState = (clean(body.operatingState) || "unknown") as InfrastructureOperatingState;
  if (!releaseNodeLifecycles.has(lifecycleStatus) || !operatingStates.has(operatingState)) throw new Error("Choose valid release lifecycle and operating states.");
  const values = { cpuCores: numberOrNull(body.cpuCores), memoryGb: numberOrNull(body.memoryGb), storageGb: numberOrNull(body.storageGb) };
  if ([values.cpuCores, values.memoryGb, values.storageGb].some((value) => value != null && value < 0)) throw new Error("Capacity values cannot be negative.");
  const parentStateId = nullable(body.parentStateId);
  await assertStateParent(db, stateId, releaseId, node.platform_id, parentStateId);
  const current = await db.prepare("SELECT * FROM release_infrastructure_node WHERE id=? AND program_id=?").bind(stateId, PROGRAM_ID).first<Record<string, unknown>>();
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO release_infrastructure_node (id,program_id,release_id,platform_id,infrastructure_node_id,parent_state_id,lifecycle_status,operating_state,cpu_cores,memory_gb,storage_gb,storage_type,drive_letter,file_system,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_state_id=excluded.parent_state_id,lifecycle_status=excluded.lifecycle_status,operating_state=excluded.operating_state,cpu_cores=excluded.cpu_cores,memory_gb=excluded.memory_gb,storage_gb=excluded.storage_gb,storage_type=excluded.storage_type,drive_letter=excluded.drive_letter,file_system=excluded.file_system,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(stateId, PROGRAM_ID, releaseId, node.platform_id, infrastructureNodeId, parentStateId, lifecycleStatus, operatingState, values.cpuCores, values.memoryGb, values.storageGb, nullable(body.storageType), nullable(body.driveLetter), nullable(body.fileSystem), nullable(body.sourceReference), nullable(body.sourceAsOf), nullable(body.notes), actor.id, current?.created_at || at, at),
    audit(db, actor, current ? "release_infrastructure_updated" : "release_infrastructure_created", "release_infrastructure_node", stateId, { releaseId, infrastructureNodeId, parentStateId, lifecycleStatus, operatingState, ...values }, current || undefined),
  ]);
  return stateId;
}

export async function saveInfrastructureInstallation(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const installationId = clean(body.id) || id("infra-installation");
  const nodeStateId = clean(body.nodeStateId);
  const productId = clean(body.productId);
  const installationRole = clean(body.installationRole) as InstallationRole;
  const deploymentStatus = (clean(body.deploymentStatus) || "installed") as InstallationStatus;
  if (!nodeStateId || !productId || !installationRoles.has(installationRole) || !installationStatuses.has(deploymentStatus)) throw new Error("Release node, Product, installation role, and status are required.");
  const state = await db.prepare("SELECT release_id,platform_id FROM release_infrastructure_node WHERE id=? AND program_id=?").bind(nodeStateId, PROGRAM_ID).first<{ release_id: string; platform_id: string }>();
  const product = await db.prepare("SELECT id FROM product WHERE id=? AND program_id=? AND lifecycle_status='active'").bind(productId, PROGRAM_ID).first<{ id: string }>();
  if (!state || !product) throw new Error("Choose an active Product and a governed release node.");
  const baselineOccurrenceId = nullable(body.baselineOccurrenceId);
  if (baselineOccurrenceId) {
    const occurrence = await db.prepare("SELECT release_id,product_id FROM baseline_occurrence WHERE id=? AND program_id=? AND workspace_id=? AND lifecycle_status='active'").bind(baselineOccurrenceId, PROGRAM_ID, WORKSPACE_ID).first<{ release_id: string; product_id: string | null }>();
    if (!occurrence || occurrence.release_id !== state.release_id) throw new Error("The linked baseline record must belong to the same Release.");
    if (occurrence.product_id && occurrence.product_id !== productId) throw new Error("The linked baseline record and installation must reference the same Product.");
  }
  const instanceName = nullable(body.instanceName);
  const current = await db.prepare("SELECT * FROM infrastructure_product_installation WHERE id=? AND program_id=?").bind(installationId, PROGRAM_ID).first<Record<string, unknown>>();
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO infrastructure_product_installation (id,program_id,release_id,platform_id,node_state_id,product_id,baseline_occurrence_id,installation_role,instance_name,normalized_instance_name,version,deployment_status,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET node_state_id=excluded.node_state_id,product_id=excluded.product_id,baseline_occurrence_id=excluded.baseline_occurrence_id,installation_role=excluded.installation_role,instance_name=excluded.instance_name,normalized_instance_name=excluded.normalized_instance_name,version=excluded.version,deployment_status=excluded.deployment_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(installationId, PROGRAM_ID, state.release_id, state.platform_id, nodeStateId, productId, baselineOccurrenceId, installationRole, instanceName, normalize(instanceName), nullable(body.version), deploymentStatus, nullable(body.sourceReference), nullable(body.sourceAsOf), nullable(body.notes), actor.id, current?.created_at || at, at),
    audit(db, actor, current ? "infrastructure_installation_updated" : "infrastructure_installation_created", "infrastructure_installation", installationId, { nodeStateId, productId, installationRole, deploymentStatus, baselineOccurrenceId }, current || undefined),
  ]);
  return installationId;
}

export async function removeInfrastructureInstallation(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const installationId = clean(body.id);
  const rationale = clean(body.rationale);
  if (!installationId || !rationale) throw new Error("Installation and removal rationale are required.");
  const current = await db.prepare("SELECT * FROM infrastructure_product_installation WHERE id=? AND program_id=?").bind(installationId, PROGRAM_ID).first<Record<string, unknown>>();
  if (!current) throw new Error("The Product installation no longer exists.");
  await db.batch([db.prepare("DELETE FROM infrastructure_product_installation WHERE id=?").bind(installationId), audit(db, actor, "infrastructure_installation_removed", "infrastructure_installation", installationId, { rationale }, current)]);
  return installationId;
}

export async function saveInfrastructureConnection(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const connectionId = clean(body.id) || id("infra-connection");
  const sourceNodeStateId = clean(body.sourceNodeStateId);
  const targetNodeStateId = clean(body.targetNodeStateId);
  const connectionType = clean(body.connectionType) as ConnectionType;
  const status = (clean(body.status) || "active") as InfrastructureLifecycle;
  if (!sourceNodeStateId || !targetNodeStateId || sourceNodeStateId === targetNodeStateId || !connectionTypes.has(connectionType) || !nodeLifecycles.has(status)) throw new Error("Two different release nodes, a connection type, and status are required.");
  const states = await db.prepare("SELECT id,release_id,platform_id FROM release_infrastructure_node WHERE id IN (?,?) AND program_id=?").bind(sourceNodeStateId, targetNodeStateId, PROGRAM_ID).all<{ id: string; release_id: string; platform_id: string }>();
  if (states.results.length !== 2 || states.results[0].release_id !== states.results[1].release_id || states.results[0].platform_id !== states.results[1].platform_id) throw new Error("Connected nodes must belong to the same Platform and Release.");
  const capacityMbps = numberOrNull(body.capacityMbps);
  if (capacityMbps != null && capacityMbps < 0) throw new Error("Connection capacity cannot be negative.");
  const current = await db.prepare("SELECT * FROM infrastructure_connection WHERE id=? AND program_id=?").bind(connectionId, PROGRAM_ID).first<Record<string, unknown>>();
  const at = now();
  const state = states.results[0];
  await db.batch([
    db.prepare("INSERT INTO infrastructure_connection (id,program_id,release_id,platform_id,source_node_state_id,target_node_state_id,connection_type,label,status,capacity_mbps,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_node_state_id=excluded.source_node_state_id,target_node_state_id=excluded.target_node_state_id,connection_type=excluded.connection_type,label=excluded.label,status=excluded.status,capacity_mbps=excluded.capacity_mbps,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(connectionId, PROGRAM_ID, state.release_id, state.platform_id, sourceNodeStateId, targetNodeStateId, connectionType, nullable(body.label), status, capacityMbps, nullable(body.sourceReference), nullable(body.sourceAsOf), nullable(body.notes), actor.id, current?.created_at || at, at),
    audit(db, actor, current ? "infrastructure_connection_updated" : "infrastructure_connection_created", "infrastructure_connection", connectionId, { sourceNodeStateId, targetNodeStateId, connectionType, status }, current || undefined),
  ]);
  return connectionId;
}

export async function removeInfrastructureConnection(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const connectionId = clean(body.id);
  const rationale = clean(body.rationale);
  if (!connectionId || !rationale) throw new Error("Connection and removal rationale are required.");
  const current = await db.prepare("SELECT * FROM infrastructure_connection WHERE id=? AND program_id=?").bind(connectionId, PROGRAM_ID).first<Record<string, unknown>>();
  if (!current) throw new Error("The connection no longer exists.");
  await db.batch([db.prepare("DELETE FROM infrastructure_connection WHERE id=?").bind(connectionId), audit(db, actor, "infrastructure_connection_removed", "infrastructure_connection", connectionId, { rationale }, current)]);
  return connectionId;
}
