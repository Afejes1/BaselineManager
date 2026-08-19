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
  const [platformResult, relationshipResult, profileResult, organizationResult, releaseResult] = await Promise.all([
    db.prepare(`SELECT p.id,p.parent_id,p.configuration_node_id,p.platform_type,p.code,p.name,p.status,p.description,p.installation_location,p.country_code,
      COUNT(DISTINCT CASE WHEN bo.lifecycle_status='active' THEN bo.id END) AS direct_occurrence_count,
      COUNT(DISTINCT CASE WHEN bo.lifecycle_status='active' THEN bo.product_id END) AS direct_product_count,
      COUNT(DISTINCT CASE WHEN bo.lifecycle_status='active' THEN bo.release_id END) AS direct_release_count
      FROM platform p LEFT JOIN baseline_occurrence bo ON bo.configuration_node_id=p.configuration_node_id
      WHERE p.program_id=? GROUP BY p.id ORDER BY CASE p.platform_type WHEN 'alou' THEN 1 WHEN 'ock' THEN 2 WHEN 'obk' THEN 3 WHEN 'pma' THEN 4 ELSE 5 END,p.code`).bind(PROGRAM_ID).all<{
        id: string; parent_id: string | null; configuration_node_id: string | null; platform_type: PlatformType; code: string; name: string; status: PlatformStatus; description: string | null; installation_location: string | null; country_code: string | null; direct_occurrence_count: number; direct_product_count: number; direct_release_count: number;
      }>(),
    db.prepare("SELECT po.id,po.platform_id,po.organization_id,po.relationship_type,po.source_reference,o.name AS organization_name FROM platform_organization po JOIN platform p ON p.id=po.platform_id JOIN organization o ON o.id=po.organization_id WHERE p.program_id=? ORDER BY o.name").bind(PROGRAM_ID).all<{ id: string; platform_id: string; organization_id: string; organization_name: string; relationship_type: "owner" | "operator" | "integrator" | "support" | "supplier"; source_reference: string | null }>(),
    db.prepare("SELECT rp.id,rp.release_id,r.name AS release_name,rp.state_role,rp.effective_date,rp.description FROM release_profile rp JOIN release r ON r.id=rp.release_id WHERE rp.program_id=? ORDER BY COALESCE(r.actual_date,r.target_date,r.name)").bind(PROGRAM_ID).all<{ id: string; release_id: string; release_name: string; state_role: ReleaseStateRole; effective_date: string | null; description: string | null }>(),
    db.prepare("SELECT id,name FROM organization WHERE program_id=? ORDER BY name").bind(PROGRAM_ID).all<{ id: string; name: string }>(),
    db.prepare("SELECT id,name FROM release WHERE program_id=? ORDER BY name").bind(PROGRAM_ID).all<{ id: string; name: string }>(),
  ]);
  return {
    platforms: platformResult.results.map((row) => ({ id: row.id, parentId: row.parent_id, configurationNodeId: row.configuration_node_id, platformType: row.platform_type, code: row.code, name: row.name, status: row.status, description: row.description, installationLocation: row.installation_location, countryCode: row.country_code, directOccurrenceCount: Number(row.direct_occurrence_count || 0), directProductCount: Number(row.direct_product_count || 0), directReleaseCount: Number(row.direct_release_count || 0) })),
    relationships: relationshipResult.results.map((row) => ({ id: row.id, platformId: row.platform_id, organizationId: row.organization_id, organizationName: row.organization_name, relationshipType: row.relationship_type, sourceReference: row.source_reference })),
    releaseProfiles: profileResult.results.map((row) => ({ id: row.id, releaseId: row.release_id, releaseName: row.release_name, stateRole: row.state_role, effectiveDate: row.effective_date, description: row.description })),
    organizations: organizationResult.results,
    releases: releaseResult.results,
  };
}

async function assertValidParent(db: Database, platformId: string, parentId: string | null) {
  if (!parentId) return;
  if (parentId === platformId) throw new Error("A Platform cannot be its own parent.");
  const rows = await db.prepare("SELECT id,parent_id FROM platform WHERE program_id=?").bind(PROGRAM_ID).all<{ id: string; parent_id: string | null }>();
  const parents = new Map(rows.results.map((row) => [row.id, row.parent_id]));
  if (!parents.has(parentId)) throw new Error("Choose a parent Platform from this program.");
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
  await assertValidParent(db, platformId, parentId);
  const at = now();
  const existing = await db.prepare("SELECT id,code,name,parent_id,platform_type,status FROM platform WHERE id=? AND program_id=?").bind(platformId, PROGRAM_ID).first<Record<string, unknown>>();
  await db.batch([
    db.prepare("INSERT INTO platform (id,program_id,parent_id,configuration_node_id,platform_type,code,normalized_code,name,normalized_name,status,description,installation_location,country_code,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,configuration_node_id=excluded.configuration_node_id,platform_type=excluded.platform_type,code=excluded.code,normalized_code=excluded.normalized_code,name=excluded.name,normalized_name=excluded.normalized_name,status=excluded.status,description=excluded.description,installation_location=excluded.installation_location,country_code=excluded.country_code,updated_at=excluded.updated_at")
      .bind(platformId, PROGRAM_ID, parentId, nullable(body.configurationNodeId), platformType, code, normalized(code), name, normalized(name), status, nullable(body.description), nullable(body.installationLocation), nullable(body.countryCode)?.toUpperCase() || null, actor.id, at, at),
    audit(db, actor, existing ? "platform_updated" : "platform_created", "platform", platformId, { code, name, platformType, status, parentId }, existing || undefined),
  ]);
  return platformId;
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

