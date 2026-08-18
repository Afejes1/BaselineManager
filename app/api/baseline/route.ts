import { env } from "cloudflare:workers";
import { TECHNICAL_BASELINE_COLUMNS, type TechnicalBaselineColumn } from "../../../lib/technical-baseline-contract";

type Cell = string | number | boolean | null | undefined;
type Record24 = Record<TechnicalBaselineColumn, Cell>;
type WorkspaceRow = {
  occurrence_id: string;
  source_row_id: string;
  revision: number;
  materialization_status: string;
  projection_payload: string;
  baseline_name: string | null;
  baseline_maturity: string | null;
  baseline_as_of: string | null;
  source_file_name: string | null;
  product_id: string | null;
};

const programId = "program-jsf";
const workspaceId = "workspace-jsf-current";
const nowIso = () => new Date().toISOString();
const cell = (value: Cell) => value == null ? null : String(value);
const normalized = (value: Cell) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const numberCell = (value: Cell) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function stableId(kind: string, ...parts: Cell[]) {
  const input = parts.map(normalized).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${kind}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function emptyRow(): Record24 {
  return Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, ""])) as Record24;
}

function asRecord24(value: unknown): Record24 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !TECHNICAL_BASELINE_COLUMNS.includes(key as TechnicalBaselineColumn))) return null;
  const row = emptyRow();
  for (const column of TECHNICAL_BASELINE_COLUMNS) {
    const current = candidate[column];
    if (current !== undefined && current !== null && typeof current !== "string" && typeof current !== "number" && typeof current !== "boolean") return null;
    row[column] = current as Cell;
  }
  return row;
}

function requiresReview(row: Record24) {
  return !normalized(row.ReleaseName) || (!normalized(row.LongName) && !normalized(row.ShortName) && !normalized(row.HW_Host));
}

type NodeStateRow = {
  source_row_id: string | null;
  storage_type: string | null;
  storage_gb: number | null;
  cpu_cores: number | null;
  ram_gb: number | null;
};
type DeploymentStateRow = {
  source_row_id: string | null;
  containerized: string | null;
  container_technology: string | null;
  container_type: string | null;
  language: string | null;
};
type PeerOccurrence = { projection_payload: string };

function nodeStateSignature(row: Record24) {
  return JSON.stringify([normalized(row.HW_Storage_Type), numberCell(row["HW_Storage (GB)"]), numberCell(row.HW_CPU_CORES), numberCell(row["HW_RAM (GB)"])]);
}

function deploymentStateSignature(row: Record24) {
  return JSON.stringify([normalized(row.Containerized), normalized(row["Container Technology"]), normalized(row["Container Type"]), normalized(row["SW Language"])]);
}

function readProjection(payload: string) {
  try {
    return asRecord24(JSON.parse(payload));
  } catch {
    return null;
  }
}

function sameNodeState(existing: NodeStateRow, row: Record24) {
  return normalized(existing.storage_type) === normalized(row.HW_Storage_Type)
    && existing.storage_gb === numberCell(row["HW_Storage (GB)"])
    && existing.cpu_cores === numberCell(row.HW_CPU_CORES)
    && existing.ram_gb === numberCell(row["HW_RAM (GB)"]);
}

function sameDeploymentState(existing: DeploymentStateRow, row: Record24) {
  return normalized(existing.containerized) === normalized(row.Containerized)
    && normalized(existing.container_technology) === normalized(row["Container Technology"])
    && normalized(existing.container_type) === normalized(row["Container Type"])
    && normalized(existing.language) === normalized(row["SW Language"]);
}

function materializationIds(row: Record24, mode: "working" | "reported", packageId?: string) {
  const releaseName = cell(row.ReleaseName) || "Unassigned";
  const releaseId = stableId("release", releaseName);
  const baselineId = mode === "working"
    ? stableId("baseline-working", workspaceId, releaseId)
    : stableId("baseline", releaseId, packageId || "reported");
  const tierName = cell(row.Tier) || "Unassigned";
  const resourceName = cell(row.Resource) || "Unassigned";
  const hostName = cell(row.HW_Host) || "Unassigned";
  const tierId = stableId("tier", tierName);
  const resourceId = stableId("resource", tierId, resourceName);
  const hostId = stableId("host", resourceId, hostName);
  const productName = cell(row.LongName) || cell(row.ShortName);
  const productId = productName ? stableId("product", productName) : null;
  const oem = cell(row.OEM);
  const organizationId = oem ? stableId("org", oem) : null;
  const deploymentId = productId ? stableId("deploy", productId, hostId) : null;
  const capabilityName = cell(row["Technical Capability Satisfied by this SW/Tech - Notes"]);
  const capabilityId = capabilityName ? stableId("capability", capabilityName) : null;
  return { releaseName, releaseId, baselineId, tierName, resourceName, hostName, tierId, resourceId, hostId, productName, productId, oem, organizationId, deploymentId, capabilityName, capabilityId };
}

function materializeCurrentRow(db: D1Database, row: Record24, sourceRowId: string, occurrenceId: string, revision: number, beforePayload: string | null, action: string, isNew = false) {
  const now = nowIso();
  const ids = materializationIds(row, "working");
  const status = requiresReview(row) ? "review" : "working";
  const baselineName = `${ids.releaseName} Working baseline`;
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(programId, "Joint Strike Fighter", "F-35 technical baseline program", "America/New_York", now, now),
    db.prepare("INSERT INTO release (id,program_id,code,normalized_code,name,normalized_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(ids.releaseId, programId, ids.releaseName, normalized(ids.releaseName), ids.releaseName, normalized(ids.releaseName), "working", now, now),
    db.prepare("INSERT INTO configuration_baseline (id,program_id,release_id,name,normalized_name,maturity,as_of,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET maturity=excluded.maturity,as_of=excluded.as_of,status=excluded.status,updated_at=excluded.updated_at").bind(ids.baselineId, programId, ids.releaseId, baselineName, normalized(baselineName), "working", now.slice(0, 10), "working", now, now),
    db.prepare("INSERT INTO configuration_node (id,program_id,parent_id,node_type,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(ids.tierId, programId, null, "tier", ids.tierName, normalized(ids.tierName), now, now),
    db.prepare("INSERT INTO configuration_node (id,program_id,parent_id,node_type,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(ids.resourceId, programId, ids.tierId, "resource", ids.resourceName, normalized(ids.resourceName), now, now),
    db.prepare("INSERT INTO configuration_node (id,program_id,parent_id,node_type,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(ids.hostId, programId, ids.resourceId, "host", ids.hostName, normalized(ids.hostName), now, now),
  ];

  if (ids.organizationId) statements.push(db.prepare("INSERT INTO organization (id,program_id,name,normalized_name,organization_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(ids.organizationId, programId, ids.oem, normalized(ids.oem), "supplier", now, now));
  if (ids.productId) {
    statements.push(db.prepare("INSERT INTO product (id,program_id,canonical_name,normalized_name,short_name,product_type,software_classification,owner_organization_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name,short_name=excluded.short_name,product_type=excluded.product_type,software_classification=excluded.software_classification,owner_organization_id=excluded.owner_organization_id,updated_at=excluded.updated_at").bind(ids.productId, programId, ids.productName, normalized(ids.productName), cell(row.ShortName), cell(row.TechStackType), cell(row["Software Type"]), ids.organizationId, now, now));
  }
  if (ids.productId && ids.organizationId) statements.push(db.prepare("INSERT INTO product_supplier (product_id,organization_id,supplier_role,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(product_id,organization_id,supplier_role) DO UPDATE SET updated_at=excluded.updated_at").bind(ids.productId, ids.organizationId, "supplier", now, now));
  if (ids.capabilityId) statements.push(db.prepare("INSERT INTO capability (id,program_id,parent_id,code,name,normalized_name,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,updated_at=excluded.updated_at").bind(ids.capabilityId, programId, null, null, ids.capabilityName, normalized(ids.capabilityName), "Governed from working baseline projection", now, now));
  if (ids.productId && ids.capabilityId) statements.push(db.prepare("INSERT INTO product_capability (product_id,capability_id,relationship,rationale,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(product_id,capability_id,relationship) DO UPDATE SET rationale=excluded.rationale,updated_at=excluded.updated_at").bind(ids.productId, ids.capabilityId, "satisfies", ids.capabilityName, now, now));
  if (ids.productId && ids.deploymentId) statements.push(db.prepare("INSERT INTO deployment (id,program_id,product_id,configuration_node_id,environment,site,deployment_role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET deployment_role=excluded.deployment_role,updated_at=excluded.updated_at").bind(ids.deploymentId, programId, ids.productId, ids.hostId, "unknown", "unknown", cell(row.TechStackType), now, now));

  statements.push(
    db.prepare("INSERT INTO baseline_node_state (id,program_id,baseline_id,configuration_node_id,source_row_id,storage_type,storage_gb,cpu_cores,ram_gb,state_notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_id,configuration_node_id) DO UPDATE SET source_row_id=excluded.source_row_id,storage_type=excluded.storage_type,storage_gb=excluded.storage_gb,cpu_cores=excluded.cpu_cores,ram_gb=excluded.ram_gb,updated_at=excluded.updated_at").bind(stableId("node-state", ids.baselineId, ids.hostId), programId, ids.baselineId, ids.hostId, sourceRowId, cell(row.HW_Storage_Type), numberCell(row["HW_Storage (GB)"]), numberCell(row.HW_CPU_CORES), numberCell(row["HW_RAM (GB)"]), null, now, now),
  );
  if (ids.deploymentId) statements.push(db.prepare("INSERT INTO baseline_deployment_state (id,program_id,baseline_id,deployment_id,source_row_id,presence,status,containerized,container_technology,container_type,language,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_id,deployment_id) DO UPDATE SET source_row_id=excluded.source_row_id,containerized=excluded.containerized,container_technology=excluded.container_technology,container_type=excluded.container_type,language=excluded.language,updated_at=excluded.updated_at").bind(stableId("deploy-state", ids.baselineId, ids.deploymentId), programId, ids.baselineId, ids.deploymentId, sourceRowId, "present", status, cell(row.Containerized), cell(row["Container Technology"]), cell(row["Container Type"]), cell(row["SW Language"]), null, now, now));

  if (isNew) {
    statements.push(db.prepare("INSERT INTO source_row_24 (id,source_package_id,source_key,row_number,row_hash,raw_payload,release_name,tier,resource,tech_stack_type,short_name,hw_host,hw_storage_type,hw_storage_gb,hw_cpu_cores,hw_ram_gb,sw_language,software_type,oem,containerized,container_technology,container_type,long_name,notes,capability_notes,notes_1,notes_2,notes_3,notes_4,release_id,baseline_id,configuration_node_id,product_id,deployment_id,materialization_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(sourceRowId, "manual-package-pending", cell(row["#"]), 0, stableId("hash", JSON.stringify(row)), JSON.stringify(row), cell(row.ReleaseName), cell(row.Tier), cell(row.Resource), cell(row.TechStackType), cell(row.ShortName), cell(row.HW_Host), cell(row.HW_Storage_Type), cell(row["HW_Storage (GB)"]), cell(row.HW_CPU_CORES), cell(row["HW_RAM (GB)"]), cell(row["SW Language"]), cell(row["Software Type"]), cell(row.OEM), cell(row.Containerized), cell(row["Container Technology"]), cell(row["Container Type"]), cell(row.LongName), cell(row.Notes), cell(row["Technical Capability Satisfied by this SW/Tech - Notes"]), cell(row["Notes.1"]), cell(row["Notes.2"]), cell(row["Notes.3"]), cell(row["Notes.4"]), ids.releaseId, ids.baselineId, ids.hostId, ids.productId, ids.deploymentId, status, now, now));
  } else {
    statements.push(db.prepare("UPDATE source_row_24 SET release_id=?,baseline_id=?,configuration_node_id=?,product_id=?,deployment_id=?,materialization_status=?,updated_at=? WHERE id=?").bind(ids.releaseId, ids.baselineId, ids.hostId, ids.productId, ids.deploymentId, status, now, sourceRowId));
  }
  statements.push(
    db.prepare("UPDATE baseline_occurrence SET release_id=?,baseline_id=?,configuration_node_id=?,product_id=?,deployment_id=?,projection_payload=?,materialization_status=?,revision=?,updated_at=? WHERE id=? AND revision=?").bind(ids.releaseId, ids.baselineId, ids.hostId, ids.productId, ids.deploymentId, JSON.stringify(row), status, revision + 1, now, occurrenceId, revision),
    db.prepare("INSERT INTO audit_event (id,program_id,action,entity_kind,entity_id,before_payload,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), programId, action, "baseline_occurrence", occurrenceId, beforePayload, JSON.stringify(row), now),
  );
  return { statements, ids, now, status };
}

function toResponse(rows: WorkspaceRow[]) {
  const records = rows.map((entry) => ({
    occurrenceId: entry.occurrence_id,
    sourceRowId: entry.source_row_id,
    revision: entry.revision,
    materializationStatus: entry.materialization_status,
    baseline: { name: entry.baseline_name, maturity: entry.baseline_maturity, asOf: entry.baseline_as_of },
    source: { fileName: entry.source_file_name },
    productId: entry.product_id,
    row: asRecord24(JSON.parse(entry.projection_payload)),
  })).filter((entry) => entry.row);
  return { workspace: { id: workspaceId, label: "Current Government working baseline" }, records };
}

export async function GET() {
  try {
    const result = await env.DB.prepare("SELECT bo.id AS occurrence_id, bo.source_row_id, bo.revision, bo.materialization_status, bo.projection_payload, cb.name AS baseline_name, cb.maturity AS baseline_maturity, cb.as_of AS baseline_as_of, sp.file_name AS source_file_name, bo.product_id FROM baseline_occurrence bo LEFT JOIN configuration_baseline cb ON cb.id = bo.baseline_id JOIN source_row_24 sr ON sr.id = bo.source_row_id JOIN source_package sp ON sp.id = sr.source_package_id WHERE bo.workspace_id = ? ORDER BY bo.created_at ASC").bind(workspaceId).all<WorkspaceRow>();
    return Response.json(toResponse(result.results));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The authoritative baseline workspace is unavailable." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { occurrenceId?: unknown; expectedRevision?: unknown; row?: unknown };
    const occurrenceId = String(body.occurrenceId ?? "").trim();
    const revision = Number(body.expectedRevision);
    const row = asRecord24(body.row);
    if (!occurrenceId || !Number.isInteger(revision) || !row) return Response.json({ error: "occurrenceId, expectedRevision, and the exact 24-column projection are required." }, { status: 400 });
    const current = await env.DB.prepare("SELECT id,source_row_id,revision,projection_payload FROM baseline_occurrence WHERE id=? AND workspace_id=?").bind(occurrenceId, workspaceId).first<{ id: string; source_row_id: string; revision: number; projection_payload: string }>();
    if (!current) return Response.json({ error: "The selected source occurrence is no longer in the current workspace." }, { status: 404 });
    if (current.revision !== revision) return Response.json({ error: "This record changed elsewhere. Reload the workspace before saving again." }, { status: 409 });
    const ids = materializationIds(row, "working");
    const nodePeers = await env.DB.prepare("SELECT projection_payload FROM baseline_occurrence WHERE workspace_id=? AND id<>? AND baseline_id=? AND configuration_node_id=?").bind(workspaceId, current.id, ids.baselineId, ids.hostId).all<PeerOccurrence>();
    if (nodePeers.results.some((peer) => {
      const peerRow = readProjection(peer.projection_payload);
      return peerRow !== null && nodeStateSignature(peerRow) !== nodeStateSignature(row);
    })) {
      return Response.json({ error: "This edit conflicts with another source occurrence's reported hardware state at the same release configuration node. Resolve the two source rows before changing the canonical node state." }, { status: 409 });
    }
    const existingNodeState = await env.DB.prepare("SELECT source_row_id,storage_type,storage_gb,cpu_cores,ram_gb FROM baseline_node_state WHERE baseline_id=? AND configuration_node_id=?").bind(ids.baselineId, ids.hostId).first<NodeStateRow>();
    if (existingNodeState && existingNodeState.source_row_id !== current.source_row_id && !sameNodeState(existingNodeState, row)) {
      return Response.json({ error: "This edit conflicts with a different source occurrence's reported hardware state at the same release configuration node. Resolve the two source rows before changing the canonical node state." }, { status: 409 });
    }
    if (ids.deploymentId) {
      const deploymentPeers = await env.DB.prepare("SELECT projection_payload FROM baseline_occurrence WHERE workspace_id=? AND id<>? AND baseline_id=? AND deployment_id=?").bind(workspaceId, current.id, ids.baselineId, ids.deploymentId).all<PeerOccurrence>();
      if (deploymentPeers.results.some((peer) => {
        const peerRow = readProjection(peer.projection_payload);
        return peerRow !== null && deploymentStateSignature(peerRow) !== deploymentStateSignature(row);
      })) {
        return Response.json({ error: "This edit conflicts with another source occurrence's reported runtime state at the same release deployment. Resolve the two source rows before changing the canonical deployment state." }, { status: 409 });
      }
      const existingDeploymentState = await env.DB.prepare("SELECT source_row_id,containerized,container_technology,container_type,language FROM baseline_deployment_state WHERE baseline_id=? AND deployment_id=?").bind(ids.baselineId, ids.deploymentId).first<DeploymentStateRow>();
      if (existingDeploymentState && existingDeploymentState.source_row_id !== current.source_row_id && !sameDeploymentState(existingDeploymentState, row)) {
        return Response.json({ error: "This edit conflicts with a different source occurrence's reported runtime state at the same release deployment. Resolve the two source rows before changing the canonical deployment state." }, { status: 409 });
      }
    }
    const materialized = materializeCurrentRow(env.DB, row, current.source_row_id, current.id, revision, current.projection_payload, "baseline_occurrence_updated");
    const result = await env.DB.batch(materialized.statements);
    const update = result[result.length - 2];
    if (!update.success || Number(update.meta.changes ?? 0) !== 1) return Response.json({ error: "This record changed elsewhere. Reload the workspace before saving again." }, { status: 409 });
    return Response.json({ occurrenceId, revision: revision + 1, materializationStatus: materialized.status, baseline: { name: `${materialized.ids.releaseName} Working baseline`, maturity: "working", asOf: materialized.now.slice(0, 10) } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The source occurrence could not be saved." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { row?: unknown };
    const row = asRecord24(body.row);
    if (!row || !normalized(row.ReleaseName)) return Response.json({ error: "Choose ReleaseName before creating a source occurrence." }, { status: 400 });
    const now = nowIso();
    const sourcePackageId = `manual-${crypto.randomUUID()}`;
    const sourceRowId = `source-row-${crypto.randomUUID()}`;
    const occurrenceId = `occurrence-${crypto.randomUUID()}`;
    const initial = [
      env.DB.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(programId, "Joint Strike Fighter", "F-35 technical baseline program", "America/New_York", now, now),
      env.DB.prepare("INSERT INTO baseline_workspace (id,program_id,label,active_import_package_id,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(workspaceId, programId, "Current Government working baseline", sourcePackageId, now, now),
      env.DB.prepare("INSERT INTO source_package (id,program_id,source_system,file_name,sheet_name,content_hash,received_at,status,row_count,accepted_count,exception_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(sourcePackageId, programId, "baseline-manager-entry", "Government working-baseline entry", null, stableId("hash", sourceRowId), now, "working", 1, 0, 1, now, now),
      env.DB.prepare("INSERT INTO source_row_24 (id,source_package_id,source_key,row_number,row_hash,raw_payload,materialization_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(sourceRowId, sourcePackageId, cell(row["#"]), 1, stableId("hash", JSON.stringify(row)), JSON.stringify(row), "review", now, now),
      env.DB.prepare("INSERT INTO baseline_occurrence (id,program_id,workspace_id,source_row_id,projection_payload,materialization_status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(occurrenceId, programId, workspaceId, sourceRowId, JSON.stringify(row), "review", 0, now, now),
    ];
    const materialized = materializeCurrentRow(env.DB, row, sourceRowId, occurrenceId, 0, null, "baseline_occurrence_created");
    const result = await env.DB.batch([...initial, ...materialized.statements]);
    const update = result[result.length - 2];
    if (!update.success || Number(update.meta.changes ?? 0) !== 1) throw new Error("The new source occurrence could not be materialized.");
    return Response.json({ occurrenceId, revision: 1, materializationStatus: materialized.status }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The source occurrence could not be created." }, { status: 500 });
  }
}
