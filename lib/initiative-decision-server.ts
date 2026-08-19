import { env } from "cloudflare:workers";
import type { Portfolio } from "./governance-model";
import { audit, PROGRAM_ID, requireWriter } from "./governance-server";
import { changePortfolio } from "./change-server";
import { assessInitiative } from "./initiative-readiness";
import type {
  AcceptanceCriterion, AcceptanceSignoff, AcceptanceStatus, AcceptanceTier, EstimateConfidence, EstimateSource,
  IncumbentObjective, InitiativeChangeLink, InitiativeChangeRelationship, InitiativeDecisionBundle, InitiativeDecisionProfile,
  InitiativeDecisionWorkspace, InitiativeMilestone, MilestoneStatus, MilestoneType, ObjectiveEstimate, ObjectiveStatus,
  RequirementAction, RequirementTrace, RequirementTraceStatus, SignoffDecision, VerificationMethod,
} from "./initiative-decision-model";

type Database = typeof env.DB;
type Actor = Portfolio["actor"];
const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;
const numberOrNull = (value: unknown) => value === "" || value === null || value === undefined ? null : Number(value);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T) => allowed.includes(value as T) ? value as T : fallback;

type InitiativeRow = { id: string; title: string; status: string; priority: string; owner: string | null; target_date: string | null; consequence: string | null; desired_outcome: string | null; decision_ask: string | null; as_is_statement: string | null; to_be_statement: string | null; success_measures: string | null; briefing_audience: string | null; decision_needed_by: string | null; primary_release_id: string | null; primary_release_name: string | null; updated_at: string };
type LinkRow = { id: string; initiative_id: string; change_request_id: string; relationship: InitiativeChangeRelationship; contribution_summary: string | null; sort_order: number };
type ObjectiveRow = { id: string; change_request_id: string; external_system: string; external_identifier: string; title: string; summary: string | null; technical_owner: string | null; status: ObjectiveStatus; planned_start: string | null; planned_finish: string | null; actual_start: string | null; actual_finish: string | null; source_locator: string | null; source_as_of: string | null; updated_at: string };
type EstimateRow = { id: string; objective_id: string; estimate_source: EstimateSource; hours_low: number | null; hours_likely: number | null; hours_high: number | null; cost_low: number | null; cost_likely: number | null; cost_high: number | null; basis: string; assumptions: string | null; source_reference: string | null; as_of: string; confidence: EstimateConfidence; created_at: string };
type RequirementRow = { id: string; objective_id: string; external_identifier: string; title: string; source_system: string; source_locator: string | null; source_as_of: string | null; change_action: RequirementAction; before_text: string | null; after_text: string | null; rationale: string | null; trace_status: RequirementTraceStatus; updated_at: string };
type CriterionRow = { id: string; objective_id: string; requirement_trace_id: string | null; tier: AcceptanceTier; code: string; statement: string; verification_method: VerificationMethod; status: AcceptanceStatus; planned_date: string | null; actual_date: string | null; evidence_reference: string | null; updated_at: string };
type SignoffRow = { id: string; criterion_id: string; signoff_role: string; signer: string | null; decision: SignoffDecision; decided_at: string | null; rationale: string | null; evidence_document_id: string | null; updated_at: string };
type MilestoneRow = { id: string; initiative_id: string; change_request_id: string | null; objective_id: string | null; title: string; milestone_type: MilestoneType; planned_date: string; actual_date: string | null; status: MilestoneStatus; consequence_if_missed: string | null; owner: string | null; sort_order: number; updated_at: string };

export async function initiativeDecisionWorkspace(db: Database, actor: Actor): Promise<InitiativeDecisionWorkspace> {
  const changes = await changePortfolio(db);
  const [initiativeResult, linkResult, objectiveResult, estimateResult, requirementResult, criterionResult, signoffResult, milestoneResult] = await Promise.all([
    db.prepare("SELECT i.*,r.name AS primary_release_name FROM initiative i LEFT JOIN release r ON r.id=i.primary_release_id WHERE i.program_id=? ORDER BY i.updated_at DESC").bind(PROGRAM_ID).all<InitiativeRow>(),
    db.prepare("SELECT l.id,l.initiative_id,l.change_request_id,l.relationship,l.contribution_summary,l.sort_order FROM initiative_change_request l JOIN initiative i ON i.id=l.initiative_id WHERE i.program_id=? ORDER BY l.initiative_id,l.sort_order,l.created_at").bind(PROGRAM_ID).all<LinkRow>(),
    db.prepare("SELECT o.* FROM incumbent_objective o JOIN change_request cr ON cr.id=o.change_request_id WHERE o.program_id=? AND cr.program_id=? ORDER BY o.planned_start,o.external_identifier").bind(PROGRAM_ID, PROGRAM_ID).all<ObjectiveRow>(),
    db.prepare("SELECT e.* FROM objective_estimate e JOIN incumbent_objective o ON o.id=e.objective_id WHERE o.program_id=? ORDER BY e.objective_id,e.as_of DESC,e.created_at DESC").bind(PROGRAM_ID).all<EstimateRow>(),
    db.prepare("SELECT q.* FROM requirement_trace q JOIN incumbent_objective o ON o.id=q.objective_id WHERE o.program_id=? ORDER BY q.objective_id,q.external_identifier").bind(PROGRAM_ID).all<RequirementRow>(),
    db.prepare("SELECT c.* FROM acceptance_criterion c JOIN incumbent_objective o ON o.id=c.objective_id WHERE o.program_id=? ORDER BY c.objective_id,c.tier,c.code").bind(PROGRAM_ID).all<CriterionRow>(),
    db.prepare("SELECT s.* FROM acceptance_signoff s JOIN acceptance_criterion c ON c.id=s.criterion_id JOIN incumbent_objective o ON o.id=c.objective_id WHERE o.program_id=? ORDER BY s.criterion_id,s.signoff_role").bind(PROGRAM_ID).all<SignoffRow>(),
    db.prepare("SELECT m.* FROM initiative_milestone m JOIN initiative i ON i.id=m.initiative_id WHERE i.program_id=? ORDER BY m.initiative_id,m.planned_date,m.sort_order").bind(PROGRAM_ID).all<MilestoneRow>(),
  ]);
  const estimatesByObjective = new Map<string, ObjectiveEstimate[]>();
  for (const row of estimateResult.results) estimatesByObjective.set(row.objective_id, [...(estimatesByObjective.get(row.objective_id) || []), { id: row.id, objectiveId: row.objective_id, estimateSource: row.estimate_source, hoursLow: row.hours_low, hoursLikely: row.hours_likely, hoursHigh: row.hours_high, costLow: row.cost_low, costLikely: row.cost_likely, costHigh: row.cost_high, basis: row.basis, assumptions: row.assumptions, sourceReference: row.source_reference, asOf: row.as_of, confidence: row.confidence, createdAt: row.created_at }]);
  const signoffsByCriterion = new Map<string, AcceptanceSignoff[]>();
  for (const row of signoffResult.results) signoffsByCriterion.set(row.criterion_id, [...(signoffsByCriterion.get(row.criterion_id) || []), { id: row.id, criterionId: row.criterion_id, signoffRole: row.signoff_role, signer: row.signer, decision: row.decision, decidedAt: row.decided_at, rationale: row.rationale, evidenceDocumentId: row.evidence_document_id, updatedAt: row.updated_at }]);
  const initiatives: InitiativeDecisionProfile[] = initiativeResult.results.map((row) => ({ id: row.id, title: row.title, status: row.status, priority: row.priority, owner: row.owner, targetDate: row.target_date, consequence: row.consequence, desiredOutcome: row.desired_outcome, decisionAsk: row.decision_ask, asIsStatement: row.as_is_statement, toBeStatement: row.to_be_statement, successMeasures: row.success_measures, briefingAudience: row.briefing_audience, decisionNeededBy: row.decision_needed_by, primaryReleaseId: row.primary_release_id, primaryReleaseName: row.primary_release_name, updatedAt: row.updated_at }));
  const links: InitiativeChangeLink[] = linkResult.results.map((row) => ({ id: row.id, initiativeId: row.initiative_id, changeRequestId: row.change_request_id, relationship: row.relationship, contributionSummary: row.contribution_summary, sortOrder: row.sort_order }));
  const objectives: IncumbentObjective[] = objectiveResult.results.map((row) => ({ id: row.id, changeRequestId: row.change_request_id, externalSystem: row.external_system, externalIdentifier: row.external_identifier, title: row.title, summary: row.summary, technicalOwner: row.technical_owner, status: row.status, plannedStart: row.planned_start, plannedFinish: row.planned_finish, actualStart: row.actual_start, actualFinish: row.actual_finish, sourceLocator: row.source_locator, sourceAsOf: row.source_as_of, estimates: estimatesByObjective.get(row.id) || [], updatedAt: row.updated_at }));
  const requirements: RequirementTrace[] = requirementResult.results.map((row) => ({ id: row.id, objectiveId: row.objective_id, externalIdentifier: row.external_identifier, title: row.title, sourceSystem: row.source_system, sourceLocator: row.source_locator, sourceAsOf: row.source_as_of, changeAction: row.change_action, beforeText: row.before_text, afterText: row.after_text, rationale: row.rationale, traceStatus: row.trace_status, updatedAt: row.updated_at }));
  const criteria: AcceptanceCriterion[] = criterionResult.results.map((row) => ({ id: row.id, objectiveId: row.objective_id, requirementTraceId: row.requirement_trace_id, tier: row.tier, code: row.code, statement: row.statement, verificationMethod: row.verification_method, status: row.status, plannedDate: row.planned_date, actualDate: row.actual_date, evidenceReference: row.evidence_reference, signoffs: signoffsByCriterion.get(row.id) || [], updatedAt: row.updated_at }));
  const milestones: InitiativeMilestone[] = milestoneResult.results.map((row) => ({ id: row.id, initiativeId: row.initiative_id, changeRequestId: row.change_request_id, objectiveId: row.objective_id, title: row.title, milestoneType: row.milestone_type, plannedDate: row.planned_date, actualDate: row.actual_date, status: row.status, consequenceIfMissed: row.consequence_if_missed, owner: row.owner, sortOrder: row.sort_order, updatedAt: row.updated_at }));
  const assessments: InitiativeDecisionWorkspace["assessments"] = {};
  for (const initiative of initiatives) assessments[initiative.id] = assessInitiative(bundleFor({ actor, initiatives, links, objectives, requirements, criteria, milestones, changes, assessments: {} }, initiative.id));
  return { actor, initiatives, links, objectives, requirements, criteria, milestones, changes, assessments };
}

export function bundleFor(workspace: Omit<InitiativeDecisionWorkspace, "assessments"> & { assessments?: InitiativeDecisionWorkspace["assessments"] }, initiativeId: string): InitiativeDecisionBundle {
  const initiative = workspace.initiatives.find((item) => item.id === initiativeId);
  if (!initiative) throw new Error("Initiative was not found.");
  const links = workspace.links.filter((item) => item.initiativeId === initiativeId);
  const requestIds = new Set(links.map((item) => item.changeRequestId));
  const objectives = workspace.objectives.filter((item) => requestIds.has(item.changeRequestId));
  const objectiveIds = new Set(objectives.map((item) => item.id));
  return { initiative, links, changeRequests: workspace.changes.requests.filter((item) => requestIds.has(item.id)), objectives, requirements: workspace.requirements.filter((item) => objectiveIds.has(item.objectiveId)), criteria: workspace.criteria.filter((item) => objectiveIds.has(item.objectiveId)), milestones: workspace.milestones.filter((item) => item.initiativeId === initiativeId), changes: workspace.changes };
}

async function assertInitiative(db: Database, initiativeId: string) {
  const row = await db.prepare("SELECT id FROM initiative WHERE id=? AND program_id=?").bind(initiativeId, PROGRAM_ID).first<{ id: string }>();
  if (!row) throw new Error("Initiative was not found.");
}

export async function saveDecisionProfile(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const initiativeId = clean(body.initiativeId);
  await assertInitiative(db, initiativeId);
  const before = await db.prepare("SELECT * FROM initiative WHERE id=?").bind(initiativeId).first<Record<string, unknown>>();
  const next = { asIsStatement: nullable(body.asIsStatement), toBeStatement: nullable(body.toBeStatement), successMeasures: nullable(body.successMeasures), briefingAudience: nullable(body.briefingAudience), decisionNeededBy: nullable(body.decisionNeededBy), decisionAsk: nullable(body.decisionAsk), desiredOutcome: nullable(body.desiredOutcome), consequence: nullable(body.consequence), owner: nullable(body.owner), targetDate: nullable(body.targetDate) };
  const at = now();
  await db.batch([
    db.prepare("UPDATE initiative SET as_is_statement=?,to_be_statement=?,success_measures=?,briefing_audience=?,decision_needed_by=?,decision_ask=?,desired_outcome=?,consequence=?,owner=?,target_date=?,updated_at=? WHERE id=? AND program_id=?").bind(next.asIsStatement, next.toBeStatement, next.successMeasures, next.briefingAudience, next.decisionNeededBy, next.decisionAsk, next.desiredOutcome, next.consequence, next.owner, next.targetDate, at, initiativeId, PROGRAM_ID),
    audit(db, actor, "initiative_decision_profile_updated", "initiative", initiativeId, next, before),
  ]);
  return initiativeId;
}

export async function linkChangeRequest(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const initiativeId = clean(body.initiativeId);
  const changeRequestId = clean(body.changeRequestId);
  await assertInitiative(db, initiativeId);
  const request = await db.prepare("SELECT id FROM change_request WHERE id=? AND program_id=?").bind(changeRequestId, PROGRAM_ID).first<{ id: string }>();
  if (!request) throw new Error("Choose a Change Request from this program.");
  const relationship = oneOf<InitiativeChangeRelationship>(body.relationship, ["delivers", "enables", "constrains", "supports"], "delivers");
  const count = await db.prepare("SELECT COUNT(*) AS count FROM initiative_change_request WHERE initiative_id=?").bind(initiativeId).first<{ count: number }>();
  const at = now();
  const linkId = makeId("initiative-change");
  await db.batch([
    db.prepare("INSERT INTO initiative_change_request (id,initiative_id,change_request_id,relationship,contribution_summary,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(initiative_id,change_request_id) DO UPDATE SET relationship=excluded.relationship,contribution_summary=excluded.contribution_summary,updated_at=excluded.updated_at").bind(linkId, initiativeId, changeRequestId, relationship, nullable(body.contributionSummary), Number(count?.count || 0), at, at),
    audit(db, actor, "change_request_linked_to_initiative", "initiative", initiativeId, { changeRequestId, relationship, contributionSummary: nullable(body.contributionSummary) }),
  ]);
  return linkId;
}

export async function saveObjective(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const objectiveId = clean(body.id) || makeId("objective");
  const changeRequestId = clean(body.changeRequestId);
  const externalSystem = clean(body.externalSystem);
  const externalIdentifier = clean(body.externalIdentifier);
  const title = clean(body.title);
  if (!changeRequestId || !externalSystem || !externalIdentifier || !title) throw new Error("Change Request, external system, Objective identifier, and title are required.");
  const request = await db.prepare("SELECT id FROM change_request WHERE id=? AND program_id=?").bind(changeRequestId, PROGRAM_ID).first<{ id: string }>();
  if (!request) throw new Error("Change Request was not found.");
  const status = oneOf<ObjectiveStatus>(body.status, ["proposed", "planned", "in_progress", "blocked", "verification", "complete", "cancelled"], "proposed");
  const before = await db.prepare("SELECT * FROM incumbent_objective WHERE id=?").bind(objectiveId).first<Record<string, unknown>>();
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO incumbent_objective (id,program_id,change_request_id,external_system,external_identifier,title,summary,technical_owner,status,planned_start,planned_finish,actual_start,actual_finish,source_locator,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET change_request_id=excluded.change_request_id,external_system=excluded.external_system,external_identifier=excluded.external_identifier,title=excluded.title,summary=excluded.summary,technical_owner=excluded.technical_owner,status=excluded.status,planned_start=excluded.planned_start,planned_finish=excluded.planned_finish,actual_start=excluded.actual_start,actual_finish=excluded.actual_finish,source_locator=excluded.source_locator,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at").bind(objectiveId, PROGRAM_ID, changeRequestId, externalSystem, externalIdentifier, title, nullable(body.summary), nullable(body.technicalOwner), status, nullable(body.plannedStart), nullable(body.plannedFinish), nullable(body.actualStart), nullable(body.actualFinish), nullable(body.sourceLocator), nullable(body.sourceAsOf), actor.id, at, at),
    audit(db, actor, before ? "incumbent_objective_updated" : "incumbent_objective_created", "incumbent_objective", objectiveId, { changeRequestId, externalSystem, externalIdentifier, title, status }, before),
  ]);
  return objectiveId;
}

export async function addObjectiveEstimate(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const objectiveId = clean(body.objectiveId);
  const objective = await db.prepare("SELECT id FROM incumbent_objective WHERE id=? AND program_id=?").bind(objectiveId, PROGRAM_ID).first<{ id: string }>();
  if (!objective) throw new Error("Objective was not found.");
  const source = oneOf<EstimateSource>(body.estimateSource, ["incumbent", "government", "independent"], "incumbent");
  const basis = clean(body.basis);
  const asOf = clean(body.asOf);
  if (!basis || !asOf) throw new Error("Estimate basis and as-of date are required.");
  const values = [body.hoursLow, body.hoursLikely, body.hoursHigh, body.costLow, body.costLikely, body.costHigh].map(numberOrNull);
  if (values.every((value) => value === null) || values.some((value) => value !== null && (!Number.isFinite(value) || value < 0))) throw new Error("Enter at least one non-negative hours or cost estimate.");
  const [hoursLow, hoursLikely, hoursHigh, costLow, costLikely, costHigh] = values;
  if (hoursLow !== null && hoursLikely !== null && hoursLow > hoursLikely || hoursLikely !== null && hoursHigh !== null && hoursLikely > hoursHigh || costLow !== null && costLikely !== null && costLow > costLikely || costLikely !== null && costHigh !== null && costLikely > costHigh) throw new Error("Estimate ranges must progress from low to likely to high.");
  const estimateId = makeId("estimate");
  const confidence = oneOf<EstimateConfidence>(body.confidence, ["unassessed", "low", "medium", "high"], "unassessed");
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO objective_estimate (id,objective_id,estimate_source,hours_low,hours_likely,hours_high,cost_low,cost_likely,cost_high,basis,assumptions,source_reference,as_of,confidence,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(estimateId, objectiveId, source, hoursLow, hoursLikely, hoursHigh, costLow, costLikely, costHigh, basis, nullable(body.assumptions), nullable(body.sourceReference), asOf, confidence, actor.id, at, at),
    audit(db, actor, "objective_estimate_recorded", "incumbent_objective", objectiveId, { estimateId, source, hoursLow, hoursLikely, hoursHigh, costLow, costLikely, costHigh, basis, asOf, confidence }),
  ]);
  return estimateId;
}

export async function saveRequirementTrace(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const requirementId = clean(body.id) || makeId("requirement");
  const objectiveId = clean(body.objectiveId);
  const externalIdentifier = clean(body.externalIdentifier);
  const title = clean(body.title);
  const sourceSystem = clean(body.sourceSystem);
  if (!objectiveId || !externalIdentifier || !title || !sourceSystem) throw new Error("Objective, requirement identifier, title, and authoritative source system are required.");
  const objective = await db.prepare("SELECT id FROM incumbent_objective WHERE id=? AND program_id=?").bind(objectiveId, PROGRAM_ID).first<{ id: string }>();
  if (!objective) throw new Error("Objective was not found.");
  const action = oneOf<RequirementAction>(body.changeAction, ["add", "modify", "retire", "verify", "none"], "verify");
  const status = oneOf<RequirementTraceStatus>(body.traceStatus, ["identified", "analysis_needed", "traced", "verified", "not_applicable"], "identified");
  if (["add", "modify"].includes(action) && !clean(body.afterText)) throw new Error("Added or modified requirements need proposed requirement text.");
  const before = await db.prepare("SELECT * FROM requirement_trace WHERE id=?").bind(requirementId).first<Record<string, unknown>>();
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO requirement_trace (id,objective_id,external_identifier,title,source_system,source_locator,source_as_of,change_action,before_text,after_text,rationale,trace_status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET external_identifier=excluded.external_identifier,title=excluded.title,source_system=excluded.source_system,source_locator=excluded.source_locator,source_as_of=excluded.source_as_of,change_action=excluded.change_action,before_text=excluded.before_text,after_text=excluded.after_text,rationale=excluded.rationale,trace_status=excluded.trace_status,updated_at=excluded.updated_at").bind(requirementId, objectiveId, externalIdentifier, title, sourceSystem, nullable(body.sourceLocator), nullable(body.sourceAsOf), action, nullable(body.beforeText), nullable(body.afterText), nullable(body.rationale), status, actor.id, at, at),
    audit(db, actor, before ? "requirement_trace_updated" : "requirement_trace_created", "requirement_trace", requirementId, { objectiveId, externalIdentifier, action, status }, before),
  ]);
  return requirementId;
}

export async function saveAcceptanceCriterion(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const criterionId = clean(body.id) || makeId("criterion");
  const objectiveId = clean(body.objectiveId);
  const code = clean(body.code);
  const statement = clean(body.statement);
  if (!objectiveId || !code || !statement) throw new Error("Objective, criterion code, and measurable statement are required.");
  const objective = await db.prepare("SELECT id FROM incumbent_objective WHERE id=? AND program_id=?").bind(objectiveId, PROGRAM_ID).first<{ id: string }>();
  if (!objective) throw new Error("Objective was not found.");
  const requirementTraceId = nullable(body.requirementTraceId);
  if (requirementTraceId) {
    const trace = await db.prepare("SELECT id FROM requirement_trace WHERE id=? AND objective_id=?").bind(requirementTraceId, objectiveId).first<{ id: string }>();
    if (!trace) throw new Error("Acceptance criterion requirement must belong to the same Objective.");
  }
  const tier = oneOf<AcceptanceTier>(body.tier, ["tier_3", "tier_4", "other"], "tier_4");
  const method = oneOf<VerificationMethod>(body.verificationMethod, ["analysis", "demonstration", "inspection", "test", "review"], "test");
  const status = oneOf<AcceptanceStatus>(body.status, ["draft", "ready", "in_verification", "passed", "failed", "waived"], "draft");
  if (status === "passed" && !clean(body.evidenceReference)) throw new Error("A passed acceptance criterion requires an evidence reference.");
  const before = await db.prepare("SELECT * FROM acceptance_criterion WHERE id=?").bind(criterionId).first<Record<string, unknown>>();
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO acceptance_criterion (id,objective_id,requirement_trace_id,tier,code,statement,verification_method,status,planned_date,actual_date,evidence_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET requirement_trace_id=excluded.requirement_trace_id,tier=excluded.tier,code=excluded.code,statement=excluded.statement,verification_method=excluded.verification_method,status=excluded.status,planned_date=excluded.planned_date,actual_date=excluded.actual_date,evidence_reference=excluded.evidence_reference,updated_at=excluded.updated_at").bind(criterionId, objectiveId, requirementTraceId, tier, code, statement, method, status, nullable(body.plannedDate), nullable(body.actualDate), nullable(body.evidenceReference), actor.id, at, at),
    audit(db, actor, before ? "acceptance_criterion_updated" : "acceptance_criterion_created", "acceptance_criterion", criterionId, { objectiveId, code, tier, method, status }, before),
  ]);
  return criterionId;
}

export async function recordAcceptanceSignoff(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const criterionId = clean(body.criterionId);
  const signoffRole = clean(body.signoffRole);
  const decision = oneOf<SignoffDecision>(body.decision, ["pending", "accepted", "rejected", "waived"], "pending");
  if (!criterionId || !signoffRole) throw new Error("Criterion and accountable sign-off role are required.");
  const criterion = await db.prepare("SELECT c.id FROM acceptance_criterion c JOIN incumbent_objective o ON o.id=c.objective_id WHERE c.id=? AND o.program_id=?").bind(criterionId, PROGRAM_ID).first<{ id: string }>();
  if (!criterion) throw new Error("Acceptance criterion was not found.");
  if (decision !== "pending" && (!clean(body.signer) || !clean(body.rationale))) throw new Error("Signer and rationale are required for a completed sign-off.");
  const existing = await db.prepare("SELECT * FROM acceptance_signoff WHERE criterion_id=? AND signoff_role=?").bind(criterionId, signoffRole).first<Record<string, unknown>>();
  const signoffId = clean(existing?.id) || makeId("signoff");
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO acceptance_signoff (id,criterion_id,signoff_role,signer,decision,decided_at,rationale,evidence_document_id,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(criterion_id,signoff_role) DO UPDATE SET signer=excluded.signer,decision=excluded.decision,decided_at=excluded.decided_at,rationale=excluded.rationale,evidence_document_id=excluded.evidence_document_id,updated_at=excluded.updated_at").bind(signoffId, criterionId, signoffRole, nullable(body.signer), decision, decision === "pending" ? null : clean(body.decidedAt) || at, nullable(body.rationale), nullable(body.evidenceDocumentId), actor.id, at, at),
    audit(db, actor, "acceptance_signoff_recorded", "acceptance_criterion", criterionId, { signoffId, signoffRole, decision, signer: nullable(body.signer), rationale: nullable(body.rationale) }, existing),
  ]);
  return signoffId;
}

export async function saveInitiativeMilestone(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const milestoneId = clean(body.id) || makeId("milestone");
  const initiativeId = clean(body.initiativeId);
  const title = clean(body.title);
  const plannedDate = clean(body.plannedDate);
  await assertInitiative(db, initiativeId);
  if (!title || !plannedDate) throw new Error("Milestone title and planned date are required.");
  const changeRequestId = nullable(body.changeRequestId);
  const objectiveId = nullable(body.objectiveId);
  if (objectiveId) {
    const objective = await db.prepare("SELECT o.id,o.change_request_id FROM incumbent_objective o WHERE o.id=? AND o.program_id=?").bind(objectiveId, PROGRAM_ID).first<{ id: string; change_request_id: string }>();
    if (!objective || changeRequestId && objective.change_request_id !== changeRequestId) throw new Error("Milestone Objective must belong to its selected Change Request.");
  }
  const type = oneOf<MilestoneType>(body.milestoneType, ["decision", "delivery", "verification", "fielding", "dependency"], "delivery");
  const status = oneOf<MilestoneStatus>(body.status, ["planned", "at_risk", "complete", "missed"], "planned");
  if (["at_risk", "missed"].includes(status) && !clean(body.consequenceIfMissed)) throw new Error("At-risk or missed milestones require a downstream consequence.");
  const count = await db.prepare("SELECT COUNT(*) AS count FROM initiative_milestone WHERE initiative_id=?").bind(initiativeId).first<{ count: number }>();
  const before = await db.prepare("SELECT * FROM initiative_milestone WHERE id=?").bind(milestoneId).first<Record<string, unknown>>();
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO initiative_milestone (id,initiative_id,change_request_id,objective_id,title,milestone_type,planned_date,actual_date,status,consequence_if_missed,owner,sort_order,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET change_request_id=excluded.change_request_id,objective_id=excluded.objective_id,title=excluded.title,milestone_type=excluded.milestone_type,planned_date=excluded.planned_date,actual_date=excluded.actual_date,status=excluded.status,consequence_if_missed=excluded.consequence_if_missed,owner=excluded.owner,updated_at=excluded.updated_at").bind(milestoneId, initiativeId, changeRequestId, objectiveId, title, type, plannedDate, nullable(body.actualDate), status, nullable(body.consequenceIfMissed), nullable(body.owner), Number(count?.count || 0), actor.id, at, at),
    audit(db, actor, before ? "initiative_milestone_updated" : "initiative_milestone_created", "initiative_milestone", milestoneId, { initiativeId, changeRequestId, objectiveId, title, type, plannedDate, status }, before),
  ]);
  return milestoneId;
}
