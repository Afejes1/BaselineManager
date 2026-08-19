import { env } from "cloudflare:workers";
import { TECHNICAL_BASELINE_COLUMNS } from "../../../../lib/technical-baseline-contract";

type Cell = string | number | boolean | null | undefined;
type IncomingRow = Record<string, Cell>;

const nowIso = () => new Date().toISOString();
const cell = (value: Cell) => value == null ? null : String(value);
const normalized = (value: Cell) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
const numberCell = (value: Cell) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const programId = "program-jsf";
const workspaceId = "workspace-jsf-current";
function stableId(kind: string, ...parts: Cell[]) {
  const input = parts.map(normalized).join("|"); let hash = 2166136261;
  for (let index=0; index<input.length; index++) { hash ^= input.charCodeAt(index); hash = Math.imul(hash,16777619); }
  return `${kind}-${(hash>>>0).toString(16).padStart(8,"0")}`;
}
function isReview(row: IncomingRow) { return !normalized(row.ReleaseName) || (!normalized(row.LongName) && !normalized(row.ShortName) && !normalized(row.HW_Host)); }

function nodeStateSignature(row: IncomingRow) {
  return JSON.stringify([normalized(row.HW_Storage_Type), numberCell(row["HW_Storage (GB)"]), numberCell(row.HW_CPU_CORES), numberCell(row["HW_RAM (GB)"])]);
}

function deploymentStateSignature(row: IncomingRow) {
  return JSON.stringify([normalized(row.Containerized), normalized(row["Container Technology"]), normalized(row["Container Type"]), normalized(row["SW Language"])]);
}

export async function GET() {
  try {
    const result = await env.DB.prepare("SELECT raw_payload FROM source_row_24 ORDER BY updated_at DESC, row_number ASC LIMIT 5000").all<{raw_payload:string}>();
    return Response.json({ rows: result.results.map((row) => JSON.parse(row.raw_payload)) });
  } catch (error) {
    return Response.json({ rows: [], error: error instanceof Error ? error.message : "Baseline storage is unavailable." }, { status:500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { fileName?:string; sheetName?:string; rows?:IncomingRow[] };
    if (!body.fileName || !Array.isArray(body.rows)) return Response.json({ error:"fileName and rows are required" }, { status:400 });
    for (const row of body.rows) {
      const keys = Object.keys(row);
      if (keys.length !== 24 || TECHNICAL_BASELINE_COLUMNS.some((column,index) => keys[index] !== column)) return Response.json({ error:"Every A2O Tech Stack row must preserve the approved column contract." }, { status:400 });
    }

    const db = env.DB;
    const now = nowIso();
    const asOf = now.slice(0,10);
    const packageFingerprint = JSON.stringify(body.rows);
    const packageId = stableId("pkg", body.fileName, packageFingerprint);
    // A node/deployment has one canonical state per reported baseline. When the
    // denormalized workbook contains incompatible claims, retain every source
    // occurrence but do not let whichever row happens to be processed last
    // silently overwrite the canonical state.
    const conflictingNodeRows = new Set<number>();
    const conflictingDeploymentRows = new Set<number>();
    const conflictingNodeKeys = new Set<string>();
    const conflictingDeploymentKeys = new Set<string>();
    const nodeClaims = new Map<string, { rowIndex: number; signature: string }>();
    const deploymentClaims = new Map<string, { rowIndex: number; signature: string }>();
    body.rows.forEach((row, rowIndex) => {
      const releaseId = stableId("release", cell(row.ReleaseName) || "Unassigned");
      const baselineId = stableId("baseline-working", workspaceId, releaseId);
      const tierId = stableId("tier", cell(row.Tier) || "Unassigned");
      const resourceId = stableId("resource", tierId, cell(row.Resource) || "Unassigned");
      const hostId = stableId("host", resourceId, cell(row.HW_Host) || "Unassigned");
      const nodeKey = `${baselineId}:${hostId}`;
      const existingNode = nodeClaims.get(nodeKey);
      const nodeSignature = nodeStateSignature(row);
      if (existingNode && existingNode.signature !== nodeSignature) {
        conflictingNodeKeys.add(nodeKey);
        conflictingNodeRows.add(existingNode.rowIndex);
        conflictingNodeRows.add(rowIndex);
      } else if (!existingNode) {
        nodeClaims.set(nodeKey, { rowIndex, signature: nodeSignature });
      }

      const productName = cell(row.LongName) || cell(row.ShortName);
      if (!productName) return;
      const productId = stableId("product", productName);
      const deploymentId = stableId("deploy", productId, hostId);
      const deploymentKey = `${baselineId}:${deploymentId}`;
      const existingDeployment = deploymentClaims.get(deploymentKey);
      const deploymentSignature = deploymentStateSignature(row);
      if (existingDeployment && existingDeployment.signature !== deploymentSignature) {
        conflictingDeploymentKeys.add(deploymentKey);
        conflictingDeploymentRows.add(existingDeployment.rowIndex);
        conflictingDeploymentRows.add(rowIndex);
      } else if (!existingDeployment) {
        deploymentClaims.set(deploymentKey, { rowIndex, signature: deploymentSignature });
      }
    });
    // Mark every occurrence at a conflicted canonical position. A later row may
    // happen to match the first claim, but the source set is still unresolved.
    body.rows.forEach((row, rowIndex) => {
      const releaseId = stableId("release", cell(row.ReleaseName) || "Unassigned");
      const baselineId = stableId("baseline-working", workspaceId, releaseId);
      const tierId = stableId("tier", cell(row.Tier) || "Unassigned");
      const resourceId = stableId("resource", tierId, cell(row.Resource) || "Unassigned");
      const hostId = stableId("host", resourceId, cell(row.HW_Host) || "Unassigned");
      if (conflictingNodeKeys.has(`${baselineId}:${hostId}`)) conflictingNodeRows.add(rowIndex);
      const productName = cell(row.LongName) || cell(row.ShortName);
      if (!productName) return;
      const deploymentId = stableId("deploy", stableId("product", productName), hostId);
      if (conflictingDeploymentKeys.has(`${baselineId}:${deploymentId}`)) conflictingDeploymentRows.add(rowIndex);
    });
    const materializationStatusFor = (row: IncomingRow, rowIndex: number) => {
      if (conflictingNodeRows.has(rowIndex) || conflictingDeploymentRows.has(rowIndex)) return "conflict";
      return isReview(row) ? "review" : "materialized";
    };
    const statements: D1PreparedStatement[] = [];
    const seen = new Set<string>();
    const add = (key:string, sql:string, ...params:unknown[]) => { if (!seen.has(key)) { seen.add(key); statements.push(db.prepare(sql).bind(...params)); } };

    add("program", "INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at", programId,"Joint Strike Fighter","F-35 technical baseline program","America/New_York",now,now);
    const acceptedCount = body.rows.filter((row, rowIndex) => materializationStatusFor(row, rowIndex) === "materialized").length;
    add("package", "INSERT INTO source_package (id,program_id,source_system,file_name,sheet_name,content_hash,received_at,status,row_count,accepted_count,exception_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET received_at=excluded.received_at,status=excluded.status,row_count=excluded.row_count,accepted_count=excluded.accepted_count,exception_count=excluded.exception_count,updated_at=excluded.updated_at", packageId,programId,"24-column-xlsx",body.fileName,body.sheetName??null,stableId("hash",packageFingerprint),now,acceptedCount === body.rows.length ? "materialized" : "materialized_with_exceptions",body.rows.length,acceptedCount,body.rows.length-acceptedCount,now,now);
    add("workspace", "INSERT INTO baseline_workspace (id,program_id,label,active_import_package_id,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active_import_package_id=excluded.active_import_package_id,updated_at=excluded.updated_at", workspaceId,programId,"Current Government working baseline",packageId,now,now);
    // The current workspace is a projection. Earlier source packages and rows
    // stay intact; only their current working projection is replaced.
    // Deployment extensions refer to the working projection's occurrences.
    // Remove those release-scoped enrichments before replacing the projection;
    // otherwise a valid next import would be blocked by the foreign-key link.
    statements.push(db.prepare("DELETE FROM managed_deployment_profile WHERE baseline_occurrence_id IN (SELECT id FROM baseline_occurrence WHERE workspace_id = ?)").bind(workspaceId));
    // Change effects may cite a working occurrence as supporting evidence. The
    // analytical effect survives a new import, but its ephemeral projection
    // pointer is cleared before the old occurrence is replaced.
    statements.push(db.prepare("UPDATE change_effect SET source_occurrence_id=NULL WHERE source_occurrence_id IN (SELECT id FROM baseline_occurrence WHERE workspace_id = ?)").bind(workspaceId));
    // Synthetic topology is a companion to the demo source package, never a
    // claim about a subsequently imported stakeholder workbook.
    statements.push(db.prepare("DELETE FROM managed_host_profile WHERE source_reference='Synthetic demo enrichment'"));
    // Demo-only governed extensions must never leak into a subsequently loaded
    // stakeholder workbook. A fresh demo import recreates them immediately in
    // /api/demo after source materialization.
    statements.push(db.prepare("DELETE FROM work_package_dependency WHERE predecessor_work_package_id IN (SELECT id FROM work_package WHERE initiative_id LIKE 'demo-initiative-%' OR objective_id LIKE 'demo-objective-%') OR successor_work_package_id IN (SELECT id FROM work_package WHERE initiative_id LIKE 'demo-initiative-%' OR objective_id LIKE 'demo-objective-%')"));
    statements.push(db.prepare("DELETE FROM work_package WHERE initiative_id LIKE 'demo-initiative-%' OR objective_id LIKE 'demo-objective-%'"));
    statements.push(db.prepare("DELETE FROM objective_effect_attribution WHERE objective_id LIKE 'demo-objective-%'"));
    statements.push(db.prepare("DELETE FROM change_request_objective_dependency WHERE prerequisite_objective_id LIKE 'demo-objective-%' OR dependent_change_request_id LIKE 'demo-change-%'"));
    statements.push(db.prepare("DELETE FROM acceptance_signoff WHERE criterion_id IN (SELECT id FROM acceptance_criterion WHERE objective_id LIKE 'demo-objective-%')"));
    statements.push(db.prepare("DELETE FROM acceptance_criterion WHERE objective_id LIKE 'demo-objective-%'"));
    statements.push(db.prepare("DELETE FROM requirement_trace WHERE objective_id LIKE 'demo-objective-%'"));
    statements.push(db.prepare("DELETE FROM objective_estimate WHERE objective_id LIKE 'demo-objective-%'"));
    statements.push(db.prepare("DELETE FROM objective_source_row WHERE objective_id LIKE 'demo-objective-%'"));
    statements.push(db.prepare("DELETE FROM objective_source_package WHERE external_system='Synthetic incumbent objective register' AND NOT EXISTS (SELECT 1 FROM objective_source_row WHERE objective_source_row.source_package_id=objective_source_package.id)"));
    statements.push(db.prepare("DELETE FROM initiative_milestone WHERE initiative_id LIKE 'demo-initiative-%'"));
    statements.push(db.prepare("DELETE FROM incumbent_objective WHERE id LIKE 'demo-objective-%'"));
    statements.push(db.prepare("DELETE FROM initiative_change_request WHERE initiative_id LIKE 'demo-initiative-%'"));
    statements.push(db.prepare("DELETE FROM brief_publication WHERE brief_id IN (SELECT id FROM executive_brief WHERE initiative_id LIKE 'demo-initiative-%')"));
    statements.push(db.prepare("DELETE FROM executive_brief WHERE initiative_id LIKE 'demo-initiative-%'"));
    statements.push(db.prepare("DELETE FROM evidence_document WHERE initiative_id LIKE 'demo-initiative-%'"));
    statements.push(db.prepare("DELETE FROM work_package WHERE initiative_id LIKE 'demo-initiative-%'"));
    statements.push(db.prepare("DELETE FROM initiative_scope WHERE initiative_id LIKE 'demo-initiative-%'"));
    statements.push(db.prepare("DELETE FROM initiative WHERE id LIKE 'demo-initiative-%'"));
    statements.push(db.prepare("DELETE FROM change_dependency WHERE predecessor_request_id LIKE 'demo-change-%' OR successor_request_id LIKE 'demo-change-%'"));
    statements.push(db.prepare("DELETE FROM change_effect WHERE change_request_id LIKE 'demo-change-%'"));
    statements.push(db.prepare("DELETE FROM change_request WHERE id LIKE 'demo-change-%'"));
    statements.push(db.prepare("DELETE FROM platform_organization WHERE platform_id LIKE 'demo-platform-%'"));
    statements.push(db.prepare("DELETE FROM platform WHERE id LIKE 'demo-platform-%'"));
    statements.push(db.prepare("DELETE FROM release_profile WHERE id LIKE 'demo-release-profile-%'"));
    statements.push(db.prepare("DELETE FROM governance_record_link WHERE governance_record_id LIKE 'demo-record-%'"));
    statements.push(db.prepare("DELETE FROM governance_record WHERE id LIKE 'demo-record-%'"));
    statements.push(db.prepare("DELETE FROM baseline_occurrence WHERE workspace_id = ?").bind(workspaceId));
    statements.push(db.prepare("DELETE FROM baseline_node_state WHERE baseline_id IN (SELECT id FROM configuration_baseline WHERE program_id=? AND maturity='working')").bind(programId));
    statements.push(db.prepare("DELETE FROM baseline_deployment_state WHERE baseline_id IN (SELECT id FROM configuration_baseline WHERE program_id=? AND maturity='working')").bind(programId));

    body.rows.forEach((row,rowIndex) => {
      const releaseName = cell(row.ReleaseName) || "Unassigned";
      const releaseId = stableId("release",releaseName);
      const reportedBaselineId = stableId("baseline",releaseId,packageId);
      const workingBaselineId = stableId("baseline-working",workspaceId,releaseId);
      const tierName = cell(row.Tier) || "Unassigned";
      const resourceName = cell(row.Resource) || "Unassigned";
      const hostName = cell(row.HW_Host) || "Unassigned";
      const tierId = stableId("tier",tierName);
      const resourceId = stableId("resource",tierId,resourceName);
      const hostId = stableId("host",resourceId,hostName);
      const productName = cell(row.LongName) || cell(row.ShortName);
      const productId = productName ? stableId("product",productName) : null;
      const oem = cell(row.OEM);
      const orgId = oem ? stableId("org",oem) : null;
      const deploymentId = productId ? stableId("deploy",productId,hostId) : null;
      const sourceRowId = stableId("row",packageId,rowIndex+2);

      add(`release:${releaseId}`, "INSERT INTO release (id,program_id,code,normalized_code,name,normalized_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at", releaseId,programId,releaseName,normalized(releaseName),releaseName,normalized(releaseName),"reported",now,now);
      const baselineName = `${releaseName} Reported ${packageId.slice(-8)}`;
      add(`baseline:${reportedBaselineId}`, "INSERT INTO configuration_baseline (id,program_id,release_id,name,normalized_name,maturity,as_of,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at", reportedBaselineId,programId,releaseId,baselineName,normalized(baselineName),"reported",asOf,"reported",now,now);
      const workingBaselineName = `${releaseName} Working baseline`;
      add(`baseline:${workingBaselineId}`, "INSERT INTO configuration_baseline (id,program_id,release_id,name,normalized_name,maturity,as_of,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET as_of=excluded.as_of,status=excluded.status,updated_at=excluded.updated_at", workingBaselineId,programId,releaseId,workingBaselineName,normalized(workingBaselineName),"working",asOf,"working",now,now);
      if (orgId) add(`org:${orgId}`, "INSERT INTO organization (id,program_id,name,normalized_name,organization_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at", orgId,programId,oem,normalized(oem),"supplier",now,now);
      add(`node:${tierId}`, "INSERT INTO configuration_node (id,program_id,parent_id,node_type,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at", tierId,programId,null,"tier",tierName,normalized(tierName),now,now);
      add(`node:${resourceId}`, "INSERT INTO configuration_node (id,program_id,parent_id,node_type,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at", resourceId,programId,tierId,"resource",resourceName,normalized(resourceName),now,now);
      add(`node:${hostId}`, "INSERT INTO configuration_node (id,program_id,parent_id,node_type,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at", hostId,programId,resourceId,"host",hostName,normalized(hostName),now,now);
      if (productId) add(`product:${productId}`, "INSERT INTO product (id,program_id,canonical_name,normalized_name,short_name,product_type,software_classification,owner_organization_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name,short_name=excluded.short_name,product_type=excluded.product_type,software_classification=excluded.software_classification,owner_organization_id=excluded.owner_organization_id,updated_at=excluded.updated_at", productId,programId,productName,normalized(productName),cell(row.ShortName),cell(row.TechStackType),cell(row["Software Type"]),orgId,now,now);
      if (productId && orgId) add(`supplier:${productId}:${orgId}`, "INSERT INTO product_supplier (product_id,organization_id,supplier_role,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(product_id,organization_id,supplier_role) DO UPDATE SET updated_at=excluded.updated_at", productId,orgId,"supplier",now,now);
      const capabilityName = cell(row["Technical Capability Satisfied by this SW/Tech - Notes"]);
      const capabilityId = capabilityName ? stableId("capability",capabilityName) : null;
      if (capabilityId) add(`capability:${capabilityId}`, "INSERT INTO capability (id,program_id,parent_id,code,name,normalized_name,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,updated_at=excluded.updated_at", capabilityId,programId,null,null,capabilityName,normalized(capabilityName),"Reported source capability text",now,now);
      if (productId && capabilityId) add(`product-capability:${productId}:${capabilityId}`, "INSERT INTO product_capability (product_id,capability_id,relationship,rationale,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(product_id,capability_id,relationship) DO UPDATE SET rationale=excluded.rationale,updated_at=excluded.updated_at", productId,capabilityId,"satisfies",capabilityName,now,now);
      if (deploymentId && productId) add(`deployment:${deploymentId}`, "INSERT INTO deployment (id,program_id,product_id,configuration_node_id,environment,site,deployment_role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET deployment_role=excluded.deployment_role,updated_at=excluded.updated_at", deploymentId,programId,productId,hostId,"unknown","unknown",cell(row.TechStackType),now,now);
      const materializationStatus = materializationStatusFor(row, rowIndex);
      statements.push(db.prepare("INSERT INTO source_row_24 (id,source_package_id,source_key,row_number,row_hash,raw_payload,release_name,tier,resource,tech_stack_type,short_name,hw_host,hw_storage_type,hw_storage_gb,hw_cpu_cores,hw_ram_gb,sw_language,software_type,oem,containerized,container_technology,container_type,long_name,notes,capability_notes,notes_1,notes_2,notes_3,notes_4,release_id,baseline_id,configuration_node_id,product_id,deployment_id,materialization_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET raw_payload=excluded.raw_payload,materialization_status=excluded.materialization_status,updated_at=excluded.updated_at").bind(sourceRowId,packageId,cell(row["#"]),rowIndex+2,stableId("hash",JSON.stringify(row)),JSON.stringify(row),cell(row.ReleaseName),cell(row.Tier),cell(row.Resource),cell(row.TechStackType),cell(row.ShortName),cell(row.HW_Host),cell(row.HW_Storage_Type),cell(row["HW_Storage (GB)"]),cell(row.HW_CPU_CORES),cell(row["HW_RAM (GB)"]),cell(row["SW Language"]),cell(row["Software Type"]),oem,cell(row.Containerized),cell(row["Container Technology"]),cell(row["Container Type"]),cell(row.LongName),cell(row.Notes),cell(row["Technical Capability Satisfied by this SW/Tech - Notes"]),cell(row["Notes.1"]),cell(row["Notes.2"]),cell(row["Notes.3"]),cell(row["Notes.4"]),releaseId,reportedBaselineId,hostId,productId,deploymentId,materializationStatus,now,now));
      statements.push(db.prepare("INSERT INTO baseline_occurrence (id,program_id,workspace_id,source_row_id,release_id,baseline_id,configuration_node_id,product_id,deployment_id,projection_payload,materialization_status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,source_row_id) DO UPDATE SET release_id=excluded.release_id,baseline_id=excluded.baseline_id,configuration_node_id=excluded.configuration_node_id,product_id=excluded.product_id,deployment_id=excluded.deployment_id,projection_payload=excluded.projection_payload,materialization_status=excluded.materialization_status,revision=excluded.revision,updated_at=excluded.updated_at").bind(stableId("occurrence",workspaceId,sourceRowId),programId,workspaceId,sourceRowId,releaseId,workingBaselineId,hostId,productId,deploymentId,JSON.stringify(row),materializationStatus,0,now,now));
      if (!conflictingNodeRows.has(rowIndex)) {
        for (const baselineId of [reportedBaselineId, workingBaselineId]) add(`node-state:${baselineId}:${hostId}`, "INSERT INTO baseline_node_state (id,program_id,baseline_id,configuration_node_id,source_row_id,storage_type,storage_gb,cpu_cores,ram_gb,state_notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_row_id=excluded.source_row_id,storage_type=excluded.storage_type,storage_gb=excluded.storage_gb,cpu_cores=excluded.cpu_cores,ram_gb=excluded.ram_gb,updated_at=excluded.updated_at", stableId("node-state",baselineId,hostId),programId,baselineId,hostId,sourceRowId,cell(row.HW_Storage_Type),numberCell(row["HW_Storage (GB)"]),numberCell(row.HW_CPU_CORES),numberCell(row["HW_RAM (GB)"]),null,now,now);
      }
      if (deploymentId && !conflictingDeploymentRows.has(rowIndex)) {
        for (const baselineId of [reportedBaselineId, workingBaselineId]) add(`deploy-state:${baselineId}:${deploymentId}`, "INSERT INTO baseline_deployment_state (id,program_id,baseline_id,deployment_id,source_row_id,presence,status,containerized,container_technology,container_type,language,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_row_id=excluded.source_row_id,containerized=excluded.containerized,container_technology=excluded.container_technology,container_type=excluded.container_type,language=excluded.language,updated_at=excluded.updated_at", stableId("deploy-state",baselineId,deploymentId),programId,baselineId,deploymentId,sourceRowId,"present",materializationStatus === "review" ? "review" : "reported",cell(row.Containerized),cell(row["Container Technology"]),cell(row["Container Type"]),cell(row["SW Language"]),null,now,now);
      }
    });
    statements.push(db.prepare("INSERT INTO audit_event (id,program_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),programId,"import_materialized","source_package",packageId,JSON.stringify({fileName:body.fileName,rowCount:body.rows.length,workspaceId}),now));
    await db.batch(statements);
    return Response.json({ packageId, rows:body.rows.length, normalized:true }, { status:201 });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Import failed without changing the baseline." }, { status:500 });
  }
}
