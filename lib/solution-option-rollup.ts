import type {
  IncumbentObjective,
  InitiativeDecisionWorkspace,
  ObjectiveEstimate,
  SolutionOptionObjectiveLink,
} from "./initiative-decision-model.js";
import { romHoursPerPoint } from "./initiative-readiness.js";

export type RollupCoverage = {
  eligible: number;
  reported: number;
  missingObjectiveIds: string[];
  complete: boolean;
};

export type NumericRangeRollup = {
  low: number | null;
  likely: number | null;
  high: number | null;
  lowCoverage: RollupCoverage;
  likelyCoverage: RollupCoverage;
  highCoverage: RollupCoverage;
};

export type SourceEstimateRollup = {
  hours: NumericRangeRollup;
  cost: NumericRangeRollup;
  estimateIds: string[];
};

export type SolutionOptionDependency = {
  id: string;
  layer: "change_request" | "objective_gate";
  predecessorKind: "change_request" | "objective";
  predecessorId: string;
  successorKind: "change_request";
  successorId: string;
  relationship: string;
  boundary: "internal" | "inbound" | "outbound";
  authority: "reported" | "assessed" | "confirmed" | "proposed" | "accepted";
  rationale: string | null;
  sourceReference: string | null;
};

export type SolutionOptionRollup = {
  optionId: string;
  coreObjectiveIds: string[];
  optionalObjectiveIds: string[];
  cancelledObjectiveIds: string[];
  incumbent: SourceEstimateRollup & { romPoints: NumericRangeRollup };
  government: SourceEstimateRollup;
  independent: SourceEstimateRollup;
  optional: {
    incumbent: SourceEstimateRollup & { romPoints: NumericRangeRollup };
    government: SourceEstimateRollup;
    independent: SourceEstimateRollup;
  };
  conversion: { hoursPerPoint: number; rationale: string | null; origin: "government_planning_assumption" };
  schedule: {
    earliestPlannedStart: string | null;
    latestPlannedFinish: string | null;
    startCoverage: RollupCoverage;
    finishCoverage: RollupCoverage;
    invalidDateObjectiveIds: string[];
  };
  dependencies: {
    internal: SolutionOptionDependency[];
    inbound: SolutionOptionDependency[];
    outbound: SolutionOptionDependency[];
  };
  scope: {
    effectCount: number;
    affectedObjectCount: number;
    affectedObjects: Array<{ kind: string; id: string; label: string }>;
    unattributedChangeEffectCount: number;
    nonCoreAttributedEffectCount: number;
    coreEffectOutsideSelectedChangeCount: number;
  };
  warnings: string[];
};

export function countUniqueRequirements(workspace: InitiativeDecisionWorkspace, objectiveIds: readonly string[]) {
  const selected = new Set(objectiveIds);
  return new Set(workspace.requirements.filter((requirement) => selected.has(requirement.objectiveId)).map((requirement) => requirement.requirementId || requirement.id)).size;
}

const bounds = ["low", "likely", "high"] as const;
type Bound = typeof bounds[number];

function coverage(objectiveIds: readonly string[], reportedIds: ReadonlySet<string>): RollupCoverage {
  const missingObjectiveIds = objectiveIds.filter((id) => !reportedIds.has(id));
  return { eligible: objectiveIds.length, reported: reportedIds.size, missingObjectiveIds, complete: objectiveIds.length > 0 && missingObjectiveIds.length === 0 };
}

function latestEstimate(objective: IncumbentObjective, sources: readonly string[]) {
  return objective.estimates
    .filter((estimate) => sources.includes(estimate.estimateSource))
    .sort((left, right) => `${right.asOf}|${right.createdAt}|${right.id}`.localeCompare(`${left.asOf}|${left.createdAt}|${left.id}`))[0];
}

function valueAt(estimate: ObjectiveEstimate, family: "hours" | "cost" | "romPoints", bound: Bound) {
  const key = `${family}${bound[0].toUpperCase()}${bound.slice(1)}` as keyof ObjectiveEstimate;
  const value = estimate[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rangeFor(
  objectives: readonly IncumbentObjective[],
  estimates: ReadonlyMap<string, ObjectiveEstimate>,
  family: "hours" | "cost" | "romPoints",
  resolver?: (estimate: ObjectiveEstimate, bound: Bound) => number | null,
): NumericRangeRollup {
  const totals: Record<Bound, number | null> = { low: null, likely: null, high: null };
  const reported: Record<Bound, Set<string>> = { low: new Set(), likely: new Set(), high: new Set() };
  for (const objective of objectives) {
    const estimate = estimates.get(objective.id);
    if (!estimate) continue;
    for (const bound of bounds) {
      const value = resolver ? resolver(estimate, bound) : valueAt(estimate, family, bound);
      if (value === null) continue;
      totals[bound] = (totals[bound] ?? 0) + value;
      reported[bound].add(objective.id);
    }
  }
  const objectiveIds = objectives.map((objective) => objective.id);
  return {
    low: totals.low,
    likely: totals.likely,
    high: totals.high,
    lowCoverage: coverage(objectiveIds, reported.low),
    likelyCoverage: coverage(objectiveIds, reported.likely),
    highCoverage: coverage(objectiveIds, reported.high),
  };
}

function sourceRollup(objectives: readonly IncumbentObjective[], source: "incumbent" | "government" | "independent", hoursPerPoint: number): SourceEstimateRollup {
  const estimates = new Map<string, ObjectiveEstimate>();
  for (const objective of objectives) {
    const estimate = latestEstimate(objective, [source]);
    if (estimate) estimates.set(objective.id, estimate);
  }
  return {
    hours: rangeFor(objectives, estimates, "hours", source === "incumbent"
      ? (estimate, bound) => {
        // Choose the family once per source estimate.  If any explicit hour
        // bound exists, missing hour bounds stay unknown; point conversion is
        // used only when the estimate contains no direct hours at all.
        const hasDirectHours = bounds.some((candidate) => valueAt(estimate, "hours", candidate) !== null);
        if (hasDirectHours) return valueAt(estimate, "hours", bound);
        const points = valueAt(estimate, "romPoints", bound);
        return points === null ? null : points * hoursPerPoint;
      }
      : (estimate, bound) => valueAt(estimate, "hours", bound)),
    cost: rangeFor(objectives, estimates, "cost"),
    estimateIds: [...estimates.values()].map((estimate) => estimate.id),
  };
}

function selectedObjectives(workspace: InitiativeDecisionWorkspace, links: readonly SolutionOptionObjectiveLink[]) {
  const ids = new Set(links.map((link) => link.objectiveId));
  return workspace.objectives.filter((objective) => ids.has(objective.id));
}

function strictDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? value : null;
}

function dependencyBoundary(predecessorInside: boolean, successorInside: boolean): SolutionOptionDependency["boundary"] | null {
  if (predecessorInside && successorInside) return "internal";
  if (!predecessorInside && successorInside) return "inbound";
  if (predecessorInside && !successorInside) return "outbound";
  return null;
}

function optionDependencies(workspace: InitiativeDecisionWorkspace, requestIds: ReadonlySet<string>, objectiveIds: ReadonlySet<string>) {
  const dependencies = new Map<string, SolutionOptionDependency>();
  for (const dependency of workspace.changes.dependencies) {
    const boundary = dependencyBoundary(requestIds.has(dependency.predecessorRequestId), requestIds.has(dependency.successorRequestId));
    if (!boundary) continue;
    const item: SolutionOptionDependency = {
      id: dependency.id,
      layer: "change_request",
      predecessorKind: "change_request",
      predecessorId: dependency.predecessorRequestId,
      successorKind: "change_request",
      successorId: dependency.successorRequestId,
      relationship: dependency.dependencyType,
      boundary,
      authority: dependency.confidence,
      rationale: dependency.rationale,
      sourceReference: dependency.sourceReference,
    };
    dependencies.set(`${item.layer}:${item.predecessorId}:${item.successorId}:${item.relationship}:${item.authority}`, item);
  }
  for (const dependency of workspace.objectiveDependencies ?? []) {
    if (dependency.status === "rejected" || dependency.status === "retired") continue;
    const boundary = dependencyBoundary(objectiveIds.has(dependency.prerequisiteObjectiveId), requestIds.has(dependency.dependentChangeRequestId));
    if (!boundary) continue;
    const item: SolutionOptionDependency = {
      id: dependency.id,
      layer: "objective_gate",
      predecessorKind: "objective",
      predecessorId: dependency.prerequisiteObjectiveId,
      successorKind: "change_request",
      successorId: dependency.dependentChangeRequestId,
      relationship: dependency.relationship,
      boundary,
      authority: dependency.status,
      rationale: dependency.rationale,
      sourceReference: dependency.sourceReference,
    };
    dependencies.set(`${item.layer}:${item.predecessorId}:${item.successorId}:${item.relationship}:${item.authority}`, item);
  }
  const values = [...dependencies.values()];
  return {
    internal: values.filter((item) => item.boundary === "internal"),
    inbound: values.filter((item) => item.boundary === "inbound"),
    outbound: values.filter((item) => item.boundary === "outbound"),
  };
}

/**
 * Derive an option comparison from explicit Objective selections. Change
 * Request links are context only and never cause new Objectives to enter the
 * calculation. Optional Objectives are reported separately and excluded from
 * the core alternative total until the analyst changes their role.
 */
export function deriveSolutionOptionRollup(workspace: InitiativeDecisionWorkspace, optionId: string): SolutionOptionRollup | null {
  const option = workspace.solutionOptions.find((item) => item.id === optionId);
  if (!option) return null;
  const initiative = workspace.initiatives.find((item) => item.id === option.initiativeId);
  if (!initiative) return null;
  const optionLinks = workspace.solutionObjectiveLinks.filter((link) => link.optionId === optionId);
  const coreLinks = optionLinks.filter((link) => link.role !== "optional");
  const optionalLinks = optionLinks.filter((link) => link.role === "optional");
  const coreSelected = selectedObjectives(workspace, coreLinks);
  const optionalSelected = selectedObjectives(workspace, optionalLinks);
  const cancelledObjectiveIds = coreSelected.filter((objective) => objective.status === "cancelled").map((objective) => objective.id);
  const executable = coreSelected.filter((objective) => objective.status !== "cancelled");
  const optionalExecutable = optionalSelected.filter((objective) => objective.status !== "cancelled");
  const hoursPerPoint = romHoursPerPoint(initiative.romHoursPerPoint);
  const incumbentEstimates = new Map<string, ObjectiveEstimate>();
  for (const objective of executable) {
    const estimate = latestEstimate(objective, ["incumbent"]);
    if (estimate) incumbentEstimates.set(objective.id, estimate);
  }
  const incumbent = {
    ...sourceRollup(executable, "incumbent", hoursPerPoint),
    romPoints: rangeFor(executable, incumbentEstimates, "romPoints"),
  };
  const optionalIncumbentEstimates = new Map<string, ObjectiveEstimate>();
  for (const objective of optionalExecutable) {
    const estimate = latestEstimate(objective, ["incumbent"]);
    if (estimate) optionalIncumbentEstimates.set(objective.id, estimate);
  }
  const optionalIncumbent = {
    ...sourceRollup(optionalExecutable, "incumbent", hoursPerPoint),
    romPoints: rangeFor(optionalExecutable, optionalIncumbentEstimates, "romPoints"),
  };
  const selectedObjectiveIds = new Set(executable.map((objective) => objective.id));
  const optionRequestIds = new Set(workspace.solutionChangeRequestLinks.filter((link) => link.optionId === optionId).map((link) => link.changeRequestId));
  const allAttributions = workspace.objectiveEffectAttributions ?? [];
  const attributionEffectIds = new Set(allAttributions
    .filter((attribution) => selectedObjectiveIds.has(attribution.objectiveId))
    .map((attribution) => attribution.changeEffectId));
  const allCoreEffects = workspace.changes.effects.filter((effect) => attributionEffectIds.has(effect.id));
  const coreEffectsOutsideSelectedChange = allCoreEffects.filter((effect) => !optionRequestIds.has(effect.changeRequestId));
  const effects = allCoreEffects.filter((effect) => optionRequestIds.has(effect.changeRequestId));
  const affected = new Map<string, { kind: string; id: string; label: string }>();
  for (const effect of effects) affected.set(`${effect.subjectKind}:${effect.subjectId}`, { kind: effect.subjectKind, id: effect.subjectId, label: effect.subjectLabel });
  const optionEffects = workspace.changes.effects.filter((effect) => optionRequestIds.has(effect.changeRequestId));
  const attributedEffectIds = new Set(allAttributions.map((attribution) => attribution.changeEffectId));
  const unattributedOptionEffects = optionEffects.filter((effect) => !attributedEffectIds.has(effect.id));
  const nonCoreAttributedEffects = optionEffects.filter((effect) => attributedEffectIds.has(effect.id) && !attributionEffectIds.has(effect.id));
  const starts = executable.map((objective) => strictDate(objective.plannedStart)).filter((value): value is string => Boolean(value));
  const finishes = executable.map((objective) => strictDate(objective.plannedFinish)).filter((value): value is string => Boolean(value));
  const coreIds = executable.map((objective) => objective.id);
  const startIds = new Set(executable.filter((objective) => strictDate(objective.plannedStart)).map((objective) => objective.id));
  const finishIds = new Set(executable.filter((objective) => strictDate(objective.plannedFinish)).map((objective) => objective.id));
  const invalidDateObjectiveIds = executable.filter((objective) => (objective.plannedStart && !strictDate(objective.plannedStart)) || (objective.plannedFinish && !strictDate(objective.plannedFinish))).map((objective) => objective.id);
  const dependencies = optionDependencies(workspace, optionRequestIds, selectedObjectiveIds);
  const warnings: string[] = [];
  if (!executable.length) warnings.push("No sourced transformation estimate: this option has no required or enabling Objective.");
  if (cancelledObjectiveIds.length) warnings.push(`${cancelledObjectiveIds.length} selected Objective${cancelledObjectiveIds.length === 1 ? " is" : "s are"} cancelled and excluded from forward effort and schedule.`);
  if (optionalSelected.length) warnings.push(`${optionalSelected.length} optional Objective${optionalSelected.length === 1 ? " is" : "s are"} shown as an add-on and excluded from the core total.`);
  if (unattributedOptionEffects.length) warnings.push(`${unattributedOptionEffects.length} linked Change Request effect${unattributedOptionEffects.length === 1 ? " has" : "s have"} no Objective attribution.`);
  if (nonCoreAttributedEffects.length) warnings.push(`${nonCoreAttributedEffects.length} linked Change Request effect${nonCoreAttributedEffects.length === 1 ? " is" : "s are"} attributed only outside this option's core Objective set.`);
  if (coreEffectsOutsideSelectedChange.length) warnings.push(`${coreEffectsOutsideSelectedChange.length} core Objective effect${coreEffectsOutsideSelectedChange.length === 1 ? " belongs" : "s belong"} to a Change Request not selected for this option.`);
  if (invalidDateObjectiveIds.length) warnings.push(`${invalidDateObjectiveIds.length} selected Objective${invalidDateObjectiveIds.length === 1 ? " has" : "s have"} an invalid planned date; invalid values are excluded from the observed window.`);
  return {
    optionId,
    coreObjectiveIds: coreIds,
    optionalObjectiveIds: optionalSelected.map((objective) => objective.id),
    cancelledObjectiveIds,
    incumbent,
    government: sourceRollup(executable, "government", hoursPerPoint),
    independent: sourceRollup(executable, "independent", hoursPerPoint),
    optional: {
      incumbent: optionalIncumbent,
      government: sourceRollup(optionalExecutable, "government", hoursPerPoint),
      independent: sourceRollup(optionalExecutable, "independent", hoursPerPoint),
    },
    conversion: { hoursPerPoint, rationale: initiative.romConversionRationale, origin: "government_planning_assumption" },
    schedule: {
      earliestPlannedStart: starts.length ? [...starts].sort()[0] : null,
      latestPlannedFinish: finishes.length ? [...finishes].sort().at(-1)! : null,
      startCoverage: coverage(coreIds, startIds),
      finishCoverage: coverage(coreIds, finishIds),
      invalidDateObjectiveIds,
    },
    dependencies,
    scope: {
      effectCount: effects.length,
      affectedObjectCount: affected.size,
      affectedObjects: [...affected.values()].sort((left, right) => left.label.localeCompare(right.label)),
      unattributedChangeEffectCount: unattributedOptionEffects.length,
      nonCoreAttributedEffectCount: nonCoreAttributedEffects.length,
      coreEffectOutsideSelectedChangeCount: coreEffectsOutsideSelectedChange.length,
    },
    warnings,
  };
}
