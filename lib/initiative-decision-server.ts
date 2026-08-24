import { env } from "cloudflare:workers";
import type { Portfolio } from "./governance-model";
import { audit, documentsBucket, PROGRAM_ID, requireWriter } from "./governance-server";
import { MAX_GOVERNED_EVIDENCE_BYTES, MAX_GOVERNED_EVIDENCE_REFERENCES, storedEvidenceIntegrityMatches } from "./evidence-validation";
import { changePortfolio } from "./change-server";
import { assessInitiative, criterionIsAccepted } from "./initiative-readiness";
import { milestoneLifecycleIssues, objectiveIdsLeavingInitiativeScope, objectiveLifecycleIssues, requirementHasAcceptancePath, requirementNeedsAcceptancePath } from "./initiative-workflow-invariants";
import { LM_OBJECTIVE_FEED_SYSTEM, parseReportedRom } from "./lm-objective-feed";
import type {
  AcceptanceCriterion, AcceptanceSignoff, AcceptanceStatus, AcceptanceTier, EstimateConfidence, EstimateSource,
  ChangeRequestObjectiveDependency, IncumbentObjective, InitiativeChangeLink, InitiativeChangeRelationship, InitiativeDecisionBundle, InitiativeDecisionProfile,
  InitiativeDecisionWorkspace, InitiativeMilestone, MilestoneStatus, MilestoneType, ObjectiveEstimate, ObjectiveStatus,
  ObjectiveAttribution, ObjectiveAttributionConfidence, ObjectiveChangeRequestLink, ObjectiveEffectAttributionRecord, ObjectiveDependencyRelationship, ObjectiveDependencyStatus,
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

type InitiativeRow = { id: string; title: string; status: string; priority: string; owner: string | null; target_date: string | null; consequence: string | null; desired_outcome: string | null; decision_ask: string | null; as_is_statement: string | null; to_be_statement: string | null; success_measures: string | null; briefing_audience: string | null; decision_needed_by: string | null; rom_hours_per_point: number | null; rom_conversion_rationale: string | null; primary_release_id: string | null; primary_release_name: string | null; updated_at: string };
type LinkRow = { id: string; initiative_id: string; change_request_id: string; relationship: InitiativeChangeRelationship; contribution_summary: string | null; sort_order: number };
type ObjectiveRow = { id: string; change_request_id: string | null; external_system: string; external_identifier: string; external_item_type: string; title: string; summary: string | null; technical_owner: string | null; status: ObjectiveStatus; planned_start: string | null; planned_finish: string | null; actual_start: string | null; actual_finish: string | null; source_locator: string | null; source_as_of: string | null; updated_at: string };
type ObjectiveChangeRequestLinkRow = { id: string; objective_id: string; change_request_id: string; relationship: "primary" | "reported" | "related"; source_system: string | null; source_locator: string | null; source_as_of: string | null; updated_at: string };
type ObjectiveDependencyRow = { id: string; dependent_change_request_id: string; prerequisite_objective_id: string; relationship: ObjectiveDependencyRelationship; status: ObjectiveDependencyStatus; rationale: string; source_reference: string | null; source_as_of: string | null; evidence_reference: string | null; updated_at: string };
type ObjectiveAttributionRow = { id: string; objective_id: string; change_effect_id: string; attribution: ObjectiveAttribution; rationale: string; source_reference: string | null; source_as_of: string | null; evidence_reference: string | null; confidence: ObjectiveAttributionConfidence; updated_at: string };
type EstimateRow = { id: string; objective_id: string; estimate_source: EstimateSource; hours_low: number | null; hours_likely: number | null; hours_high: number | null; cost_low: number | null; cost_likely: number | null; cost_high: number | null; basis: string; assumptions: string | null; source_reference: string | null; as_of: string; confidence: EstimateConfidence; created_at: string };
type FeedRomRow = { subject_id: string; canonical_objective_id: string; feed_key: string; rom: string; file_name: string; source_as_of: string | null; observed_at: string; updated_at: string };
type RequirementRow = { id: string; objective_id: string; requirement_id: string; version_label: string; external_identifier: string; title: string; source_system: string; source_locator: string | null; source_as_of: string | null; change_action: RequirementAction; before_text: string | null; after_text: string | null; rationale: string | null; trace_status: RequirementTraceStatus; updated_at: string };
type CriterionRow = { id: string; objective_id: string; requirement_trace_id: string | null; objective_requirement_id: string | null; tier: AcceptanceTier; code: string; statement: string; verification_method: VerificationMethod; status: AcceptanceStatus; planned_date: string | null; actual_date: string | null; evidence_reference: string | null; updated_at: string };
type SignoffRow = { id: string; criterion_id: string; signoff_role: string; signer: string | null; decision: SignoffDecision; decided_at: string | null; rationale: string | null; evidence_document_id: string | null; evidence_record_id: string | null; evidence_file_name: string | null; evidence_content_type: string | null; evidence_byte_size: number | null; evidence_description: string | null; evidence_r2_key: string | null; evidence_integrity_payload: string | null; updated_at: string };
type MilestoneRow = { id: string; initiative_id: string; change_request_id: string | null; objective_id: string | null; title: string; milestone_type: MilestoneType; planned_date: string; actual_date: string | null; status: MilestoneStatus; consequence_if_missed: string | null; owner: string | null; sort_order: number; updated_at: string };
type EvidenceSupportRow = { file_name: string; r2_key: string; byte_size: number; integrity_payload: string | null };
export type EvidenceVerificationScope = { initiativeId?: string; objectiveId?: string; changeRequestId?: string };

async function findVerifiedEvidenceSupport(rows: readonly EvidenceSupportRow[]) {
  const bucket = documentsBucket();
  let inspectedBytes = 0;
  for (let index = 0; index < rows.length; index += 1) {
    if (index >= MAX_GOVERNED_EVIDENCE_REFERENCES) return "budget_exceeded" as const;
    const row = rows[index];
    if (!Number.isSafeInteger(row.byte_size) || row.byte_size < 0 || inspectedBytes + row.byte_size > MAX_GOVERNED_EVIDENCE_BYTES) return "budget_exceeded" as const;
    inspectedBytes += row.byte_size;
    if (await storedEvidenceIntegrityMatches(bucket, { fileName: row.file_name, r2Key: row.r2_key, byteSize: row.byte_size, auditPayload: row.integrity_payload })) return "verified" as const;
  }
  return "none" as const;
}

export async function initiativeDecisionWorkspace(db: Database, actor: Actor, evidenceScope: EvidenceVerificationScope = {}): Promise<InitiativeDecisionWorkspace> {
  const changes = await changePortfolio(db);
  const [initiativeResult, linkResult, objectiveResult, objectiveChangeRequestLinkResult, dependencyResult, attributionResult, estimateResult, feedRomResult, requirementResult, criterionResult, signoffResult, milestoneResult] = await Promise.all([
    db.prepare("SELECT i.*,r.name AS primary_release_name FROM initiative i LEFT JOIN release r ON r.id=i.primary_release_id WHERE i.program_id=? ORDER BY i.updated_at DESC").bind(PROGRAM_ID).all<InitiativeRow>(),
    db.prepare("SELECT l.id,l.initiative_id,l.change_request_id,l.relationship,l.contribution_summary,l.sort_order FROM initiative_change_request l JOIN initiative i ON i.id=l.initiative_id WHERE i.program_id=? ORDER BY l.initiative_id,l.sort_order,l.created_at").bind(PROGRAM_ID).all<LinkRow>(),
    db.prepare("SELECT o.* FROM incumbent_objective o WHERE o.program_id=? ORDER BY o.planned_start,o.external_identifier").bind(PROGRAM_ID).all<ObjectiveRow>(),
    db.prepare("SELECT l.id,l.objective_id,l.change_request_id,l.relationship,l.source_system,l.source_locator,l.source_as_of,l.updated_at FROM objective_change_request_link l JOIN incumbent_objective o ON o.id=l.objective_id JOIN change_request cr ON cr.id=l.change_request_id WHERE o.program_id=? AND cr.program_id=? ORDER BY l.objective_id,CASE l.relationship WHEN 'primary' THEN 0 WHEN 'reported' THEN 1 ELSE 2 END,l.updated_at DESC").bind(PROGRAM_ID, PROGRAM_ID).all<ObjectiveChangeRequestLinkRow>(),
    db.prepare("SELECT d.* FROM change_request_objective_dependency d JOIN change_request cr ON cr.id=d.dependent_change_request_id JOIN incumbent_objective o ON o.id=d.prerequisite_objective_id WHERE cr.program_id=? AND o.program_id=? ORDER BY d.status,d.updated_at DESC").bind(PROGRAM_ID, PROGRAM_ID).all<ObjectiveDependencyRow>(),
    db.prepare("SELECT a.* FROM objective_effect_attribution a JOIN incumbent_objective o ON o.id=a.objective_id JOIN change_effect e ON e.id=a.change_effect_id WHERE o.program_id=? AND e.change_request_id IN (SELECT id FROM change_request WHERE program_id=?) ORDER BY a.objective_id,a.updated_at DESC").bind(PROGRAM_ID, PROGRAM_ID).all<ObjectiveAttributionRow>(),
    db.prepare("SELECT e.* FROM objective_estimate e JOIN incumbent_objective o ON o.id=e.objective_id WHERE o.program_id=? ORDER BY e.objective_id,e.as_of DESC,e.created_at DESC").bind(PROGRAM_ID).all<EstimateRow>(),
    db.prepare("SELECT s.subject_id,f.canonical_objective_id,s.feed_key,s.rom,snapshot.file_name,snapshot.source_as_of,snapshot.observed_at,s.updated_at FROM lm_objective_feed_state s JOIN lm_objective_feed_subject f ON f.id=s.subject_id JOIN lm_objective_feed_snapshot snapshot ON snapshot.id=s.latest_snapshot_id WHERE f.program_id=? AND f.external_system=? AND f.canonical_objective_id IS NOT NULL AND TRIM(COALESCE(s.rom,''))<>'' ORDER BY f.canonical_objective_id,COALESCE(snapshot.source_as_of,snapshot.observed_at) DESC,s.updated_at DESC").bind(PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM).all<FeedRomRow>(),
    db.prepare("SELECT oq.id,oq.objective_id,oq.requirement_id,oq.version_label,r.external_identifier,r.title,r.source_system,COALESCE(oq.source_reference,r.source_locator) AS source_locator,COALESCE(oq.source_as_of,r.source_as_of) AS source_as_of,oq.change_action,oq.before_text,oq.after_text,oq.rationale,oq.disposition AS trace_status,oq.updated_at FROM objective_requirement oq JOIN requirement r ON r.id=oq.requirement_id JOIN incumbent_objective o ON o.id=oq.objective_id WHERE o.program_id=? ORDER BY oq.objective_id,r.external_identifier,oq.version_label").bind(PROGRAM_ID).all<RequirementRow>(),
    db.prepare("SELECT c.* FROM acceptance_criterion c JOIN incumbent_objective o ON o.id=c.objective_id WHERE o.program_id=? ORDER BY c.objective_id,c.tier,c.code").bind(PROGRAM_ID).all<CriterionRow>(),
    db.prepare(`SELECT s.*,d.id AS evidence_record_id,d.file_name AS evidence_file_name,d.content_type AS evidence_content_type,d.byte_size AS evidence_byte_size,d.description AS evidence_description,d.r2_key AS evidence_r2_key,
      (SELECT a.after_payload FROM audit_event a WHERE a.program_id=o.program_id AND a.entity_kind='evidence_document' AND a.entity_id=s.evidence_document_id
       AND a.action IN ('evidence_document_attached','evidence_document_restored','evidence_integrity_sealed') ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS evidence_integrity_payload
      FROM acceptance_signoff s JOIN acceptance_criterion c ON c.id=s.criterion_id JOIN incumbent_objective o ON o.id=c.objective_id
      LEFT JOIN evidence_document d ON d.id=s.evidence_document_id AND d.program_id=o.program_id
      WHERE o.program_id=? ORDER BY s.criterion_id,s.signoff_role`).bind(PROGRAM_ID).all<SignoffRow>(),
    db.prepare("SELECT m.* FROM initiative_milestone m JOIN initiative i ON i.id=m.initiative_id WHERE i.program_id=? ORDER BY m.initiative_id,m.planned_date,m.sort_order").bind(PROGRAM_ID).all<MilestoneRow>(),
  ]);
  const evidenceBucket = documentsBucket();
  const signoffEvidenceStatus = new Map<string, "verified" | "unverified" | "not_checked">();
  const requestIdsByObjective = new Map<string, Set<string>>();
  for (const objective of objectiveResult.results) {
    const requestIds = new Set<string>();
    if (objective.change_request_id) requestIds.add(objective.change_request_id);
    requestIdsByObjective.set(objective.id, requestIds);
  }
  for (const link of objectiveChangeRequestLinkResult.results) {
    const requestIds = requestIdsByObjective.get(link.objective_id) ?? new Set<string>();
    requestIds.add(link.change_request_id);
    requestIdsByObjective.set(link.objective_id, requestIds);
  }
  const initiativeIdsByRequest = new Map<string, Set<string>>();
  for (const link of linkResult.results) {
    const initiativeIds = initiativeIdsByRequest.get(link.change_request_id) ?? new Set<string>();
    initiativeIds.add(link.initiative_id);
    initiativeIdsByRequest.set(link.change_request_id, initiativeIds);
  }
  const objectiveIdByCriterion = new Map(criterionResult.results.map((criterion) => [criterion.id, criterion.objective_id]));
  const evidenceCandidates = new Map<string, { row: SignoffRow; scopes: Set<string> }>();
  for (const row of signoffResult.results) {
    const documentId = row.evidence_document_id;
    if (!documentId || !["accepted", "waived"].includes(row.decision)) continue;
    const objectiveId = objectiveIdByCriterion.get(row.criterion_id) || "unknown";
    const scopes = new Set<string>([`objective:${objectiveId}`]);
    for (const requestId of requestIdsByObjective.get(objectiveId) ?? []) {
      scopes.add(`change-request:${requestId}`);
      for (const initiativeId of initiativeIdsByRequest.get(requestId) ?? []) scopes.add(`initiative:${initiativeId}`);
    }
    // Unlinked Objectives still receive an independent bounded verification
    // scope; unrelated Initiatives can never consume their evidence budget.
    const candidate = evidenceCandidates.get(documentId) ?? { row, scopes: new Set<string>() };
    for (const scope of scopes) candidate.scopes.add(scope);
    evidenceCandidates.set(documentId, candidate);
  }
  let inspectedEvidenceDocuments = 0;
  let inspectedEvidenceBytes = 0;
  // Readiness is based on current object bytes, not mutable object metadata.
  // A scoped Initiative request gets the complete governed 100-document /
  // 100-MB envelope without interference from unrelated portfolio data. The
  // unscoped portfolio endpoint uses the same envelope globally, preventing a
  // single GET from multiplying R2 reads by the number of Initiatives.
  for (const [documentId, candidate] of [...evidenceCandidates.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const row = candidate.row;
    const inRequestedScope = (!evidenceScope.initiativeId || candidate.scopes.has(`initiative:${evidenceScope.initiativeId}`))
      && (!evidenceScope.objectiveId || candidate.scopes.has(`objective:${evidenceScope.objectiveId}`))
      && (!evidenceScope.changeRequestId || candidate.scopes.has(`change-request:${evidenceScope.changeRequestId}`));
    if (!inRequestedScope) { signoffEvidenceStatus.set(documentId, "not_checked"); continue; }
    if (!row.evidence_file_name || !row.evidence_r2_key || !Number.isSafeInteger(row.evidence_byte_size) || Number(row.evidence_byte_size) < 0) { signoffEvidenceStatus.set(documentId, "unverified"); continue; }
    const byteSize = Number(row.evidence_byte_size);
    if (inspectedEvidenceDocuments >= MAX_GOVERNED_EVIDENCE_REFERENCES || inspectedEvidenceBytes + byteSize > MAX_GOVERNED_EVIDENCE_BYTES) { signoffEvidenceStatus.set(documentId, "not_checked"); continue; }
    inspectedEvidenceDocuments += 1;
    inspectedEvidenceBytes += byteSize;
    signoffEvidenceStatus.set(documentId, await storedEvidenceIntegrityMatches(evidenceBucket, { fileName: row.evidence_file_name, r2Key: row.evidence_r2_key, byteSize, auditPayload: row.evidence_integrity_payload }) ? "verified" : "unverified");
  }
  const estimatesByObjective = new Map<string, ObjectiveEstimate[]>();
  for (const row of estimateResult.results) estimatesByObjective.set(row.objective_id, [...(estimatesByObjective.get(row.objective_id) || []), { id: row.id, objectiveId: row.objective_id, estimateSource: row.estimate_source, hoursLow: row.hours_low, hoursLikely: row.hours_likely, hoursHigh: row.hours_high, costLow: row.cost_low, costLikely: row.cost_likely, costHigh: row.cost_high, basis: row.basis, assumptions: row.assumptions, sourceReference: row.source_reference, asOf: row.as_of, confidence: row.confidence, createdAt: row.created_at }]);
  for (const row of feedRomResult.results) {
    const rom = parseReportedRom(row.rom);
    if (!rom) continue;
    const asOf = /^\d{4}-\d{2}-\d{2}/.test(row.source_as_of || "") ? row.source_as_of!.slice(0, 10) : row.observed_at.slice(0, 10);
    const estimate: ObjectiveEstimate = {
      id: `lm-feed-rom-${row.subject_id}`,
      objectiveId: row.canonical_objective_id,
      estimateSource: "incumbent",
      hoursLow: rom.unit === "hours" ? rom.low : null,
      hoursLikely: rom.unit === "hours" ? rom.likely : null,
      hoursHigh: rom.unit === "hours" ? rom.high : null,
      costLow: rom.unit === "cost" ? rom.low : null,
      costLikely: rom.unit === "cost" ? rom.likely : null,
      costHigh: rom.unit === "cost" ? rom.high : null,
      romPointsLow: rom.unit === "points" ? rom.low : null,
      romPointsLikely: rom.unit === "points" ? rom.likely : null,
      romPointsHigh: rom.unit === "points" ? rom.high : null,
      basis: `Lockheed-reported ROM from ${row.file_name}`,
      assumptions: [rom.assumptions, `Raw source ROM: ${rom.raw}.`].filter(Boolean).join(" "),
      sourceReference: `${LM_OBJECTIVE_FEED_SYSTEM} · ${row.file_name} · feed key ${row.feed_key}`,
      asOf,
      confidence: "unassessed",
      createdAt: row.updated_at,
    };
    estimatesByObjective.set(row.canonical_objective_id, [...(estimatesByObjective.get(row.canonical_objective_id) || []), estimate]);
  }
  const signoffsByCriterion = new Map<string, AcceptanceSignoff[]>();
  for (const row of signoffResult.results) {
    const evidenceDocumentId = row.evidence_document_id;
    const quarantined = row.evidence_content_type === "application/octet-stream" && row.evidence_description?.startsWith("[QUARANTINED LEGACY EVIDENCE");
    const evidenceIntegrityStatus = !evidenceDocumentId ? "not_attached" : !row.evidence_record_id || quarantined ? "unverified" : signoffEvidenceStatus.get(evidenceDocumentId) ?? "not_checked";
    signoffsByCriterion.set(row.criterion_id, [...(signoffsByCriterion.get(row.criterion_id) || []), { id: row.id, criterionId: row.criterion_id, signoffRole: row.signoff_role, signer: row.signer, decision: row.decision, decidedAt: row.decided_at, rationale: row.rationale, evidenceDocumentId, evidenceIntegrityStatus, updatedAt: row.updated_at }]);
  }
  const initiatives: InitiativeDecisionProfile[] = initiativeResult.results.map((row) => ({ id: row.id, title: row.title, status: row.status, priority: row.priority, owner: row.owner, targetDate: row.target_date, consequence: row.consequence, desiredOutcome: row.desired_outcome, decisionAsk: row.decision_ask, asIsStatement: row.as_is_statement, toBeStatement: row.to_be_statement, successMeasures: row.success_measures, briefingAudience: row.briefing_audience, decisionNeededBy: row.decision_needed_by, romHoursPerPoint: Number.isFinite(row.rom_hours_per_point) && Number(row.rom_hours_per_point) > 0 ? Number(row.rom_hours_per_point) : 500, romConversionRationale: row.rom_conversion_rationale, primaryReleaseId: row.primary_release_id, primaryReleaseName: row.primary_release_name, updatedAt: row.updated_at }));
  const links: InitiativeChangeLink[] = linkResult.results.map((row) => ({ id: row.id, initiativeId: row.initiative_id, changeRequestId: row.change_request_id, relationship: row.relationship, contributionSummary: row.contribution_summary, sortOrder: row.sort_order }));
  const objectives: IncumbentObjective[] = objectiveResult.results.map((row) => ({ id: row.id, changeRequestId: row.change_request_id, externalSystem: row.external_system, externalIdentifier: row.external_identifier, externalItemType: row.external_item_type || "Objective", title: row.title, summary: row.summary, technicalOwner: row.technical_owner, status: row.status, plannedStart: row.planned_start, plannedFinish: row.planned_finish, actualStart: row.actual_start, actualFinish: row.actual_finish, sourceLocator: row.source_locator, sourceAsOf: row.source_as_of, estimates: estimatesByObjective.get(row.id) || [], updatedAt: row.updated_at }));
  const objectiveChangeRequestLinks: ObjectiveChangeRequestLink[] = objectiveChangeRequestLinkResult.results.map((row) => ({ id: row.id, objectiveId: row.objective_id, changeRequestId: row.change_request_id, relationship: row.relationship, sourceSystem: row.source_system, sourceLocator: row.source_locator, sourceAsOf: row.source_as_of, updatedAt: row.updated_at }));
  const objectiveDependencies: ChangeRequestObjectiveDependency[] = dependencyResult.results.map((row) => ({ id: row.id, dependentChangeRequestId: row.dependent_change_request_id, prerequisiteObjectiveId: row.prerequisite_objective_id, relationship: row.relationship, status: row.status, rationale: row.rationale, sourceReference: row.source_reference, sourceAsOf: row.source_as_of, evidenceReference: row.evidence_reference, updatedAt: row.updated_at }));
  const objectiveEffectAttributions: ObjectiveEffectAttributionRecord[] = attributionResult.results.map((row) => ({ id: row.id, objectiveId: row.objective_id, changeEffectId: row.change_effect_id, attribution: row.attribution, rationale: row.rationale, sourceReference: row.source_reference, sourceAsOf: row.source_as_of, evidenceReference: row.evidence_reference, confidence: row.confidence, updatedAt: row.updated_at }));
  const requirements: RequirementTrace[] = requirementResult.results.map((row) => ({ id: row.id, objectiveId: row.objective_id, requirementId: row.requirement_id, versionLabel: row.version_label, externalIdentifier: row.external_identifier, title: row.title, sourceSystem: row.source_system, sourceLocator: row.source_locator, sourceAsOf: row.source_as_of, changeAction: row.change_action, beforeText: row.before_text, afterText: row.after_text, rationale: row.rationale, traceStatus: row.trace_status, updatedAt: row.updated_at }));
  const criteria: AcceptanceCriterion[] = criterionResult.results.map((row) => ({ id: row.id, objectiveId: row.objective_id, requirementTraceId: row.objective_requirement_id || row.requirement_trace_id, tier: row.tier, code: row.code, statement: row.statement, verificationMethod: row.verification_method, status: row.status, plannedDate: row.planned_date, actualDate: row.actual_date, evidenceReference: row.evidence_reference, signoffs: signoffsByCriterion.get(row.id) || [], updatedAt: row.updated_at }));
  const milestones: InitiativeMilestone[] = milestoneResult.results.map((row) => ({ id: row.id, initiativeId: row.initiative_id, changeRequestId: row.change_request_id, objectiveId: row.objective_id, title: row.title, milestoneType: row.milestone_type, plannedDate: row.planned_date, actualDate: row.actual_date, status: row.status, consequenceIfMissed: row.consequence_if_missed, owner: row.owner, sortOrder: row.sort_order, updatedAt: row.updated_at }));
  const assessments: InitiativeDecisionWorkspace["assessments"] = {};
  for (const initiative of initiatives) assessments[initiative.id] = assessInitiative(bundleFor({ actor, initiatives, links, objectives, objectiveChangeRequestLinks, requirements, criteria, milestones, changes, assessments: {} }, initiative.id));
  return { actor, initiatives, links, objectives, objectiveChangeRequestLinks, objectiveDependencies, objectiveEffectAttributions, requirements, criteria, milestones, changes, assessments };
}

export function bundleFor(workspace: Omit<InitiativeDecisionWorkspace, "assessments"> & { assessments?: InitiativeDecisionWorkspace["assessments"] }, initiativeId: string): InitiativeDecisionBundle {
  const initiative = workspace.initiatives.find((item) => item.id === initiativeId);
  if (!initiative) throw new Error("Initiative was not found.");
  const links = workspace.links.filter((item) => item.initiativeId === initiativeId);
  const requestIds = new Set(links.map((item) => item.changeRequestId));
  const objectiveChangeRequestLinks = workspace.objectiveChangeRequestLinks ?? [];
  const objectives = workspace.objectives.filter((item) => requestIds.has(item.changeRequestId || "") || objectiveChangeRequestLinks.some((link) => link.objectiveId === item.id && requestIds.has(link.changeRequestId)));
  const objectiveIds = new Set(objectives.map((item) => item.id));
  return { initiative, links, changeRequests: workspace.changes.requests.filter((item) => requestIds.has(item.id)), objectives, objectiveChangeRequestLinks: objectiveChangeRequestLinks.filter((link) => objectiveIds.has(link.objectiveId)), objectiveDependencies: (workspace.objectiveDependencies ?? []).filter((item) => requestIds.has(item.dependentChangeRequestId) || objectiveIds.has(item.prerequisiteObjectiveId)), objectiveEffectAttributions: (workspace.objectiveEffectAttributions ?? []).filter((item) => objectiveIds.has(item.objectiveId)), requirements: workspace.requirements.filter((item) => objectiveIds.has(item.objectiveId)), criteria: workspace.criteria.filter((item) => objectiveIds.has(item.objectiveId)), milestones: workspace.milestones.filter((item) => item.initiativeId === initiativeId), changes: workspace.changes };
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
  const romHoursPerPoint = numberOrNull(body.romHoursPerPoint) ?? 500;
  if (!Number.isFinite(romHoursPerPoint) || romHoursPerPoint <= 0) throw new Error("Lockheed ROM conversion must be a positive number of labor hours per point.");
  const next = { asIsStatement: nullable(body.asIsStatement), toBeStatement: nullable(body.toBeStatement), successMeasures: nullable(body.successMeasures), briefingAudience: nullable(body.briefingAudience), decisionNeededBy: nullable(body.decisionNeededBy), decisionAsk: nullable(body.decisionAsk), desiredOutcome: nullable(body.desiredOutcome), consequence: nullable(body.consequence), owner: nullable(body.owner), targetDate: nullable(body.targetDate), romHoursPerPoint, romConversionRationale: nullable(body.romConversionRationale) };
  const at = now();
  await db.batch([
    db.prepare("UPDATE initiative SET as_is_statement=?,to_be_statement=?,success_measures=?,briefing_audience=?,decision_needed_by=?,decision_ask=?,desired_outcome=?,consequence=?,owner=?,target_date=?,rom_hours_per_point=?,rom_conversion_rationale=?,updated_at=? WHERE id=? AND program_id=?").bind(next.asIsStatement, next.toBeStatement, next.successMeasures, next.briefingAudience, next.decisionNeededBy, next.decisionAsk, next.desiredOutcome, next.consequence, next.owner, next.targetDate, next.romHoursPerPoint, next.romConversionRationale, at, initiativeId, PROGRAM_ID),
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

export async function unlinkChangeRequest(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const initiativeId = clean(body.initiativeId);
  const changeRequestId = clean(body.changeRequestId);
  const rationale = clean(body.rationale);
  if (!initiativeId || !changeRequestId || !rationale) throw new Error("Initiative, Change Request, and unlink rationale are required.");
  await assertInitiative(db, initiativeId);
  const before = await db.prepare("SELECT l.* FROM initiative_change_request l JOIN change_request cr ON cr.id=l.change_request_id WHERE l.initiative_id=? AND l.change_request_id=? AND cr.program_id=?").bind(initiativeId, changeRequestId, PROGRAM_ID).first<Record<string, unknown>>();
  if (!before) throw new Error("The Initiative contribution link no longer exists.");
  const [remainingLinkResult, candidateObjectiveResult] = await Promise.all([
    db.prepare("SELECT change_request_id FROM initiative_change_request WHERE initiative_id=? AND change_request_id<>?").bind(initiativeId, changeRequestId).all<{ change_request_id: string }>(),
    db.prepare(`SELECT DISTINCT o.id FROM incumbent_objective o
      LEFT JOIN objective_change_request_link l ON l.objective_id=o.id
      WHERE o.program_id=? AND (o.change_request_id=? OR l.change_request_id=?)`).bind(PROGRAM_ID, changeRequestId, changeRequestId).all<{ id: string }>(),
  ]);
  const candidateObjectiveIds = candidateObjectiveResult.results.map((item) => item.id);
  const relationResult = candidateObjectiveIds.length
    ? await db.prepare(`SELECT o.id AS objective_id,o.change_request_id FROM incumbent_objective o
        WHERE o.program_id=? AND o.id IN (SELECT value FROM json_each(?)) AND o.change_request_id IS NOT NULL
        UNION
        SELECT l.objective_id,l.change_request_id FROM objective_change_request_link l JOIN incumbent_objective o ON o.id=l.objective_id
        WHERE o.program_id=? AND l.objective_id IN (SELECT value FROM json_each(?))`)
      .bind(PROGRAM_ID, JSON.stringify(candidateObjectiveIds), PROGRAM_ID, JSON.stringify(candidateObjectiveIds)).all<{ objective_id: string; change_request_id: string }>()
    : { results: [] as Array<{ objective_id: string; change_request_id: string }> };
  const leavingObjectiveIds = objectiveIdsLeavingInitiativeScope({
    removedChangeRequestId: changeRequestId,
    remainingChangeRequestIds: remainingLinkResult.results.map((item) => item.change_request_id),
    relations: relationResult.results.map((item) => ({ objectiveId: item.objective_id, changeRequestId: item.change_request_id })),
  });
  const leavingObjectiveJson = JSON.stringify(leavingObjectiveIds);
  const [milestoneDependency, workPackageDependency] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM initiative_milestone
      WHERE initiative_id=? AND (change_request_id=? OR objective_id IN (SELECT value FROM json_each(?)))`).bind(initiativeId, changeRequestId, leavingObjectiveJson).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT w.id) AS count FROM work_package w
      LEFT JOIN work_package_objective l ON l.work_package_id=w.id
      WHERE w.initiative_id=? AND (w.change_request_id=? OR w.objective_id IN (SELECT value FROM json_each(?)) OR l.objective_id IN (SELECT value FROM json_each(?)))`).bind(initiativeId, changeRequestId, leavingObjectiveJson, leavingObjectiveJson).first<{ count: number }>(),
  ]);
  const milestoneCount = Number(milestoneDependency?.count || 0);
  const workPackageCount = Number(workPackageDependency?.count || 0);
  if (milestoneCount || workPackageCount) {
    const dependencies = [
      milestoneCount ? `${milestoneCount} Initiative milestone${milestoneCount === 1 ? "" : "s"}` : "",
      workPackageCount ? `${workPackageCount} WBS Objective trace${workPackageCount === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" and ");
    throw new Error(`Reassign or remove ${dependencies} before unlinking this Change Request; the unlink would leave those Initiative-owned records outside its delivery scope.`);
  }
  const results = await db.batch([
    db.prepare("DELETE FROM initiative_change_request WHERE initiative_id=? AND change_request_id=?").bind(initiativeId, changeRequestId),
    audit(db, actor, "change_request_unlinked_from_initiative", "initiative", initiativeId, { changeRequestId, rationale }, before),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) throw new Error("The Initiative contribution changed before it could be removed. Reload and try again.");
  return changeRequestId;
}

export async function saveObjective(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const objectiveId = clean(body.id) || makeId("objective");
  const changeRequestId = nullable(body.changeRequestId);
  const externalSystem = clean(body.externalSystem);
  const externalIdentifier = clean(body.externalIdentifier);
  const externalItemType = clean(body.externalItemType) || "Objective";
  const title = clean(body.title);
  if (!externalSystem || !externalIdentifier || !title) throw new Error("External system, Objective identifier, and title are required.");
  if (changeRequestId) {
    const request = await db.prepare("SELECT id FROM change_request WHERE id=? AND program_id=?").bind(changeRequestId, PROGRAM_ID).first<{ id: string }>();
    if (!request) throw new Error("Change Request was not found.");
  }
  const status = oneOf<ObjectiveStatus>(body.status, ["proposed", "planned", "in_progress", "blocked", "verification", "complete", "cancelled"], "proposed");
  const plannedStart = nullable(body.plannedStart);
  const plannedFinish = nullable(body.plannedFinish);
  const actualStart = nullable(body.actualStart);
  const actualFinish = nullable(body.actualFinish);
  const lifecycleIssues = objectiveLifecycleIssues({ status, plannedStart, plannedFinish, actualStart, actualFinish });
  if (lifecycleIssues.includes("planned_window_reversed")) throw new Error("Objective planned start must not fall after planned finish.");
  if (lifecycleIssues.includes("actual_window_reversed")) throw new Error("Objective actual start must not fall after actual finish.");
  if (lifecycleIssues.includes("complete_without_actual_finish")) throw new Error("A complete Objective requires an actual finish date.");
  const before = await db.prepare("SELECT * FROM incumbent_objective WHERE id=? AND program_id=?").bind(objectiveId, PROGRAM_ID).first<Record<string, unknown>>();
  const parentChanged = Boolean(before && clean(before.change_request_id) !== (changeRequestId || ""));
  if (parentChanged && !clean(body.reparentReason)) {
    throw new Error("Changing an Objective's owning Change Request requires a documented reparent reason.");
  }
  if (parentChanged) {
    if (changeRequestId) {
      const selfDependency = await db.prepare("SELECT id FROM change_request_objective_dependency WHERE prerequisite_objective_id=? AND dependent_change_request_id=? AND status IN ('proposed','accepted') LIMIT 1")
        .bind(objectiveId, changeRequestId).first<{ id: string }>();
      if (selfDependency) throw new Error("Reparenting would turn an active cross-package dependency into a Change Request dependency on its own Objective. Retire or reject that dependency before changing accountability.");
    }
    const orphanedAttribution = await db.prepare(`SELECT a.id FROM objective_effect_attribution a
      JOIN change_effect e ON e.id=a.change_effect_id
      WHERE a.objective_id=?
        AND (? IS NULL OR e.change_request_id<>?)
        AND NOT EXISTS (
          SELECT 1 FROM objective_change_request_link l
          WHERE l.objective_id=? AND l.change_request_id=e.change_request_id AND l.relationship<>'primary'
        )
      LIMIT 1`).bind(objectiveId, changeRequestId, changeRequestId, objectiveId).first<{ id: string }>();
    if (orphanedAttribution) throw new Error("Reparenting would strand a technical-effect attribution outside the Objective's surviving Change Request links. Reconcile that attribution or retain an explicit reported/related link before changing accountability.");
  }
  if (status === "complete") {
    const closureWorkspace = await initiativeDecisionWorkspace(db, actor, { objectiveId });
    const criteria = closureWorkspace.criteria.filter((criterion) => criterion.objectiveId === objectiveId);
    if (!criteria.length || criteria.some((criterion) => !criterionIsAccepted(criterion))) throw new Error("A complete Objective requires every acceptance criterion to be passed or waived with a current accountable sign-off and governed evidence.");
    const requirements = closureWorkspace.requirements.filter((requirement) => requirement.objectiveId === objectiveId);
    if (requirements.some((requirement) => requirement.traceStatus === "not_applicable" && !requirement.rationale?.trim())) throw new Error("A complete Objective cannot rely on a not-applicable requirement without a documented rationale.");
    if (requirements.some((requirement) => requirementNeedsAcceptancePath(requirement.traceStatus) && !requirementHasAcceptancePath(requirement.id, criteria))) throw new Error("A complete Objective requires an acceptance criterion for every applicable requirement trace.");
  }
  const at = now();
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO incumbent_objective (id,program_id,change_request_id,external_system,external_identifier,external_item_type,title,summary,technical_owner,status,planned_start,planned_finish,actual_start,actual_finish,source_locator,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET change_request_id=excluded.change_request_id,external_system=excluded.external_system,external_identifier=excluded.external_identifier,external_item_type=excluded.external_item_type,title=excluded.title,summary=excluded.summary,technical_owner=excluded.technical_owner,status=excluded.status,planned_start=excluded.planned_start,planned_finish=excluded.planned_finish,actual_start=excluded.actual_start,actual_finish=excluded.actual_finish,source_locator=excluded.source_locator,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at").bind(objectiveId, PROGRAM_ID, changeRequestId, externalSystem, externalIdentifier, externalItemType, title, nullable(body.summary), nullable(body.technicalOwner), status, plannedStart, plannedFinish, actualStart, actualFinish, nullable(body.sourceLocator), nullable(body.sourceAsOf), actor.id, at, at),
    // A direct owner is represented consistently as a primary hard link.
    // Removing the direct owner only removes that primary relation; imported
    // reported/related references remain available for traceability.
    db.prepare("DELETE FROM objective_change_request_link WHERE objective_id=? AND relationship='primary'").bind(objectiveId),
  ];
  if (changeRequestId) statements.push(db.prepare("INSERT INTO objective_change_request_link (id,program_id,objective_id,change_request_id,relationship,source_system,source_locator,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(objective_id,change_request_id,relationship) DO UPDATE SET source_system=excluded.source_system,source_locator=excluded.source_locator,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at").bind(makeId("objective-change"), PROGRAM_ID, objectiveId, changeRequestId, "primary", "Government analyst", nullable(body.sourceLocator), nullable(body.sourceAsOf), actor.id, at, at));
  statements.push(audit(db, actor, before ? "incumbent_objective_updated" : "incumbent_objective_created", "incumbent_objective", objectiveId, { changeRequestId, externalSystem, externalIdentifier, title, status, reparentReason: parentChanged ? nullable(body.reparentReason) : null }, before));
  await db.batch(statements);
  return objectiveId;
}

/**
 * Record a precise dependency from one Change Request to an Objective owned
 * by another Change Request. This does not create or imply a broad CR-to-CR
 * dependency; the prerequisite remains the Objective record itself.
 */
export async function saveObjectiveDependency(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  let dependencyId = clean(body.id);
  const dependentChangeRequestId = clean(body.dependentChangeRequestId);
  const prerequisiteObjectiveId = clean(body.prerequisiteObjectiveId);
  if (!dependentChangeRequestId || !prerequisiteObjectiveId) throw new Error("Dependent Change Request and prerequisite Objective are required.");
  const request = await db.prepare("SELECT id FROM change_request WHERE id=? AND program_id=?").bind(dependentChangeRequestId, PROGRAM_ID).first<{ id: string }>();
  const objective = await db.prepare("SELECT id,change_request_id FROM incumbent_objective WHERE id=? AND program_id=?").bind(prerequisiteObjectiveId, PROGRAM_ID).first<{ id: string; change_request_id: string | null }>();
  if (!request) throw new Error("Dependent Change Request was not found.");
  if (!objective) throw new Error("Prerequisite Objective was not found.");
  if (objective.change_request_id && objective.change_request_id === dependentChangeRequestId) throw new Error("A Change Request cannot depend on an Objective that it owns. Record the internal work relationship separately.");
  const relationship = oneOf<ObjectiveDependencyRelationship>(body.relationship, ["requires", "enables", "blocks", "consumes"], "requires");
  const status = oneOf<ObjectiveDependencyStatus>(body.status, ["proposed", "accepted", "rejected", "retired"], "proposed");
  const rationale = clean(body.rationale);
  if (!rationale) throw new Error("A dependency rationale is required.");
  const sourceReference = nullable(body.sourceReference);
  const evidenceReference = nullable(body.evidenceReference);
  if (status === "accepted" && !sourceReference && !evidenceReference) throw new Error("An accepted dependency requires a source or evidence reference.");
  if (!dependencyId) dependencyId = (await db.prepare("SELECT id FROM change_request_objective_dependency WHERE dependent_change_request_id=? AND prerequisite_objective_id=? AND relationship=?").bind(dependentChangeRequestId, prerequisiteObjectiveId, relationship).first<{ id: string }>())?.id || makeId("objective-dependency");
  const before = await db.prepare("SELECT * FROM change_request_objective_dependency WHERE id=?").bind(dependencyId).first<Record<string, unknown>>();
  if (before && (clean(before.dependent_change_request_id) !== dependentChangeRequestId || clean(before.prerequisite_objective_id) !== prerequisiteObjectiveId || clean(before.relationship) !== relationship)) throw new Error("An existing Objective dependency cannot be moved or retyped. Retire it and create a new dependency.");
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO change_request_objective_dependency (id,dependent_change_request_id,prerequisite_objective_id,relationship,status,rationale,source_reference,source_as_of,evidence_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET dependent_change_request_id=excluded.dependent_change_request_id,prerequisite_objective_id=excluded.prerequisite_objective_id,relationship=excluded.relationship,status=excluded.status,rationale=excluded.rationale,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,evidence_reference=excluded.evidence_reference,updated_at=excluded.updated_at").bind(dependencyId, dependentChangeRequestId, prerequisiteObjectiveId, relationship, status, rationale, sourceReference, nullable(body.sourceAsOf), evidenceReference, actor.id, at, at),
    audit(db, actor, before ? "objective_dependency_updated" : "objective_dependency_created", "change_request_objective_dependency", dependencyId, { dependentChangeRequestId, prerequisiteObjectiveId, relationship, status, rationale, sourceReference, sourceAsOf: nullable(body.sourceAsOf), evidenceReference }, before),
  ]);
  return dependencyId;
}

/**
 * Attribute a technical Change Effect to an Objective without transferring
 * ownership. The Change Effect remains owned by its Change Request.
 */
export async function saveObjectiveEffectAttribution(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  let attributionId = clean(body.id);
  const objectiveId = clean(body.objectiveId);
  const changeEffectId = clean(body.changeEffectId);
  if (!objectiveId || !changeEffectId) throw new Error("Objective and Change Effect are required.");
  const objective = await db.prepare("SELECT id,change_request_id FROM incumbent_objective WHERE id=? AND program_id=?").bind(objectiveId, PROGRAM_ID).first<{ id: string; change_request_id: string | null }>();
  const effect = await db.prepare("SELECT ce.id,ce.change_request_id FROM change_effect ce JOIN change_request cr ON cr.id=ce.change_request_id WHERE ce.id=? AND cr.program_id=?").bind(changeEffectId, PROGRAM_ID).first<{ id: string; change_request_id: string }>();
  if (!objective) throw new Error("Objective was not found.");
  if (!effect) throw new Error("Change Effect was not found.");
  const linkedToEffect = objective && effect ? Boolean(await db.prepare("SELECT id FROM objective_change_request_link WHERE objective_id=? AND change_request_id=? LIMIT 1").bind(objectiveId, effect.change_request_id).first<{ id: string }>()) : false;
  if (effect.change_request_id !== objective.change_request_id && !linkedToEffect) throw new Error("An Objective can attribute only technical effects on a Change Request linked to that Objective.");
  const attribution = oneOf<ObjectiveAttribution>(body.attribution, ["primary", "contributing", "uncertain"], "contributing");
  const confidence = oneOf<ObjectiveAttributionConfidence>(body.confidence, ["unassessed", "low", "medium", "high"], "unassessed");
  const rationale = clean(body.rationale);
  if (!rationale) throw new Error("An attribution rationale is required.");
  const sourceReference = nullable(body.sourceReference);
  const evidenceReference = nullable(body.evidenceReference);
  if (confidence === "high" && !sourceReference && !evidenceReference) throw new Error("High-confidence attribution requires a source or evidence reference.");
  if (!attributionId) attributionId = (await db.prepare("SELECT id FROM objective_effect_attribution WHERE objective_id=? AND change_effect_id=?").bind(objectiveId, changeEffectId).first<{ id: string }>())?.id || makeId("objective-effect");
  const before = await db.prepare("SELECT * FROM objective_effect_attribution WHERE id=?").bind(attributionId).first<Record<string, unknown>>();
  if (before && (clean(before.objective_id) !== objectiveId || clean(before.change_effect_id) !== changeEffectId)) throw new Error("An existing effect attribution cannot be moved to another Objective or Change Effect.");
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO objective_effect_attribution (id,objective_id,change_effect_id,attribution,rationale,source_reference,source_as_of,evidence_reference,confidence,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET objective_id=excluded.objective_id,change_effect_id=excluded.change_effect_id,attribution=excluded.attribution,rationale=excluded.rationale,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,evidence_reference=excluded.evidence_reference,confidence=excluded.confidence,updated_at=excluded.updated_at").bind(attributionId, objectiveId, changeEffectId, attribution, rationale, sourceReference, nullable(body.sourceAsOf), evidenceReference, confidence, actor.id, at, at),
    audit(db, actor, before ? "objective_effect_attribution_updated" : "objective_effect_attribution_created", "objective_effect_attribution", attributionId, { objectiveId, changeEffectId, attribution, rationale, sourceReference, sourceAsOf: nullable(body.sourceAsOf), evidenceReference, confidence }, before),
  ]);
  return attributionId;
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
  const rangeProgresses = (range: Array<number | null>) => range.filter((value): value is number => value !== null).every((value, index, present) => index === 0 || present[index - 1] <= value);
  if (!rangeProgresses([hoursLow, hoursLikely, hoursHigh]) || !rangeProgresses([costLow, costLikely, costHigh])) throw new Error("Estimate ranges must progress from low to likely to high, including when the likely value is not supplied.");
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
  const objectiveRequirementId = clean(body.id) || makeId("objective-requirement");
  const objectiveId = clean(body.objectiveId);
  const externalIdentifier = clean(body.externalIdentifier);
  const title = clean(body.title);
  const sourceSystem = clean(body.sourceSystem);
  if (!objectiveId || !externalIdentifier || !title || !sourceSystem) throw new Error("Objective, requirement identifier, title, and authoritative source system are required.");
  const before = await db.prepare("SELECT * FROM objective_requirement WHERE id=?").bind(objectiveRequirementId).first<Record<string, unknown>>();
  if (before && clean(before.objective_id) !== objectiveId) throw new Error("An existing requirement trace cannot be moved to another Objective. Create a new trace so dependent acceptance criteria remain explicit.");
  const objective = await db.prepare("SELECT id,status FROM incumbent_objective WHERE id=? AND program_id=?").bind(objectiveId, PROGRAM_ID).first<{ id: string; status: ObjectiveStatus }>();
  if (!objective) throw new Error("Objective was not found.");
  if (objective.status === "complete") throw new Error("Reopen the Objective before changing its requirement traces.");
  const action = oneOf<RequirementAction>(body.changeAction, ["add", "modify", "retire", "verify", "none"], "verify");
  const status = oneOf<RequirementTraceStatus>(body.traceStatus, ["identified", "analysis_needed", "traced", "verified", "not_applicable"], "identified");
  const rationale = nullable(body.rationale);
  if (["add", "modify"].includes(action) && !clean(body.afterText)) throw new Error("Added or modified requirements need proposed requirement text.");
  if (status === "not_applicable" && !rationale) throw new Error("A not-applicable requirement trace requires a documented rationale.");
  if (["traced", "verified"].includes(status)) {
    const acceptancePath = await db.prepare("SELECT id FROM acceptance_criterion WHERE objective_id=? AND (objective_requirement_id=? OR requirement_trace_id=?) LIMIT 1").bind(objectiveId, objectiveRequirementId, objectiveRequirementId).first<{ id: string }>();
    if (!acceptancePath) throw new Error("Link at least one acceptance criterion before marking this requirement traced or verified.");
  }
  const at = now();
  const existingRequirement = await db.prepare("SELECT id FROM requirement WHERE program_id=? AND source_system=? AND external_identifier=?").bind(PROGRAM_ID, sourceSystem, externalIdentifier).first<{ id: string }>();
  const requirementId = existingRequirement?.id || makeId("requirement");
  const versionLabel = clean(body.versionLabel) || "1";
  await db.batch([
    db.prepare("INSERT INTO requirement (id,program_id,external_identifier,title,source_system,source_locator,source_as_of,current_text,lifecycle_status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(program_id,source_system,external_identifier) DO UPDATE SET title=excluded.title,source_locator=excluded.source_locator,source_as_of=excluded.source_as_of,current_text=COALESCE(excluded.current_text,requirement.current_text),lifecycle_status=excluded.lifecycle_status,updated_at=excluded.updated_at").bind(requirementId, PROGRAM_ID, externalIdentifier, title, sourceSystem, nullable(body.sourceLocator), nullable(body.sourceAsOf), nullable(body.afterText) || nullable(body.beforeText), action === "retire" ? "retired" : "active", actor.id, at, at),
    db.prepare("INSERT INTO objective_requirement (id,objective_id,requirement_id,version_label,change_action,before_text,after_text,rationale,disposition,source_reference,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET requirement_id=excluded.requirement_id,version_label=excluded.version_label,change_action=excluded.change_action,before_text=excluded.before_text,after_text=excluded.after_text,rationale=excluded.rationale,disposition=excluded.disposition,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at").bind(objectiveRequirementId, objectiveId, requirementId, versionLabel, action, nullable(body.beforeText), nullable(body.afterText), rationale, status, nullable(body.sourceLocator), nullable(body.sourceAsOf), actor.id, at, at),
    audit(db, actor, before ? "objective_requirement_updated" : "objective_requirement_created", "objective_requirement", objectiveRequirementId, { objectiveId, requirementId, externalIdentifier, versionLabel, action, status }, before),
  ]);
  return objectiveRequirementId;
}

export async function saveAcceptanceCriterion(db: Database, actor: Actor, body: Record<string, unknown>) {
  requireWriter(actor);
  const criterionId = clean(body.id) || makeId("criterion");
  const objectiveId = clean(body.objectiveId);
  const code = clean(body.code);
  const statement = clean(body.statement);
  if (!objectiveId || !code || !statement) throw new Error("Objective, criterion code, and measurable statement are required.");
  const before = await db.prepare("SELECT * FROM acceptance_criterion WHERE id=?").bind(criterionId).first<Record<string, unknown>>();
  if (before && clean(before.objective_id) !== objectiveId) throw new Error("An existing acceptance criterion cannot be moved to another Objective. Create a new criterion so its trace, sign-offs, and evidence scope remain explicit.");
  const objective = await db.prepare("SELECT id,status FROM incumbent_objective WHERE id=? AND program_id=?").bind(objectiveId, PROGRAM_ID).first<{ id: string; status: ObjectiveStatus }>();
  if (!objective) throw new Error("Objective was not found.");
  if (objective.status === "complete") throw new Error("Reopen the Objective before changing its acceptance criteria.");
  const requirementTraceId = nullable(body.requirementTraceId);
  if (requirementTraceId) {
    const trace = await db.prepare("SELECT id FROM objective_requirement WHERE id=? AND objective_id=?").bind(requirementTraceId, objectiveId).first<{ id: string }>();
    if (!trace) throw new Error("Acceptance criterion requirement must be linked to the same Objective.");
  }
  const previousRequirementTraceId = nullable(before?.objective_requirement_id) || nullable(before?.requirement_trace_id);
  if (previousRequirementTraceId && previousRequirementTraceId !== requirementTraceId) {
    const previousRequirement = await db.prepare("SELECT disposition FROM objective_requirement WHERE id=? AND objective_id=?").bind(previousRequirementTraceId, objectiveId).first<{ disposition: RequirementTraceStatus }>();
    if (previousRequirement && requirementNeedsAcceptancePath(previousRequirement.disposition)) {
      const alternativePath = await db.prepare("SELECT id FROM acceptance_criterion WHERE objective_id=? AND id<>? AND (objective_requirement_id=? OR requirement_trace_id=?) LIMIT 1").bind(objectiveId, criterionId, previousRequirementTraceId, previousRequirementTraceId).first<{ id: string }>();
      if (!alternativePath) throw new Error("This is the requirement's only acceptance criterion. Link a replacement or mark the requirement not applicable with rationale before removing this acceptance path.");
    }
  }
  const tier = oneOf<AcceptanceTier>(body.tier, ["tier_3", "tier_4", "other"], "tier_4");
  const method = oneOf<VerificationMethod>(body.verificationMethod, ["analysis", "demonstration", "inspection", "test", "review"], "test");
  const status = oneOf<AcceptanceStatus>(body.status, ["draft", "ready", "in_verification", "passed", "failed", "waived"], "draft");
  const actualDate = nullable(body.actualDate);
  if (["passed", "failed", "waived"].includes(status) && !actualDate) throw new Error("A completed or waived acceptance criterion requires the actual verification or disposition date.");
  if (status === "passed" && !clean(body.evidenceReference)) {
    const attached = await db.prepare(`SELECT d.file_name,d.r2_key,d.byte_size,
      (SELECT a.after_payload FROM audit_event a WHERE a.program_id=d.program_id AND a.entity_kind='evidence_document' AND a.entity_id=d.id
       AND a.action IN ('evidence_document_attached','evidence_document_restored','evidence_integrity_sealed') ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS integrity_payload
      FROM acceptance_signoff s JOIN evidence_document d ON d.id=s.evidence_document_id
      WHERE s.criterion_id=? AND s.decision IN ('accepted','waived')
      AND NOT (d.content_type='application/octet-stream' AND d.description LIKE '[QUARANTINED LEGACY EVIDENCE%')
      ORDER BY s.updated_at DESC,s.id ASC LIMIT ?`).bind(criterionId, MAX_GOVERNED_EVIDENCE_REFERENCES + 1).all<EvidenceSupportRow>();
    const support = await findVerifiedEvidenceSupport(attached.results);
    if (support !== "verified") throw new Error(support === "budget_exceeded" ? "Acceptance evidence exceeds the governed 100-document or 100 MB verification envelope; split the criterion evidence set before marking it passed." : "A passed acceptance criterion requires an evidence reference or an accepted sign-off with an integrity-verified document.");
  }
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO acceptance_criterion (id,objective_id,requirement_trace_id,objective_requirement_id,tier,code,statement,verification_method,status,planned_date,actual_date,evidence_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET requirement_trace_id=NULL,objective_requirement_id=excluded.objective_requirement_id,tier=excluded.tier,code=excluded.code,statement=excluded.statement,verification_method=excluded.verification_method,status=excluded.status,planned_date=excluded.planned_date,actual_date=excluded.actual_date,evidence_reference=excluded.evidence_reference,updated_at=excluded.updated_at").bind(criterionId, objectiveId, null, requirementTraceId, tier, code, statement, method, status, nullable(body.plannedDate), actualDate, nullable(body.evidenceReference), actor.id, at, at),
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
  const criterion = await db.prepare("SELECT c.id,c.objective_id,c.status,c.evidence_reference,o.status AS objective_status FROM acceptance_criterion c JOIN incumbent_objective o ON o.id=c.objective_id WHERE c.id=? AND o.program_id=?").bind(criterionId, PROGRAM_ID).first<{ id: string; objective_id: string; status: AcceptanceStatus; evidence_reference: string | null; objective_status: ObjectiveStatus }>();
  if (!criterion) throw new Error("Acceptance criterion was not found.");
  if (criterion.objective_status === "complete") throw new Error("Reopen the Objective before changing its acceptance sign-offs.");
  if (decision !== "pending" && (!clean(body.signer) || !clean(body.rationale))) throw new Error("Signer and rationale are required for a completed sign-off.");
  const evidenceDocumentId = nullable(body.evidenceDocumentId);
  let candidateEvidenceVerified = false;
  if (evidenceDocumentId) {
    const evidence = await db.prepare(`SELECT d.id,d.file_name,d.r2_key,d.byte_size,
      (SELECT a.after_payload FROM audit_event a WHERE a.program_id=d.program_id AND a.entity_kind='evidence_document' AND a.entity_id=d.id
       AND a.action IN ('evidence_document_attached','evidence_document_restored','evidence_integrity_sealed') ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS integrity_payload
      FROM evidence_document d WHERE d.id=? AND d.program_id=? AND NOT (d.content_type='application/octet-stream' AND d.description LIKE '[QUARANTINED LEGACY EVIDENCE%')
      AND (d.initiative_id IN (SELECT icr.initiative_id FROM initiative_change_request icr WHERE icr.change_request_id IN (SELECT change_request_id FROM incumbent_objective WHERE id=? UNION SELECT change_request_id FROM objective_change_request_link WHERE objective_id=?))
      OR EXISTS (SELECT 1 FROM governance_record_link grl WHERE grl.governance_record_id=d.governance_record_id AND ((grl.entity_kind='objective' AND grl.entity_id=?) OR (grl.entity_kind='initiative' AND grl.entity_id IN (SELECT icr.initiative_id FROM initiative_change_request icr WHERE icr.change_request_id IN (SELECT change_request_id FROM incumbent_objective WHERE id=? UNION SELECT change_request_id FROM objective_change_request_link WHERE objective_id=?))))))`)
      .bind(evidenceDocumentId, PROGRAM_ID, criterion.objective_id, criterion.objective_id, criterion.objective_id, criterion.objective_id, criterion.objective_id).first<{ id: string; file_name: string; r2_key: string; byte_size: number; integrity_payload: string | null }>();
    if (!evidence) throw new Error("Choose a supporting document attached to the same Initiative as this acceptance criterion.");
    if (!await storedEvidenceIntegrityMatches(documentsBucket(), { fileName: evidence.file_name, r2Key: evidence.r2_key, byteSize: evidence.byte_size, auditPayload: evidence.integrity_payload })) throw new Error("This document is not integrity verified against its current stored bytes. A Baseline steward must validate and seal or reattach it before it can support acceptance.");
    candidateEvidenceVerified = true;
  }
  if (criterion.status === "passed" && !criterion.evidence_reference) {
    let retainedSupport = ["accepted", "waived"].includes(decision) && candidateEvidenceVerified;
    if (!retainedSupport) {
      const alternatives = await db.prepare(`SELECT d.file_name,d.r2_key,d.byte_size,
        (SELECT a.after_payload FROM audit_event a WHERE a.program_id=d.program_id AND a.entity_kind='evidence_document' AND a.entity_id=d.id
         AND a.action IN ('evidence_document_attached','evidence_document_restored','evidence_integrity_sealed') ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS integrity_payload
        FROM acceptance_signoff s JOIN evidence_document d ON d.id=s.evidence_document_id
        WHERE s.criterion_id=? AND s.signoff_role<>? AND s.decision IN ('accepted','waived')
        AND NOT (d.content_type='application/octet-stream' AND d.description LIKE '[QUARANTINED LEGACY EVIDENCE%')
        ORDER BY s.updated_at DESC,s.id ASC LIMIT ?`).bind(criterionId, signoffRole, MAX_GOVERNED_EVIDENCE_REFERENCES + 1).all<EvidenceSupportRow>();
      retainedSupport = await findVerifiedEvidenceSupport(alternatives.results) === "verified";
    }
    if (!retainedSupport) throw new Error("This change would leave a passed acceptance criterion without a current accepted sign-off and integrity-verified evidence. Add a text evidence reference or retain another verified acceptance sign-off first.");
  }
  const existing = await db.prepare("SELECT * FROM acceptance_signoff WHERE criterion_id=? AND signoff_role=?").bind(criterionId, signoffRole).first<Record<string, unknown>>();
  const signoffId = clean(existing?.id) || makeId("signoff");
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO acceptance_signoff (id,criterion_id,signoff_role,signer,decision,decided_at,rationale,evidence_document_id,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(criterion_id,signoff_role) DO UPDATE SET signer=excluded.signer,decision=excluded.decision,decided_at=excluded.decided_at,rationale=excluded.rationale,evidence_document_id=excluded.evidence_document_id,updated_at=excluded.updated_at").bind(signoffId, criterionId, signoffRole, nullable(body.signer), decision, decision === "pending" ? null : clean(body.decidedAt) || at, nullable(body.rationale), evidenceDocumentId, actor.id, at, at),
    audit(db, actor, "acceptance_signoff_recorded", "acceptance_criterion", criterionId, { signoffId, signoffRole, decision, signer: nullable(body.signer), rationale: nullable(body.rationale), evidenceDocumentId }, existing),
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
    const objective = await db.prepare("SELECT o.id,o.change_request_id FROM incumbent_objective o WHERE o.id=? AND o.program_id=?").bind(objectiveId, PROGRAM_ID).first<{ id: string; change_request_id: string | null }>();
    if (!objective) throw new Error("Milestone Objective was not found.");
    if (changeRequestId && objective.change_request_id !== changeRequestId) {
      const reported = await db.prepare("SELECT id FROM objective_change_request_link WHERE objective_id=? AND change_request_id=? LIMIT 1").bind(objectiveId, changeRequestId).first<{ id: string }>();
      if (!reported) throw new Error("Milestone Objective must be linked to its selected Change Request.");
    }
  }
  const type = oneOf<MilestoneType>(body.milestoneType, ["decision", "delivery", "verification", "fielding", "dependency"], "delivery");
  const status = oneOf<MilestoneStatus>(body.status, ["planned", "at_risk", "complete", "missed"], "planned");
  const actualDate = nullable(body.actualDate);
  if (milestoneLifecycleIssues({ status, actualDate }).includes("complete_without_actual_date")) throw new Error("A complete Initiative milestone requires an actual date.");
  if (["at_risk", "missed"].includes(status) && !clean(body.consequenceIfMissed)) throw new Error("At-risk or missed milestones require a downstream consequence.");
  const count = await db.prepare("SELECT COUNT(*) AS count FROM initiative_milestone WHERE initiative_id=?").bind(initiativeId).first<{ count: number }>();
  const before = await db.prepare("SELECT * FROM initiative_milestone WHERE id=?").bind(milestoneId).first<Record<string, unknown>>();
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO initiative_milestone (id,initiative_id,change_request_id,objective_id,title,milestone_type,planned_date,actual_date,status,consequence_if_missed,owner,sort_order,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET change_request_id=excluded.change_request_id,objective_id=excluded.objective_id,title=excluded.title,milestone_type=excluded.milestone_type,planned_date=excluded.planned_date,actual_date=excluded.actual_date,status=excluded.status,consequence_if_missed=excluded.consequence_if_missed,owner=excluded.owner,updated_at=excluded.updated_at").bind(milestoneId, initiativeId, changeRequestId, objectiveId, title, type, plannedDate, actualDate, status, nullable(body.consequenceIfMissed), nullable(body.owner), Number(count?.count || 0), actor.id, at, at),
    audit(db, actor, before ? "initiative_milestone_updated" : "initiative_milestone_created", "initiative_milestone", milestoneId, { initiativeId, changeRequestId, objectiveId, title, type, plannedDate, status }, before),
  ]);
  return milestoneId;
}
