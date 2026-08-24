import { objectiveIsRelatedToChangeRequest, type InitiativeAssessment, type InitiativeDecisionBundle, type ReadinessFinding } from "./initiative-decision-model.js";
import { milestoneLifecycleIssues, objectiveLifecycleIssues, requirementHasAcceptancePath, requirementNeedsAcceptancePath } from "./initiative-workflow-invariants.js";

export function criterionIsAccepted(criterion: InitiativeDecisionBundle["criteria"][number]) {
  if (!["passed", "waived"].includes(criterion.status)) return false;
  const acceptedSignoffs = criterion.signoffs.filter((signoff) => ["accepted", "waived"].includes(signoff.decision));
  if (!acceptedSignoffs.length || acceptedSignoffs.some((signoff) => signoff.evidenceDocumentId && signoff.evidenceIntegrityStatus !== "verified")) return false;
  if (criterion.status === "waived") return true;
  return Boolean(criterion.evidenceReference?.trim()) || acceptedSignoffs.some((signoff) => Boolean(signoff.evidenceDocumentId) && signoff.evidenceIntegrityStatus === "verified");
}

function finding(input: Omit<ReadinessFinding, "id">): ReadinessFinding {
  return { id: `${input.subjectKind}:${input.subjectId}:${input.category}:${input.title}`, ...input };
}

export function assessInitiative(bundle: InitiativeDecisionBundle, asOf = new Date()): InitiativeAssessment {
  const findings: ReadinessFinding[] = [];
  const add = (input: Omit<ReadinessFinding, "id">) => findings.push(finding(input));
  const initiative = bundle.initiative;
  const requiredFrame = [
    [initiative.asIsStatement, "Current-state statement", "Record the evidence-backed left side of the one-pager."],
    [initiative.toBeStatement, "Target-state statement", "Record the concrete right side of the one-pager."],
    [initiative.decisionAsk, "Leadership decision ask", "State exactly what leadership is being asked to fund, defer, or direct."],
    [initiative.decisionNeededBy, "Decision-needed-by date", "A decision paper without a decision date cannot drive the delivery timeline."],
  ] as const;
  for (const [value, title, detail] of requiredFrame) if (!value?.trim()) add({ severity: "blocker", category: "decision", title, detail, subjectKind: "initiative", subjectId: initiative.id });

  if (!bundle.changeRequests.length) add({ severity: "blocker", category: "traceability", title: "No linked Change Requests", detail: "Link the external funding/prioritization units that deliver this Initiative.", subjectKind: "initiative", subjectId: initiative.id });
  const effectCounts = new Map<string, number>();
  for (const effect of bundle.changes.effects) effectCounts.set(effect.changeRequestId, (effectCounts.get(effect.changeRequestId) || 0) + 1);
  for (const request of bundle.changeRequests) {
    if (request.decisionStatus === "pending") add({ severity: "information", category: "decision", title: `${request.externalIdentifier} awaits a Government decision`, detail: request.consequenceIfDeferred || "The deferral consequence has not been stated.", subjectKind: "change_request", subjectId: request.id });
    if (!request.sourceLocator || !request.sourceAsOf) add({ severity: "warning", category: "evidence", title: `${request.externalIdentifier} source reference is incomplete`, detail: "Record both the incumbent source locator and the date its status was checked.", subjectKind: "change_request", subjectId: request.id });
    if (!request.impactSummary || !request.consequenceIfDeferred || !effectCounts.get(request.id)) add({ severity: "blocker", category: "traceability", title: `${request.externalIdentifier} impact analysis is incomplete`, detail: "A funding decision needs a consequence plus explicit links to the affected baseline objects.", subjectKind: "change_request", subjectId: request.id });
    if (!bundle.objectives.some((objective) => objectiveIsRelatedToChangeRequest(objective, request.id, bundle.objectiveChangeRequestLinks))) add({ severity: "blocker", category: "traceability", title: `${request.externalIdentifier} has no incumbent Objective`, detail: "Link at least one externally governed technical work objective before claiming how the request will be delivered.", subjectKind: "change_request", subjectId: request.id });
  }

  const initiativeRequestIds = new Set(bundle.changeRequests.map((request) => request.id));
  for (const dependency of bundle.changes.dependencies.filter((item) => initiativeRequestIds.has(item.predecessorRequestId) || initiativeRequestIds.has(item.successorRequestId))) {
    const subjectId = initiativeRequestIds.has(dependency.successorRequestId) ? dependency.successorRequestId : dependency.predecessorRequestId;
    if (!dependency.rationale || !dependency.consequenceIfUnmet) add({ severity: "blocker", category: "traceability", title: "Change Request dependency analysis is incomplete", detail: "Record both the technical basis and the consequence if the dependency is not met.", subjectKind: "change_request", subjectId });
    if (!dependency.sourceReference || !dependency.sourceAsOf) add({ severity: "warning", category: "evidence", title: "Change Request dependency source is incomplete", detail: "Record the supporting call, document, or external-system locator and the date it was checked.", subjectKind: "change_request", subjectId });
    if (dependency.confidence === "reported") add({ severity: "warning", category: "evidence", title: "Change Request dependency is only reported", detail: "Government assessment or confirmation is required before briefing the relationship as established fact.", subjectKind: "change_request", subjectId });
  }

  for (const objective of bundle.objectives) {
    const objectiveRequirements = bundle.requirements.filter((item) => item.objectiveId === objective.id);
    const objectiveCriteria = bundle.criteria.filter((item) => item.objectiveId === objective.id);
    if (!objective.sourceLocator || !objective.sourceAsOf) add({ severity: "warning", category: "evidence", title: `${objective.externalIdentifier} source reference is incomplete`, detail: "This application should make the incumbent claim inspectable, not silently restate it.", subjectKind: "objective", subjectId: objective.id });
    if (!objectiveRequirements.length) add({ severity: "blocker", category: "traceability", title: `${objective.externalIdentifier} has no requirement trace`, detail: "Record the authoritative requirement identifiers affected or explicitly justify not applicable.", subjectKind: "objective", subjectId: objective.id });
    if (!objectiveCriteria.length) add({ severity: "blocker", category: "acceptance", title: `${objective.externalIdentifier} has no acceptance criteria`, detail: "Define measurable acceptance before treating the technical work as fundable or complete.", subjectKind: "objective", subjectId: objective.id });
    const incumbentEstimate = objective.estimates.find((item) => item.estimateSource === "incumbent");
    const independentEstimate = objective.estimates.find((item) => item.estimateSource === "government" || item.estimateSource === "independent");
    if (!incumbentEstimate) add({ severity: "warning", category: "estimate", title: `${objective.externalIdentifier} has no incumbent estimate`, detail: "Record the incumbent claim with its basis and as-of date.", subjectKind: "objective", subjectId: objective.id });
    if (!independentEstimate) add({ severity: "warning", category: "estimate", title: `${objective.externalIdentifier} has no independent assessment`, detail: "Do not brief a single-source effort or cost claim as established fact.", subjectKind: "objective", subjectId: objective.id });
    if (objective.status !== "cancelled" && (!objective.plannedStart || !objective.plannedFinish)) add({ severity: "warning", category: "schedule", title: `${objective.externalIdentifier} dates are incomplete`, detail: "The Initiative timeline is derived from its constituent work; both planned dates are needed.", subjectKind: "objective", subjectId: objective.id });
    const lifecycleIssues = objectiveLifecycleIssues(objective);
    if (lifecycleIssues.includes("planned_window_reversed")) add({ severity: "blocker", category: "schedule", title: `${objective.externalIdentifier} planned dates are reversed`, detail: "Planned start must not fall after planned finish.", subjectKind: "objective", subjectId: objective.id });
    if (lifecycleIssues.includes("actual_window_reversed")) add({ severity: "blocker", category: "schedule", title: `${objective.externalIdentifier} actual dates are reversed`, detail: "Actual start must not fall after actual finish.", subjectKind: "objective", subjectId: objective.id });
    if (lifecycleIssues.includes("complete_without_actual_finish")) add({ severity: "blocker", category: "schedule", title: `${objective.externalIdentifier} is complete without an actual finish`, detail: "Record the actual completion date before treating this Objective as complete.", subjectKind: "objective", subjectId: objective.id });
    if (objective.status === "complete" && objectiveCriteria.length && objectiveCriteria.some((criterion) => !criterionIsAccepted(criterion))) add({ severity: "blocker", category: "acceptance", title: `${objective.externalIdentifier} is complete before acceptance closure`, detail: "Every acceptance criterion must be passed or waived with a current accountable sign-off and governed evidence before the Objective can be complete.", subjectKind: "objective", subjectId: objective.id });
    if (objective.status === "blocked") add({ severity: "blocker", category: "schedule", title: `${objective.externalIdentifier} is blocked`, detail: objective.summary || "Resolve or explicitly accept the blocked technical objective.", subjectKind: "objective", subjectId: objective.id });
  }

  for (const requirement of bundle.requirements) {
    if (["identified", "analysis_needed"].includes(requirement.traceStatus)) add({ severity: "blocker", category: "traceability", title: `${requirement.externalIdentifier} is not traced`, detail: "Confirm the authoritative before/after requirement and link its acceptance evidence.", subjectKind: "requirement", subjectId: requirement.id });
    if (requirement.traceStatus === "not_applicable" && !requirement.rationale?.trim()) add({ severity: "blocker", category: "traceability", title: `${requirement.externalIdentifier} lacks a not-applicable rationale`, detail: "Document why this authoritative requirement does not require an acceptance path for the Objective.", subjectKind: "requirement", subjectId: requirement.id });
    if (requirementNeedsAcceptancePath(requirement.traceStatus) && !requirementHasAcceptancePath(requirement.id, bundle.criteria)) add({ severity: "blocker", category: "acceptance", title: `${requirement.externalIdentifier} has no acceptance path`, detail: "Link at least one measurable acceptance criterion to every applicable requirement trace.", subjectKind: "requirement", subjectId: requirement.id });
    if (!requirement.sourceLocator || !requirement.sourceAsOf) add({ severity: "warning", category: "evidence", title: `${requirement.externalIdentifier} source is incomplete`, detail: "Record where the governing requirement can be found and when it was checked.", subjectKind: "requirement", subjectId: requirement.id });
  }

  const tierSet = new Set(bundle.criteria.map((criterion) => criterion.tier));
  if (bundle.objectives.length && !tierSet.has("tier_3")) add({ severity: "warning", category: "acceptance", title: "No Tier 3 acceptance criterion", detail: "Confirm the program-governed mission acceptance layer; the displayed label is configurable terminology.", subjectKind: "initiative", subjectId: initiative.id });
  if (bundle.objectives.length && !tierSet.has("tier_4")) add({ severity: "warning", category: "acceptance", title: "No Tier 4 acceptance criterion", detail: "Confirm the program-governed system acceptance layer; the displayed label is configurable terminology.", subjectKind: "initiative", subjectId: initiative.id });
  const today = new Date(asOf.toISOString().slice(0, 10));
  for (const criterion of bundle.criteria) {
    const planned = criterion.plannedDate ? new Date(`${criterion.plannedDate}T00:00:00Z`) : null;
    const hasAttachedEvidence = criterion.signoffs.some((entry) => ["accepted", "waived"].includes(entry.decision) && entry.evidenceIntegrityStatus === "verified");
    if (planned && planned < today && !["passed", "waived"].includes(criterion.status)) add({ severity: "blocker", category: "acceptance", title: `${criterion.code} verification is overdue`, detail: `Planned for ${criterion.plannedDate}; record the result, evidence, and sign-off.`, subjectKind: "criterion", subjectId: criterion.id });
    if (["passed", "failed", "waived"].includes(criterion.status) && !criterion.actualDate) add({ severity: "blocker", category: "acceptance", title: `${criterion.code} lacks an actual disposition date`, detail: "Record when verification completed or the waiver/failure was dispositioned before briefing this criterion as resolved.", subjectKind: "criterion", subjectId: criterion.id });
    if (criterion.status === "passed" && !criterion.evidenceReference && !hasAttachedEvidence) add({ severity: "blocker", category: "evidence", title: `${criterion.code} passed without evidence`, detail: "A passed criterion needs an inspectable evidence reference or attached sign-off document.", subjectKind: "criterion", subjectId: criterion.id });
    if (criterion.signoffs.some((entry) => ["accepted", "waived"].includes(entry.decision) && entry.evidenceDocumentId && entry.evidenceIntegrityStatus !== "verified")) add({ severity: "blocker", category: "evidence", title: `${criterion.code} sign-off evidence is not currently verified`, detail: "Re-open this Initiative or retry after the evidence-verification budget is available; governed reports and publication will independently verify the exact bytes and fail closed.", subjectKind: "criterion", subjectId: criterion.id });
    if (["passed", "waived"].includes(criterion.status) && !criterion.signoffs.some((entry) => ["accepted", "waived"].includes(entry.decision))) add({ severity: "warning", category: "acceptance", title: `${criterion.code} lacks acceptance sign-off`, detail: "Record the accountable role, signer, rationale, and date.", subjectKind: "criterion", subjectId: criterion.id });
    if (criterion.status === "failed") add({ severity: "blocker", category: "acceptance", title: `${criterion.code} failed`, detail: criterion.evidenceReference || "Record the failure evidence and recovery decision.", subjectKind: "criterion", subjectId: criterion.id });
  }

  for (const milestone of bundle.milestones) {
    if (milestoneLifecycleIssues(milestone).includes("complete_without_actual_date")) add({ severity: "blocker", category: "schedule", title: `${milestone.title} is complete without an actual date`, detail: "Record when the milestone occurred before treating it as complete.", subjectKind: "milestone", subjectId: milestone.id });
    if (["at_risk", "missed"].includes(milestone.status)) add({ severity: milestone.status === "missed" ? "blocker" : "warning", category: "schedule", title: `${milestone.title} is ${milestone.status === "at_risk" ? "at risk" : "missed"}`, detail: milestone.consequenceIfMissed || "Record the downstream consequence so leadership can trade schedule deliberately.", subjectKind: "milestone", subjectId: milestone.id });
  }

  const blockers = findings.filter((item) => item.severity === "blocker").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const score = Math.max(0, Math.min(100, 100 - blockers * 12 - warnings * 4));
  return {
    stage: blockers ? "not_ready" : warnings ? "analysis_incomplete" : "decision_ready",
    score,
    blockers,
    warnings,
    decisionsPending: bundle.changeRequests.filter((request) => request.decisionStatus === "pending").length,
    requirementsTraced: bundle.requirements.filter((item) => ["traced", "verified", "not_applicable"].includes(item.traceStatus)).length,
    criteriaPassed: bundle.criteria.filter(criterionIsAccepted).length,
    findings,
  };
}

export const DEFAULT_ROM_HOURS_PER_POINT = 500;

export function romHoursPerPoint(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : DEFAULT_ROM_HOURS_PER_POINT;
}

export function estimateVariance(bundle: InitiativeDecisionBundle, conversionHoursPerPoint = bundle.initiative?.romHoursPerPoint) {
  const hoursPerPoint = romHoursPerPoint(conversionHoursPerPoint);
  const latest = (objectiveId: string, sources: string[]) => bundle.objectives.find((item) => item.id === objectiveId)?.estimates
    .filter((item) => sources.includes(item.estimateSource)).sort((a, b) => `${b.asOf}|${b.createdAt}|${b.id}`.localeCompare(`${a.asOf}|${a.createdAt}|${a.id}`))[0];
  let incumbentHours: number | null = null;
  let assessedHours: number | null = null;
  let incumbentCost: number | null = null;
  let incumbentRomPoints: number | null = null;
  let assessedCost: number | null = null;
  let incumbentHoursCoverage = 0;
  let assessedHoursCoverage = 0;
  let incumbentCostCoverage = 0;
  let assessedCostCoverage = 0;
  for (const objective of bundle.objectives) {
    const incumbent = latest(objective.id, ["incumbent"]);
    const assessed = latest(objective.id, ["government", "independent"]);
    if (incumbent?.hoursLikely !== null && incumbent?.hoursLikely !== undefined) { incumbentHours = (incumbentHours ?? 0) + incumbent.hoursLikely; incumbentHoursCoverage += 1; }
    else if (incumbent?.romPointsLikely !== null && incumbent?.romPointsLikely !== undefined) {
      incumbentRomPoints = (incumbentRomPoints ?? 0) + incumbent.romPointsLikely;
      incumbentHours = (incumbentHours ?? 0) + incumbent.romPointsLikely * hoursPerPoint;
      incumbentHoursCoverage += 1;
    }
    if (assessed?.hoursLikely !== null && assessed?.hoursLikely !== undefined) { assessedHours = (assessedHours ?? 0) + assessed.hoursLikely; assessedHoursCoverage += 1; }
    if (incumbent?.costLikely !== null && incumbent?.costLikely !== undefined) { incumbentCost = (incumbentCost ?? 0) + incumbent.costLikely; incumbentCostCoverage += 1; }
    if (assessed?.costLikely !== null && assessed?.costLikely !== undefined) { assessedCost = (assessedCost ?? 0) + assessed.costLikely; assessedCostCoverage += 1; }
  }
  return { incumbentHours, assessedHours, incumbentCost, assessedCost, incumbentRomPoints, romHoursPerPoint: hoursPerPoint, incumbentHoursCoverage, assessedHoursCoverage, incumbentCostCoverage, assessedCostCoverage, objectiveCount: bundle.objectives.length };
}
