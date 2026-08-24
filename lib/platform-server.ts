import { env } from "cloudflare:workers";
import { audit, PROGRAM_ID, requireWriter } from "./governance-server";
import type { PlatformPortfolio, PlatformStatus, PlatformType, ReleaseStateRole } from "./platform-model";

type Database = typeof env.DB;
type Actor = { id: string; displayName: string; role: "steward" | "editor" | "viewer" };
const now = () => new Date().toISOString();
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;
const normalized = (value: unknown) => clean(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const platformTypes = new Set<PlatformType>(["alou", "ock", "obk", "pma", "other"]);
const platformStatuses = new Set<PlatformStatus>(["active", "planned", "retired"]);
const releaseRoles = new Set<ReleaseStateRole>(["historical", "as_is", "to_be", "reported"]);

export async function platformPortfolio(db: Database): Promise<PlatformPortfolio> {
  const [platformResult, assignmentResult, occurrenceResult, relationshipResult, profileResult, organizationResult, releaseResult] = await Promise.all([
    db.prepare(`SELECT p.id,p.parent_id,p.configuration_node_id,p.platform_type,p.code,p.name,p.status,p.description,p.installation_location,p.country_code,
      resource_node.node_type AS configuration_node_type,tier_node.name AS reported_tier_name,
      COUNT(DISTINCT CASE WHEN bo.lifecycle_status='active' THEN bo.id END) AS direct_occurrence_count,
      COUNT(DISTINCT CASE WHEN bo.lifecycle_status='active' THEN bo.product_id END) AS direct_product_count,
      COUNT(DISTINCT CASE WHEN bo.lifecycle_status='active' THEN bo.release_id END) AS direct_release_count
      FROM platform p LEFT JOIN configuration_node resource_node ON resource_node.id=p.configuration_node_id LEFT JOIN configuration_node tier_node ON tier_node.id=resource_node.parent_id
      LEFT JOIN platform_baseline_assignment pba ON pba.platform_id=p.id LEFT JOIN baseline_occurrence bo ON bo.id=pba.baseline_occurrence_id
      WHERE p.program_id=? GROUP BY p.id ORDER BY CASE p.platform_type WHEN 'alou' THEN 1 WHEN 'ock' THEN 2 WHEN 'obk' THEN 3 WHEN 'pma' THEN 4 ELSE 5 END,p.code`).bind(PROGRAM_ID).all<{
        id: string; parent_id: string | null; configuration_node_id: string | null; platform_type: PlatformType; code: string; name: string; status: PlatformStatus; description: string | null; installation_location: string | null; country_code: string | null; configuration_node_type: string | null; reported_tier_name: string | null; direct_occurrence_count: number; direct_product_count: number; direct_release_count: number;
      }>(),
    db.prepare(`SELECT a.id,a.platform_id,a.baseline_occurrence_id,a.release_id,r.name AS release_name,COALESCE(p.canonical_name,'Unnamed product') AS product_name,COALESCE(ext.source_key,sr.source_key,'No external key') AS source_key,COALESCE(n.name,'Unassigned host') AS host_name,a.assignment_role,a.confidence,a.review_status,a.source_reference,a.source_as_of,a.reviewed_at
      FROM platform_baseline_assignment a JOIN baseline_occurrence bo ON bo.id=a.baseline_occurrence_id JOIN release r ON r.id=a.release_id LEFT JOIN product p ON p.id=bo.product_id LEFT JOIN baseline_record_extension ext ON ext.baseline_occurrence_id=bo.id LEFT JOIN source_row_24 sr ON sr.id=bo.source_row_id LEFT JOIN configuration_node n ON n.id=bo.configuration_node_id WHERE a.program_id=? AND bo.lifecycle_status='active' ORDER BY r.name,p.canonical_name`).bind(PROGRAM_ID).all<{ id: string; platform_id: string; baseline_occurrence_id: string; release_id: string; release_name: string; product_name: string; source_key: string; host_name: string; assignment_role: "primary" | "supporting"; confidence: "reported" | "assessed" | "confirmed"; review_status: "not_reviewed" | "reviewed" | "follow_up"; source_reference: string | null; source_as_of: string | null; reviewed_at: string | null }>(),
    db.prepare(`SELECT bo.id,bo.release_id,r.name AS release_name,COALESCE(p.canonical_name,'Unnamed product') AS product_name,COALESCE(ext.source_key,sr.source_key,'No external key') AS source_key,COALESCE(t.name,'Unassigned') || ' / ' || COALESCE(res.name,'Unassigned') || ' / ' || COALESCE(host.name,'Unassigned') AS placement,pa.platform_id AS primary_platform_id
      FROM baseline_occurrence bo JOIN release r ON r.id=bo.release_id LEFT JOIN product p ON p.id=bo.product_id LEFT JOIN baseline_record_extension ext ON ext.baseline_occurrence_id=bo.id LEFT JOIN source_row_24 sr ON sr.id=bo.source_row_id LEFT JOIN configuration_node host ON host.id=bo.configuration_node_id LEFT JOIN configuration_node res ON res.id=host.parent_id LEFT JOIN configuration_node t ON t.id=res.parent_id LEFT JOIN platform_baseline_assignment pa ON pa.baseline_occurrence_id=bo.id AND pa.assignment_role='primary' WHERE bo.program_id=? AND bo.workspace_id=? AND bo.lifecycle_status='active' ORDER BY r.name,p.canonical_name,COALESCE(ext.source_key,sr.source_key),bo.created_at`).bind(PROGRAM_ID, "workspace-jsf-current").all<{ id: string; release_id: string; release_name: string; product_name: string; source_key: string; placement: string; primary_platform_id: string | null }>(),
    db.prepare("SELECT po.id,po.platform_id,po.organization_id,po.relationship_type,po.source_reference,o.name AS organization_name FROM platform_organization po JOIN platform p ON p.id=po.platform_id JOIN organization o ON o.id=po.organization_id WHERE p.program_id=? ORDER BY o.name").bind(PROGRAM_ID).all<{ id: string; platform_id: string; organization_id: string; organization_name: string; relationship_type: "owner" | "operator" | "integrator" | "support" | "supplier"; source_reference: string | null }>(),
    db.prepare("SELECT rp.id,rp.release_id,r.name AS release_name,rp.state_role,rp.effective_date,rp.description FROM release_profile rp JOIN release r ON r.id=rp.release_id WHERE rp.program_id=? ORDER BY COALESCE(r.actual_date,r.target_date,r.name)").bind(PROGRAM_ID).all<{ id: string; release_id: string; release_name: string; state_role: ReleaseStateRole; effective_date: string | null; description: string | null }>(),
    db.prepare("SELECT id,name FROM organization WHERE program_id=? ORDER BY name").bind(PROGRAM_ID).all<{ id: string; name: string }>(),
    db.prepare("SELECT id,name FROM release WHERE program_id=? ORDER BY name").bind(PROGRAM_ID).all<{ id: string; name: string }>(),
  ]);
  return {
    platforms: platformResult.results.map((row) => ({ id: row.id, parentId: row.parent_id, configurationNodeId: row.configuration_node_id, platformType: row.platform_type, code: row.code, name: row.name, status: row.status, description: row.description, installationLocation: row.installation_location, countryCode: row.country_code, isA2OResourcePlatform: row.configuration_node_type === "resource", isGovernedPlatform: row.configuration_node_type !== "resource" || row.platform_type !== "other" || Boolean(row.parent_id), reportedTierName: row.reported_tier_name, directOccurrenceCount: Number(row.direct_occurrence_count || 0), directProductCount: Number(row.direct_product_count || 0), directReleaseCount: Number(row.direct_release_count || 0) })),
    assignments: assignmentResult.results.map((row) => ({ id: row.id, platformId: row.platform_id, baselineOccurrenceId: row.baseline_occurrence_id, releaseId: row.release_id, releaseName: row.release_name, productName: row.product_name, sourceKey: row.source_key, hostName: row.host_name, assignmentRole: row.assignment_role, confidence: row.confidence, reviewStatus: row.review_status, sourceReference: row.source_reference, sourceAsOf: row.source_as_of, reviewedAt: row.reviewed_at })),
    occurrenceOptions: occurrenceResult.results.map((row) => ({ id: row.id, releaseId: row.release_id, releaseName: row.release_name, productName: row.product_name, sourceKey: row.source_key, placement: row.placement, primaryPlatformId: row.primary_platform_id })),
    relationships: relationshipResult.results.map((row) => ({ id: row.id, platformId: row.platform_id, organizationId: row.organization_id, organizationName: row.organization_name, relationshipType: row.relationship_type, sourceReference: row.source_reference })),
    releaseProfiles: profileResult.results.map((row) => ({ id: row.id, releaseId: row.release_id, releaseName: row.release_name, stateRole: row.state_role, effectiveDate: row.effective_date, description: row.description })),
    organizations: organizationResult.results,
    releases: releaseResult.results,
  };
}

const requiredParent: Partial<Record<PlatformType, PlatformType>> = { ock: "alou", obk: "ock", pma: "obk" };
async function assertValidParent(db: Database, platformId: string, platformType: PlatformType, parentId: string | null) {
  if (!parentId) {
    if (requiredParent[platformType]) throw new Error(`${platformType.toUpperCase()} requires a ${requiredParent[platformType]!.toUpperCase()} parent.`);
    return;
  }
  if (parentId === platformId) throw new Error("A Platform cannot be its own parent.");
  const rows = await db.prepare("SELECT id,parent_id,platform_type FROM platform WHERE program_id=?").bind(PROGRAM_ID).all<{ id: string; parent_id: string | null; platform_type: PlatformType }>();
  const parents = new Map(rows.results.map((row) => [row.id, row.parent_id]));
  if (!parents.has(parentId)) throw new Error("Choose a parent Platform from this program.");
  const parentType = rows.results.find((row) => row.id === parentId)?.platform_type;
  if (requiredParent[platformType] && parentType !== requiredParent[platformType]) throw new Error(`${platformType.toUpperCase()} must be directly beneath ${requiredParent[platformType]!.toUpperCase()}.`);
  if (platformType === "alou") throw new Error("ALOU is a root and cannot have a parent.");
  const invalidChild = rows.results.find((row) => row.parent_id === platformId && requiredParent[row.platform_type] !== platformType && row.platform_type !== "other");
  if (invalidChild) throw new Error(`Changing this type would invalidate child ${invalidChild.id}. Reparent that child first.`);
  const visited = new Set<string>();
  let cursor: string | null | undefined = parentId;
  while (cursor) {
    if (cursor === platformId) throw new Error("That parent would create a Platform hierarchy cycle.");
    if (visited.has(cursor)) throw new Error("The existing Platform hierarchy contains a cycle that must be resolved first.");
    visited.add(cursor);
    cursor = parents.get(cursor);
  }
}

export async function savePlatform(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const platformId = clean(body.id) || makeId("platform");
  const code = clean(body.code);
  const name = clean(body.name);
  const platformType = clean(body.platformType) as PlatformType;
  const status = (clean(body.status) || "active") as PlatformStatus;
  const parentId = nullable(body.parentId);
  if (!code || !name || !platformTypes.has(platformType) || !platformStatuses.has(status)) throw new Error("Platform code, name, type, and valid status are required.");
  await assertValidParent(db, platformId, platformType, parentId);
  const at = now();
  const existing = await db.prepare("SELECT id,code,name,parent_id,configuration_node_id,platform_type,status FROM platform WHERE id=? AND program_id=?").bind(platformId, PROGRAM_ID).first<Record<string, unknown>>();
  // Source-derived A2O Resource Platforms retain their Configuration Node link
  // when a reviewer edits the Government Platform context. Delinking must be an
  // explicit API action, never an accidental omission from an edit form.
  const configurationNodeId = Object.prototype.hasOwnProperty.call(body, "configurationNodeId")
    ? nullable(body.configurationNodeId)
    : typeof existing?.configuration_node_id === "string" ? existing.configuration_node_id : null;
  await db.batch([
    db.prepare("INSERT INTO platform (id,program_id,parent_id,configuration_node_id,platform_type,code,normalized_code,name,normalized_name,status,description,installation_location,country_code,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,configuration_node_id=excluded.configuration_node_id,platform_type=excluded.platform_type,code=excluded.code,normalized_code=excluded.normalized_code,name=excluded.name,normalized_name=excluded.normalized_name,status=excluded.status,description=excluded.description,installation_location=excluded.installation_location,country_code=excluded.country_code,updated_at=excluded.updated_at")
      .bind(platformId, PROGRAM_ID, parentId, configurationNodeId, platformType, code, normalized(code), name, normalized(name), status, nullable(body.description), nullable(body.installationLocation), nullable(body.countryCode)?.toUpperCase() || null, actor.id, at, at),
    audit(db, actor, existing ? "platform_updated" : "platform_created", "platform", platformId, { code, name, platformType, status, parentId }, existing || undefined),
  ]);
  return platformId;
}

export async function savePlatformAssignment(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const platformId = clean(body.platformId);
  const occurrenceId = clean(body.baselineOccurrenceId);
  const assignmentRole = clean(body.assignmentRole) === "supporting" ? "supporting" : "primary";
  const confidence = new Set(["reported", "assessed", "confirmed"]).has(clean(body.confidence)) ? clean(body.confidence) : "assessed";
  const reviewStatus = new Set(["not_reviewed", "reviewed", "follow_up"]).has(clean(body.reviewStatus)) ? clean(body.reviewStatus) : "not_reviewed";
  const sourceReference = nullable(body.sourceReference);
  if (!platformId || !occurrenceId) throw new Error("Platform and baseline record are required.");
  if ((confidence === "assessed" || confidence === "confirmed") && !sourceReference) throw new Error("Assessed or confirmed assignments require a source reference.");
  const occurrence = await db.prepare("SELECT bo.release_id FROM baseline_occurrence bo JOIN platform p ON p.id=? AND p.program_id=bo.program_id WHERE bo.id=? AND bo.program_id=? AND bo.lifecycle_status='active'").bind(platformId, occurrenceId, PROGRAM_ID).first<{ release_id: string }>();
  if (!occurrence?.release_id) throw new Error("Choose an active baseline record and Platform from this program.");
  const at = now();
  const assignmentId = makeId("platform-assignment");
  await db.batch([
    db.prepare("INSERT INTO platform_baseline_assignment (id,program_id,platform_id,baseline_occurrence_id,release_id,assignment_role,confidence,review_status,source_reference,source_as_of,reviewed_by_user_id,reviewed_at,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_occurrence_id,assignment_role) DO UPDATE SET platform_id=excluded.platform_id,release_id=excluded.release_id,confidence=excluded.confidence,review_status=excluded.review_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,reviewed_by_user_id=excluded.reviewed_by_user_id,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at")
      .bind(assignmentId, PROGRAM_ID, platformId, occurrenceId, occurrence.release_id, assignmentRole, confidence, reviewStatus, sourceReference, nullable(body.sourceAsOf), reviewStatus === "not_reviewed" ? null : actor.id, reviewStatus === "not_reviewed" ? null : at, actor.id, at, at),
    audit(db, actor, "platform_baseline_assigned", "platform", platformId, { occurrenceId, assignmentRole, confidence, reviewStatus, sourceReference }),
  ]);
  return assignmentId;
}

export async function removePlatformAssignment(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const assignmentId = clean(body.assignmentId);
  const rationale = clean(body.rationale);
  if (!assignmentId || !rationale) throw new Error("Assignment and removal rationale are required.");
  const before = await db.prepare("SELECT * FROM platform_baseline_assignment WHERE id=? AND program_id=?").bind(assignmentId, PROGRAM_ID).first<Record<string, unknown>>();
  if (!before) throw new Error("The assignment no longer exists.");
  await db.batch([db.prepare("DELETE FROM platform_baseline_assignment WHERE id=?").bind(assignmentId), audit(db, actor, "platform_baseline_unassigned", "platform_assignment", assignmentId, { rationale }, before)]);
  return assignmentId;
}

export async function linkPlatformOrganization(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const platformId = clean(body.platformId);
  const organizationId = clean(body.organizationId);
  const relationshipType = clean(body.relationshipType);
  if (!platformId || !organizationId || !new Set(["owner", "operator", "integrator", "support", "supplier"]).has(relationshipType)) throw new Error("Platform, organization, and relationship are required.");
  const at = now();
  const relationId = makeId("platform-org");
  await db.batch([
    db.prepare("INSERT INTO platform_organization (id,platform_id,organization_id,relationship_type,source_reference,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(platform_id,organization_id,relationship_type) DO UPDATE SET source_reference=excluded.source_reference,updated_at=excluded.updated_at")
      .bind(relationId, platformId, organizationId, relationshipType, nullable(body.sourceReference), at, at),
    audit(db, actor, "platform_organization_linked", "platform", platformId, { organizationId, relationshipType }),
  ]);
  return relationId;
}

export async function saveReleaseProfile(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const releaseId = clean(body.releaseId);
  const stateRole = clean(body.stateRole) as ReleaseStateRole;
  if (!releaseId || !releaseRoles.has(stateRole)) throw new Error("Release and a valid analytical state role are required.");
  const at = now();
  const profileId = clean(body.id) || makeId("release-profile");
  await db.batch([
    db.prepare("INSERT INTO release_profile (id,program_id,release_id,state_role,effective_date,description,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(release_id) DO UPDATE SET state_role=excluded.state_role,effective_date=excluded.effective_date,description=excluded.description,updated_at=excluded.updated_at")
      .bind(profileId, PROGRAM_ID, releaseId, stateRole, nullable(body.effectiveDate), nullable(body.description), actor.id, at, at),
    audit(db, actor, "release_state_role_updated", "release", releaseId, { stateRole, effectiveDate: nullable(body.effectiveDate) }),
  ]);
  return profileId;
}
