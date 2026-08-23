import { env } from "cloudflare:workers";
import {
  BASELINE_PROGRAM_ID, BASELINE_WORKSPACE_ID, asA2ORow, normalized, numberCell,
  readAssembledBaselineRecords, recordRequiresReview, textCell, type A2ORow,
} from "../../../lib/a2o-baseline-server";
import { audit, ensureActor, requireWriter } from "../../../lib/governance-server";

const nowIso = () => new Date().toISOString();
export type CurrentBaselineRecord = { source_row_id: string | null; release_id: string | null; product_id: string | null; configuration_node_id: string | null; deployment_id: string | null; revision: number; projection_payload: string | null; lifecycle_status: string };
type Current = CurrentBaselineRecord;
type Ids = {
  releaseId: string; baselineId: string; baselineRevision: number; baselineParentId: string | null; baselineIsNew: boolean;
  tierId: string; resourceId: string; hostId: string; resourcePlatformId: string; effectivePlatformId: string;
  productId: string | null; supplierId: string | null; deploymentId: string | null;
  infrastructureNodeId: string | null; releaseInfrastructureStateId: string | null; infrastructureInstallationId: string | null;
  storageMediumId: string | null;
};

export type BaselineResolver = {
  releases: Map<string, string>;
  workingSets: Map<string, { id: string; revision: number }>;
  latestSets: Map<string, { id: string; revision: number }>;
  underReviewReleases: Set<string>;
  tiers: Map<string, string>;
  resources: Map<string, string>;
  hosts: Map<string, string>;
  resourcePlatforms: Map<string, string>;
  products: Map<string, string>;
  suppliers: Map<string, string>;
  deployments: Map<string, string>;
  platformAssignments: Map<string, { platformId: string; confidence: string }>;
  infrastructureNodes: Map<string, string>;
  releaseInfrastructureStates: Map<string, string>;
  infrastructureInstallations: Map<string, string>;
  storageMedia: Map<string, string>;
};

export async function createBaselineResolver(db: D1Database): Promise<BaselineResolver> {
  const [releases, sets, nodes, products, aliases, suppliers, deployments, resourcePlatforms, assignments, infrastructureNodes, infrastructureStates, infrastructureInstallations, storageMedia] = await Promise.all([
    db.prepare("SELECT id,normalized_name FROM release WHERE program_id=?").bind(BASELINE_PROGRAM_ID).all<{ id: string; normalized_name: string }>(),
    db.prepare("SELECT id,release_id,revision_number,approval_status FROM configuration_baseline WHERE program_id=? ORDER BY revision_number DESC,updated_at DESC").bind(BASELINE_PROGRAM_ID).all<{ id: string; release_id: string; revision_number: number; approval_status: string }>(),
    db.prepare("SELECT id,parent_id,node_type,normalized_name FROM configuration_node WHERE program_id=?").bind(BASELINE_PROGRAM_ID).all<{ id: string; parent_id: string | null; node_type: string; normalized_name: string }>(),
    db.prepare("SELECT id,normalized_name FROM product WHERE program_id=? AND lifecycle_status='active'").bind(BASELINE_PROGRAM_ID).all<{ id: string; normalized_name: string }>(),
    db.prepare("SELECT entity_kind,entity_id,normalized_alias FROM canonical_alias WHERE program_id=? AND namespace='name' AND status='accepted'").bind(BASELINE_PROGRAM_ID).all<{ entity_kind: string; entity_id: string; normalized_alias: string }>(),
    db.prepare("SELECT id,normalized_name FROM organization WHERE program_id=?").bind(BASELINE_PROGRAM_ID).all<{ id: string; normalized_name: string }>(),
    db.prepare("SELECT id,product_id,configuration_node_id FROM deployment WHERE program_id=? AND environment='unknown' AND site='unknown'").bind(BASELINE_PROGRAM_ID).all<{ id: string; product_id: string; configuration_node_id: string }>(),
    db.prepare("SELECT id,configuration_node_id FROM platform WHERE program_id=? AND configuration_node_id IS NOT NULL").bind(BASELINE_PROGRAM_ID).all<{ id: string; configuration_node_id: string }>(),
    db.prepare("SELECT baseline_occurrence_id,platform_id,confidence FROM platform_baseline_assignment WHERE program_id=? AND assignment_role='primary'").bind(BASELINE_PROGRAM_ID).all<{ baseline_occurrence_id: string; platform_id: string; confidence: string }>(),
    db.prepare("SELECT id,platform_id,configuration_node_id FROM infrastructure_node WHERE program_id=? AND configuration_node_id IS NOT NULL").bind(BASELINE_PROGRAM_ID).all<{ id: string; platform_id: string; configuration_node_id: string }>(),
    db.prepare("SELECT id,release_id,infrastructure_node_id FROM release_infrastructure_node WHERE program_id=?").bind(BASELINE_PROGRAM_ID).all<{ id: string; release_id: string; infrastructure_node_id: string }>(),
    db.prepare("SELECT id,baseline_occurrence_id FROM infrastructure_product_installation WHERE program_id=? AND baseline_occurrence_id IS NOT NULL").bind(BASELINE_PROGRAM_ID).all<{ id: string; baseline_occurrence_id: string }>(),
    db.prepare("SELECT id,normalized_code FROM infrastructure_reference_value WHERE program_id=? AND category='storage_medium' AND lifecycle_status='active'").bind(BASELINE_PROGRAM_ID).all<{ id: string; normalized_code: string }>(),
  ]);
  const workingSets = new Map<string, { id: string; revision: number }>();
  const latestSets = new Map<string, { id: string; revision: number }>();
  const underReviewReleases = new Set<string>();
  for (const set of sets.results) {
    if (!latestSets.has(set.release_id)) latestSets.set(set.release_id, { id: set.id, revision: set.revision_number });
    if (set.approval_status === "working" && !workingSets.has(set.release_id)) workingSets.set(set.release_id, { id: set.id, revision: set.revision_number });
    if (set.approval_status === "under_review") underReviewReleases.add(set.release_id);
  }
  const tiers = new Map<string, string>(); const resources = new Map<string, string>(); const hosts = new Map<string, string>();
  for (const node of nodes.results) {
    if (node.node_type === "tier") tiers.set(node.normalized_name, node.id);
    if (node.node_type === "resource") resources.set(`${node.parent_id || ""}|${node.normalized_name}`, node.id);
    if (node.node_type === "host") hosts.set(`${node.parent_id || ""}|${node.normalized_name}`, node.id);
  }
  const productMap = new Map(products.results.map((item) => [item.normalized_name, item.id]));
  const supplierMap = new Map(suppliers.results.map((item) => [item.normalized_name, item.id]));
  for (const alias of aliases.results) {
    if (alias.entity_kind === "product") productMap.set(alias.normalized_alias, alias.entity_id);
    if (alias.entity_kind === "organization") supplierMap.set(alias.normalized_alias, alias.entity_id);
  }
  return {
    releases: new Map(releases.results.map((item) => [item.normalized_name, item.id])), workingSets, latestSets, underReviewReleases,
    tiers, resources, hosts, resourcePlatforms: new Map(resourcePlatforms.results.map((item) => [item.configuration_node_id, item.id])), products: productMap, suppliers: supplierMap,
    deployments: new Map(deployments.results.map((item) => [`${item.product_id}|${item.configuration_node_id}`, item.id])),
    platformAssignments: new Map(assignments.results.map((item) => [item.baseline_occurrence_id, { platformId: item.platform_id, confidence: item.confidence }])),
    infrastructureNodes: new Map(infrastructureNodes.results.map((item) => [`${item.platform_id}|${item.configuration_node_id}`, item.id])),
    releaseInfrastructureStates: new Map(infrastructureStates.results.map((item) => [`${item.release_id}|${item.infrastructure_node_id}`, item.id])),
    infrastructureInstallations: new Map(infrastructureInstallations.results.map((item) => [item.baseline_occurrence_id, item.id])),
    storageMedia: new Map(storageMedia.results.map((item) => [item.normalized_code, item.id])),
  };
}

async function firstId(db: D1Database, sql: string, ...params: unknown[]) { return (await db.prepare(sql).bind(...params).first<{ id: string }>())?.id || null; }

function installationRole(row: A2ORow) {
  const value = `${textCell(row.TechStackType)} ${textCell(row.LongName)} ${textCell(row.ShortName)}`.toLowerCase();
  if (/operating system|windows server|red hat|\blinux\b/.test(value)) return "operating_system";
  if (/hypervisor|vmware|hyper-v|\besxi\b/.test(value)) return "hypervisor";
  if (/database|\bdbms\b|sql server|postgres/.test(value)) return "database";
  if (/\bruntime\b|\bjava\s*(8|11|17|21)?\b/.test(value)) return "runtime";
  if (/middleware/.test(value)) return "middleware";
  if (/firmware/.test(value)) return "firmware";
  if (/\bagent\b/.test(value)) return "agent";
  return "application";
}

function hasReportedIdentity(value: unknown) {
  const key = normalized(value);
  return Boolean(key) && !["unassigned", "not reported", "n/a", "na", "unknown", "none"].includes(key);
}

async function resolveIds(db: D1Database, occurrenceId: string, row: A2ORow, resolver?: BaselineResolver): Promise<Ids> {
  const releaseName = textCell(row.ReleaseName) || "Unassigned";
  const releaseKey = normalized(releaseName);
  const releaseId = resolver ? resolver.releases.get(releaseKey) || crypto.randomUUID() : await firstId(db, "SELECT id FROM release WHERE program_id=? AND normalized_name=?", BASELINE_PROGRAM_ID, releaseKey) || crypto.randomUUID();
  if (resolver) resolver.releases.set(releaseKey, releaseId);
  // A working Configuration Set is editable. Approved/superseded sets are never selected for a write.
  const editableSet = resolver?.workingSets.get(releaseId) || await db.prepare("SELECT id,revision_number AS revision FROM configuration_baseline WHERE program_id=? AND release_id=? AND approval_status='working' ORDER BY revision_number DESC, updated_at DESC LIMIT 1").bind(BASELINE_PROGRAM_ID, releaseId).first<{ id: string; revision: number }>();
  const underReview = resolver ? resolver.underReviewReleases.has(releaseId) : Boolean(await firstId(db, "SELECT id FROM configuration_baseline WHERE program_id=? AND release_id=? AND approval_status='under_review' LIMIT 1", BASELINE_PROGRAM_ID, releaseId));
  if (!editableSet && underReview) throw new Error(`${releaseName} has a Configuration Set under review. Return it to working before changing Baseline Records.`);
  const latestSet = resolver?.latestSets.get(releaseId) || await db.prepare("SELECT id,revision_number AS revision FROM configuration_baseline WHERE program_id=? AND release_id=? ORDER BY revision_number DESC,updated_at DESC LIMIT 1").bind(BASELINE_PROGRAM_ID, releaseId).first<{ id: string; revision: number }>();
  const baselineId = editableSet?.id || crypto.randomUUID();
  const baselineRevision = editableSet?.revision || Number(latestSet?.revision || 0) + 1;
  const baselineIsNew = !editableSet;
  if (resolver && baselineIsNew) resolver.workingSets.set(releaseId, { id: baselineId, revision: baselineRevision });
  const tierName = textCell(row.Tier) || "Unassigned"; const resourceName = textCell(row.Resource) || "Unassigned"; const hostName = textCell(row.HW_Host) || "Unassigned";
  const tierKey = normalized(tierName); const tierId = resolver ? resolver.tiers.get(tierKey) || crypto.randomUUID() : await firstId(db, "SELECT id FROM configuration_node WHERE program_id=? AND parent_id IS NULL AND node_type='tier' AND normalized_name=?", BASELINE_PROGRAM_ID, tierKey) || crypto.randomUUID(); if (resolver) resolver.tiers.set(tierKey, tierId);
  const resourceKey = `${tierId}|${normalized(resourceName)}`; const resourceId = resolver ? resolver.resources.get(resourceKey) || crypto.randomUUID() : await firstId(db, "SELECT id FROM configuration_node WHERE program_id=? AND parent_id=? AND node_type='resource' AND normalized_name=?", BASELINE_PROGRAM_ID, tierId, normalized(resourceName)) || crypto.randomUUID(); if (resolver) resolver.resources.set(resourceKey, resourceId);
  const hostKey = `${resourceId}|${normalized(hostName)}`; const hostId = resolver ? resolver.hosts.get(hostKey) || crypto.randomUUID() : await firstId(db, "SELECT id FROM configuration_node WHERE program_id=? AND parent_id=? AND node_type='host' AND normalized_name=?", BASELINE_PROGRAM_ID, resourceId, normalized(hostName)) || crypto.randomUUID(); if (resolver) resolver.hosts.set(hostKey, hostId);
  // In the A2O model Resource is the Platform. Tier qualifies that Platform;
  // host remains the lower-level deployment node beneath it.
  const generatedResourcePlatformId = `a2o-resource-platform-${resourceId}`;
  const resourcePlatformId = resolver ? resolver.resourcePlatforms.get(resourceId) || generatedResourcePlatformId : await firstId(db, "SELECT id FROM platform WHERE program_id=? AND configuration_node_id=?", BASELINE_PROGRAM_ID, resourceId) || generatedResourcePlatformId;
  if (resolver) resolver.resourcePlatforms.set(resourceId, resourcePlatformId);
  const existingAssignment = resolver?.platformAssignments.get(occurrenceId) || await db.prepare("SELECT platform_id AS platformId,confidence FROM platform_baseline_assignment WHERE program_id=? AND baseline_occurrence_id=? AND assignment_role='primary' LIMIT 1").bind(BASELINE_PROGRAM_ID, occurrenceId).first<{ platformId: string; confidence: string }>();
  // A later A2O import may refresh a reported Resource Platform, but it cannot
  // silently move an analyst-assessed or confirmed fielding assignment.
  const effectivePlatformId = existingAssignment && existingAssignment.confidence !== "reported" ? existingAssignment.platformId : resourcePlatformId;
  const productName = textCell(row.LongName) || textCell(row.ShortName);
  // Baseline Record editing assigns a Product; it does not rename the Product
  // already linked to other releases. Canonical renames use the Product editor.
  const productKey = normalized(productName); const productId = productName ? resolver ? resolver.products.get(productKey) || crypto.randomUUID() : await firstId(db, "SELECT id FROM product WHERE program_id=? AND normalized_name=? AND lifecycle_status='active'", BASELINE_PROGRAM_ID, productKey) || await firstId(db, "SELECT entity_id AS id FROM canonical_alias WHERE program_id=? AND entity_kind='product' AND namespace='name' AND status='accepted' AND normalized_alias=?", BASELINE_PROGRAM_ID, productKey) || crypto.randomUUID() : null; if (resolver && productId) resolver.products.set(productKey, productId);
  const supplierName = textCell(row.OEM);
  const supplierKey = normalized(supplierName); const supplierId = supplierName ? resolver ? resolver.suppliers.get(supplierKey) || crypto.randomUUID() : await firstId(db, "SELECT id FROM organization WHERE program_id=? AND normalized_name=?", BASELINE_PROGRAM_ID, supplierKey) || await firstId(db, "SELECT entity_id AS id FROM canonical_alias WHERE program_id=? AND entity_kind='organization' AND namespace='name' AND status='accepted' AND normalized_alias=?", BASELINE_PROGRAM_ID, supplierKey) || crypto.randomUUID() : null; if (resolver && supplierId) resolver.suppliers.set(supplierKey, supplierId);
  const deploymentKey = productId ? `${productId}|${hostId}` : ""; const deploymentId = productId ? resolver ? resolver.deployments.get(deploymentKey) || crypto.randomUUID() : await firstId(db, "SELECT id FROM deployment WHERE program_id=? AND product_id=? AND configuration_node_id=? AND environment='unknown' AND site='unknown'", BASELINE_PROGRAM_ID, productId, hostId) || crypto.randomUUID() : null; if (resolver && deploymentId) resolver.deployments.set(deploymentKey, deploymentId);
  const hasReportedHost = hasReportedIdentity(row.HW_Host);
  const nodeKey = `${effectivePlatformId}|${hostId}`;
  const infrastructureNodeId = hasReportedHost ? resolver ? resolver.infrastructureNodes.get(nodeKey) || crypto.randomUUID() : await firstId(db, "SELECT id FROM infrastructure_node WHERE program_id=? AND platform_id=? AND configuration_node_id=?", BASELINE_PROGRAM_ID, effectivePlatformId, hostId) || crypto.randomUUID() : null;
  if (resolver && infrastructureNodeId) resolver.infrastructureNodes.set(nodeKey, infrastructureNodeId);
  const stateKey = infrastructureNodeId ? `${releaseId}|${infrastructureNodeId}` : "";
  const releaseInfrastructureStateId = infrastructureNodeId ? resolver ? resolver.releaseInfrastructureStates.get(stateKey) || crypto.randomUUID() : await firstId(db, "SELECT id FROM release_infrastructure_node WHERE program_id=? AND release_id=? AND infrastructure_node_id=?", BASELINE_PROGRAM_ID, releaseId, infrastructureNodeId) || crypto.randomUUID() : null;
  if (resolver && releaseInfrastructureStateId) resolver.releaseInfrastructureStates.set(stateKey, releaseInfrastructureStateId);
  const infrastructureInstallationId = productId && releaseInfrastructureStateId ? resolver ? resolver.infrastructureInstallations.get(occurrenceId) || crypto.randomUUID() : await firstId(db, "SELECT id FROM infrastructure_product_installation WHERE program_id=? AND baseline_occurrence_id=?", BASELINE_PROGRAM_ID, occurrenceId) || crypto.randomUUID() : null;
  if (resolver && infrastructureInstallationId) resolver.infrastructureInstallations.set(occurrenceId, infrastructureInstallationId);
  const storageKey = normalized(textCell(row.HW_Storage_Type));
  const storageMediumId = storageKey ? resolver ? resolver.storageMedia.get(storageKey) || null : await firstId(db, "SELECT id FROM infrastructure_reference_value WHERE program_id=? AND category='storage_medium' AND normalized_code=? AND lifecycle_status='active'", BASELINE_PROGRAM_ID, storageKey) : null;
  return { releaseId, baselineId, baselineRevision, baselineParentId: editableSet ? null : latestSet?.id || null, baselineIsNew, tierId, resourceId, hostId, resourcePlatformId, effectivePlatformId, productId, supplierId, deploymentId, infrastructureNodeId, releaseInfrastructureStateId, infrastructureInstallationId, storageMediumId };
}

/** Materialize a database-authoritative record. JSON persists only as a legacy fallback. */
export async function materializeBaselineRecord(db: D1Database, occurrenceId: string, row: A2ORow, revision: number, beforePayload: string | null, sourceRowId: string | null, resolver?: BaselineResolver, actorId?: string | null) {
  const now = nowIso(); const ids = await resolveIds(db, occurrenceId, row, resolver); const status = recordRequiresReview(row) ? "review" : "materialized";
  const releaseName = textCell(row.ReleaseName) || "Unassigned"; const tierName = textCell(row.Tier) || "Unassigned"; const resourceName = textCell(row.Resource) || "Unassigned"; const hostName = textCell(row.HW_Host) || "Unassigned"; const productName = textCell(row.LongName) || textCell(row.ShortName); const supplierName = textCell(row.OEM);
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(BASELINE_PROGRAM_ID, "Joint Strike Fighter", "F-35 technical baseline program", "America/New_York", now, now),
    db.prepare("INSERT INTO baseline_workspace (id,program_id,label,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(BASELINE_WORKSPACE_ID, BASELINE_PROGRAM_ID, "Working Technical Baseline", now, now),
    db.prepare("INSERT INTO release (id,program_id,code,normalized_code,name,normalized_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,updated_at=excluded.updated_at").bind(ids.releaseId, BASELINE_PROGRAM_ID, releaseName, normalized(releaseName), releaseName, normalized(releaseName), "planned", now, now),
    db.prepare("INSERT INTO configuration_baseline (id,program_id,release_id,name,normalized_name,maturity,as_of,status,revision_number,approval_status,parent_baseline_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET as_of=excluded.as_of,status=excluded.status,updated_at=excluded.updated_at WHERE configuration_baseline.approval_status='working'").bind(ids.baselineId, BASELINE_PROGRAM_ID, ids.releaseId, `${releaseName} Working configuration r${ids.baselineRevision}`, normalized(`${releaseName} Working configuration r${ids.baselineRevision}`), "government_assessed", now.slice(0, 10), "working", ids.baselineRevision, "working", ids.baselineParentId, now, now),
    db.prepare("INSERT INTO configuration_node (id,program_id,parent_id,node_type,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(ids.tierId, BASELINE_PROGRAM_ID, null, "tier", tierName, normalized(tierName), now, now),
    db.prepare("INSERT INTO configuration_node (id,program_id,parent_id,node_type,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(ids.resourceId, BASELINE_PROGRAM_ID, ids.tierId, "resource", resourceName, normalized(resourceName), now, now),
    db.prepare("INSERT INTO configuration_node (id,program_id,parent_id,node_type,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(ids.hostId, BASELINE_PROGRAM_ID, ids.resourceId, "host", hostName, normalized(hostName), now, now),
    // A source-derived Resource Platform is intentionally separate from the
    // governed ALOU/OCK/OBK/PMA hierarchy.  Its identity is the Resource node;
    // Tier is retained as the reported descriptor, not a second Platform.
    db.prepare("INSERT INTO platform (id,program_id,parent_id,configuration_node_id,platform_type,code,normalized_code,name,normalized_name,status,description,installation_location,country_code,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(configuration_node_id) DO UPDATE SET updated_at=excluded.updated_at").bind(ids.resourcePlatformId, BASELINE_PROGRAM_ID, null, ids.resourceId, "other", `A2O-RESOURCE-${ids.resourceId}`, normalized(`A2O-RESOURCE-${ids.resourceId}`), resourceName, normalized(resourceName), "active", `A2O Resource Platform · Tier descriptor: ${tierName}`, null, null, actorId || null, now, now),
  ];
  if (ids.baselineIsNew && ids.baselineParentId) statements.push(
    db.prepare("INSERT OR IGNORE INTO baseline_node_state (id,program_id,baseline_id,configuration_node_id,source_row_id,storage_type,storage_gb,cpu_cores,ram_gb,state_notes,created_at,updated_at) SELECT 'clone-' || ? || '-' || id,program_id,?,configuration_node_id,source_row_id,storage_type,storage_gb,cpu_cores,ram_gb,state_notes,?,? FROM baseline_node_state WHERE baseline_id=?").bind(ids.baselineId, ids.baselineId, now, now, ids.baselineParentId),
    db.prepare("INSERT OR IGNORE INTO baseline_deployment_state (id,program_id,baseline_id,deployment_id,source_row_id,reported_version,application_version,runtime_version,presence,status,installation_type,containerized,container_technology,container_type,language,notes,created_at,updated_at) SELECT 'clone-' || ? || '-' || id,program_id,?,deployment_id,source_row_id,reported_version,application_version,runtime_version,presence,status,installation_type,containerized,container_technology,container_type,language,notes,?,? FROM baseline_deployment_state WHERE baseline_id=?").bind(ids.baselineId, ids.baselineId, now, now, ids.baselineParentId),
    db.prepare("UPDATE baseline_occurrence SET baseline_id=?,updated_at=? WHERE release_id=? AND baseline_id=? AND lifecycle_status='active'").bind(ids.baselineId, now, ids.releaseId, ids.baselineParentId),
  );
  if (ids.supplierId) statements.push(db.prepare("INSERT INTO organization (id,program_id,name,normalized_name,organization_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(ids.supplierId, BASELINE_PROGRAM_ID, supplierName, normalized(supplierName), "supplier", now, now));
  // A2O names resolve through accepted aliases, but a later source spelling
  // must never rename the retained canonical Product.  New identities get
  // their initial metadata here; subsequent product naming is a governed
  // catalog action.  This is what lets a corrected spelling absorb an old
  // typo without losing the imported source row that reported the typo.
  if (ids.productId) statements.push(db.prepare("INSERT INTO product (id,program_id,canonical_name,normalized_name,short_name,product_type,software_classification,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET short_name=COALESCE(product.short_name,excluded.short_name),product_type=COALESCE(product.product_type,excluded.product_type),software_classification=COALESCE(product.software_classification,excluded.software_classification),updated_at=excluded.updated_at").bind(ids.productId, BASELINE_PROGRAM_ID, productName, normalized(productName), textCell(row.ShortName), textCell(row.TechStackType), textCell(row["Software Type"]), now, now));
  // OEM creates only a supplier relationship. Ownership requires a separate governed action.
  if (ids.productId && ids.supplierId) statements.push(db.prepare("INSERT INTO product_supplier (product_id,organization_id,supplier_role,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(product_id,organization_id,supplier_role) DO UPDATE SET updated_at=excluded.updated_at").bind(ids.productId, ids.supplierId, "supplier", now, now));
  if (ids.deploymentId && ids.productId) statements.push(db.prepare("INSERT INTO deployment (id,program_id,product_id,configuration_node_id,environment,site,deployment_role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(ids.deploymentId, BASELINE_PROGRAM_ID, ids.productId, ids.hostId, "unknown", "unknown", null, now, now));
  // Materialize the reported host into the governed configuration model. The
  // source does not establish whether HW_Host is physical, virtual, or an
  // appliance, so the stable identity begins as "other" and is explicitly
  // marked reported. Analysts can classify the node and raise confidence from
  // the Platform workspace without a later import overwriting that judgment.
  if (ids.infrastructureNodeId && ids.releaseInfrastructureStateId) statements.push(
    db.prepare("INSERT INTO infrastructure_node (id,program_id,platform_id,configuration_node_id,node_type,code,normalized_code,name,normalized_name,lifecycle_status,description,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(ids.infrastructureNodeId, BASELINE_PROGRAM_ID, ids.effectivePlatformId, ids.hostId, "other", hostName, normalized(hostName), hostName, normalized(hostName), "active", "Reported A2O HW_Host. Physical, virtual, or appliance classification has not been independently confirmed.", actorId || null, now, now),
    db.prepare("INSERT INTO release_infrastructure_node (id,program_id,release_id,platform_id,infrastructure_node_id,parent_state_id,lifecycle_status,operating_state,confidence,cpu_cores,memory_gb,storage_gb,storage_medium_id,storage_type,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET platform_id=excluded.platform_id,cpu_cores=excluded.cpu_cores,memory_gb=excluded.memory_gb,storage_gb=excluded.storage_gb,storage_medium_id=excluded.storage_medium_id,storage_type=excluded.storage_type,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at WHERE release_infrastructure_node.confidence='reported'").bind(ids.releaseInfrastructureStateId, BASELINE_PROGRAM_ID, ids.releaseId, ids.effectivePlatformId, ids.infrastructureNodeId, null, "active", "unknown", "reported", numberCell(row.HW_CPU_CORES), numberCell(row["HW_RAM (GB)"]), numberCell(row["HW_Storage (GB)"]), ids.storageMediumId, textCell(row.HW_Storage_Type), `A2O Tech Stack · HW_Host: ${hostName}`, now.slice(0, 10), "Reported capacity. Confirm host type and containment before treating this as an assessed configuration.", actorId || null, now, now),
  );
  if (ids.infrastructureInstallationId && ids.releaseInfrastructureStateId && ids.productId) statements.push(
    db.prepare("INSERT INTO infrastructure_product_installation (id,program_id,release_id,platform_id,node_state_id,product_id,baseline_occurrence_id,installation_role,instance_name,normalized_instance_name,source_identity,version,deployment_status,confidence,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET release_id=excluded.release_id,platform_id=excluded.platform_id,node_state_id=excluded.node_state_id,product_id=excluded.product_id,installation_role=excluded.installation_role,deployment_status=excluded.deployment_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at WHERE infrastructure_product_installation.confidence='reported'").bind(ids.infrastructureInstallationId, BASELINE_PROGRAM_ID, ids.releaseId, ids.effectivePlatformId, ids.releaseInfrastructureStateId, ids.productId, occurrenceId, installationRole(row), null, "", `a2o:${occurrenceId}`, null, "installed", "reported", `A2O Tech Stack · Baseline record ${textCell(row["#"]) || occurrenceId}`, now.slice(0, 10), "Reported Product placement. Installation role is an import classification and requires analyst confirmation.", actorId || null, now, now),
  );
  if (!ids.infrastructureNodeId && resolver?.infrastructureInstallations.get(occurrenceId)) statements.push(
    db.prepare("UPDATE infrastructure_product_installation SET deployment_status='absent',updated_at=? WHERE baseline_occurrence_id=? AND confidence='reported'").bind(now, occurrenceId),
  );
  if (sourceRowId) statements.push(
    db.prepare("UPDATE baseline_record_source SET disposition='superseded',updated_at=? WHERE baseline_occurrence_id=? AND source_row_id<>? AND disposition='current'").bind(now, occurrenceId, sourceRowId),
    db.prepare("INSERT INTO baseline_record_source (id,baseline_occurrence_id,source_row_id,relationship,disposition,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(baseline_occurrence_id,source_row_id) DO UPDATE SET relationship=excluded.relationship,disposition=excluded.disposition,updated_at=excluded.updated_at").bind(crypto.randomUUID(), occurrenceId, sourceRowId, "imported", "current", now, now),
  );
  statements.push(
    db.prepare("INSERT INTO baseline_node_state (id,program_id,baseline_id,configuration_node_id,source_row_id,storage_type,storage_gb,cpu_cores,ram_gb,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_id,configuration_node_id) DO UPDATE SET source_row_id=excluded.source_row_id,storage_type=excluded.storage_type,storage_gb=excluded.storage_gb,cpu_cores=excluded.cpu_cores,ram_gb=excluded.ram_gb,updated_at=excluded.updated_at").bind(crypto.randomUUID(), BASELINE_PROGRAM_ID, ids.baselineId, ids.hostId, sourceRowId, textCell(row.HW_Storage_Type), numberCell(row["HW_Storage (GB)"]), numberCell(row.HW_CPU_CORES), numberCell(row["HW_RAM (GB)"]), now, now),
  );
  if (ids.deploymentId) statements.push(db.prepare("INSERT INTO baseline_deployment_state (id,program_id,baseline_id,deployment_id,source_row_id,presence,status,containerized,container_technology,container_type,language,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_id,deployment_id) DO UPDATE SET source_row_id=excluded.source_row_id,containerized=excluded.containerized,container_technology=excluded.container_technology,container_type=excluded.container_type,language=excluded.language,updated_at=excluded.updated_at").bind(crypto.randomUUID(), BASELINE_PROGRAM_ID, ids.baselineId, ids.deploymentId, sourceRowId, "present", status, textCell(row.Containerized), textCell(row["Container Technology"]), textCell(row["Container Type"]), textCell(row["SW Language"]), now, now));
  statements.push(
    // Reimports refresh the reported A2O mapping. A Government-assessed or
    // confirmed fielding assignment remains intact until an analyst changes it.
    db.prepare("INSERT INTO platform_baseline_assignment (id,program_id,platform_id,baseline_occurrence_id,release_id,assignment_role,confidence,review_status,source_reference,source_as_of,reviewed_by_user_id,reviewed_at,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_occurrence_id,assignment_role) DO UPDATE SET platform_id=CASE WHEN platform_baseline_assignment.confidence='reported' THEN excluded.platform_id ELSE platform_baseline_assignment.platform_id END,release_id=excluded.release_id,source_reference=CASE WHEN platform_baseline_assignment.confidence='reported' THEN excluded.source_reference ELSE platform_baseline_assignment.source_reference END,source_as_of=CASE WHEN platform_baseline_assignment.confidence='reported' THEN excluded.source_as_of ELSE platform_baseline_assignment.source_as_of END,updated_at=excluded.updated_at").bind(crypto.randomUUID(), BASELINE_PROGRAM_ID, ids.resourcePlatformId, occurrenceId, ids.releaseId, "primary", "reported", "not_reviewed", `A2O Tech Stack · Tier: ${tierName} · Resource Platform: ${resourceName}`, null, null, null, actorId || null, now, now),
  );
  statements.push(
    // Capability text stays staged; only a user resolution can create Product-Capability.
    db.prepare("INSERT INTO baseline_record_extension (baseline_occurrence_id,source_key,notes,capability_notes,notes_1,notes_2,notes_3,notes_4,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_occurrence_id) DO UPDATE SET source_key=excluded.source_key,notes=excluded.notes,capability_notes=excluded.capability_notes,notes_1=excluded.notes_1,notes_2=excluded.notes_2,notes_3=excluded.notes_3,notes_4=excluded.notes_4,updated_at=excluded.updated_at").bind(occurrenceId, textCell(row["#"]), textCell(row.Notes), textCell(row["Technical Capability Satisfied by this SW/Tech - Notes"]), textCell(row["Notes.1"]), textCell(row["Notes.2"]), textCell(row["Notes.3"]), textCell(row["Notes.4"]), now, now),
    db.prepare("UPDATE baseline_occurrence SET source_row_id=?,release_id=?,baseline_id=?,configuration_node_id=?,product_id=?,deployment_id=?,projection_payload=?,materialization_status=?,revision=?,updated_at=? WHERE id=? AND revision=?").bind(sourceRowId, ids.releaseId, ids.baselineId, ids.hostId, ids.productId, ids.deploymentId, JSON.stringify(row), status, revision + 1, now, occurrenceId, revision),
    db.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,before_payload,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), BASELINE_PROGRAM_ID, actorId || null, "baseline_record_materialized", "baseline_occurrence", occurrenceId, beforePayload, JSON.stringify({ authoritative: "normalized", row }), now),
  );
  return { statements, updateIndex: statements.length - 2, ids, status, now };
}

export async function GET(request: Request) {
  try { await ensureActor(env.DB, request); const records = await readAssembledBaselineRecords(env.DB, { includeVoided: new URL(request.url).searchParams.get("includeVoided") === "true" }); return Response.json({ workspace: { id: BASELINE_WORKSPACE_ID, label: "Working Technical Baseline" }, records: records.map((record) => ({ ...record, sourceRowId: record.sourceRowId || record.occurrenceId })) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The working baseline is unavailable." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request); requireWriter(actor);
    const body = await request.json() as { occurrenceId?: unknown; expectedRevision?: unknown; row?: unknown }; const occurrenceId = String(body.occurrenceId ?? "").trim(); const revision = Number(body.expectedRevision); const row = asA2ORow(body.row);
    if (!occurrenceId || !Number.isInteger(revision) || !row) return Response.json({ error: "occurrenceId, expectedRevision, and the exact A2O Tech Stack row are required." }, { status: 400 });
    const current = await env.DB.prepare("SELECT source_row_id,release_id,product_id,configuration_node_id,deployment_id,revision,projection_payload,lifecycle_status FROM baseline_occurrence WHERE id=? AND workspace_id=?").bind(occurrenceId, BASELINE_WORKSPACE_ID).first<Current>();
    if (!current) return Response.json({ error: "Baseline record was not found." }, { status: 404 }); if (current.lifecycle_status !== "active") return Response.json({ error: "Restore this voided baseline record before editing it." }, { status: 409 }); if (current.revision !== revision) return Response.json({ error: "This record changed elsewhere. Reload before saving." }, { status: 409 });
    const materialized = await materializeBaselineRecord(env.DB, occurrenceId, row, revision, current.projection_payload, current.source_row_id, undefined, actor.id); const result = await env.DB.batch(materialized.statements); const update = result[materialized.updateIndex];
    if (!update.success || Number(update.meta.changes ?? 0) !== 1) return Response.json({ error: "This record changed elsewhere. Reload before saving." }, { status: 409 });
    return Response.json({ occurrenceId, revision: revision + 1, materializationStatus: materialized.status, baseline: { name: `${textCell(row.ReleaseName)} Working configuration`, maturity: "government_assessed", asOf: materialized.now.slice(0, 10) } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The baseline record could not be saved." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request); requireWriter(actor);
    const body = await request.json() as { action?: unknown; occurrenceId?: unknown; row?: unknown };
    if (body.action === "restore_occurrence") { const occurrenceId = String(body.occurrenceId || "").trim(); if (!occurrenceId) return Response.json({ error: "occurrenceId is required." }, { status: 400 }); const before = await env.DB.prepare("SELECT lifecycle_status,lifecycle_reason,voided_at FROM baseline_occurrence WHERE id=? AND workspace_id=?").bind(occurrenceId, BASELINE_WORKSPACE_ID).first<Record<string, unknown>>(); if (!before) return Response.json({ error: "Baseline record was not found." }, { status: 404 }); const at = nowIso(); await env.DB.batch([env.DB.prepare("UPDATE baseline_occurrence SET lifecycle_status='active',lifecycle_reason=NULL,voided_at=NULL,voided_by_user_id=NULL,revision=revision+1,updated_at=? WHERE id=? AND workspace_id=?").bind(at, occurrenceId, BASELINE_WORKSPACE_ID), audit(env.DB, actor, "baseline_record_restored", "baseline_occurrence", occurrenceId, { lifecycleStatus: "active" }, before)]); return Response.json({ ok: true, occurrenceId }); }
    const row = asA2ORow(body.row); if (!row || !normalized(row.ReleaseName)) return Response.json({ error: "Choose a release before creating a baseline record." }, { status: 400 }); const now = nowIso(); const occurrenceId = crypto.randomUUID();
    const initial = [env.DB.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(BASELINE_PROGRAM_ID, "Joint Strike Fighter", "F-35 technical baseline program", "America/New_York", now, now), env.DB.prepare("INSERT INTO baseline_workspace (id,program_id,label,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(BASELINE_WORKSPACE_ID, BASELINE_PROGRAM_ID, "Working Technical Baseline", now, now), env.DB.prepare("INSERT INTO baseline_occurrence (id,program_id,workspace_id,source_row_id,projection_payload,materialization_status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(occurrenceId, BASELINE_PROGRAM_ID, BASELINE_WORKSPACE_ID, null, JSON.stringify(row), "review", 0, now, now)];
    const materialized = await materializeBaselineRecord(env.DB, occurrenceId, row, 0, null, null, undefined, actor.id); const result = await env.DB.batch([...initial, ...materialized.statements]); const update = result[initial.length + materialized.updateIndex]; if (!update.success || Number(update.meta.changes ?? 0) !== 1) throw new Error("The new baseline record could not be materialized."); return Response.json({ occurrenceId, revision: 1, materializationStatus: materialized.status }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The baseline record could not be created." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try { const actor = await ensureActor(env.DB, request); requireWriter(actor); const body = await request.json() as { occurrenceId?: unknown; reason?: unknown }; const occurrenceId = String(body.occurrenceId || "").trim(); const reason = String(body.reason || "").trim(); if (!occurrenceId || !reason) return Response.json({ error: "Baseline record and a reason are required. Records are voided, not deleted." }, { status: 400 }); const before = await env.DB.prepare("SELECT lifecycle_status,lifecycle_reason,voided_at FROM baseline_occurrence WHERE id=? AND workspace_id=?").bind(occurrenceId, BASELINE_WORKSPACE_ID).first<Record<string, unknown>>(); if (!before) return Response.json({ error: "Baseline record was not found." }, { status: 404 }); const at = nowIso(); await env.DB.batch([env.DB.prepare("UPDATE baseline_occurrence SET lifecycle_status='voided',lifecycle_reason=?,voided_at=?,voided_by_user_id=?,revision=revision+1,updated_at=? WHERE id=? AND workspace_id=?").bind(reason, at, actor.id, at, occurrenceId, BASELINE_WORKSPACE_ID), audit(env.DB, actor, "baseline_record_voided", "baseline_occurrence", occurrenceId, { lifecycleStatus: "voided", reason }, before)]); return Response.json({ ok: true, occurrenceId }); }
  catch (error) { const message = error instanceof Error ? error.message : "Baseline record could not be voided."; return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 }); }
}
