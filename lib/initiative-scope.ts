import type { ChangeEffect, ChangeSubjectKind } from "./change-model.js";
import type { InitiativeDecisionBundle } from "./initiative-decision-model.js";

export type DerivedAffectedObject = {
  kind: ChangeSubjectKind;
  id: string;
  label: string;
  effects: ChangeEffect[];
  objectiveIds: string[];
  releaseNames: string[];
};

export type DerivedInitiativeScope = {
  effects: ChangeEffect[];
  affectedObjects: DerivedAffectedObject[];
  objectCountByKind: Map<ChangeSubjectKind, number>;
  explicitBaselineRecordCount: number;
  attributedEffectCount: number;
  unattributedEffectCount: number;
  releaseNames: string[];
};

/**
 * Initiative technical scope is the union of the hard affected-object links on
 * its Change Requests.  A Product, Platform, or individual baseline record is
 * included only when a Change Request explicitly identifies it; a Release lens
 * never expands a Platform effect into every record in that Release.
 */
export function deriveInitiativeScope(bundle: InitiativeDecisionBundle): DerivedInitiativeScope {
  const requestIds = new Set(bundle.changeRequests.map((request) => request.id));
  const effects = bundle.changes.effects.filter((effect) => requestIds.has(effect.changeRequestId));
  const effectIds = new Set(effects.map((effect) => effect.id));
  const objectiveIds = new Set(bundle.objectives.map((objective) => objective.id));
  const objectiveIdsByEffect = new Map<string, Set<string>>();
  for (const attribution of bundle.objectiveEffectAttributions || []) {
    if (!effectIds.has(attribution.changeEffectId) || !objectiveIds.has(attribution.objectiveId)) continue;
    const attributedObjectives = objectiveIdsByEffect.get(attribution.changeEffectId) || new Set<string>();
    attributedObjectives.add(attribution.objectiveId);
    objectiveIdsByEffect.set(attribution.changeEffectId, attributedObjectives);
  }

  const objectByKey = new Map<string, DerivedAffectedObject>();
  const releaseNames = new Set<string>();
  for (const effect of effects) {
    if (effect.fromReleaseName) releaseNames.add(effect.fromReleaseName);
    if (effect.toReleaseName) releaseNames.add(effect.toReleaseName);
    const key = `${effect.subjectKind}:${effect.subjectId}`;
    const current = objectByKey.get(key) || { kind: effect.subjectKind, id: effect.subjectId, label: effect.subjectLabel, effects: [], objectiveIds: [], releaseNames: [] };
    current.effects.push(effect);
    for (const objectiveId of objectiveIdsByEffect.get(effect.id) || []) if (!current.objectiveIds.includes(objectiveId)) current.objectiveIds.push(objectiveId);
    for (const releaseName of [effect.fromReleaseName, effect.toReleaseName]) if (releaseName && !current.releaseNames.includes(releaseName)) current.releaseNames.push(releaseName);
    objectByKey.set(key, current);
  }
  for (const request of bundle.changeRequests) if (request.requestedReleaseName) releaseNames.add(request.requestedReleaseName);

  const affectedObjects = [...objectByKey.values()].sort((left, right) => `${left.kind}:${left.label}`.localeCompare(`${right.kind}:${right.label}`));
  const objectCountByKind = new Map<ChangeSubjectKind, number>();
  for (const object of affectedObjects) objectCountByKind.set(object.kind, (objectCountByKind.get(object.kind) || 0) + 1);
  const attributedEffectCount = new Set(objectiveIdsByEffect.keys()).size;
  return {
    effects,
    affectedObjects,
    objectCountByKind,
    explicitBaselineRecordCount: objectCountByKind.get("occurrence") || 0,
    attributedEffectCount,
    unattributedEffectCount: effects.length - attributedEffectCount,
    releaseNames: [...releaseNames].sort((left, right) => left.localeCompare(right)),
  };
}

export function scopeObjectKindLabel(kind: ChangeSubjectKind) {
  return kind === "occurrence" ? "baseline record" : kind.replaceAll("_", " ");
}
