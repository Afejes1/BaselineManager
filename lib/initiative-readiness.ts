import { objectiveIsRelatedToChangeRequest, type InitiativeAssessment, type InitiativeDecisionBundle, type ReadinessFinding } from "./initiative-decision-model.js";

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
    if (objective.status === "blocked") add({ severity: "blocker", category: "schedule", title: `${objective.externalIdentifier} is blocked`, detail: objective.summary || "Resolve or explicitly accept the blocked technical objective.", subjectKind: "objective", subjectId: objective.id });
  }

  for (const requirement of bundle.requirements) {
    if (["identified", "analysis_needed"].includes(requirement.traceStatus)) add({ severity: "blocker", category: "traceability", title: `${requirement.externalIdentifier} is not traced`, detail: "Confirm the authoritative before/after requirement and link its acceptance evidence.", subjectKind: "requirement", subjectId: requirement.id });
    if (!requirement.sourceLocator || !requirement.sourceAsOf) add({ severity: "warning", category: "evidence", title: `${requirement.externalIdentifier} source is incomplete`, detail: "Record where the governing requirement can be found and when it was checked.", subjectKind: "requirement", subjectId: requirement.id });
  }

  const tierSet = new Set(bundle.criteria.map((criterion) => criterion.tier));
  if (bundle.objectives.length && !tierSet.has("tier_3")) add({ severity: "warning", category: "acceptance", title: "No Tier 3 acceptance criterion", detail: "Confirm the program-governed mission acceptance layer; the displayed label is configurable terminology.", subjectKind: "initiative", subjectId: initiative.id });
  if (bundle.objectives.length && !tierSet.has("tier_4")) add({ severity: "warning", category: "acceptance", title: "No Tier 4 acceptance criterion", detail: "Confirm the program-governed system acceptance layer; the displayed label is configurable terminology.", subjectKind: "initiative", subjectId: initiative.id });
  const today = new Date(asOf.toISOString().slice(0, 10));
  for (const criterion of bundle.criteria) {
    const planned = criterion.plannedDate ? new Date(`${criterion.plannedDate}T00:00:00Z`) : null;
    if (planned && planned < today && !["passed", "waived"].includes(criterion.status)) add({ severity: "blocker", category: "acceptance", title: `${criterion.code} verification is overdue`, detail: `Planned for ${criterion.plannedDate}; record the result, evidence, and sign-off.`, subjectKind: "criterion", subjectId: criterion.id });
    if (criterion.status === "passed" && !criterion.evidenceReference) add({ severity: "blocker", category: "evidence", title: `${criterion.code} passed without evidence`, detail: "A passed criterion needs an inspectable evidence reference.", subjectKind: "criterion", subjectId: criterion.id });
    if (["passed", "waived"].includes(criterion.status) && !criterion.signoffs.some((entry) => ["accepted", "waived"].includes(entry.decision))) add({ severity: "warning", category: "acceptance", title: `${criterion.code} lacks acceptance sign-off`, detail: "Record the accountable role, signer, rationale, and date.", subjectKind: "criterion", subjectId: criterion.id });
    if (criterion.status === "failed") add({ severity: "blocker", category: "acceptance", title: `${criterion.code} failed`, detail: criterion.evidenceReference || "Record the failure evidence and recovery decision.", subjectKind: "criterion", subjectId: criterion.id });
  }

  for (const milestone of bundle.milestones) if (["at_risk", "missed"].includes(milestone.status)) add({ severity: milestone.status === "missed" ? "blocker" : "warning", category: "schedule", title: `${milestone.title} is ${milestone.status === "at_risk" ? "at risk" : "missed"}`, detail: milestone.consequenceIfMissed || "Record the downstream consequence so leadership can trade schedule deliberately.", subjectKind: "milestone", subjectId: milestone.id });

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
    criteriaPassed: bundle.criteria.filter((item) => ["passed", "waived"].includes(item.status)).length,
    findings,
  };
}

export function estimateVariance(bundle: InitiativeDecisionBundle) {
  const latest = (objectiveId: string, sources: string[]) => bundle.objectives.find((item) => item.id === objectiveId)?.estimates
    .filter((item) => sources.includes(item.estimateSource)).sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
  let incumbentHours = 0;
  let assessedHours = 0;
  let incumbentCost = 0;
  let assessedCost = 0;
  for (const objective of bundle.objectives) {
    const incumbent = latest(objective.id, ["incumbent"]);
    const assessed = latest(objective.id, ["government", "independent"]);
    incumbentHours += incumbent?.hoursLikely || 0;
    assessedHours += assessed?.hoursLikely || 0;
    incumbentCost += incumbent?.costLikely || 0;
    assessedCost += assessed?.costLikely || 0;
  }
  return { incumbentHours, assessedHours, incumbentCost, assessedCost };
}
