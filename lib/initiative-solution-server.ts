import { env } from "cloudflare:workers";
import type { Portfolio } from "./governance-model";
import { audit, PROGRAM_ID, requireWriter } from "./governance-server";
import { initiativeDecisionWorkspace } from "./initiative-decision-server";
import { buildSolutionDecisionBasis, canonicalSolutionDecisionBasis, hashSolutionDecisionBasis } from "./solution-decision-basis";
import type {
  EstimateConfidence,
  InitiativeChangeRelationship,
  SolutionAssessmentCriterion,
  SolutionAssessmentRating,
  SolutionDecisionDisposition,
  SolutionObjectiveRole,
  SolutionOptionStatus,
  SolutionOptionType,
} from "./initiative-decision-model";

type Database = typeof env.DB;
type Actor = Portfolio["actor"];
const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;
const normalized = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T) => allowed.includes(value as T) ? value as T : fallback;
const validDate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
};

async function assertInitiative(db: Database, initiativeId: string) {
  const initiative = await db.prepare("SELECT id FROM initiative WHERE id=? AND program_id=?").bind(initiativeId, PROGRAM_ID).first<{ id: string }>();
  if (!initiative) throw new Error("Initiative was not found.");
  return initiative;
}

async function optionContext(db: Database, optionId: string) {
  const option = await db.prepare("SELECT o.*,i.program_id FROM solution_option o JOIN initiative i ON i.id=o.initiative_id WHERE o.id=? AND i.program_id=?").bind(optionId, PROGRAM_ID).first<Record<string, unknown>>();
  if (!option) throw new Error("Solution option was not found.");
  return option;
}

async function assertOptionMutable(db: Database, optionId: string) {
  const selected = await db.prepare("SELECT d.id FROM initiative_solution_decision d WHERE d.selected_option_id=? AND d.disposition='selected'").bind(optionId).first<{ id: string }>();
  if (selected) throw new Error("Return the Initiative adjudication to pending before changing its selected solution option.");
}

export async function saveSolutionOption(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const optionId = clean(body.id) || makeId("solution-option");
  const initiativeId = clean(body.initiativeId);
  const title = clean(body.title);
  if (!initiativeId || !title) throw new Error("Initiative and solution title are required.");
  await assertInitiative(db, initiativeId);
  const before = await db.prepare("SELECT * FROM solution_option WHERE id=?").bind(optionId).first<Record<string, unknown>>();
  if (before && clean(before.initiative_id) !== initiativeId) throw new Error("A solution option cannot be moved to another Initiative.");
  if (before) await assertOptionMutable(db, optionId);
  const optionType = oneOf<SolutionOptionType>(body.optionType, ["candidate", "status_quo"], "candidate");
  const status = oneOf<SolutionOptionStatus>(body.status, ["draft", "under_review", "recommended", "not_selected", "retired"], "draft");
  if (["not_selected", "retired"].includes(status)) {
    const selected = await db.prepare("SELECT id FROM initiative_solution_decision WHERE initiative_id=? AND selected_option_id=? AND disposition='selected'").bind(initiativeId, optionId).first<{ id: string }>();
    if (selected) throw new Error("Change the Initiative decision before retiring or marking the selected option not selected.");
  }
  const duplicate = await db.prepare("SELECT id FROM solution_option WHERE initiative_id=? AND normalized_title=? AND id<>?").bind(initiativeId, normalized(title), optionId).first<{ id: string }>();
  if (duplicate) throw new Error("This Initiative already has a solution option with that title.");
  const count = before ? null : await db.prepare("SELECT COUNT(*) AS count FROM solution_option WHERE initiative_id=?").bind(initiativeId).first<{ count: number }>();
  const sortOrder = before ? Number(before.sort_order || 0) : Number(count?.count || 0);
  const at = now();
  const next = { optionId, title, optionType, status, summary: nullable(body.summary), projectedOutcome: nullable(body.projectedOutcome), expectedConsequences: nullable(body.expectedConsequences), residualRisks: nullable(body.residualRisks), assumptions: nullable(body.assumptions), sortOrder };
  await db.batch([
    db.prepare("INSERT INTO solution_option (id,initiative_id,title,normalized_title,option_type,status,summary,projected_outcome,expected_consequences,residual_risks,assumptions,sort_order,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,normalized_title=excluded.normalized_title,option_type=excluded.option_type,status=excluded.status,summary=excluded.summary,projected_outcome=excluded.projected_outcome,expected_consequences=excluded.expected_consequences,residual_risks=excluded.residual_risks,assumptions=excluded.assumptions,updated_at=excluded.updated_at")
      .bind(optionId, initiativeId, title, normalized(title), optionType, status, next.summary, next.projectedOutcome, next.expectedConsequences, next.residualRisks, next.assumptions, sortOrder, actor.id, at, at),
    audit(db, actor, before ? "solution_option_updated" : "solution_option_created", "initiative", initiativeId, next, before),
  ]);
  return optionId;
}

export async function saveSolutionStep(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const stepId = clean(body.id) || makeId("solution-step");
  const optionId = clean(body.optionId);
  const title = clean(body.title);
  if (!optionId || !title) throw new Error("Solution option and step title are required.");
  const option = await optionContext(db, optionId);
  await assertOptionMutable(db, optionId);
  const initiativeId = clean(option.initiative_id);
  const before = await db.prepare("SELECT * FROM solution_option_step WHERE id=?").bind(stepId).first<Record<string, unknown>>();
  if (before && clean(before.option_id) !== optionId) throw new Error("A solution step cannot be moved to another option.");
  const count = before ? null : await db.prepare("SELECT COUNT(*) AS count FROM solution_option_step WHERE option_id=?").bind(optionId).first<{ count: number }>();
  const sortOrder = before ? Number(before.sort_order || 0) : Number(count?.count || 0);
  const at = now();
  const next = { stepId, optionId, title, description: nullable(body.description), expectedResult: nullable(body.expectedResult), sortOrder };
  await db.batch([
    db.prepare("INSERT INTO solution_option_step (id,option_id,title,description,expected_result,sort_order,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,expected_result=excluded.expected_result,updated_at=excluded.updated_at")
      .bind(stepId, optionId, title, next.description, next.expectedResult, sortOrder, actor.id, at, at),
    audit(db, actor, before ? "solution_step_updated" : "solution_step_created", "initiative", initiativeId, next, before),
  ]);
  return stepId;
}

export async function setSolutionChangeRequest(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const optionId = clean(body.optionId);
  const changeRequestId = clean(body.changeRequestId);
  const option = await optionContext(db, optionId);
  await assertOptionMutable(db, optionId);
  const initiativeId = clean(option.initiative_id);
  const available = await db.prepare("SELECT id FROM initiative_change_request WHERE initiative_id=? AND change_request_id=?").bind(initiativeId, changeRequestId).first<{ id: string }>();
  if (!available) throw new Error("Link the Change Request to the Initiative before selecting it for a solution option.");
  const relationship = oneOf<InitiativeChangeRelationship>(body.relationship, ["delivers", "enables", "constrains", "supports"], "delivers");
  const before = await db.prepare("SELECT * FROM solution_option_change_request WHERE option_id=? AND change_request_id=?").bind(optionId, changeRequestId).first<Record<string, unknown>>();
  const linkId = clean(before?.id) || makeId("solution-change");
  const at = now();
  const next = { optionId, changeRequestId, relationship, rationale: nullable(body.rationale) };
  await db.batch([
    db.prepare("INSERT INTO solution_option_change_request (id,option_id,change_request_id,relationship,rationale,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(option_id,change_request_id) DO UPDATE SET relationship=excluded.relationship,rationale=excluded.rationale,updated_at=excluded.updated_at")
      .bind(linkId, optionId, changeRequestId, relationship, next.rationale, actor.id, at, at),
    audit(db, actor, before ? "solution_change_request_updated" : "solution_change_request_selected", "initiative", initiativeId, next, before),
  ]);
  return linkId;
}

export async function removeSolutionChangeRequest(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const optionId = clean(body.optionId);
  const changeRequestId = clean(body.changeRequestId);
  const rationale = clean(body.rationale);
  if (!rationale) throw new Error("A removal rationale is required.");
  const option = await optionContext(db, optionId);
  await assertOptionMutable(db, optionId);
  const initiativeId = clean(option.initiative_id);
  const before = await db.prepare("SELECT * FROM solution_option_change_request WHERE option_id=? AND change_request_id=?").bind(optionId, changeRequestId).first<Record<string, unknown>>();
  if (!before) throw new Error("The option no longer includes that Change Request.");
  const stranded = await db.prepare(`SELECT l.id FROM solution_option_objective l
    JOIN incumbent_objective o ON o.id=l.objective_id
    WHERE l.option_id=?
      AND (o.change_request_id=? OR EXISTS (SELECT 1 FROM objective_change_request_link r WHERE r.objective_id=o.id AND r.change_request_id=?))
      AND NOT EXISTS (
        SELECT 1 FROM solution_option_change_request other
        WHERE other.option_id=? AND other.change_request_id<>?
          AND (other.change_request_id=o.change_request_id OR EXISTS (SELECT 1 FROM objective_change_request_link r2 WHERE r2.objective_id=o.id AND r2.change_request_id=other.change_request_id))
      ) LIMIT 1`).bind(optionId, changeRequestId, changeRequestId, optionId, changeRequestId).first<{ id: string }>();
  if (stranded) throw new Error("Remove or reassign the option's Objectives before removing their only selected Change Request.");
  const result = await db.batch([
    db.prepare("DELETE FROM solution_option_change_request WHERE option_id=? AND change_request_id=?").bind(optionId, changeRequestId),
    audit(db, actor, "solution_change_request_removed", "initiative", initiativeId, { optionId, changeRequestId, rationale }, before),
  ]);
  if (Number(result[0]?.meta?.changes || 0) !== 1) throw new Error("The solution selection changed before it could be removed. Reload and try again.");
  return changeRequestId;
}

export async function setSolutionObjective(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const optionId = clean(body.optionId);
  const objectiveId = clean(body.objectiveId);
  const option = await optionContext(db, optionId);
  await assertOptionMutable(db, optionId);
  const initiativeId = clean(option.initiative_id);
  const trace = await db.prepare(`SELECT o.id FROM incumbent_objective o
    WHERE o.id=? AND o.program_id=? AND EXISTS (
      SELECT 1 FROM solution_option_change_request selected
      WHERE selected.option_id=? AND (selected.change_request_id=o.change_request_id OR EXISTS (
        SELECT 1 FROM objective_change_request_link r WHERE r.objective_id=o.id AND r.change_request_id=selected.change_request_id
      ))
    )`).bind(objectiveId, PROGRAM_ID, optionId).first<{ id: string }>();
  if (!trace) throw new Error("Select a Change Request that traces to this Objective before adding it to the option.");
  const role = oneOf<SolutionObjectiveRole>(body.role, ["required", "enabling", "optional"], "required");
  const before = await db.prepare("SELECT * FROM solution_option_objective WHERE option_id=? AND objective_id=?").bind(optionId, objectiveId).first<Record<string, unknown>>();
  const linkId = clean(before?.id) || makeId("solution-objective");
  const at = now();
  const next = { optionId, objectiveId, role, rationale: nullable(body.rationale) };
  await db.batch([
    db.prepare("INSERT INTO solution_option_objective (id,option_id,objective_id,role,rationale,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(option_id,objective_id) DO UPDATE SET role=excluded.role,rationale=excluded.rationale,updated_at=excluded.updated_at")
      .bind(linkId, optionId, objectiveId, role, next.rationale, actor.id, at, at),
    audit(db, actor, before ? "solution_objective_updated" : "solution_objective_selected", "initiative", initiativeId, next, before),
  ]);
  return linkId;
}

export async function removeSolutionObjective(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const optionId = clean(body.optionId);
  const objectiveId = clean(body.objectiveId);
  const rationale = clean(body.rationale);
  if (!rationale) throw new Error("A removal rationale is required.");
  const option = await optionContext(db, optionId);
  await assertOptionMutable(db, optionId);
  const initiativeId = clean(option.initiative_id);
  const before = await db.prepare("SELECT * FROM solution_option_objective WHERE option_id=? AND objective_id=?").bind(optionId, objectiveId).first<Record<string, unknown>>();
  if (!before) throw new Error("The option no longer includes that Objective.");
  const result = await db.batch([
    db.prepare("DELETE FROM solution_option_objective WHERE option_id=? AND objective_id=?").bind(optionId, objectiveId),
    audit(db, actor, "solution_objective_removed", "initiative", initiativeId, { optionId, objectiveId, rationale }, before),
  ]);
  if (Number(result[0]?.meta?.changes || 0) !== 1) throw new Error("The Objective selection changed before it could be removed. Reload and try again.");
  return objectiveId;
}

export async function saveSolutionAssessment(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const optionId = clean(body.optionId);
  const option = await optionContext(db, optionId);
  await assertOptionMutable(db, optionId);
  const initiativeId = clean(option.initiative_id);
  const criterion = oneOf<SolutionAssessmentCriterion>(body.criterion, ["outcome_alignment", "delivery_effort", "schedule_feasibility", "cyber_lifecycle", "mission_operational_impact", "stakeholder_impact", "requirements_acceptance"], "outcome_alignment");
  const rating = oneOf<SolutionAssessmentRating>(body.rating, ["favorable", "mixed", "unfavorable", "unassessed"], "unassessed");
  const confidence = oneOf<EstimateConfidence>(body.confidence, ["low", "medium", "high", "unassessed"], "unassessed");
  if (rating !== "unassessed" && !clean(body.narrative)) throw new Error("A rated assessment requires a concise Government rationale.");
  const before = await db.prepare("SELECT * FROM solution_option_assessment WHERE option_id=? AND criterion=?").bind(optionId, criterion).first<Record<string, unknown>>();
  const assessmentId = clean(before?.id) || makeId("solution-assessment");
  const at = now();
  const next = { optionId, criterion, rating, narrative: nullable(body.narrative), sourceReference: nullable(body.sourceReference), confidence };
  await db.batch([
    db.prepare("INSERT INTO solution_option_assessment (id,option_id,criterion,rating,narrative,source_reference,confidence,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(option_id,criterion) DO UPDATE SET rating=excluded.rating,narrative=excluded.narrative,source_reference=excluded.source_reference,confidence=excluded.confidence,updated_at=excluded.updated_at")
      .bind(assessmentId, optionId, criterion, rating, next.narrative, next.sourceReference, confidence, actor.id, at, at),
    audit(db, actor, before ? "solution_assessment_updated" : "solution_assessment_created", "initiative", initiativeId, next, before),
  ]);
  return assessmentId;
}

export async function saveSolutionDecision(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const initiativeId = clean(body.initiativeId);
  await assertInitiative(db, initiativeId);
  const disposition = oneOf<SolutionDecisionDisposition>(body.disposition, ["pending", "selected", "deferred", "no_action"], "pending");
  const selectedOptionId = nullable(body.selectedOptionId);
  const requestedAuthority = nullable(body.decisionAuthority);
  const requestedDate = nullable(body.decisionDate);
  const requestedRationale = nullable(body.rationale);
  const decisionAuthority = disposition === "pending" ? null : requestedAuthority;
  const decisionDate = disposition === "pending" ? null : requestedDate;
  const rationale = disposition === "pending" ? null : requestedRationale;
  const acceptedResidualRisk = disposition === "pending" ? null : nullable(body.acceptedResidualRisk);
  if (disposition === "selected" && !selectedOptionId) throw new Error("A selected decision requires a solution option.");
  if (disposition !== "selected" && selectedOptionId) throw new Error("Only a selected disposition may name a selected option.");
  if (disposition !== "pending" && (!decisionAuthority || !decisionDate || !rationale)) throw new Error("A completed adjudication requires the authority, decision date, and rationale.");
  if (disposition !== "pending" && !validDate(decisionDate)) throw new Error("A completed adjudication requires a valid calendar decision date.");
  if (selectedOptionId) {
    const option = await db.prepare("SELECT id,status FROM solution_option WHERE id=? AND initiative_id=?").bind(selectedOptionId, initiativeId).first<{ id: string; status: SolutionOptionStatus }>();
    if (!option || option.status === "retired" || option.status === "not_selected") throw new Error("Choose an active solution option from this Initiative that has not been retired or marked not selected.");
  }
  const before = await db.prepare("SELECT id,initiative_id,selected_option_id,disposition,decision_authority,decision_date,rationale,accepted_residual_risk,basis_snapshot_json,basis_hash,decision_revision,created_by_user_id,created_at,updated_at FROM initiative_solution_decision WHERE initiative_id=?").bind(initiativeId).first<Record<string, unknown>>();
  if (before && clean(before.disposition) !== "pending" && disposition !== "pending") {
    throw new Error("Return the Initiative adjudication to pending before changing a completed decision.");
  }
  const decisionId = clean(before?.id) || makeId("solution-decision");
  const at = now();
  const decisionRevision = disposition === "pending" ? Number(before?.decision_revision || 0) : Number(before?.decision_revision || 0) + 1;
  let basisSnapshotJson: string | null = null;
  let basisHash: string | null = null;
  if (disposition === "selected" && selectedOptionId) {
    const workspace = await initiativeDecisionWorkspace(db, actor, { initiativeId });
    const basis = buildSolutionDecisionBasis(workspace, initiativeId, selectedOptionId);
    basisSnapshotJson = canonicalSolutionDecisionBasis(basis);
    basisHash = await hashSolutionDecisionBasis(basis);
  }
  const latestRevision = before ? await db.prepare("SELECT disposition,selected_option_id,decision_authority,decision_date,rationale,accepted_residual_risk,basis_hash,revision FROM initiative_solution_decision_revision WHERE decision_id=? ORDER BY revision DESC LIMIT 1").bind(decisionId).first<Record<string, unknown>>() : null;
  if (disposition !== "pending" && latestRevision) {
    const metadataUnchanged = clean(latestRevision.decision_authority) === decisionAuthority
      && clean(latestRevision.decision_date) === decisionDate
      && clean(latestRevision.rationale) === rationale
      && (nullable(latestRevision.accepted_residual_risk) || null) === acceptedResidualRisk;
    if (metadataUnchanged && disposition === "selected" && clean(latestRevision.disposition) === "selected" && clean(latestRevision.selected_option_id) === selectedOptionId && clean(latestRevision.basis_hash) === basisHash) {
      throw new Error("The selected option, source-backed basis, and adjudication metadata have not changed. The prior adjudication remains the current revision.");
    }
    if (metadataUnchanged) throw new Error("Enter fresh decision authority, date, rationale, or residual-risk metadata for the new adjudication revision.");
    if (clean(latestRevision.decision_date) > decisionDate!) throw new Error("A new adjudication cannot be dated before the prior recorded revision.");
  }
  const next = { initiativeId, selectedOptionId, disposition, decisionAuthority, decisionDate, rationale, acceptedResidualRisk, basisSnapshotJson, basisHash, decisionRevision };
  const mutation = before
    ? db.prepare("UPDATE initiative_solution_decision SET selected_option_id=?,disposition=?,decision_authority=?,decision_date=?,rationale=?,accepted_residual_risk=?,basis_snapshot_json=?,basis_hash=?,decision_revision=?,created_by_user_id=?,updated_at=? WHERE id=? AND disposition=? AND decision_revision=?")
      .bind(selectedOptionId, disposition, decisionAuthority, decisionDate, rationale, acceptedResidualRisk, basisSnapshotJson, basisHash, decisionRevision, actor.id, at, decisionId, before.disposition, before.decision_revision)
    : db.prepare("INSERT INTO initiative_solution_decision (id,initiative_id,selected_option_id,disposition,decision_authority,decision_date,rationale,accepted_residual_risk,basis_snapshot_json,basis_hash,decision_revision,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(decisionId, initiativeId, selectedOptionId, disposition, decisionAuthority, decisionDate, rationale, acceptedResidualRisk, basisSnapshotJson, basisHash, decisionRevision, actor.id, at, at);
  const results = await db.batch([
    mutation,
    audit(db, actor, before ? (disposition === "pending" ? "solution_decision_returned_to_pending" : "solution_decision_readjudicated") : "solution_decision_recorded", "initiative", initiativeId, next, before),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) throw new Error("The Initiative adjudication changed before it could be saved. Reload and try again.");
  return decisionId;
}
