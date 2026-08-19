import { env } from "cloudflare:workers";
import { audit, PROGRAM_ID, requireWriter } from "./governance-server";
import type { CanonicalKind, StewardshipPortfolio } from "./stewardship-model";

type Database = typeof env.DB;
type Actor = { id: string; displayName: string; role: "steward" | "editor" | "viewer" };
const now = () => new Date().toISOString();
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalized = (value: unknown) => clean(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const kinds = new Set<CanonicalKind>(["product", "organization", "configuration_node"]);

type EntityRow = { id: string; kind: CanonicalKind; name: string; secondary: string | null; reference_count: number };
type AliasRow = { id: string; entity_kind: CanonicalKind; entity_id: string; entity_name: string; alias: string; namespace: string; source_reference: string | null; status: "proposed" | "accepted" | "rejected" | "retired"; reviewed_at: string | null };
type MergeRow = { id: string; entity_kind: CanonicalKind; source_entity_id: string; target_entity_id: string; source_name: string; target_name: string; rationale: string; source_reference: string | null; merged_at: string };

export async function stewardshipPortfolio(db: Database): Promise<StewardshipPortfolio> {
  const [entities, aliases, merges] = await Promise.all([
    db.prepare(`SELECT p.id,'product' AS kind,p.canonical_name AS name,p.short_name AS secondary,COUNT(DISTINCT bo.id) AS reference_count FROM product p LEFT JOIN baseline_occurrence bo ON bo.product_id=p.id AND bo.lifecycle_status='active' WHERE p.program_id=? AND NOT EXISTS (SELECT 1 FROM canonical_merge_event m WHERE m.program_id=p.program_id AND m.entity_kind='product' AND m.source_entity_id=p.id) GROUP BY p.id
      UNION ALL SELECT o.id,'organization',o.name,o.organization_type,COUNT(DISTINCT ps.product_id) FROM organization o LEFT JOIN product_supplier ps ON ps.organization_id=o.id WHERE o.program_id=? AND NOT EXISTS (SELECT 1 FROM canonical_merge_event m WHERE m.program_id=o.program_id AND m.entity_kind='organization' AND m.source_entity_id=o.id) GROUP BY o.id
      UNION ALL SELECT n.id,'configuration_node',n.name,n.node_type,COUNT(DISTINCT bo.id) FROM configuration_node n LEFT JOIN baseline_occurrence bo ON bo.configuration_node_id=n.id AND bo.lifecycle_status='active' WHERE n.program_id=? AND NOT EXISTS (SELECT 1 FROM canonical_merge_event m WHERE m.program_id=n.program_id AND m.entity_kind='configuration_node' AND m.source_entity_id=n.id) GROUP BY n.id ORDER BY kind,name`).bind(PROGRAM_ID, PROGRAM_ID, PROGRAM_ID).all<EntityRow>(),
    db.prepare(`SELECT a.id,a.entity_kind,a.entity_id,a.alias,a.namespace,a.source_reference,a.status,a.reviewed_at,
      COALESCE(p.canonical_name,o.name,n.name,a.entity_id) AS entity_name FROM canonical_alias a
      LEFT JOIN product p ON a.entity_kind='product' AND p.id=a.entity_id
      LEFT JOIN organization o ON a.entity_kind='organization' AND o.id=a.entity_id
      LEFT JOIN configuration_node n ON a.entity_kind='configuration_node' AND n.id=a.entity_id
      WHERE a.program_id=? ORDER BY a.updated_at DESC`).bind(PROGRAM_ID).all<AliasRow>(),
    db.prepare(`SELECT m.*,COALESCE(sp.canonical_name,so.name,sn.name,m.source_entity_id) AS source_name,COALESCE(tp.canonical_name,torg.name,tn.name,m.target_entity_id) AS target_name
      FROM canonical_merge_event m
      LEFT JOIN product sp ON m.entity_kind='product' AND sp.id=m.source_entity_id LEFT JOIN product tp ON m.entity_kind='product' AND tp.id=m.target_entity_id
      LEFT JOIN organization so ON m.entity_kind='organization' AND so.id=m.source_entity_id LEFT JOIN organization torg ON m.entity_kind='organization' AND torg.id=m.target_entity_id
      LEFT JOIN configuration_node sn ON m.entity_kind='configuration_node' AND sn.id=m.source_entity_id LEFT JOIN configuration_node tn ON m.entity_kind='configuration_node' AND tn.id=m.target_entity_id
      WHERE m.program_id=? ORDER BY m.merged_at DESC LIMIT 50`).bind(PROGRAM_ID).all<MergeRow>(),
  ]);
  return {
    entities: entities.results.map((row) => ({ id: row.id, kind: row.kind, name: row.name, secondary: row.secondary, referenceCount: Number(row.reference_count || 0) })),
    aliases: aliases.results.map((row) => ({ id: row.id, entityKind: row.entity_kind, entityId: row.entity_id, entityName: row.entity_name, alias: row.alias, namespace: row.namespace, sourceReference: row.source_reference, status: row.status, reviewedAt: row.reviewed_at })),
    merges: merges.results.map((row) => ({ id: row.id, entityKind: row.entity_kind, sourceEntityId: row.source_entity_id, targetEntityId: row.target_entity_id, sourceName: row.source_name, targetName: row.target_name, rationale: row.rationale, sourceReference: row.source_reference, mergedAt: row.merged_at })),
  };
}

async function entityName(db: Database, kind: CanonicalKind, entityId: string) {
  const table = kind === "product" ? "product" : kind === "organization" ? "organization" : "configuration_node";
  const name = kind === "product" ? "canonical_name" : "name";
  return db.prepare(`SELECT ${name} AS name FROM ${table} WHERE id=? AND program_id=?`).bind(entityId, PROGRAM_ID).first<{ name: string }>();
}

export async function saveCanonicalAlias(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const entityKind = clean(body.entityKind) as CanonicalKind;
  const entityId = clean(body.entityId);
  const alias = clean(body.alias);
  const namespace = clean(body.namespace) || "name";
  if (!kinds.has(entityKind) || !entityId || !alias) throw new Error("Entity, alias, and identity type are required.");
  if (!await entityName(db, entityKind, entityId)) throw new Error("The canonical entity no longer exists.");
  const at = now();
  const aliasId = id("alias");
  await db.batch([
    db.prepare("INSERT INTO canonical_alias (id,program_id,entity_kind,entity_id,alias,normalized_alias,namespace,source_reference,status,reviewed_by_user_id,reviewed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(program_id,entity_kind,namespace,normalized_alias) DO UPDATE SET entity_id=excluded.entity_id,alias=excluded.alias,source_reference=excluded.source_reference,status='accepted',reviewed_by_user_id=excluded.reviewed_by_user_id,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at")
      .bind(aliasId, PROGRAM_ID, entityKind, entityId, alias, normalized(alias), namespace, clean(body.sourceReference) || null, "accepted", actor.id, at, at, at),
    audit(db, actor, "canonical_alias_accepted", entityKind, entityId, { alias, namespace, sourceReference: clean(body.sourceReference) || null }),
  ]);
  return aliasId;
}

export async function mergeCanonicalEntity(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const entityKind = clean(body.entityKind) as CanonicalKind;
  const sourceId = clean(body.sourceEntityId);
  const targetId = clean(body.targetEntityId);
  const rationale = clean(body.rationale);
  if (!kinds.has(entityKind) || !sourceId || !targetId || sourceId === targetId || !rationale) throw new Error("Two different entities and a merger rationale are required.");
  if (entityKind === "configuration_node") throw new Error("Configuration nodes may receive aliases, but node mergers require placement-by-placement reconciliation and are intentionally blocked.");
  const [source, target] = await Promise.all([entityName(db, entityKind, sourceId), entityName(db, entityKind, targetId)]);
  if (!source || !target) throw new Error("Both canonical entities must still exist.");
  if (entityKind === "product") {
    const conflicts = await db.prepare("SELECT COUNT(*) AS count FROM deployment source JOIN deployment target ON target.product_id=? AND target.configuration_node_id=source.configuration_node_id AND target.environment=source.environment AND target.site=source.site WHERE source.product_id=?").bind(targetId, sourceId).first<{ count: number }>();
    if (Number(conflicts?.count || 0)) throw new Error("These Products have overlapping deployment positions. Reconcile those deployment records before merging the canonical identities.");
  }
  const at = now();
  const sourceReference = clean(body.sourceReference) || null;
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO canonical_alias (id,program_id,entity_kind,entity_id,alias,normalized_alias,namespace,source_reference,status,reviewed_by_user_id,reviewed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(program_id,entity_kind,namespace,normalized_alias) DO UPDATE SET entity_id=excluded.entity_id,status='accepted',reviewed_by_user_id=excluded.reviewed_by_user_id,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at")
      .bind(id("alias"), PROGRAM_ID, entityKind, targetId, source.name, normalized(source.name), "name", sourceReference, "accepted", actor.id, at, at, at),
    db.prepare("INSERT INTO canonical_merge_event (id,program_id,entity_kind,source_entity_id,target_entity_id,rationale,source_reference,merged_by_user_id,merged_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id("merge"), PROGRAM_ID, entityKind, sourceId, targetId, rationale, sourceReference, actor.id, at),
  ];
  if (entityKind === "product") {
    statements.push(
      db.prepare("UPDATE source_row_24 SET product_id=?,updated_at=? WHERE product_id=?").bind(targetId, at, sourceId),
      db.prepare("UPDATE baseline_occurrence SET product_id=?,updated_at=? WHERE product_id=?").bind(targetId, at, sourceId),
      db.prepare("UPDATE managed_deployment_profile SET product_id=?,updated_at=? WHERE product_id=?").bind(targetId, at, sourceId),
      db.prepare("UPDATE change_effect SET subject_id=?,updated_at=? WHERE subject_kind='product' AND subject_id=?").bind(targetId, at, sourceId),
      db.prepare("INSERT OR IGNORE INTO product_supplier (product_id,organization_id,supplier_role,created_at,updated_at) SELECT ?,organization_id,supplier_role,created_at,? FROM product_supplier WHERE product_id=?").bind(targetId, at, sourceId),
      db.prepare("DELETE FROM product_supplier WHERE product_id=?").bind(sourceId),
      db.prepare("INSERT OR IGNORE INTO product_capability (product_id,capability_id,relationship,rationale,created_at,updated_at) SELECT ?,capability_id,relationship,rationale,created_at,? FROM product_capability WHERE product_id=?").bind(targetId, at, sourceId),
      db.prepare("DELETE FROM product_capability WHERE product_id=?").bind(sourceId),
      db.prepare("UPDATE initiative_scope SET scope_id=?,updated_at=? WHERE scope_kind='product' AND scope_id=?").bind(targetId, at, sourceId),
      db.prepare("UPDATE deployment SET product_id=?,updated_at=? WHERE product_id=?").bind(targetId, at, sourceId),
    );
  } else {
    statements.push(
      db.prepare("UPDATE product SET owner_organization_id=?,updated_at=? WHERE owner_organization_id=?").bind(targetId, at, sourceId),
      db.prepare("UPDATE configuration_node SET owner_organization_id=?,updated_at=? WHERE owner_organization_id=?").bind(targetId, at, sourceId),
      db.prepare("UPDATE change_effect SET subject_id=?,updated_at=? WHERE subject_kind='organization' AND subject_id=?").bind(targetId, at, sourceId),
      db.prepare("INSERT OR IGNORE INTO product_supplier (product_id,organization_id,supplier_role,created_at,updated_at) SELECT product_id,?,supplier_role,created_at,? FROM product_supplier WHERE organization_id=?").bind(targetId, at, sourceId),
      db.prepare("DELETE FROM product_supplier WHERE organization_id=?").bind(sourceId),
      db.prepare("INSERT OR IGNORE INTO platform_organization (id,platform_id,organization_id,relationship_type,source_reference,created_at,updated_at) SELECT 'platform-org-' || lower(hex(randomblob(16))),platform_id,?,relationship_type,source_reference,created_at,? FROM platform_organization WHERE organization_id=?").bind(targetId, at, sourceId),
      db.prepare("DELETE FROM platform_organization WHERE organization_id=?").bind(sourceId),
    );
  }
  statements.push(audit(db, actor, "canonical_entity_merged", entityKind, targetId, { sourceId, targetId, rationale, sourceReference, sourceName: source.name, targetName: target.name }));
  await db.batch(statements);
  return targetId;
}
