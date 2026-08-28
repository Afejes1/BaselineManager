import type { AcceptanceSignoff, InitiativeDecisionWorkspace, ObjectiveEstimate } from "./initiative-decision-model.js";
import { selectInitiativeBundle } from "./initiative-decision-model.js";
import { deriveSolutionOptionRollup, type NumericRangeRollup, type RollupCoverage, type SolutionOptionDependency, type SolutionOptionRollup, type SourceEstimateRollup } from "./solution-option-rollup.js";

export const SOLUTION_DECISION_BASIS_VERSION = 3 as const;

/** Locale-independent Unicode code-point order for persisted set-like arrays. */
function compareText(left: string, right: string) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] < rightPoints[index] ? -1 : 1;
  }
  return leftPoints.length - rightPoints.length;
}

function byId<T extends { id: string }>(rows: readonly T[]) {
  return [...rows].sort((left, right) => compareText(left.id, right.id));
}

function byOrderThenId<T extends { id: string; sortOrder: number }>(rows: readonly T[]) {
  return [...rows].sort((left, right) => left.sortOrder - right.sortOrder || compareText(left.id, right.id));
}

const sortedText = (values: readonly string[]) => [...new Set(values)].sort(compareText);

/** Remove local write clocks while retaining semantic/source clocks such as sourceAsOf, asOf, and decidedAt. */
function semanticValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return typeof value === "number" && !Number.isFinite(value) ? null : value;
  if (Array.isArray(value)) return value.map(semanticValue);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "updatedAt" && key !== "createdAt")
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, child]) => [key, semanticValue(child)]));
}

function canonicalValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return typeof value === "number" && !Number.isFinite(value) ? null : value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, child]) => [key, canonicalValue(child)]));
}

export function canonicalSolutionDecisionBasis(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export async function hashSolutionDecisionBasis(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalSolutionDecisionBasis(value)));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function semanticCoverage(value: RollupCoverage) {
  return { eligible: value.eligible, reported: value.reported, missingObjectiveIds: sortedText(value.missingObjectiveIds), complete: value.complete };
}

function semanticRange(value: NumericRangeRollup) {
  return { low: value.low, likely: value.likely, high: value.high, lowCoverage: semanticCoverage(value.lowCoverage), likelyCoverage: semanticCoverage(value.likelyCoverage), highCoverage: semanticCoverage(value.highCoverage) };
}

function semanticSource(value: SourceEstimateRollup) {
  return { hours: semanticRange(value.hours), cost: semanticRange(value.cost), estimateIds: sortedText(value.estimateIds) };
}

function dependencyKey(value: SolutionOptionDependency) {
  return [value.layer, value.predecessorKind, value.predecessorId, value.successorKind, value.successorId, value.relationship, value.authority, value.id].join("\u0000");
}

function semanticDependencies(values: readonly SolutionOptionDependency[]) {
  return [...values].sort((left, right) => compareText(dependencyKey(left), dependencyKey(right))).map(semanticValue);
}

function stableWarningCodes(rollup: SolutionOptionRollup) {
  return [
    !rollup.coreObjectiveIds.length ? "no_executable_objective" : null,
    rollup.cancelledObjectiveIds.length ? "cancelled_objective_excluded" : null,
    rollup.optionalObjectiveIds.length ? "optional_objective_excluded" : null,
    rollup.scope.unattributedChangeEffectCount ? "unattributed_change_effect" : null,
    rollup.scope.nonCoreAttributedEffectCount ? "non_core_attributed_effect" : null,
    rollup.scope.coreEffectOutsideSelectedChangeCount ? "core_effect_outside_selected_change" : null,
    rollup.schedule.invalidDateObjectiveIds.length ? "invalid_objective_date" : null,
  ].filter((value): value is string => Boolean(value));
}

function semanticRollup(rollup: SolutionOptionRollup) {
  return {
    optionId: rollup.optionId,
    coreObjectiveIds: sortedText(rollup.coreObjectiveIds),
    optionalObjectiveIds: sortedText(rollup.optionalObjectiveIds),
    cancelledObjectiveIds: sortedText(rollup.cancelledObjectiveIds),
    incumbent: { ...semanticSource(rollup.incumbent), romPoints: semanticRange(rollup.incumbent.romPoints) },
    government: semanticSource(rollup.government),
    independent: semanticSource(rollup.independent),
    optional: {
      incumbent: { ...semanticSource(rollup.optional.incumbent), romPoints: semanticRange(rollup.optional.incumbent.romPoints) },
      government: semanticSource(rollup.optional.government),
      independent: semanticSource(rollup.optional.independent),
    },
    conversion: rollup.conversion,
    schedule: {
      earliestPlannedStart: rollup.schedule.earliestPlannedStart,
      latestPlannedFinish: rollup.schedule.latestPlannedFinish,
      startCoverage: semanticCoverage(rollup.schedule.startCoverage),
      finishCoverage: semanticCoverage(rollup.schedule.finishCoverage),
      invalidDateObjectiveIds: sortedText(rollup.schedule.invalidDateObjectiveIds),
    },
    dependencies: {
      internal: semanticDependencies(rollup.dependencies.internal),
      inbound: semanticDependencies(rollup.dependencies.inbound),
      outbound: semanticDependencies(rollup.dependencies.outbound),
    },
    scope: {
      effectCount: rollup.scope.effectCount,
      affectedObjectCount: rollup.scope.affectedObjectCount,
      affectedObjects: [...rollup.scope.affectedObjects]
        .sort((left, right) => compareText(`${left.kind}\u0000${left.id}\u0000${left.label}`, `${right.kind}\u0000${right.id}\u0000${right.label}`))
        .map(semanticValue),
      unattributedChangeEffectCount: rollup.scope.unattributedChangeEffectCount,
      nonCoreAttributedEffectCount: rollup.scope.nonCoreAttributedEffectCount,
      coreEffectOutsideSelectedChangeCount: rollup.scope.coreEffectOutsideSelectedChangeCount,
    },
    warningCodes: stableWarningCodes(rollup),
  };
}

function currentEstimateIds(rollup: SolutionOptionRollup) {
  return new Set([
    ...rollup.incumbent.estimateIds, ...rollup.government.estimateIds, ...rollup.independent.estimateIds,
    ...rollup.optional.incumbent.estimateIds, ...rollup.optional.government.estimateIds, ...rollup.optional.independent.estimateIds,
  ]);
}

function semanticEstimate(estimate: ObjectiveEstimate) {
  return semanticValue(estimate);
}

function evidenceBasis(signoff: AcceptanceSignoff) {
  const { evidenceIntegrityStatus, evidenceFingerprint, ...record } = signoff;
  const fingerprint = evidenceDocumentIdFingerprint(signoff.evidenceDocumentId, evidenceIntegrityStatus, evidenceFingerprint);
  return semanticValue({ ...record, evidenceFingerprint: fingerprint });
}

function evidenceDocumentIdFingerprint(
  documentId: string | null,
  status: AcceptanceSignoff["evidenceIntegrityStatus"],
  fingerprint: AcceptanceSignoff["evidenceFingerprint"],
) {
  if (!documentId) return null;
  return fingerprint ?? {
    documentId,
    fileName: null,
    byteSize: null,
    sealedContentHash: null,
    quarantined: false,
    integrityStatus: status === "not_attached" ? "unverified" : status,
  };
}

/**
 * Freezes the semantic decision case, the current source records selected by
 * the rollup, and explicit supplier/evidence provenance. Local write clocks,
 * historical non-winning estimates, and presentation copy are excluded.
 */
export function buildSolutionDecisionBasis(workspace: InitiativeDecisionWorkspace, initiativeId: string, optionId: string) {
  const bundle = selectInitiativeBundle(workspace, initiativeId);
  const option = bundle?.solutionOptions.find((item) => item.id === optionId);
  const rollup = deriveSolutionOptionRollup(workspace, optionId);
  if (!bundle || !option || !rollup) throw new Error("The selected solution option is not available for a decision snapshot.");

  const changeLinks = byId(bundle.solutionChangeRequestLinks.filter((item) => item.optionId === optionId));
  const objectiveLinks = byId(bundle.solutionObjectiveLinks.filter((item) => item.optionId === optionId));
  const stepRows = byOrderThenId(bundle.solutionSteps.filter((item) => item.optionId === optionId));
  const assessmentRows = byId(bundle.solutionAssessments.filter((item) => item.optionId === optionId));
  const changeRequestIds = new Set(changeLinks.map((item) => item.changeRequestId));
  const objectiveIds = new Set(objectiveLinks.map((item) => item.objectiveId));
  const estimateIds = currentEstimateIds(rollup);
  const selectedObjectives = byId(bundle.objectives.filter((item) => objectiveIds.has(item.id))).map((objective) => semanticValue({
    ...objective,
    estimates: byId((objective.estimates || []).filter((estimate) => estimateIds.has(estimate.id))).map(semanticEstimate),
  }));
  const optionEffectIds = new Set(bundle.changes.effects.filter((effect) => changeRequestIds.has(effect.changeRequestId)).map((effect) => effect.id));
  const attributionRows = byId((workspace.objectiveEffectAttributions || []).filter((item) => objectiveIds.has(item.objectiveId) || optionEffectIds.has(item.changeEffectId)));
  const coreAttributedEffectIds = new Set(attributionRows.filter((item) => objectiveIds.has(item.objectiveId)).map((item) => item.changeEffectId));
  const feedSources = [...(workspace.objectiveFeedSources || [])]
    .filter((item) => objectiveIds.has(item.objectiveId))
    .sort((left, right) => compareText(`${left.subjectId}\u0000${left.snapshotId}`, `${right.subjectId}\u0000${right.snapshotId}`))
    .map((item) => semanticValue({ ...item, domains: sortedText(item.domains) }));
  const initiativeEvidence = [...(workspace.initiativeEvidenceFingerprints || [])]
    .filter((item) => item.initiativeId === initiativeId)
    .sort((left, right) => compareText(`${left.documentId}\u0000${left.governanceRecordId || ""}`, `${right.documentId}\u0000${right.governanceRecordId || ""}`))
    .map(semanticValue);
  const activeOptions = byOrderThenId(bundle.solutionOptions.filter((item) => item.status !== "retired"));
  const activeOptionRollups = new Map(activeOptions.map((candidate) => [candidate.id, deriveSolutionOptionRollup(workspace, candidate.id)]));
  const evaluatedAlternatives = activeOptions.map((candidate) => {
    const candidateRollup = activeOptionRollups.get(candidate.id) || null;
    return {
      option: semanticValue(candidate),
      steps: byOrderThenId(bundle.solutionSteps.filter((item) => item.optionId === candidate.id)).map(semanticValue),
      stepReferences: byId(bundle.solutionStepReferences.filter((item) => item.optionId === candidate.id)).map(semanticValue),
      stepDependencies: byId(bundle.solutionStepDependencies.filter((item) => item.optionId === candidate.id)).map(semanticValue),
      changeRequestLinks: byId(bundle.solutionChangeRequestLinks.filter((item) => item.optionId === candidate.id)).map(semanticValue),
      objectiveLinks: byId(bundle.solutionObjectiveLinks.filter((item) => item.optionId === candidate.id)).map(semanticValue),
      knockOns: byId(bundle.solutionKnockOns.filter((item) => item.optionId === candidate.id)).map(semanticValue),
      governmentAssessments: byId(bundle.solutionAssessments.filter((item) => item.optionId === candidate.id)).map(semanticValue),
      derivedRollup: candidateRollup ? semanticRollup(candidateRollup) : null,
    };
  });
  const evaluatedRequestIds = new Set(bundle.solutionChangeRequestLinks.filter((item) => activeOptions.some((option) => option.id === item.optionId)).map((item) => item.changeRequestId));
  const evaluatedObjectiveIds = new Set(bundle.solutionObjectiveLinks.filter((item) => activeOptions.some((option) => option.id === item.optionId)).map((item) => item.objectiveId));
  const evaluatedEstimateIds = new Set([...activeOptionRollups.values()].flatMap((candidateRollup) => candidateRollup ? [...currentEstimateIds(candidateRollup)] : []));

  return {
    basisVersion: SOLUTION_DECISION_BASIS_VERSION,
    initiative: {
      id: bundle.initiative.id,
      title: bundle.initiative.title,
      owner: bundle.initiative.owner,
      problemStatement: bundle.initiative.problemStatement,
      desiredOutcome: bundle.initiative.desiredOutcome,
      successMeasures: bundle.initiative.successMeasures,
      driversConstraints: bundle.initiative.driversConstraints,
      decisionQuestion: bundle.initiative.decisionQuestion,
      decisionNeededBy: bundle.initiative.decisionNeededBy,
      romHoursPerPoint: bundle.initiative.romHoursPerPoint,
      romConversionRationale: bundle.initiative.romConversionRationale,
    },
    selectedOptionId: optionId,
    evaluatedAlternatives,
    evaluatedSourceRecords: {
      changeRequests: byId(workspace.changes.requests.filter((item) => evaluatedRequestIds.has(item.id))).map(semanticValue),
      objectives: byId(workspace.objectives.filter((item) => evaluatedObjectiveIds.has(item.id))).map((objective) => semanticValue({ ...objective, estimates: byId((objective.estimates || []).filter((estimate) => evaluatedEstimateIds.has(estimate.id))).map(semanticEstimate) })),
      objectiveFeedSources: [...(workspace.objectiveFeedSources || [])].filter((item) => evaluatedObjectiveIds.has(item.objectiveId)).sort((left, right) => compareText(`${left.subjectId}\u0000${left.snapshotId}`, `${right.subjectId}\u0000${right.snapshotId}`)).map((item) => semanticValue({ ...item, domains: sortedText(item.domains) })),
    },
    option: semanticValue(option),
    steps: stepRows.map(semanticValue),
    optionChangeRequestLinks: changeLinks.map(semanticValue),
    changeRequests: byId(bundle.changeRequests.filter((item) => changeRequestIds.has(item.id))).map(semanticValue),
    optionObjectiveLinks: objectiveLinks.map(semanticValue),
    objectives: selectedObjectives,
    objectiveFeedSources: feedSources,
    initiativeEvidence,
    objectiveChangeRequestLinks: byId((bundle.objectiveChangeRequestLinks || []).filter((item) => objectiveIds.has(item.objectiveId))).map(semanticValue),
    changeDependencies: byId((bundle.changes.dependencies || []).filter((item) => changeRequestIds.has(item.predecessorRequestId) || changeRequestIds.has(item.successorRequestId))).map(semanticValue),
    objectiveDependencies: byId((bundle.objectiveDependencies || []).filter((item) => changeRequestIds.has(item.dependentChangeRequestId) || objectiveIds.has(item.prerequisiteObjectiveId))).map(semanticValue),
    changeEffects: byId((bundle.changes.effects || []).filter((item) => changeRequestIds.has(item.changeRequestId) || coreAttributedEffectIds.has(item.id))).map(semanticValue),
    objectiveEffectAttributions: attributionRows.map(semanticValue),
    requirements: byId(bundle.requirements.filter((item) => objectiveIds.has(item.objectiveId))).map(semanticValue),
    acceptanceCriteria: byId(bundle.criteria.filter((item) => objectiveIds.has(item.objectiveId))).map((criterion) => semanticValue({
      ...criterion,
      signoffs: byId(criterion.signoffs).map(evidenceBasis),
    })),
    milestones: byId(bundle.milestones.filter((item) => (item.changeRequestId && changeRequestIds.has(item.changeRequestId)) || (item.objectiveId && objectiveIds.has(item.objectiveId)))).map(semanticValue),
    governmentAssessments: assessmentRows.map(semanticValue),
    derivedRollup: semanticRollup(rollup),
  };
}
