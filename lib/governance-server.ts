import { env } from "cloudflare:workers";
import type { BriefSnapshot, BriefStatus, GovernanceRecordStatus, GovernanceRecordType, InitiativePriority, InitiativeStatus, Portfolio, WorkPackageStatus } from "./governance-model";

export const PROGRAM_ID = "program-jsf";
// This is the existing authoritative baseline workspace. Governance records
// deliberately share it; a second workspace would make brief snapshots look
// empty even though the intake grid has materialized source occurrences.
export const WORKSPACE_ID = "workspace-jsf-current";

type Database = typeof env.DB;
type Actor = Portfolio["actor"];

const initiativeStatusSet = new Set<InitiativeStatus>(["draft", "active", "decision_required", "closed"]);
const initiativePrioritySet = new Set<InitiativePriority>(["low", "medium", "high", "critical"]);
const workPackageStatusSet = new Set<WorkPackageStatus>(["planned", "in_progress", "on_hold", "complete"]);
const recordTypeSet = new Set<GovernanceRecordType>(["mcp", "technical_call", "decision", "risk", "question", "technical_note"]);
const recordStatusSet = new Set<GovernanceRecordStatus>(["open", "in_review", "approved", "closed", "superseded"]);
const briefStatusSet = new Set<BriefStatus>(["draft", "reviewed", "published", "superseded"]);

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;
const normalized = (value: unknown) => clean(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const asArray = <T>(value: unknown) => Array.isArray(value) ? value as T[] : [];
const json = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };

function actorFromRequest(request: Request) {
  const userId = request.headers.get("oai-authenticated-user-id") || "local-baseline-steward";
  const email = request.headers.get("oai-authenticated-user-email");
  const fullName = request.headers.get("oai-authenticated-user-full-name");
  const displayName = fullName ? decodeURIComponent(fullName) : email || "Baseline steward";
  return { id: userId, email, displayName };
}

export async function ensureActor(db: Database, request: Request): Promise<Actor> {
  const candidate = actorFromRequest(request);
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(PROGRAM_ID, "Joint Strike Fighter", "F-35 technical baseline program", "America/New_York", at, at),
    db.prepare("INSERT INTO app_user (id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,updated_at=excluded.updated_at").bind(candidate.id, candidate.email, candidate.displayName, at, at),
  ]);
  const existing = await db.prepare("SELECT role FROM program_role_assignment WHERE program_id=? AND user_id=?").bind(PROGRAM_ID, candidate.id).first<{ role: Actor["role"] }>();
  let role = existing?.role;
  if (!role) {
    const count = await db.prepare("SELECT COUNT(*) AS count FROM program_role_assignment WHERE program_id=?").bind(PROGRAM_ID).first<{ count: number }>();
    role = Number(count?.count ?? 0) === 0 ? "steward" : "editor";
    await db.prepare("INSERT INTO program_role_assignment (id,program_id,user_id,role,assigned_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id("role"), PROGRAM_ID, candidate.id, role, candidate.id, at, at).run();
  }
  return { id: candidate.id, displayName: candidate.displayName, role };
}

export function requireWriter(actor: Actor) {
  if (actor.role === "viewer") throw new Error("This account is a viewer. A steward or editor must make this change.");
}

export function audit(db: Database, actor: Actor, action: string, entityKind: string, entityId: string, after: unknown, before?: unknown) {
  return db.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,before_payload,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id("audit"), PROGRAM_ID, actor.id, action, entityKind, entityId, before === undefined ? null : JSON.stringify(before), JSON.stringify(after), now());
}

type InitiativeRow = {
  id: string; primary_release_id: string | null; title: string; status: InitiativeStatus; priority: InitiativePriority; owner: string | null; target_date: string | null;
  consequence: string | null; desired_outcome: string | null; decision_ask: string | null; created_at: string; updated_at: string; primary_release_name: string | null;
};

type WorkPackageRow = { id: string; initiative_id: string | null; change_request_id: string | null; objective_id: string | null; parent_id: string | null; wbs_code: string; title: string; owner: string | null; planned_start: string | null; due_date: string | null; actual_start: string | null; actual_finish: string | null; status: WorkPackageStatus; definition_of_done: string | null; progress_basis: string | null; notes: string | null; sort_order: number; created_at: string; updated_at: string };
type WorkPackageDependencyRow = { id: string; predecessor_work_package_id: string; successor_work_package_id: string; relationship: "FS" | "SS" | "FF" | "SF"; lag_days: number; status: "proposed" | "accepted" | "rejected" | "retired"; rationale: string; source_reference: string | null; updated_at: string };
type ScopeRow = { id: string; initiative_id: string; scope_kind: "product" | "release" | "capability" | "occurrence" | "configuration_node"; scope_id: string; display_label: string | null };
type RecordRow = { id: string; record_type: GovernanceRecordType; external_reference: string | null; title: string; status: GovernanceRecordStatus; owner: string | null; occurred_at: string | null; due_date: string | null; summary: string | null; decision_ask: string | null; impact: string | null; created_at: string; updated_at: string };
type LinkRow = { id: string; governance_record_id: string; entity_kind: "initiative" | "work_package" | "release" | "product" | "capability" | "occurrence" | "configuration_node"; entity_id: string; relationship: string; display_label: string | null };
type DocumentRow = { id: string; governance_record_id: string | null; initiative_id: string | null; file_name: string; content_type: string | null; byte_size: number; description: string | null; created_at: string };
type BriefRow = { id: string; initiative_id: string | null; initiative_title: string | null; title: string; status: BriefStatus; notes: string | null; snapshot_payload: string; body_markdown: string; published_at: string | null; created_at: string; updated_at: string };
type ActivityRow = { id: string; action: string; entity_kind: string; entity_id: string; actor_name: string | null; created_at: string };

export async function portfolio(db: Database, actor: Actor): Promise<Portfolio> {
  const [initiativeResult, scopeResult, workPackageResult, workDependencyResult, recordResult, linkResult, documentResult, briefResult, activityResult] = await Promise.all([
    db.prepare("SELECT i.*, r.name AS primary_release_name FROM initiative i LEFT JOIN release r ON r.id=i.primary_release_id WHERE i.program_id=? ORDER BY i.updated_at DESC").bind(PROGRAM_ID).all<InitiativeRow>(),
    db.prepare("SELECT s.id,s.initiative_id,s.scope_kind,s.scope_id,s.display_label FROM initiative_scope s JOIN initiative i ON i.id=s.initiative_id WHERE i.program_id=? ORDER BY s.created_at ASC").bind(PROGRAM_ID).all<ScopeRow>(),
    db.prepare("SELECT w.* FROM work_package w LEFT JOIN initiative i ON i.id=w.initiative_id LEFT JOIN incumbent_objective o ON o.id=w.objective_id LEFT JOIN change_request cr ON cr.id=COALESCE(w.change_request_id,o.change_request_id) WHERE i.program_id=? OR o.program_id=? OR cr.program_id=? ORDER BY COALESCE(w.initiative_id,''),COALESCE(w.objective_id,''),w.sort_order,w.wbs_code").bind(PROGRAM_ID, PROGRAM_ID, PROGRAM_ID).all<WorkPackageRow>(),
    db.prepare("SELECT d.* FROM work_package_dependency d JOIN work_package w ON w.id=d.predecessor_work_package_id LEFT JOIN initiative i ON i.id=w.initiative_id LEFT JOIN incumbent_objective o ON o.id=w.objective_id WHERE i.program_id=? OR o.program_id=? ORDER BY d.status,d.updated_at").bind(PROGRAM_ID, PROGRAM_ID).all<WorkPackageDependencyRow>(),
    db.prepare("SELECT * FROM governance_record WHERE program_id=? ORDER BY occurred_at DESC,updated_at DESC").bind(PROGRAM_ID).all<RecordRow>(),
    db.prepare("SELECT l.*, COALESCE(i.title,p.canonical_name,r.name,c.name,n.name,CASE WHEN o.id IS NOT NULL THEN 'Source occurrence' END,'Linked record') AS display_label FROM governance_record_link l LEFT JOIN initiative i ON l.entity_kind='initiative' AND i.id=l.entity_id LEFT JOIN product p ON l.entity_kind='product' AND p.id=l.entity_id LEFT JOIN release r ON l.entity_kind='release' AND r.id=l.entity_id LEFT JOIN capability c ON l.entity_kind='capability' AND c.id=l.entity_id LEFT JOIN configuration_node n ON l.entity_kind='configuration_node' AND n.id=l.entity_id LEFT JOIN baseline_occurrence o ON l.entity_kind='occurrence' AND o.id=l.entity_id").all<LinkRow>(),
    db.prepare("SELECT id,governance_record_id,initiative_id,file_name,content_type,byte_size,description,created_at FROM evidence_document WHERE program_id=? ORDER BY created_at DESC").bind(PROGRAM_ID).all<DocumentRow>(),
    db.prepare("SELECT b.*, i.title AS initiative_title FROM executive_brief b LEFT JOIN initiative i ON i.id=b.initiative_id WHERE b.program_id=? ORDER BY b.updated_at DESC").bind(PROGRAM_ID).all<BriefRow>(),
    db.prepare("SELECT a.id,a.action,a.entity_kind,a.entity_id,u.display_name AS actor_name,a.created_at FROM audit_event a LEFT JOIN app_user u ON u.id=a.actor_id WHERE a.program_id=? ORDER BY a.created_at DESC LIMIT 30").bind(PROGRAM_ID).all<ActivityRow>(),
  ]);

  const scopes = new Map<string, ScopeRow[]>();
  for (const entry of scopeResult.results) scopes.set(entry.initiative_id, [...(scopes.get(entry.initiative_id) ?? []), entry]);
  const workPackages = new Map<string, WorkPackageRow[]>();
  for (const entry of workPackageResult.results) if (entry.initiative_id) workPackages.set(entry.initiative_id, [...(workPackages.get(entry.initiative_id) ?? []), entry]);
  const links = new Map<string, LinkRow[]>();
  for (const entry of linkResult.results) links.set(entry.governance_record_id, [...(links.get(entry.governance_record_id) ?? []), entry]);
  const documentsByRecord = new Map<string, DocumentRow[]>();
  for (const entry of documentResult.results) if (entry.governance_record_id) documentsByRecord.set(entry.governance_record_id, [...(documentsByRecord.get(entry.governance_record_id) ?? []), entry]);
  const recordLinksByInitiative = new Map<string, number>();
  for (const entry of linkResult.results) if (entry.entity_kind === "initiative") recordLinksByInitiative.set(entry.entity_id, (recordLinksByInitiative.get(entry.entity_id) ?? 0) + 1);

  return {
    actor,
    initiatives: initiativeResult.results.map((entry) => ({
      id: entry.id, title: entry.title, status: entry.status, priority: entry.priority, owner: entry.owner, targetDate: entry.target_date,
      consequence: entry.consequence, desiredOutcome: entry.desired_outcome, decisionAsk: entry.decision_ask, primaryReleaseId: entry.primary_release_id,
      primaryReleaseName: entry.primary_release_name, scope: (scopes.get(entry.id) ?? []).map((scope) => ({ id: scope.id, scopeKind: scope.scope_kind, scopeId: scope.scope_id, displayLabel: scope.display_label })),
      workPackages: (workPackages.get(entry.id) ?? []).map(mapWorkPackage),
      linkedRecordCount: recordLinksByInitiative.get(entry.id) ?? 0, createdAt: entry.created_at, updatedAt: entry.updated_at,
    })),
    workPackages: workPackageResult.results.map(mapWorkPackage),
    workPackageDependencies: workDependencyResult.results.map((entry) => ({ id: entry.id, predecessorWorkPackageId: entry.predecessor_work_package_id, successorWorkPackageId: entry.successor_work_package_id, relationship: entry.relationship, lagDays: entry.lag_days, status: entry.status, rationale: entry.rationale, sourceReference: entry.source_reference, updatedAt: entry.updated_at })),
    records: recordResult.results.map((entry) => ({
      id: entry.id, recordType: entry.record_type, externalReference: entry.external_reference, title: entry.title, status: entry.status, owner: entry.owner, occurredAt: entry.occurred_at, dueDate: entry.due_date, summary: entry.summary, decisionAsk: entry.decision_ask, impact: entry.impact,
      links: (links.get(entry.id) ?? []).map((link) => ({ id: link.id, entityKind: link.entity_kind, entityId: link.entity_id, relationship: link.relationship, displayLabel: link.display_label })),
      documents: (documentsByRecord.get(entry.id) ?? []).map((document) => ({ id: document.id, governanceRecordId: document.governance_record_id, initiativeId: document.initiative_id, fileName: document.file_name, contentType: document.content_type, byteSize: document.byte_size, description: document.description, createdAt: document.created_at })),
      createdAt: entry.created_at, updatedAt: entry.updated_at,
    })),
    briefs: briefResult.results.map((entry) => ({
      id: entry.id, initiativeId: entry.initiative_id, initiativeTitle: entry.initiative_title, title: entry.title, status: entry.status, notes: entry.notes,
      snapshot: json<BriefSnapshot>(entry.snapshot_payload, emptySnapshot()), bodyMarkdown: entry.body_markdown, publishedAt: entry.published_at, createdAt: entry.created_at, updatedAt: entry.updated_at,
    })),
    activity: activityResult.results.map((entry) => ({ id: entry.id, action: entry.action, entityKind: entry.entity_kind, entityId: entry.entity_id, actorName: entry.actor_name || "Baseline steward", createdAt: entry.created_at })),
  };
}

function mapWorkPackage(work: WorkPackageRow) {
  return { id: work.id, initiativeId: work.initiative_id, changeRequestId: work.change_request_id, objectiveId: work.objective_id, parentId: work.parent_id, wbsCode: work.wbs_code, title: work.title, owner: work.owner, plannedStart: work.planned_start, dueDate: work.due_date, actualStart: work.actual_start, actualFinish: work.actual_finish, status: work.status, definitionOfDone: work.definition_of_done, progressBasis: work.progress_basis, notes: work.notes, sortOrder: work.sort_order, createdAt: work.created_at, updatedAt: work.updated_at };
}

function emptySnapshot(): BriefSnapshot {
  return { asOf: "", releaseName: "All releases", sourceRows: 0, products: 0, releases: 0, reviewRows: 0, productNames: [], linkedRecords: [] };
}

async function releaseIdFor(db: Database, releaseName: unknown) {
  const name = clean(releaseName);
  if (!name || name === "All releases") return null;
  const row = await db.prepare("SELECT id,name FROM release WHERE program_id=? AND normalized_name=?").bind(PROGRAM_ID, normalized(name)).first<{ id: string; name: string }>();
  if (!row) throw new Error(`ReleaseName "${name}" is not in the current baseline workspace.`);
  return row.id;
}

function scopeProducts(value: unknown): Array<{ id: string; label: string | null }> {
  const unique = new Map<string, string | null>();
  for (const entry of asArray<Record<string, unknown>>(value)) {
    const productId = clean(entry.id);
    if (productId) unique.set(productId, nullable(entry.label));
  }
  return [...unique.entries()].map(([id, label]) => ({ id, label }));
}

export async function createInitiative(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const title = clean(body.title);
  if (!title) throw new Error("An initiative title is required.");
  const status = initiativeStatusSet.has(body.status as InitiativeStatus) ? body.status as InitiativeStatus : "draft";
  const priority = initiativePrioritySet.has(body.priority as InitiativePriority) ? body.priority as InitiativePriority : "medium";
  const releaseId = await releaseIdFor(db, body.releaseName);
  const initiativeId = id("initiative");
  const at = now();
  const products = scopeProducts(body.productScopes);
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO initiative (id,program_id,primary_release_id,title,normalized_title,status,priority,owner,target_date,consequence,desired_outcome,decision_ask,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(initiativeId, PROGRAM_ID, releaseId, title, normalized(title), status, priority, nullable(body.owner), nullable(body.targetDate), nullable(body.consequence), nullable(body.desiredOutcome), nullable(body.decisionAsk), actor.id, at, at),
  ];
  for (const product of products) statements.push(db.prepare("INSERT INTO initiative_scope (id,initiative_id,scope_kind,scope_id,display_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id("scope"), initiativeId, "product", product.id, product.label, at, at));
  statements.push(audit(db, actor, "initiative_created", "initiative", initiativeId, { title, status, priority, releaseId, products }));
  await db.batch(statements);
  return initiativeId;
}

export async function updateInitiative(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const initiativeId = clean(body.initiativeId);
  const current = await db.prepare("SELECT * FROM initiative WHERE id=? AND program_id=?").bind(initiativeId, PROGRAM_ID).first<InitiativeRow>();
  if (!current) throw new Error("The requested initiative no longer exists.");
  const title = clean(body.title) || current.title;
  const status = initiativeStatusSet.has(body.status as InitiativeStatus) ? body.status as InitiativeStatus : current.status;
  const priority = initiativePrioritySet.has(body.priority as InitiativePriority) ? body.priority as InitiativePriority : current.priority;
  const releaseId = body.releaseName === undefined ? current.primary_release_id : await releaseIdFor(db, body.releaseName);
  const at = now();
  const next = { title, status, priority, owner: body.owner === undefined ? current.owner : nullable(body.owner), targetDate: body.targetDate === undefined ? current.target_date : nullable(body.targetDate), consequence: body.consequence === undefined ? current.consequence : nullable(body.consequence), desiredOutcome: body.desiredOutcome === undefined ? current.desired_outcome : nullable(body.desiredOutcome), decisionAsk: body.decisionAsk === undefined ? current.decision_ask : nullable(body.decisionAsk), releaseId };
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE initiative SET primary_release_id=?,title=?,normalized_title=?,status=?,priority=?,owner=?,target_date=?,consequence=?,desired_outcome=?,decision_ask=?,updated_at=? WHERE id=?")
      .bind(releaseId, title, normalized(title), status, priority, next.owner, next.targetDate, next.consequence, next.desiredOutcome, next.decisionAsk, at, initiativeId),
  ];
  if (body.productScopes !== undefined) {
    statements.push(db.prepare("DELETE FROM initiative_scope WHERE initiative_id=? AND scope_kind='product'").bind(initiativeId));
    for (const product of scopeProducts(body.productScopes)) statements.push(db.prepare("INSERT INTO initiative_scope (id,initiative_id,scope_kind,scope_id,display_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id("scope"), initiativeId, "product", product.id, product.label, at, at));
  }
  statements.push(audit(db, actor, "initiative_updated", "initiative", initiativeId, next, current));
  await db.batch(statements);
}

export async function createWorkPackage(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const initiativeId = clean(body.initiativeId);
  const objectiveId = clean(body.objectiveId);
  const title = clean(body.title);
  if ((!initiativeId && !objectiveId) || !title) throw new Error("A work package needs an Objective or Initiative context and a title.");
  let changeRequestId = clean(body.changeRequestId) || null;
  if (objectiveId) {
    const objective = await db.prepare("SELECT id,change_request_id FROM incumbent_objective WHERE id=? AND program_id=?").bind(objectiveId, PROGRAM_ID).first<{ id: string; change_request_id: string }>();
    if (!objective) throw new Error("Choose an LM Objective from this program.");
    if (changeRequestId && changeRequestId !== objective.change_request_id) throw new Error("The work package Change Request must own the selected Objective.");
    changeRequestId = objective.change_request_id;
    if (initiativeId) {
      const linked = await db.prepare("SELECT id FROM initiative_change_request WHERE initiative_id=? AND change_request_id=?").bind(initiativeId, changeRequestId).first<{ id: string }>();
      if (!linked) throw new Error("The Objective's Change Request must be linked to the selected Initiative.");
    }
  }
  const parentId = clean(body.parentId) || null;
  if (parentId) {
    const parent = await db.prepare("SELECT objective_id FROM work_package WHERE id=?").bind(parentId).first<{ objective_id: string | null }>();
    if (!parent || parent.objective_id !== (objectiveId || null)) throw new Error("A child work package must use the same Objective as its parent.");
  }
  const count = objectiveId ? await db.prepare("SELECT COUNT(*) AS count FROM work_package WHERE objective_id=?").bind(objectiveId).first<{ count: number }>() : await db.prepare("SELECT COUNT(*) AS count FROM work_package WHERE initiative_id=?").bind(initiativeId).first<{ count: number }>();
  const workPackageId = id("wbs");
  const at = now();
  const code = clean(body.wbsCode) || `WP-${String(Number(count?.count ?? 0) + 1).padStart(2, "0")}`;
  const status = workPackageStatusSet.has(body.status as WorkPackageStatus) ? body.status as WorkPackageStatus : "planned";
  await db.batch([
    db.prepare("INSERT INTO work_package (id,initiative_id,change_request_id,objective_id,parent_id,wbs_code,title,owner,planned_start,due_date,status,definition_of_done,progress_basis,notes,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(workPackageId, initiativeId || null, changeRequestId, objectiveId || null, parentId, code, title, nullable(body.owner), nullable(body.plannedStart), nullable(body.dueDate), status, nullable(body.definitionOfDone), nullable(body.progressBasis), nullable(body.notes), Number(count?.count ?? 0), at, at),
    audit(db, actor, "work_package_created", "work_package", workPackageId, { initiativeId: initiativeId || null, changeRequestId, objectiveId: objectiveId || null, code, title, status }),
  ]);
  return workPackageId;
}

export async function updateWorkPackage(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const workPackageId = clean(body.workPackageId);
  const current = await db.prepare("SELECT * FROM work_package WHERE id=?").bind(workPackageId).first<WorkPackageRow>();
  if (!current) throw new Error("The requested work package no longer exists.");
  const status = workPackageStatusSet.has(body.status as WorkPackageStatus) ? body.status as WorkPackageStatus : current.status;
  const next = { title: clean(body.title) || current.title, code: clean(body.wbsCode) || current.wbs_code, owner: body.owner === undefined ? current.owner : nullable(body.owner), plannedStart: body.plannedStart === undefined ? current.planned_start : nullable(body.plannedStart), dueDate: body.dueDate === undefined ? current.due_date : nullable(body.dueDate), actualStart: body.actualStart === undefined ? current.actual_start : nullable(body.actualStart), actualFinish: body.actualFinish === undefined ? current.actual_finish : nullable(body.actualFinish), status, definitionOfDone: body.definitionOfDone === undefined ? current.definition_of_done : nullable(body.definitionOfDone), progressBasis: body.progressBasis === undefined ? current.progress_basis : nullable(body.progressBasis), notes: body.notes === undefined ? current.notes : nullable(body.notes) };
  await db.batch([
    db.prepare("UPDATE work_package SET wbs_code=?,title=?,owner=?,planned_start=?,due_date=?,actual_start=?,actual_finish=?,status=?,definition_of_done=?,progress_basis=?,notes=?,updated_at=? WHERE id=?").bind(next.code, next.title, next.owner, next.plannedStart, next.dueDate, next.actualStart, next.actualFinish, next.status, next.definitionOfDone, next.progressBasis, next.notes, now(), workPackageId),
    audit(db, actor, "work_package_updated", "work_package", workPackageId, next, current),
  ]);
}

export async function saveWorkPackageDependency(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const dependencyId = clean(body.id) || id("wbs-dependency");
  const predecessorId = clean(body.predecessorWorkPackageId);
  const successorId = clean(body.successorWorkPackageId);
  const relationship = new Set(["FS", "SS", "FF", "SF"]).has(clean(body.relationship)) ? clean(body.relationship) : "FS";
  const status = new Set(["proposed", "accepted", "rejected", "retired"]).has(clean(body.status)) ? clean(body.status) : "proposed";
  const rationale = clean(body.rationale);
  const sourceReference = nullable(body.sourceReference);
  const lagDays = Number(body.lagDays || 0);
  if (!predecessorId || !successorId || predecessorId === successorId || !rationale || !Number.isInteger(lagDays)) throw new Error("Two different work packages, a rationale, and a whole-number lag are required.");
  if (status === "accepted" && !sourceReference) throw new Error("An accepted schedule dependency requires a source reference.");
  const found = await db.prepare("SELECT COUNT(*) AS count FROM work_package WHERE id IN (?,?)").bind(predecessorId, successorId).first<{ count: number }>();
  if (Number(found?.count) !== 2) throw new Error("Both work packages must exist.");
  if (status === "accepted") {
    const rows = await db.prepare("SELECT predecessor_work_package_id,successor_work_package_id FROM work_package_dependency WHERE status='accepted' AND id<>?").bind(dependencyId).all<{ predecessor_work_package_id: string; successor_work_package_id: string }>();
    const graph = new Map<string, string[]>();
    for (const row of rows.results) graph.set(row.predecessor_work_package_id, [...(graph.get(row.predecessor_work_package_id) || []), row.successor_work_package_id]);
    const pending = [successorId]; const visited = new Set<string>();
    while (pending.length) { const currentId = pending.pop()!; if (currentId === predecessorId) throw new Error("That accepted dependency would create a schedule cycle."); if (visited.has(currentId)) continue; visited.add(currentId); pending.push(...(graph.get(currentId) || [])); }
  }
  const before = await db.prepare("SELECT * FROM work_package_dependency WHERE id=?").bind(dependencyId).first<Record<string, unknown>>();
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO work_package_dependency (id,predecessor_work_package_id,successor_work_package_id,relationship,lag_days,status,rationale,source_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET predecessor_work_package_id=excluded.predecessor_work_package_id,successor_work_package_id=excluded.successor_work_package_id,relationship=excluded.relationship,lag_days=excluded.lag_days,status=excluded.status,rationale=excluded.rationale,source_reference=excluded.source_reference,updated_at=excluded.updated_at").bind(dependencyId, predecessorId, successorId, relationship, lagDays, status, rationale, sourceReference, actor.id, at, at),
    audit(db, actor, before ? "work_package_dependency_updated" : "work_package_dependency_created", "work_package_dependency", dependencyId, { predecessorId, successorId, relationship, lagDays, status, rationale, sourceReference }, before),
  ]);
  return dependencyId;
}

function governanceLinks(value: unknown) {
  const validKinds = new Set(["initiative", "work_package", "release", "product", "capability", "occurrence", "configuration_node"]);
  const unique = new Map<string, { kind: string; id: string; relationship: string }>();
  for (const entry of asArray<Record<string, unknown>>(value)) {
    const kind = clean(entry.kind);
    const targetId = clean(entry.id);
    const relationship = clean(entry.relationship) || "affects";
    if (validKinds.has(kind) && targetId) unique.set(`${kind}:${targetId}:${relationship}`, { kind, id: targetId, relationship });
  }
  return [...unique.values()];
}

export async function createGovernanceRecord(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const type = recordTypeSet.has(body.recordType as GovernanceRecordType) ? body.recordType as GovernanceRecordType : "technical_note";
  const title = clean(body.title);
  if (!title) throw new Error("A title is required for a governance record.");
  const status = recordStatusSet.has(body.status as GovernanceRecordStatus) ? body.status as GovernanceRecordStatus : "open";
  const recordId = id("record");
  const at = now();
  const links = governanceLinks(body.links);
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO governance_record (id,program_id,record_type,external_reference,title,status,owner,occurred_at,due_date,summary,decision_ask,impact,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(recordId, PROGRAM_ID, type, nullable(body.externalReference), title, status, nullable(body.owner), nullable(body.occurredAt), nullable(body.dueDate), nullable(body.summary), nullable(body.decisionAsk), nullable(body.impact), actor.id, at, at),
  ];
  for (const link of links) statements.push(db.prepare("INSERT INTO governance_record_link (id,governance_record_id,entity_kind,entity_id,relationship,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id("record-link"), recordId, link.kind, link.id, link.relationship, at, at));
  statements.push(audit(db, actor, "governance_record_created", "governance_record", recordId, { type, title, status, links }));
  await db.batch(statements);
  return recordId;
}

export async function updateGovernanceRecord(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const recordId = clean(body.recordId);
  const current = await db.prepare("SELECT * FROM governance_record WHERE id=? AND program_id=?").bind(recordId, PROGRAM_ID).first<RecordRow>();
  if (!current) throw new Error("The requested governance record no longer exists.");
  const status = recordStatusSet.has(body.status as GovernanceRecordStatus) ? body.status as GovernanceRecordStatus : current.status;
  const next = { title: clean(body.title) || current.title, status, owner: body.owner === undefined ? current.owner : nullable(body.owner), dueDate: body.dueDate === undefined ? current.due_date : nullable(body.dueDate), summary: body.summary === undefined ? current.summary : nullable(body.summary), decisionAsk: body.decisionAsk === undefined ? current.decision_ask : nullable(body.decisionAsk), impact: body.impact === undefined ? current.impact : nullable(body.impact) };
  await db.batch([
    db.prepare("UPDATE governance_record SET title=?,status=?,owner=?,due_date=?,summary=?,decision_ask=?,impact=?,updated_at=? WHERE id=?").bind(next.title, next.status, next.owner, next.dueDate, next.summary, next.decisionAsk, next.impact, now(), recordId),
    audit(db, actor, "governance_record_updated", "governance_record", recordId, next, current),
  ]);
}

type SourceScopeRow = { projection_payload: string; product_id: string | null; release_id: string | null; materialization_status: string; product_name: string | null; release_name: string | null };

export async function createExecutiveBrief(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const initiativeId = clean(body.initiativeId);
  const initiative = await db.prepare("SELECT i.*,r.name AS primary_release_name FROM initiative i LEFT JOIN release r ON r.id=i.primary_release_id WHERE i.id=? AND i.program_id=?").bind(initiativeId, PROGRAM_ID).first<InitiativeRow>();
  if (!initiative) throw new Error("Choose a durable initiative before creating a brief.");
  const productScopes = await db.prepare("SELECT scope_id FROM initiative_scope WHERE initiative_id=? AND scope_kind='product'").bind(initiativeId).all<{ scope_id: string }>();
  const scopedProductIds = new Set(productScopes.results.map((entry) => entry.scope_id));
  const sourceRows = await db.prepare("SELECT bo.projection_payload,bo.product_id,bo.release_id,bo.materialization_status,p.canonical_name AS product_name,r.name AS release_name FROM baseline_occurrence bo LEFT JOIN product p ON p.id=bo.product_id LEFT JOIN release r ON r.id=bo.release_id WHERE bo.workspace_id=?").bind(WORKSPACE_ID).all<SourceScopeRow>();
  const selectedRows = sourceRows.results.filter((row) => (!initiative.primary_release_id || row.release_id === initiative.primary_release_id) && (!scopedProductIds.size || (row.product_id && scopedProductIds.has(row.product_id))));
  const linkedRecords = await db.prepare("SELECT g.record_type,g.title,g.status FROM governance_record g JOIN governance_record_link l ON l.governance_record_id=g.id WHERE l.entity_kind='initiative' AND l.entity_id=? ORDER BY g.updated_at DESC").bind(initiativeId).all<{ record_type: string; title: string; status: string }>();
  const productNames = [...new Set(selectedRows.map((row) => row.product_name || productFromPayload(row.projection_payload)).filter(Boolean))].slice(0, 20) as string[];
  const releaseNames = new Set(selectedRows.map((row) => row.release_name).filter(Boolean));
  const snapshot: BriefSnapshot = { asOf: now(), releaseName: initiative.primary_release_name || "All releases", sourceRows: selectedRows.length, products: new Set(selectedRows.map((row) => row.product_id || productFromPayload(row.projection_payload))).size, releases: releaseNames.size, reviewRows: selectedRows.filter((row) => row.materialization_status !== "materialized").length, productNames, linkedRecords: linkedRecords.results.map((record) => ({ type: record.record_type, title: record.title, status: record.status })) };
  const title = clean(body.title) || `${initiative.title} - Executive one-pager`;
  const briefId = id("brief");
  const at = now();
  const markdown = briefMarkdown(title, initiative, snapshot);
  await db.batch([
    db.prepare("INSERT INTO executive_brief (id,program_id,initiative_id,title,status,notes,snapshot_payload,body_markdown,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(briefId, PROGRAM_ID, initiativeId, title, "draft", nullable(body.notes), JSON.stringify(snapshot), markdown, actor.id, at, at),
    audit(db, actor, "executive_brief_created", "executive_brief", briefId, { title, initiativeId, snapshot }),
  ]);
  return briefId;
}

export async function updateExecutiveBrief(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const briefId = clean(body.briefId);
  const current = await db.prepare("SELECT * FROM executive_brief WHERE id=? AND program_id=?").bind(briefId, PROGRAM_ID).first<BriefRow>();
  if (!current) throw new Error("The requested brief no longer exists.");
  const status = briefStatusSet.has(body.status as BriefStatus) ? body.status as BriefStatus : current.status;
  const notes = body.notes === undefined ? current.notes : nullable(body.notes);
  const publishedAt = status === "published" && !current.published_at ? now() : current.published_at;
  await db.batch([
    db.prepare("UPDATE executive_brief SET status=?,notes=?,published_at=?,updated_at=? WHERE id=?").bind(status, notes, publishedAt, now(), briefId),
    audit(db, actor, "executive_brief_updated", "executive_brief", briefId, { status, notes, publishedAt }, current),
  ]);
}

export async function recordBriefPublication(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const briefId = clean(body.briefId);
  const format = clean(body.format);
  if (format !== "markdown" && format !== "pdf" && format !== "docx") throw new Error("Unsupported brief publication format.");
  const brief = await db.prepare("SELECT snapshot_payload,updated_at FROM executive_brief WHERE id=? AND program_id=?").bind(briefId, PROGRAM_ID).first<{ snapshot_payload: string; updated_at: string }>();
  if (!brief) throw new Error("The requested brief no longer exists.");
  const publicationId = id("brief-publication");
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO brief_publication (id,brief_id,format,content_hash,snapshot_payload,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?)").bind(publicationId, briefId, format, `${briefId}:${brief.updated_at}:${format}`, brief.snapshot_payload, actor.id, at),
    audit(db, actor, "executive_brief_exported", "executive_brief", briefId, { publicationId, format }),
  ]);
}

function productFromPayload(payload: string) {
  const row = json<Record<string, unknown>>(payload, {});
  return clean(row.LongName) || clean(row.ShortName) || "Unassigned product";
}

function briefMarkdown(title: string, initiative: InitiativeRow, snapshot: BriefSnapshot) {
  const linked = snapshot.linkedRecords.length ? snapshot.linkedRecords.map((record) => `- ${record.type}: ${record.title} (${record.status})`).join("\n") : "- No linked MCPs, calls, decisions, or risks yet.";
  const products = snapshot.productNames.length ? snapshot.productNames.map((name) => `- ${name}`).join("\n") : "- No current source occurrences match this scope.";
  return `# ${title}\n\n## Decision / outcome\n${initiative.decision_ask || "Decision ask not yet recorded."}\n\n${initiative.desired_outcome || "Desired outcome not yet recorded."}\n\n## Scope snapshot\n- As of: ${snapshot.asOf}\n- Release scope: ${snapshot.releaseName}\n- Source records: ${snapshot.sourceRows}\n- Products: ${snapshot.products}\n- Releases: ${snapshot.releases}\n- Records needing review: ${snapshot.reviewRows}\n\n## Consequence\n${initiative.consequence || "Not yet recorded."}\n\n## Representative products\n${products}\n\n## Linked Government record(s)\n${linked}\n`;
}

export type DocumentBucket = { put: (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string; contentDisposition?: string } }) => Promise<unknown>; get: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string; contentDisposition?: string } } | null> };

export function documentsBucket() {
  return (env as unknown as { DOCUMENTS?: DocumentBucket }).DOCUMENTS;
}
