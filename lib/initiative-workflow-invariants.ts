export type ObjectiveLifecycleIssue = "planned_window_reversed" | "actual_window_reversed" | "complete_without_actual_finish";
export type MilestoneLifecycleIssue = "complete_without_actual_date";

type ObjectiveLifecycleInput = {
  status: string;
  plannedStart?: string | null;
  plannedFinish?: string | null;
  actualStart?: string | null;
  actualFinish?: string | null;
};

type MilestoneLifecycleInput = { status: string; actualDate?: string | null };
type ObjectiveRequestRelation = { objectiveId: string; changeRequestId: string };

const dateOnly = (value: string | null | undefined) => value?.trim().slice(0, 10) || null;

export function objectiveLifecycleIssues(input: ObjectiveLifecycleInput): ObjectiveLifecycleIssue[] {
  const issues: ObjectiveLifecycleIssue[] = [];
  const plannedStart = dateOnly(input.plannedStart);
  const plannedFinish = dateOnly(input.plannedFinish);
  const actualStart = dateOnly(input.actualStart);
  const actualFinish = dateOnly(input.actualFinish);
  if (plannedStart && plannedFinish && plannedStart > plannedFinish) issues.push("planned_window_reversed");
  if (actualStart && actualFinish && actualStart > actualFinish) issues.push("actual_window_reversed");
  if (input.status === "complete" && !actualFinish) issues.push("complete_without_actual_finish");
  return issues;
}

export function milestoneLifecycleIssues(input: MilestoneLifecycleInput): MilestoneLifecycleIssue[] {
  return input.status === "complete" && !dateOnly(input.actualDate) ? ["complete_without_actual_date"] : [];
}

export function requirementNeedsAcceptancePath(traceStatus: string) {
  return traceStatus !== "not_applicable";
}

export function requirementHasAcceptancePath(requirementId: string, criteria: readonly { requirementTraceId: string | null }[]) {
  return criteria.some((criterion) => criterion.requirementTraceId === requirementId);
}

export function objectiveIdsLeavingInitiativeScope(input: {
  removedChangeRequestId: string;
  remainingChangeRequestIds: readonly string[];
  relations: readonly ObjectiveRequestRelation[];
}) {
  const remaining = new Set(input.remainingChangeRequestIds);
  const candidateObjectiveIds = new Set(input.relations.filter((relation) => relation.changeRequestId === input.removedChangeRequestId).map((relation) => relation.objectiveId));
  return [...candidateObjectiveIds].filter((objectiveId) => !input.relations.some((relation) => relation.objectiveId === objectiveId && remaining.has(relation.changeRequestId))).sort();
}
