import { env } from "cloudflare:workers";
import { audit, PROGRAM_ID, requireWriter } from "./governance-server";
import type { AuditEntry, MasterDataPortfolio, MasterEntityKind, ReleaseStage, ReleaseStateRole } from "./master-data-model";

type Database = typeof env.DB;
type Actor = { id: string; displayName: string; role: "viewer" | "editor" | "steward" };

const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;
const normalized = (value: unknown) => clean(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const releaseStageSet = new Set<ReleaseStage>(["proposed", "planned", "in_development", "integration", "test", "fielding", "operational", "superseded", "cancelled"]);
const releaseRoleSet = new Set<ReleaseStateRole>(["historical", "as_is", "to_be", "reported"]);
const milestoneStatusSet = new Set(["planned", "at_risk", "complete", "cancelled"]);

export async function masterDataPortfolio(db: Database): Promise<MasterDataPortfolio> {
  const [releases, milestones, configurationSets, products, organizations, capabilities, configurationNodes] = await Promise.all([
    db.prepare(`SELECT r.id,r.code,r.name,r.status,r.description,r.owner,r.predecessor_release_id AS predecessorReleaseId,r.target_date AS targetDate,r.actual_date AS actualDate,r.source_reference AS sourceReference,r.source_as_of AS sourceAsOf,COALESCE(rp.state_role,'reported') AS stateRole,rp.effective_date AS effectiveDate,rp.description AS profileDescription,COUNT(DISTINCT CASE WHEN bo.lifecycle_status='active' THEN bo.id END) AS baselineRecordCount,COUNT(DISTINCT CASE WHEN bo.lifecycle_status='active' THEN bo.product_id END) AS productCount,r.updated_at AS updatedAt FROM release r LEFT JOIN release_profile rp ON rp.release_id=r.id LEFT JOIN baseline_occurrence bo ON bo.release_id=r.id AND bo.workspace_id='workspace-jsf-current' WHERE r.program_id=? GROUP BY r.id ORDER BY COALESCE(r.target_date,r.actual_date,'9999-12-31'),r.name`).bind(PROGRAM_ID).all(),
    db.prepare(`SELECT id,release_id AS releaseId,milestone_type AS milestoneType,title,status,planned_date AS plannedDate,forecast_date AS forecastDate,actual_date AS actualDate,owner,source_reference AS sourceReference,source_as_of AS sourceAsOf,notes,updated_at AS updatedAt FROM release_milestone WHERE program_id=? ORDER BY COALESCE(planned_date,forecast_date,actual_date,'9999-12-31'),title`).bind(PROGRAM_ID).all(),
    db.prepare(`SELECT cb.id,cb.release_id AS releaseId,cb.name,cb.revision_number AS revisionNumber,cb.approval_status AS approvalStatus,cb.as_of AS asOf,cb.description,cb.approved_at AS approvedAt,cb.locked_at AS lockedAt,COUNT(DISTINCT CASE WHEN bo.lifecycle_status='active' THEN bo.id END) AS baselineRecordCount,cb.updated_at AS updatedAt FROM configuration_baseline cb LEFT JOIN baseline_occurrence bo ON bo.baseline_id=cb.id WHERE cb.program_id=? GROUP BY cb.id ORDER BY cb.release_id,cb.revision_number DESC`).bind(PROGRAM_ID).all(),
    db.prepare(`SELECT id,canonical_name AS canonicalName,short_name AS shortName,product_type AS productType,software_classification AS softwareClassification,owner_organization_id AS ownerOrganizationId,description,lifecycle_status AS lifecycleStatus,source_reference AS sourceReference,source_as_of AS sourceAsOf,updated_at AS updatedAt FROM product WHERE program_id=? ORDER BY canonical_name`).bind(PROGRAM_ID).all(),
    db.prepare(`SELECT id,name,organization_type AS organizationType,description,lifecycle_status AS lifecycleStatus,source_reference AS sourceReference,source_as_of AS sourceAsOf,updated_at AS updatedAt FROM organization WHERE program_id=? ORDER BY name`).bind(PROGRAM_ID).all(),
    db.prepare(`SELECT id,parent_id AS parentId,code,name,description,lifecycle_status AS lifecycleStatus,source_reference AS sourceReference,source_as_of AS sourceAsOf,updated_at AS updatedAt FROM capability WHERE program_id=? ORDER BY name`).bind(PROGRAM_ID).all(),
    db.prepare(`SELECT id,parent_id AS parentId,node_type AS nodeType,code,name,description,owner_organization_id AS ownerOrganizationId,lifecycle_status AS lifecycleStatus,source_reference AS sourceReference,source_as_of AS sourceAsOf,updated_at AS updatedAt FROM configuration_node WHERE program_id=? ORDER BY node_type,name`).bind(PROGRAM_ID).all(),
  ]);
  return {
    releases: releases.results as MasterDataPortfolio["releases"], milestones: milestones.results as MasterDataPortfolio["milestones"], configurationSets: configurationSets.results as MasterDataPortfolio["configurationSets"],
    products: products.results as MasterDataPortfolio["products"], organizations: organizations.results as MasterDataPortfolio["organizations"],
    capabilities: capabilities.results as MasterDataPortfolio["capabilities"], configurationNodes: configurationNodes.results as MasterDataPortfolio["configurationNodes"],
  };
}

export async function transitionConfigurationSet(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const configurationSetId = clean(body.id);
  const target = clean(body.approvalStatus) as "working" | "under_review" | "approved" | "superseded";
  const rationale = clean(body.rationale);
  const current = await db.prepare("SELECT * FROM configuration_baseline WHERE id=? AND program_id=?").bind(configurationSetId, PROGRAM_ID).first<Record<string, unknown>>();
  if (!current) throw new Error("The Configuration Set was not found.");
  const from = String(current.approval_status || "working");
  const allowed = new Set(["working:under_review", "under_review:working", "under_review:approved"]);
  if (!allowed.has(`${from}:${target}`)) throw new Error(`Configuration Set cannot transition from ${from.replaceAll("_", " ")} to ${target.replaceAll("_", " ")}.`);
  if (target === "approved" && !rationale) throw new Error("Approval requires a rationale.");
  if (target === "approved" && actor.role !== "steward") throw new Error("Only the baseline steward may approve a Configuration Set.");
  const at = now();
  const statements = [
    db.prepare("UPDATE configuration_baseline SET approval_status=?,approved_at=CASE WHEN ?='approved' THEN ? ELSE approved_at END,approved_by_user_id=CASE WHEN ?='approved' THEN ? ELSE approved_by_user_id END,locked_at=CASE WHEN ?='approved' THEN ? ELSE locked_at END,superseded_at=CASE WHEN ?='superseded' THEN ? ELSE superseded_at END,updated_at=? WHERE id=?")
      .bind(target, target, at, target, actor.id, target, at, target, at, at, configurationSetId),
    audit(db, actor, "configuration_set_transitioned", "configuration_baseline", configurationSetId, { from, to: target, rationale }, current),
  ];
  if (target === "approved") statements.unshift(db.prepare("UPDATE configuration_baseline SET approval_status='superseded',superseded_at=?,superseded_by_baseline_id=?,updated_at=? WHERE program_id=? AND release_id=? AND approval_status='approved' AND id<>?").bind(at, configurationSetId, at, PROGRAM_ID, String(current.release_id), configurationSetId));
  await db.batch(statements);
  return configurationSetId;
}

async function validateParent(db: Database, table: "capability" | "configuration_node", id: string, parentId: string | null) {
  if (!parentId) return;
  if (id === parentId) throw new Error("A record cannot be its own parent.");
  const rows = await db.prepare(`WITH RECURSIVE descendants(id) AS (SELECT id FROM ${table} WHERE parent_id=? UNION ALL SELECT child.id FROM ${table} child JOIN descendants d ON child.parent_id=d.id) SELECT id FROM descendants`).bind(id).all<{ id: string }>();
  if (rows.results.some((row) => row.id === parentId)) throw new Error("This parent would create a hierarchy cycle.");
}

export async function saveRelease(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const releaseId = clean(body.id) || makeId("release");
  const name = clean(body.name);
  const code = nullable(body.code);
  const status = clean(body.status) as ReleaseStage;
  const stateRole = clean(body.stateRole || "reported") as ReleaseStateRole;
  const predecessorReleaseId = nullable(body.predecessorReleaseId);
  if (!name || !releaseStageSet.has(status) || !releaseRoleSet.has(stateRole)) throw new Error("Release name, lifecycle stage, and analytical role are required.");
  if (predecessorReleaseId === releaseId) throw new Error("A Release cannot be its own predecessor.");
  if ((status === "cancelled" || status === "superseded") && !clean(body.lifecycleRationale)) throw new Error("A rationale is required to cancel or supersede a Release.");
  const before = await db.prepare("SELECT * FROM release WHERE id=? AND program_id=?").bind(releaseId, PROGRAM_ID).first<Record<string, unknown>>();
  if (predecessorReleaseId) {
    const chain = await db.prepare("WITH RECURSIVE predecessors(id) AS (SELECT predecessor_release_id FROM release WHERE id=? UNION ALL SELECT r.predecessor_release_id FROM release r JOIN predecessors p ON r.id=p.id WHERE p.id IS NOT NULL) SELECT id FROM predecessors WHERE id IS NOT NULL").bind(predecessorReleaseId).all<{ id: string }>();
    if (chain.results.some((item) => item.id === releaseId)) throw new Error("This predecessor would create a Release cycle.");
  }
  const at = now();
  const statements = before ? [
    db.prepare("UPDATE release SET code=?,normalized_code=?,name=?,normalized_name=?,status=?,description=?,owner=?,predecessor_release_id=?,target_date=?,actual_date=?,source_reference=?,source_as_of=?,updated_at=? WHERE id=? AND program_id=?")
      .bind(code, code ? normalized(code) : null, name, normalized(name), status, nullable(body.description), nullable(body.owner), predecessorReleaseId, nullable(body.targetDate), nullable(body.actualDate), nullable(body.sourceReference), nullable(body.sourceAsOf), at, releaseId, PROGRAM_ID),
  ] : [
    db.prepare("INSERT INTO release (id,program_id,code,normalized_code,name,normalized_name,status,description,owner,predecessor_release_id,target_date,actual_date,source_reference,source_as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(releaseId, PROGRAM_ID, code, code ? normalized(code) : null, name, normalized(name), status, nullable(body.description), nullable(body.owner), predecessorReleaseId, nullable(body.targetDate), nullable(body.actualDate), nullable(body.sourceReference), nullable(body.sourceAsOf), at, at),
  ];
  const profileId = makeId("release-profile");
  statements.push(db.prepare("INSERT INTO release_profile (id,program_id,release_id,state_role,effective_date,description,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(release_id) DO UPDATE SET state_role=excluded.state_role,effective_date=excluded.effective_date,description=excluded.description,updated_at=excluded.updated_at")
    .bind(profileId, PROGRAM_ID, releaseId, stateRole, nullable(body.effectiveDate), nullable(body.profileDescription), actor.id, at, at));
  // Baseline exports resolve ReleaseName through the governed Release link.
  // Renaming a Release therefore does not rewrite imported row snapshots or a
  // second JSON projection.
  statements.push(audit(db, actor, before ? "release_updated" : "release_created", "release", releaseId, { name, code, status, stateRole, predecessorReleaseId, targetDate: nullable(body.targetDate), actualDate: nullable(body.actualDate), lifecycleRationale: nullable(body.lifecycleRationale) }, before));
  await db.batch(statements);
  return releaseId;
}

export async function saveReleaseMilestone(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const milestoneId = clean(body.id) || makeId("release-milestone");
  const releaseId = clean(body.releaseId);
  const title = clean(body.title);
  const milestoneType = clean(body.milestoneType);
  const status = clean(body.status || "planned");
  if (!releaseId || !title || !milestoneType || !milestoneStatusSet.has(status)) throw new Error("Release, milestone type, title, and status are required.");
  if (body.plannedDate && body.actualDate && clean(body.actualDate) < clean(body.plannedDate) && status === "planned") throw new Error("A planned milestone cannot have an actual date before its planned date while still marked planned.");
  const before = await db.prepare("SELECT * FROM release_milestone WHERE id=? AND program_id=?").bind(milestoneId, PROGRAM_ID).first<Record<string, unknown>>();
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO release_milestone (id,program_id,release_id,milestone_type,title,status,planned_date,forecast_date,actual_date,owner,source_reference,source_as_of,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET release_id=excluded.release_id,milestone_type=excluded.milestone_type,title=excluded.title,status=excluded.status,planned_date=excluded.planned_date,forecast_date=excluded.forecast_date,actual_date=excluded.actual_date,owner=excluded.owner,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(milestoneId, PROGRAM_ID, releaseId, milestoneType, title, status, nullable(body.plannedDate), nullable(body.forecastDate), nullable(body.actualDate), nullable(body.owner), nullable(body.sourceReference), nullable(body.sourceAsOf), nullable(body.notes), before?.created_at || at, at),
    audit(db, actor, before ? "release_milestone_updated" : "release_milestone_created", "release", releaseId, { milestoneId, title, milestoneType, status }, before),
  ]);
  return milestoneId;
}

export async function saveMasterEntity(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const kind = clean(body.kind) as MasterEntityKind;
  const entityId = clean(body.id) || makeId(kind.replace("_", "-"));
  const at = now();
  const name = clean(body.name || body.canonicalName);
  if (!name || !new Set<MasterEntityKind>(["product", "organization", "capability", "configuration_node"]).has(kind)) throw new Error("Object type and canonical name are required.");
  const table = kind === "configuration_node" ? "configuration_node" : kind;
  const before = await db.prepare(`SELECT * FROM ${table} WHERE id=? AND program_id=?`).bind(entityId, PROGRAM_ID).first<Record<string, unknown>>();
  const status = clean(body.lifecycleStatus || "active");
  if ((status === "retired" || status === "inactive") && !clean(body.lifecycleRationale)) throw new Error("A lifecycle rationale is required.");
  let statement;
  if (kind === "product") {
    if (!new Set(["active", "retired"]).has(status)) throw new Error("Invalid Product lifecycle state.");
    statement = db.prepare("INSERT INTO product (id,program_id,canonical_name,normalized_name,short_name,product_type,software_classification,owner_organization_id,description,lifecycle_status,source_reference,source_as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name,normalized_name=excluded.normalized_name,short_name=excluded.short_name,product_type=excluded.product_type,software_classification=excluded.software_classification,owner_organization_id=excluded.owner_organization_id,description=excluded.description,lifecycle_status=excluded.lifecycle_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at")
      .bind(entityId, PROGRAM_ID, name, normalized(name), nullable(body.shortName), nullable(body.productType), nullable(body.softwareClassification), nullable(body.ownerOrganizationId), nullable(body.description), status, nullable(body.sourceReference), nullable(body.sourceAsOf), before?.created_at || at, at);
  } else if (kind === "organization") {
    if (!new Set(["active", "inactive", "retired"]).has(status)) throw new Error("Invalid Organization lifecycle state.");
    statement = db.prepare("INSERT INTO organization (id,program_id,name,normalized_name,organization_type,description,lifecycle_status,source_reference,source_as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,organization_type=excluded.organization_type,description=excluded.description,lifecycle_status=excluded.lifecycle_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at")
      .bind(entityId, PROGRAM_ID, name, normalized(name), nullable(body.organizationType), nullable(body.description), status, nullable(body.sourceReference), nullable(body.sourceAsOf), before?.created_at || at, at);
  } else if (kind === "capability") {
    if (!new Set(["draft", "active", "retired"]).has(status)) throw new Error("Invalid Capability lifecycle state.");
    await validateParent(db, "capability", entityId, nullable(body.parentId));
    statement = db.prepare("INSERT INTO capability (id,program_id,parent_id,code,name,normalized_name,description,lifecycle_status,source_reference,source_as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,code=excluded.code,name=excluded.name,normalized_name=excluded.normalized_name,description=excluded.description,lifecycle_status=excluded.lifecycle_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at")
      .bind(entityId, PROGRAM_ID, nullable(body.parentId), nullable(body.code), name, normalized(name), nullable(body.description), status, nullable(body.sourceReference), nullable(body.sourceAsOf), before?.created_at || at, at);
  } else {
    if (!new Set(["active", "retired"]).has(status) || !clean(body.nodeType)) throw new Error("Configuration type and valid lifecycle state are required.");
    await validateParent(db, "configuration_node", entityId, nullable(body.parentId));
    const code = nullable(body.code);
    statement = db.prepare("INSERT INTO configuration_node (id,program_id,parent_id,node_type,code,normalized_code,name,normalized_name,description,owner_organization_id,lifecycle_status,source_reference,source_as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,node_type=excluded.node_type,code=excluded.code,normalized_code=excluded.normalized_code,name=excluded.name,normalized_name=excluded.normalized_name,description=excluded.description,owner_organization_id=excluded.owner_organization_id,lifecycle_status=excluded.lifecycle_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at")
      .bind(entityId, PROGRAM_ID, nullable(body.parentId), clean(body.nodeType), code, code ? normalized(code) : null, name, normalized(name), nullable(body.description), nullable(body.ownerOrganizationId), status, nullable(body.sourceReference), nullable(body.sourceAsOf), before?.created_at || at, at);
  }
  await db.batch([statement, audit(db, actor, before ? `${kind}_updated` : `${kind}_created`, kind, entityId, { name, lifecycleStatus: status, lifecycleRationale: nullable(body.lifecycleRationale) }, before)]);
  return entityId;
}

export async function auditHistory(db: Database, kind: string, entityId: string): Promise<AuditEntry[]> {
  const rows = await db.prepare("SELECT id,action,actor_id AS actorId,before_payload AS beforePayload,after_payload AS afterPayload,created_at AS createdAt FROM audit_event WHERE program_id=? AND entity_kind=? AND entity_id=? ORDER BY created_at DESC LIMIT 100").bind(PROGRAM_ID, kind, entityId).all();
  return rows.results as AuditEntry[];
}
