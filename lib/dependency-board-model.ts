import type { MasterDataPortfolio } from "./master-data-model.js";
import type { InitiativeDecisionWorkspace } from "./initiative-decision-model.js";
import { objectiveRelatedChangeRequestIds } from "./initiative-decision-model.js";
import type { Portfolio } from "./governance-model.js";

export type DependencyBoardItemKind = "change_request" | "objective" | "work_package";
export type DependencyBoardItem = {
  key: string;
  id: string;
  kind: DependencyBoardItemKind;
  identifier: string;
  title: string;
  status: string;
  owner: string | null;
  href: string;
  releaseId: string | null;
  releaseName: string | null;
  scheduleDate: string | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  parentLabel: string | null;
};
export type DependencyBoardEdge = {
  id: string;
  sourceKey: string;
  targetKey: string;
  sourceLabel: string;
  targetLabel: string;
  scope: "change" | "objective_gate" | "work_package";
  relationship: string;
  status: string;
  rationale: string | null;
  sourceReference: string | null;
  cycle: boolean;
};
export type DependencyBoardPortfolio = {
  items: DependencyBoardItem[];
  edges: DependencyBoardEdge[];
  releases: Array<{ id: string; name: string; targetDate: string | null }>;
};

const key = (kind: DependencyBoardItemKind, id: string) => `${kind}:${id}`;

function cycleEdgeIds(edges: Array<Omit<DependencyBoardEdge, "cycle">>) {
  const active = edges.filter((edge) => !["conflicts", "overlaps"].includes(edge.relationship) && !["rejected", "retired"].includes(edge.status));
  const outgoing = new Map<string, Array<{ target: string; id: string }>>();
  for (const edge of active) outgoing.set(edge.sourceKey, [...(outgoing.get(edge.sourceKey) || []), { target: edge.targetKey, id: edge.id }]);
  const result = new Set<string>();
  for (const edge of active) {
    const queue = [edge.targetKey];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (current === edge.sourceKey) { result.add(edge.id); break; }
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of outgoing.get(current) || []) if (next.id !== edge.id) queue.push(next.target);
    }
  }
  return result;
}

export function buildDependencyBoard(decisions: InitiativeDecisionWorkspace, governance: Portfolio, master: MasterDataPortfolio): DependencyBoardPortfolio {
  const releaseById = new Map(master.releases.map((release) => [release.id, release]));
  const requestById = new Map(decisions.changes.requests.map((request) => [request.id, request]));
  const objectiveById = new Map(decisions.objectives.map((objective) => [objective.id, objective]));
  const initiativeById = new Map(decisions.initiatives.map((initiative) => [initiative.id, initiative]));
  const workById = new Map(governance.workPackages.map((work) => [work.id, work]));
  const objectiveRequestIds = new Map(decisions.objectives.map((objective) => [objective.id, objectiveRelatedChangeRequestIds(objective, decisions.objectiveChangeRequestLinks)]));
  const items: DependencyBoardItem[] = [];

  for (const request of decisions.changes.requests) {
    const release = request.requestedReleaseId ? releaseById.get(request.requestedReleaseId) : undefined;
    items.push({ key: key("change_request", request.id), id: request.id, kind: "change_request", identifier: request.externalIdentifier, title: request.title, status: request.decisionStatus, owner: request.externalOwner, href: `/changes/${encodeURIComponent(request.id)}`, releaseId: request.requestedReleaseId, releaseName: request.requestedReleaseName, scheduleDate: release?.targetDate || null, plannedStart: null, plannedFinish: release?.targetDate || null, parentLabel: request.typeLabel });
  }
  for (const objective of decisions.objectives) {
    const relatedRequests = (objectiveRequestIds.get(objective.id) || []).map((id) => requestById.get(id)).filter((item) => Boolean(item));
    const releaseNames = [...new Set(relatedRequests.map((request) => request?.requestedReleaseName).filter((value): value is string => Boolean(value)))];
    const releaseIds = [...new Set(relatedRequests.map((request) => request?.requestedReleaseId).filter((value): value is string => Boolean(value)))];
    items.push({ key: key("objective", objective.id), id: objective.id, kind: "objective", identifier: objective.externalIdentifier, title: objective.title, status: objective.status, owner: objective.technicalOwner, href: `/objectives/${encodeURIComponent(objective.id)}`, releaseId: releaseIds.length === 1 ? releaseIds[0] : null, releaseName: releaseNames.length === 1 ? releaseNames[0] : null, scheduleDate: objective.plannedStart || objective.plannedFinish, plannedStart: objective.plannedStart, plannedFinish: objective.plannedFinish, parentLabel: relatedRequests.map((request) => request?.externalIdentifier).filter(Boolean).join(" · ") || "No accountable Change Request" });
  }
  for (const work of governance.workPackages) {
    const initiative = work.initiativeId ? initiativeById.get(work.initiativeId) : undefined;
    items.push({ key: key("work_package", work.id), id: work.id, kind: "work_package", identifier: work.wbsCode, title: work.title, status: work.status, owner: work.owner, href: `/delivery/${encodeURIComponent(work.id)}`, releaseId: initiative?.primaryReleaseId || null, releaseName: initiative?.primaryReleaseName || null, scheduleDate: work.plannedStart || work.dueDate, plannedStart: work.plannedStart, plannedFinish: work.dueDate, parentLabel: initiative?.title || "Initiative not assigned" });
  }

  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const edges: Array<Omit<DependencyBoardEdge, "cycle">> = [];
  for (const dependency of decisions.changes.dependencies) {
    const sourceKey = key("change_request", dependency.predecessorRequestId);
    const targetKey = key("change_request", dependency.successorRequestId);
    if (!itemByKey.has(sourceKey) || !itemByKey.has(targetKey)) continue;
    edges.push({ id: `change:${dependency.id}`, sourceKey, targetKey, sourceLabel: itemByKey.get(sourceKey)!.identifier, targetLabel: itemByKey.get(targetKey)!.identifier, scope: "change", relationship: dependency.dependencyType, status: "recorded", rationale: dependency.rationale, sourceReference: dependency.sourceReference });
  }
  for (const dependency of decisions.objectiveDependencies || []) {
    const sourceKey = key("objective", dependency.prerequisiteObjectiveId);
    const targetKey = key("change_request", dependency.dependentChangeRequestId);
    if (!itemByKey.has(sourceKey) || !itemByKey.has(targetKey)) continue;
    edges.push({ id: `objective:${dependency.id}`, sourceKey, targetKey, sourceLabel: itemByKey.get(sourceKey)!.identifier, targetLabel: itemByKey.get(targetKey)!.identifier, scope: "objective_gate", relationship: dependency.relationship, status: dependency.status, rationale: dependency.rationale, sourceReference: dependency.sourceReference });
  }
  for (const dependency of governance.workPackageDependencies) {
    const sourceKey = key("work_package", dependency.predecessorWorkPackageId);
    const targetKey = key("work_package", dependency.successorWorkPackageId);
    if (!workById.has(dependency.predecessorWorkPackageId) || !workById.has(dependency.successorWorkPackageId)) continue;
    edges.push({ id: `work:${dependency.id}`, sourceKey, targetKey, sourceLabel: itemByKey.get(sourceKey)?.identifier || dependency.predecessorWorkPackageId, targetLabel: itemByKey.get(targetKey)?.identifier || dependency.successorWorkPackageId, scope: "work_package", relationship: dependency.relationship, status: dependency.status, rationale: dependency.rationale, sourceReference: dependency.sourceReference });
  }
  const cycles = cycleEdgeIds(edges);
  return { items, edges: edges.map((edge) => ({ ...edge, cycle: cycles.has(edge.id) })), releases: master.releases.map((release) => ({ id: release.id, name: release.name, targetDate: release.targetDate })) };
}
