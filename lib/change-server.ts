import { env } from "cloudflare:workers";
import { audit, PROGRAM_ID, requireWriter } from "./governance-server";
import type { ChangeAction, ChangeDependency, ChangeEffect, ChangePortfolio, ChangeRequest, ChangeRequestReferenceStatus, ChangeSubjectKind, DependencyType, FundingDecision, GovernmentPriority } from "./change-model";

type Database = typeof env.DB;
type Actor = { id: string; displayName: string; role: "steward" | "editor" | "viewer" };
const atNow = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;
const normalized = (value: unknown) => clean(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const priorities = new Set<GovernmentPriority>(["unranked", "low", "medium", "high", "critical"]);
const decisions = new Set<FundingDecision>(["pending", "fund", "defer", "decline"]);
const referenceStatuses = new Set<ChangeRequestReferenceStatus>(["active", "closed", "superseded"]);
const subjects = new Set<ChangeSubjectKind>(["product", "platform", "configuration_node", "occurrence", "release", "organization"]);
const actions = new Set<ChangeAction>(["add", "remove", "move", "modify", "assess"]);
const dependencyTypes = new Set<DependencyType>(["requires", "enables", "blocks", "conflicts", "overlaps"]);

async function ensureTypes(db: Database) {
  const at = atNow();
  const defaults = [
    ["cr-type-mcp", "MCP", "Maintenance Change Proposal", "Government prioritization reference for incumbent maintenance work.", 10],
    ["cr-type-dsor", "DSOR", "DSOR", "Externally managed request type. Expand the label only when the governing source defines it.", 20],
    ["cr-type-other", "OTHER", "Other external request", "Configurable fallback for an externally managed request type.", 90],
  ] as const;
  await db.batch(defaults.map((entry) => db.prepare("INSERT INTO change_request_type (id,program_id,code,normalized_code,label,description,active,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(program_id,normalized_code) DO UPDATE SET label=excluded.label,description=excluded.description,active=excluded.active,sort_order=excluded.sort_order,updated_at=excluded.updated_at")
    .bind(entry[0], PROGRAM_ID, entry[1], normalized(entry[1]), entry[2], entry[3], true, entry[4], at, at)));
}

type RequestRow = {
  id: string; type_id: string; type_code: string; type_label: string; external_system: string | null; external_identifier: string; title: string; external_status: string | null; external_owner: string | null; source_locator: string | null; source_as_of: string | null; requested_release_id: string | null; requested_release_name: string | null; government_priority: GovernmentPriority; decision_status: FundingDecision; decision_authority: string | null; decision_at: string | null; decision_rationale: string | null; reference_status: ChangeRequestReferenceStatus; lifecycle_rationale: string | null; summary: string | null; consequence_if_funded: string | null; consequence_if_deferred: string | null; impact_summary: string | null; knock_on_effects: string | null; updated_at: string;
};
type EffectRow = {
  id: string; change_request_id: string; subject_kind: ChangeSubjectKind; subject_id: string; subject_label: string | null; action: ChangeAction; aspect: string; from_release_id: string | null; from_release_name: string | null; to_release_id: string | null; to_release_name: string | null; current_value: string | null; target_value: string | null; consequence: string | null; rationale: string | null; confidence: "reported" | "assessed" | "confirmed"; source_occurrence_id: string | null;
};

export async function changePortfolio(db: Database): Promise<ChangePortfolio> {
  await ensureTypes(db);
  const [typeResult, requestResult, effectResult, dependencyResult, releaseResult, productResult, platformResult, configResult, occurrenceResult, organizationResult] = await Promise.all([
    db.prepare("SELECT id,code,label,description,active,sort_order FROM change_request_type WHERE program_id=? ORDER BY sort_order,label").bind(PROGRAM_ID).all<{ id: string; code: string; label: string; description: string | null; active: number; sort_order: number }>(),
    db.prepare(`SELECT cr.*,crt.code AS type_code,crt.label AS type_label,r.name AS requested_release_name FROM change_request cr JOIN change_request_type crt ON crt.id=cr.type_id LEFT JOIN release r ON r.id=cr.requested_release_id WHERE cr.program_id=? ORDER BY CASE cr.decision_status WHEN 'pending' THEN 0 ELSE 1 END,CASE cr.government_priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,cr.updated_at DESC`).bind(PROGRAM_ID).all<RequestRow>(),
    db.prepare(`SELECT ce.*,fr.name AS from_release_name,tr.name AS to_release_name,
      COALESCE(p.canonical_name,pf.code || ' · ' || pf.name,n.name,r.name,o.name,CASE WHEN bo.id IS NOT NULL THEN COALESCE(ext.source_key,sr.source_key,'Baseline record') END,ce.subject_id) AS subject_label
      FROM change_effect ce JOIN change_request cr ON cr.id=ce.change_request_id
      LEFT JOIN product p ON ce.subject_kind='product' AND p.id=ce.subject_id
      LEFT JOIN platform pf ON ce.subject_kind='platform' AND pf.id=ce.subject_id
      LEFT JOIN configuration_node n ON ce.subject_kind='configuration_node' AND n.id=ce.subject_id
      LEFT JOIN release r ON ce.subject_kind='release' AND r.id=ce.subject_id
      LEFT JOIN organization o ON ce.subject_kind='organization' AND o.id=ce.subject_id
      LEFT JOIN baseline_occurrence bo ON ce.subject_kind='occurrence' AND bo.id=ce.subject_id
      LEFT JOIN baseline_record_extension ext ON ext.baseline_occurrence_id=bo.id
      LEFT JOIN source_row_24 sr ON sr.id=bo.source_row_id LEFT JOIN release fr ON fr.id=ce.from_release_id LEFT JOIN release tr ON tr.id=ce.to_release_id
      WHERE cr.program_id=? ORDER BY ce.created_at`).bind(PROGRAM_ID).all<EffectRow>(),
    db.prepare("SELECT cd.id,cd.predecessor_request_id,cd.successor_request_id,cd.dependency_type,cd.rationale,cd.consequence_if_unmet,cd.owner,cd.confidence,cd.source_reference,cd.source_as_of FROM change_dependency cd JOIN change_request cr ON cr.id=cd.predecessor_request_id WHERE cr.program_id=? ORDER BY cd.created_at").bind(PROGRAM_ID).all<{ id: string; predecessor_request_id: string; successor_request_id: string; dependency_type: DependencyType; rationale: string | null; consequence_if_unmet: string | null; owner: string | null; confidence: "reported" | "assessed" | "confirmed"; source_reference: string | null; source_as_of: string | null }>(),
    db.prepare("SELECT id,name FROM release WHERE program_id=? ORDER BY name").bind(PROGRAM_ID).all<{ id: string; name: string }>(),
    db.prepare("SELECT id,canonical_name AS label FROM product WHERE program_id=? AND lifecycle_status='active' ORDER BY canonical_name").bind(PROGRAM_ID).all<{ id: string; label: string }>(),
    db.prepare("SELECT id,code || ' · ' || name AS label FROM platform WHERE program_id=? ORDER BY code").bind(PROGRAM_ID).all<{ id: string; label: string }>(),
    db.prepare("SELECT id,name AS label FROM configuration_node WHERE program_id=? ORDER BY name").bind(PROGRAM_ID).all<{ id: string; label: string }>(),
    db.prepare("SELECT bo.id,COALESCE(ext.source_key,sr.source_key,'Baseline record') || ' · ' || COALESCE(r.name,'Unassigned release') AS label FROM baseline_occurrence bo LEFT JOIN baseline_record_extension ext ON ext.baseline_occurrence_id=bo.id LEFT JOIN source_row_24 sr ON sr.id=bo.source_row_id LEFT JOIN release r ON r.id=bo.release_id WHERE bo.program_id=? AND bo.lifecycle_status='active' ORDER BY r.name,COALESCE(ext.source_key,sr.source_key),bo.created_at").bind(PROGRAM_ID).all<{ id: string; label: string }>(),
    db.prepare("SELECT id,name AS label FROM organization WHERE program_id=? ORDER BY name").bind(PROGRAM_ID).all<{ id: string; label: string }>(),
  ]);
  const requests: ChangeRequest[] = requestResult.results.map((row) => ({ id: row.id, typeId: row.type_id, typeCode: row.type_code, typeLabel: row.type_label, externalSystem: row.external_system, externalIdentifier: row.external_identifier, title: row.title, externalStatus: row.external_status, externalOwner: row.external_owner, sourceLocator: row.source_locator, sourceAsOf: row.source_as_of, requestedReleaseId: row.requested_release_id, requestedReleaseName: row.requested_release_name, governmentPriority: row.government_priority, decisionStatus: row.decision_status, decisionAuthority: row.decision_authority, decisionAt: row.decision_at, decisionRationale: row.decision_rationale, referenceStatus: row.reference_status, lifecycleRationale: row.lifecycle_rationale, summary: row.summary, consequenceIfFunded: row.consequence_if_funded, consequenceIfDeferred: row.consequence_if_deferred, impactSummary: row.impact_summary, knockOnEffects: row.knock_on_effects, updatedAt: row.updated_at }));
  const effects: ChangeEffect[] = effectResult.results.map((row) => ({ id: row.id, changeRequestId: row.change_request_id, subjectKind: row.subject_kind, subjectId: row.subject_id, subjectLabel: row.subject_label || row.subject_id, action: row.action, aspect: row.aspect, fromReleaseId: row.from_release_id, fromReleaseName: row.from_release_name, toReleaseId: row.to_release_id, toReleaseName: row.to_release_name, currentValue: row.current_value, targetValue: row.target_value, consequence: row.consequence, rationale: row.rationale, confidence: row.confidence, sourceOccurrenceId: row.source_occurrence_id }));
  const dependencies: ChangeDependency[] = dependencyResult.results.map((row) => ({ id: row.id, predecessorRequestId: row.predecessor_request_id, successorRequestId: row.successor_request_id, dependencyType: row.dependency_type, rationale: row.rationale, consequenceIfUnmet: row.consequence_if_unmet, owner: row.owner, confidence: row.confidence, sourceReference: row.source_reference, sourceAsOf: row.source_as_of }));
  return {
    types: typeResult.results.map((row) => ({ id: row.id, code: row.code, label: row.label, description: row.description, active: Boolean(row.active), sortOrder: row.sort_order })),
    requests, effects, dependencies, releases: releaseResult.results,
    subjects: [
      ...productResult.results.map((row) => ({ kind: "product" as const, ...row })),
      ...platformResult.results.map((row) => ({ kind: "platform" as const, ...row })),
      ...configResult.results.map((row) => ({ kind: "configuration_node" as const, ...row })),
      ...occurrenceResult.results.map((row) => ({ kind: "occurrence" as const, ...row })),
      ...releaseResult.results.map((row) => ({ kind: "release" as const, id: row.id, label: row.name })),
      ...organizationResult.results.map((row) => ({ kind: "organization" as const, ...row })),
    ],
  };
}

export async function saveChangeRequest(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  await ensureTypes(db);
  const requestId = clean(body.id) || makeId("change");
  const typeId = clean(body.typeId);
  const externalSystem = clean(body.externalSystem);
  const externalIdentifier = clean(body.externalIdentifier);
  const title = clean(body.title);
  const priority = (clean(body.governmentPriority) || "unranked") as GovernmentPriority;
  if (!typeId || !externalSystem || !externalIdentifier || !title || !priorities.has(priority)) throw new Error("External system, request type, external identifier, title, and valid Government priority are required.");
  const validType = await db.prepare("SELECT id FROM change_request_type WHERE id=? AND program_id=? AND active=1").bind(typeId, PROGRAM_ID).first<{ id: string }>();
  if (!validType) throw new Error("Choose an active Change Request type.");
  const existing = await db.prepare("SELECT * FROM change_request WHERE id=? AND program_id=?").bind(requestId, PROGRAM_ID).first<Record<string, unknown>>();
  const at = atNow();
  await db.batch([
    db.prepare(`INSERT INTO change_request (id,program_id,type_id,external_system,external_identifier,title,external_status,external_owner,source_locator,source_as_of,requested_release_id,government_priority,decision_status,summary,consequence_if_funded,consequence_if_deferred,impact_summary,knock_on_effects,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type_id=excluded.type_id,external_system=excluded.external_system,external_identifier=excluded.external_identifier,title=excluded.title,external_status=excluded.external_status,external_owner=excluded.external_owner,source_locator=excluded.source_locator,source_as_of=excluded.source_as_of,requested_release_id=excluded.requested_release_id,government_priority=excluded.government_priority,summary=excluded.summary,consequence_if_funded=excluded.consequence_if_funded,consequence_if_deferred=excluded.consequence_if_deferred,impact_summary=excluded.impact_summary,knock_on_effects=excluded.knock_on_effects,updated_at=excluded.updated_at`)
      .bind(requestId, PROGRAM_ID, typeId, externalSystem, externalIdentifier, title, nullable(body.externalStatus), nullable(body.externalOwner), nullable(body.sourceLocator), nullable(body.sourceAsOf), nullable(body.requestedReleaseId), priority, existing?.decision_status || "pending", nullable(body.summary), nullable(body.consequenceIfFunded), nullable(body.consequenceIfDeferred), nullable(body.impactSummary), nullable(body.knockOnEffects), actor.id, at, at),
    audit(db, actor, existing ? "change_request_updated" : "change_request_created", "change_request", requestId, { externalIdentifier, title, priority }, existing || undefined),
  ]);
  return requestId;
}

export async function setFundingDecision(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const requestId = clean(body.id);
  const decisionStatus = clean(body.decisionStatus) as FundingDecision;
  const authority = clean(body.decisionAuthority);
  const rationale = clean(body.decisionRationale);
  if (!requestId || !decisions.has(decisionStatus)) throw new Error("Choose a valid funding decision.");
  if (decisionStatus !== "pending" && (!authority || !rationale)) throw new Error("Decision authority and rationale are required when funding, deferring, or declining a request.");
  const before = await db.prepare("SELECT decision_status,decision_authority,decision_at,decision_rationale FROM change_request WHERE id=? AND program_id=?").bind(requestId, PROGRAM_ID).first<Record<string, unknown>>();
  if (!before) throw new Error("Change Request was not found.");
  const at = atNow();
  await db.batch([
    db.prepare("UPDATE change_request SET decision_status=?,decision_authority=?,decision_at=?,decision_by_user_id=?,decision_rationale=?,updated_at=? WHERE id=? AND program_id=?")
      .bind(decisionStatus, decisionStatus === "pending" ? null : authority, decisionStatus === "pending" ? null : at, decisionStatus === "pending" ? null : actor.id, decisionStatus === "pending" ? null : rationale, at, requestId, PROGRAM_ID),
    audit(db, actor, "change_request_funding_decision_recorded", "change_request", requestId, { decisionStatus, authority, rationale }, before),
  ]);
  return requestId;
}

export async function setChangeRequestLifecycle(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const requestId = clean(body.id);
  const referenceStatus = clean(body.referenceStatus) as ChangeRequestReferenceStatus;
  const rationale = clean(body.lifecycleRationale);
  if (!requestId || !referenceStatuses.has(referenceStatus)) throw new Error("Choose a valid Change Request lifecycle state.");
  if (referenceStatus !== "active" && !rationale) throw new Error("A rationale is required to close or supersede a Change Request reference.");
  const before = await db.prepare("SELECT reference_status,lifecycle_rationale FROM change_request WHERE id=? AND program_id=?").bind(requestId, PROGRAM_ID).first<Record<string, unknown>>();
  if (!before) throw new Error("Change Request was not found.");
  const at = atNow();
  await db.batch([
    db.prepare("UPDATE change_request SET reference_status=?,lifecycle_rationale=?,updated_at=? WHERE id=? AND program_id=?")
      .bind(referenceStatus, referenceStatus === "active" ? null : rationale, at, requestId, PROGRAM_ID),
    audit(db, actor, "change_request_lifecycle_changed", "change_request", requestId, { referenceStatus, rationale: referenceStatus === "active" ? null : rationale }, before),
  ]);
  return requestId;
}

export async function retireChangeEffect(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const effectId = clean(body.effectId);
  const rationale = clean(body.rationale);
  if (!effectId || !rationale) throw new Error("Effect and retirement rationale are required.");
  const before = await db.prepare("SELECT ce.* FROM change_effect ce JOIN change_request cr ON cr.id=ce.change_request_id WHERE ce.id=? AND cr.program_id=?").bind(effectId, PROGRAM_ID).first<Record<string, unknown>>();
  if (!before) throw new Error("Affected-object link was not found.");
  const requestId = String(before.change_request_id);
  await db.batch([
    db.prepare("DELETE FROM change_effect WHERE id=?").bind(effectId),
    audit(db, actor, "change_effect_retired", "change_request", requestId, { rationale }, before),
  ]);
  return requestId;
}

export async function retireChangeDependency(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const dependencyId = clean(body.dependencyId);
  const rationale = clean(body.rationale);
  if (!dependencyId || !rationale) throw new Error("Dependency and retirement rationale are required.");
  const before = await db.prepare("SELECT cd.* FROM change_dependency cd JOIN change_request cr ON cr.id=cd.successor_request_id WHERE cd.id=? AND cr.program_id=?").bind(dependencyId, PROGRAM_ID).first<Record<string, unknown>>();
  if (!before) throw new Error("Change Request dependency was not found.");
  const requestId = String(before.successor_request_id);
  await db.batch([
    db.prepare("DELETE FROM change_dependency WHERE id=?").bind(dependencyId),
    audit(db, actor, "change_dependency_retired", "change_request", requestId, { rationale }, before),
  ]);
  return requestId;
}

async function assertSubject(db: Database, kind: ChangeSubjectKind, subjectId: string) {
  const tables: Record<ChangeSubjectKind, string> = { product: "product", platform: "platform", configuration_node: "configuration_node", occurrence: "baseline_occurrence", release: "release", organization: "organization" };
  const row = await db.prepare(`SELECT id FROM ${tables[kind]} WHERE id=?${kind === "occurrence" ? " AND program_id=? AND lifecycle_status='active'" : kind === "platform" || kind === "product" || kind === "configuration_node" || kind === "release" || kind === "organization" ? " AND program_id=?" : ""}`).bind(subjectId, PROGRAM_ID).first<{ id: string }>();
  if (!row) throw new Error("Choose an active subject from this program.");
}

export async function addChangeEffect(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const changeRequestId = clean(body.changeRequestId);
  const subjectKind = clean(body.subjectKind) as ChangeSubjectKind;
  const subjectId = clean(body.subjectId);
  const action = (clean(body.effectAction) || "modify") as ChangeAction;
  const aspect = clean(body.aspect) || "configuration";
  if (!changeRequestId || !subjects.has(subjectKind) || !subjectId || !actions.has(action)) throw new Error("Change Request, affected subject, action, and aspect are required.");
  const request = await db.prepare("SELECT id FROM change_request WHERE id=? AND program_id=?").bind(changeRequestId, PROGRAM_ID).first<{ id: string }>();
  if (!request) throw new Error("Change Request was not found.");
  await assertSubject(db, subjectKind, subjectId);
  const effectId = makeId("effect");
  const at = atNow();
  const confidence = new Set(["reported", "assessed", "confirmed"]).has(clean(body.confidence)) ? clean(body.confidence) : "assessed";
  await db.batch([
    db.prepare("INSERT INTO change_effect (id,change_request_id,subject_kind,subject_id,action,aspect,from_release_id,to_release_id,current_value,target_value,consequence,rationale,confidence,source_occurrence_id,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(effectId, changeRequestId, subjectKind, subjectId, action, aspect, nullable(body.fromReleaseId), nullable(body.toReleaseId), nullable(body.currentValue), nullable(body.targetValue), nullable(body.consequence), nullable(body.rationale), confidence, subjectKind === "occurrence" ? subjectId : nullable(body.sourceOccurrenceId), actor.id, at, at),
    audit(db, actor, "change_effect_added", "change_request", changeRequestId, { subjectKind, subjectId, action, aspect }),
  ]);
  return effectId;
}

export async function addChangeDependency(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const predecessor = clean(body.predecessorRequestId);
  const successor = clean(body.successorRequestId);
  const dependencyType = clean(body.dependencyType) as DependencyType;
  const rationale = clean(body.rationale);
  const consequenceIfUnmet = clean(body.consequenceIfUnmet);
  const confidence = new Set(["reported", "assessed", "confirmed"]).has(clean(body.confidence)) ? clean(body.confidence) : "reported";
  if (!predecessor || !successor || predecessor === successor || !dependencyTypes.has(dependencyType)) throw new Error("Choose two different Change Requests and a valid dependency type.");
  if (!rationale || !consequenceIfUnmet) throw new Error("Dependency rationale and consequence if unmet are required.");
  const requestCount = await db.prepare("SELECT COUNT(*) AS count FROM change_request WHERE program_id=? AND id IN (?,?)").bind(PROGRAM_ID, predecessor, successor).first<{ count: number }>();
  if (Number(requestCount?.count) !== 2) throw new Error("Both Change Requests must belong to this program.");
  if (!new Set<DependencyType>(["conflicts", "overlaps"]).has(dependencyType)) {
    const rows = await db.prepare("SELECT predecessor_request_id,successor_request_id FROM change_dependency cd JOIN change_request cr ON cr.id=cd.predecessor_request_id WHERE cr.program_id=? AND cd.dependency_type NOT IN ('conflicts','overlaps')").bind(PROGRAM_ID).all<{ predecessor_request_id: string; successor_request_id: string }>();
    const next = new Map<string, string[]>();
    for (const row of rows.results) next.set(row.predecessor_request_id, [...(next.get(row.predecessor_request_id) || []), row.successor_request_id]);
    const pending = [successor];
    const visited = new Set<string>();
    while (pending.length) { const current = pending.pop()!; if (current === predecessor) throw new Error("That dependency would create a Change Request cycle."); if (visited.has(current)) continue; visited.add(current); pending.push(...(next.get(current) || [])); }
  }
  const dependencyId = makeId("dependency");
  const at = atNow();
  await db.batch([
    db.prepare("INSERT INTO change_dependency (id,predecessor_request_id,successor_request_id,dependency_type,rationale,consequence_if_unmet,owner,confidence,source_reference,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(dependencyId, predecessor, successor, dependencyType, rationale, consequenceIfUnmet, nullable(body.owner), confidence, nullable(body.sourceReference), nullable(body.sourceAsOf), actor.id, at, at),
    audit(db, actor, "change_dependency_added", "change_request", successor, { predecessor, dependencyType, rationale, consequenceIfUnmet, confidence, sourceReference: nullable(body.sourceReference) }),
  ]);
  return dependencyId;
}

export async function assignOccurrences(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const changeRequestId = clean(body.changeRequestId);
  const occurrenceIds = Array.isArray(body.occurrenceIds) ? Array.from(new Set(body.occurrenceIds.map(clean).filter(Boolean))) : [];
  const effectAction = (clean(body.effectAction) || "modify") as ChangeAction;
  if (!changeRequestId || !occurrenceIds.length || !actions.has(effectAction)) throw new Error("Choose a Change Request, valid action, and at least one baseline record.");
  const request = await db.prepare("SELECT id FROM change_request WHERE id=? AND program_id=?").bind(changeRequestId, PROGRAM_ID).first<{ id: string }>();
  if (!request) throw new Error("Change Request was not found.");
  const at = atNow();
  const statements: D1PreparedStatement[] = [];
  for (const occurrenceId of occurrenceIds) {
    await assertSubject(db, "occurrence", occurrenceId);
    statements.push(db.prepare("INSERT INTO change_effect (id,change_request_id,subject_kind,subject_id,action,aspect,consequence,confidence,source_occurrence_id,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(makeId("effect"), changeRequestId, "occurrence", occurrenceId, effectAction, clean(body.aspect) || "configuration", nullable(body.consequence), "assessed", occurrenceId, actor.id, at, at));
  }
  statements.push(audit(db, actor, "source_occurrences_assigned_to_change_request", "change_request", changeRequestId, { occurrenceIds }));
  await db.batch(statements);
  return changeRequestId;
}
