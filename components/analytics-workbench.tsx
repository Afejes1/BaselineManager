"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "./app-link";
import { type AnalyticsContextKind } from "./analytics-link";
import { useWorkspaceContext } from "./workspace-context";
import { useChangePortfolio } from "../lib/change-client";
import { productDisplayName, productIdentityKey, text } from "../lib/baseline-data";
import { dataQualityFor } from "../lib/baseline-quality";
import { useGovernancePortfolio } from "../lib/governance-client";
import { displayStatus } from "../lib/governance-model";
import { useInitiativeDecisions } from "../lib/initiative-decision-client";
import { objectiveRelatedChangeRequestIds, readable, selectInitiativeBundle } from "../lib/initiative-decision-model";
import { useMasterData } from "../lib/master-data-client";
import { usePlatformPortfolio } from "../lib/platform-client";
import { compareReleases, releaseNames } from "../lib/release-analysis";
import type { ManagedRecord24 } from "../lib/baseline-client";
import type { ChangeEffect, ChangeRequest } from "../lib/change-model";

type ScopeKind = "portfolio" | AnalyticsContextKind;

type Scope = {
  kind: ScopeKind;
  id: string | null;
  label: string;
  description: string;
  rows: ManagedRecord24[];
  requestIds: Set<string>;
  objectiveIds: Set<string>;
  initiativeIds: Set<string>;
  platformIds: Set<string>;
  releaseIds: Set<string>;
  evidenceKeys: Set<string>;
};

const supportedKinds: AnalyticsContextKind[] = ["product", "platform", "release", "change_request", "objective", "initiative", "organization", "capability"];
const priorityWeight: Record<string, number> = { critical: 6, high: 4, medium: 2, low: 1, unranked: 0 };
const clean = (value: unknown) => String(value ?? "").trim();
const normalized = (value: unknown) => clean(value).replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));

function hrefFor(kind: string, id: string) {
  if (kind === "product") return `/products/${encodeURIComponent(id)}`;
  if (kind === "platform") return `/platforms/${encodeURIComponent(id)}`;
  if (kind === "release") return `/releases/${encodeURIComponent(id)}`;
  if (kind === "change_request") return `/changes/${encodeURIComponent(id)}`;
  if (kind === "objective") return `/objectives/${encodeURIComponent(id)}`;
  if (kind === "initiative") return `/initiatives/${encodeURIComponent(id)}`;
  if (kind === "organization") return `/organizations/${encodeURIComponent(id)}`;
  if (kind === "capability") return `/capabilities/${encodeURIComponent(id)}`;
  if (kind === "occurrence") return `/occurrences/${encodeURIComponent(id)}`;
  return "/";
}

function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }

function distribution(rows: ManagedRecord24[], valueFor: (row: ManagedRecord24) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = valueFor(row) || "Not reported";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)).slice(0, 7);
}

function Distribution({ title, detail, items }: { title: string; detail: string; items: Array<{ label: string; count: number }> }) {
  const maximum = Math.max(...items.map((item) => item.count), 1);
  return <article className="domain-card analytics-distribution">
    <span className="eyebrow">BASELINE COMPOSITION</span>
    <h3>{title}</h3>
    <p className="entity-meta">{detail}</p>
    {items.length ? <div className="analytics-bar-list">{items.map((item) => <div className="analytics-bar-row" key={item.label}><span title={item.label}>{item.label}</span><div className="analytics-bar-track" aria-label={`${item.label}: ${item.count} records`}><i style={{ width: `${Math.max(7, Math.round((item.count / maximum) * 100))}%` }} /></div><b>{item.count}</b></div>)}</div> : <p className="empty">No baseline records are in scope.</p>}
  </article>;
}

function decisionPressure(request: ChangeRequest, effects: ChangeEffect[], dependencyCount: number, objectiveCount: number) {
  const noEffect = effects.length === 0 ? 3 : 0;
  const noObjective = objectiveCount === 0 ? 2 : 0;
  const noConsequence = !clean(request.consequenceIfDeferred) || !clean(request.consequenceIfFunded) ? 1 : 0;
  return (request.decisionStatus === "pending" ? 8 : 0) + (priorityWeight[request.governmentPriority] || 0) + Math.min(dependencyCount, 4) + Math.min(effects.length, 3) + noEffect + noObjective + noConsequence;
}

export function AnalyticsWorkbench() {
  const searchParams = useSearchParams();
  const { rows, scopedRows, releaseLens, loading: baselineLoading, error: baselineError } = useWorkspaceContext();
  const master = useMasterData();
  const platforms = usePlatformPortfolio();
  const changes = useChangePortfolio();
  const decisions = useInitiativeDecisions();
  const governance = useGovernancePortfolio();
  const requestedKind = searchParams.get("kind");
  const requestedId = searchParams.get("id") || "";
  const kind: ScopeKind = requestedKind && supportedKinds.includes(requestedKind as AnalyticsContextKind) && requestedId ? requestedKind as AnalyticsContextKind : "portfolio";
  const baseRows = releaseLens ? scopedRows : rows;

  const analysis = useMemo(() => {
    const workspace = decisions.workspace;
    const masterData = master.portfolio;
    const changePortfolio = changes.portfolio;
    const platformPortfolio = platforms.portfolio;
    const governancePortfolio = governance.portfolio;
    const requestById = new Map(changePortfolio.requests.map((request) => [request.id, request]));
    const objectiveLinks = workspace?.objectiveChangeRequestLinks || [];
    const assignmentByOccurrence = new Map<string, string[]>();
    for (const assignment of platformPortfolio.assignments) assignmentByOccurrence.set(assignment.baselineOccurrenceId, [...(assignmentByOccurrence.get(assignment.baselineOccurrenceId) || []), assignment.platformId]);

    const descendantsFor = (platformId: string) => {
      const ids = new Set([platformId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const platform of platformPortfolio.platforms) if (platform.parentId && ids.has(platform.parentId) && !ids.has(platform.id)) { ids.add(platform.id); changed = true; }
      }
      return ids;
    };

    const rowsForEffects = (effects: ChangeEffect[]) => {
      const productIds = new Set(effects.filter((item) => item.subjectKind === "product").map((item) => item.subjectId));
      const occurrenceIds = new Set(effects.filter((item) => item.subjectKind === "occurrence").map((item) => item.subjectId));
      const nodeIds = new Set(effects.filter((item) => item.subjectKind === "configuration_node").map((item) => item.subjectId));
      const releaseIds = new Set(effects.filter((item) => item.subjectKind === "release").map((item) => item.subjectId));
      const releaseNames = new Set(effects.flatMap((item) => [item.fromReleaseName, item.toReleaseName]).filter((item): item is string => Boolean(item)));
      const organizationIds = new Set(effects.filter((item) => item.subjectKind === "organization").map((item) => item.subjectId));
      const organizationNames = new Set(effects.filter((item) => item.subjectKind === "organization").map((item) => normalized(item.subjectLabel)));
      const platformIds = new Set(effects.filter((item) => item.subjectKind === "platform").flatMap((item) => [...descendantsFor(item.subjectId)]));
      const platformOccurrenceIds = new Set(platformPortfolio.assignments.filter((item) => platformIds.has(item.platformId)).map((item) => item.baselineOccurrenceId));
      const namesById = new Map(masterData.organizations.map((item) => [item.id, normalized(item.name)]));
      for (const id of organizationIds) { const name = namesById.get(id); if (name) organizationNames.add(name); }
      return baseRows.filter((row) => productIds.has(row.__meta.productId || "") || occurrenceIds.has(row.__meta.occurrenceId) || nodeIds.has(row.__meta.configurationNodeId || "") || releaseIds.has(row.__meta.releaseId || "") || releaseNames.has(clean(row.ReleaseName)) || platformOccurrenceIds.has(row.__meta.occurrenceId) || organizationNames.has(normalized(row.OEM)));
    };

    const relatedObjectiveIds = (requestIds: Set<string>) => new Set((workspace?.objectives || []).filter((objective) => objectiveRelatedChangeRequestIds(objective, objectiveLinks).some((requestId) => requestIds.has(requestId))).map((objective) => objective.id));
    const initiativeIdsForRequests = (requestIds: Set<string>) => new Set((workspace?.links || []).filter((link) => requestIds.has(link.changeRequestId)).map((link) => link.initiativeId));
    const allRowReleaseIds = (sourceRows: ManagedRecord24[]) => new Set(sourceRows.map((row) => row.__meta.releaseId).filter((id): id is string => Boolean(id)));
    const allRowPlatformIds = (sourceRows: ManagedRecord24[]) => new Set(sourceRows.flatMap((row) => assignmentByOccurrence.get(row.__meta.occurrenceId) || []));

    let selectedRows: ManagedRecord24[] = [];
    let requestIds = new Set<string>();
    let objectiveIds = new Set<string>();
    let initiativeIds = new Set<string>();
    let platformIds = new Set<string>();
    let releaseIds = new Set<string>();
    let label = "Cross-release portfolio";
    let description = releaseLens ? `Baseline measures are filtered to ${releaseLens}. Decision and evidence links remain cross-release.` : "Working baseline, delivery evidence, and decision traceability across all releases.";

    if (kind === "portfolio") {
      selectedRows = baseRows;
      requestIds = new Set(changePortfolio.requests.map((item) => item.id));
      objectiveIds = new Set((workspace?.objectives || []).map((item) => item.id));
      initiativeIds = new Set((workspace?.initiatives || []).map((item) => item.id));
      platformIds = new Set(platformPortfolio.platforms.map((item) => item.id));
      releaseIds = allRowReleaseIds(selectedRows);
    } else if (kind === "product") {
      const product = masterData.products.find((item) => item.id === requestedId || productIdentityKey({ LongName: item.canonicalName } as ManagedRecord24) === requestedId);
      const productIds = new Set([requestedId, product?.id].filter((id): id is string => Boolean(id)));
      selectedRows = baseRows.filter((row) => productIds.has(row.__meta.productId || "") || productIdentityKey(row) === requestedId);
      for (const row of selectedRows) if (row.__meta.productId) productIds.add(row.__meta.productId);
      label = product?.canonicalName || productDisplayName(selectedRows[0] || {} as ManagedRecord24);
      description = "Product fielding history, technical effects, delivery commitments, and linked evidence.";
      requestIds = new Set(changePortfolio.effects.filter((effect) => effect.subjectKind === "product" && productIds.has(effect.subjectId)).map((effect) => effect.changeRequestId));
      objectiveIds = relatedObjectiveIds(requestIds);
      initiativeIds = initiativeIdsForRequests(requestIds);
      platformIds = allRowPlatformIds(selectedRows);
      releaseIds = allRowReleaseIds(selectedRows);
    } else if (kind === "platform") {
      const platform = platformPortfolio.platforms.find((item) => item.id === requestedId);
      platformIds = descendantsFor(requestedId);
      const occurrenceIds = new Set(platformPortfolio.assignments.filter((item) => platformIds.has(item.platformId)).map((item) => item.baselineOccurrenceId));
      selectedRows = baseRows.filter((row) => occurrenceIds.has(row.__meta.occurrenceId));
      label = platform ? `${platform.code} · ${platform.name}` : requestedId;
      description = "Platform subtree, fielded baseline positions, change effects, and supporting evidence.";
      requestIds = new Set(changePortfolio.effects.filter((effect) => effect.subjectKind === "platform" && platformIds.has(effect.subjectId)).map((effect) => effect.changeRequestId));
      objectiveIds = relatedObjectiveIds(requestIds);
      initiativeIds = initiativeIdsForRequests(requestIds);
      releaseIds = allRowReleaseIds(selectedRows);
    } else if (kind === "release") {
      const release = masterData.releases.find((item) => item.id === requestedId || item.name === requestedId) || platformPortfolio.releases.find((item) => item.id === requestedId || item.name === requestedId);
      const releaseName = release?.name || requestedId;
      selectedRows = baseRows.filter((row) => clean(row.ReleaseName) === releaseName || row.__meta.releaseId === release?.id);
      label = releaseName;
      description = "Release baseline posture, targeted work, observed change, and supporting evidence.";
      if (release?.id) releaseIds.add(release.id);
      for (const row of selectedRows) if (row.__meta.releaseId) releaseIds.add(row.__meta.releaseId);
      const releaseEffects = changePortfolio.effects.filter((effect) => (effect.subjectKind === "release" && releaseIds.has(effect.subjectId)) || effect.fromReleaseName === releaseName || effect.toReleaseName === releaseName);
      requestIds = new Set(changePortfolio.requests.filter((request) => request.requestedReleaseName === releaseName || (release?.id && request.requestedReleaseId === release.id)).map((request) => request.id));
      for (const effect of releaseEffects) requestIds.add(effect.changeRequestId);
      objectiveIds = relatedObjectiveIds(requestIds);
      initiativeIds = new Set((workspace?.initiatives || []).filter((item) => item.primaryReleaseName === releaseName || (release?.id && item.primaryReleaseId === release.id)).map((item) => item.id));
      platformIds = allRowPlatformIds(selectedRows);
    } else if (kind === "change_request") {
      const request = requestById.get(requestedId);
      label = request ? `${request.externalIdentifier} · ${request.title}` : requestedId;
      description = "Government funding decision, attributed technical scope, delivery chain, and evidence.";
      requestIds.add(requestedId);
      objectiveIds = relatedObjectiveIds(requestIds);
      initiativeIds = initiativeIdsForRequests(requestIds);
      const effects = changePortfolio.effects.filter((effect) => requestIds.has(effect.changeRequestId));
      selectedRows = rowsForEffects(effects);
      platformIds = allRowPlatformIds(selectedRows);
      releaseIds = allRowReleaseIds(selectedRows);
      if (request?.requestedReleaseId) releaseIds.add(request.requestedReleaseId);
    } else if (kind === "objective") {
      const objective = (workspace?.objectives || []).find((item) => item.id === requestedId);
      label = objective ? `${objective.externalIdentifier} · ${objective.title}` : requestedId;
      description = "Incumbent objective, linked funding requests, technical attribution, acceptance, and evidence.";
      objectiveIds.add(requestedId);
      for (const requestId of objective ? objectiveRelatedChangeRequestIds(objective, objectiveLinks) : []) requestIds.add(requestId);
      const attributedEffectIds = new Set((workspace?.objectiveEffectAttributions || []).filter((item) => objectiveIds.has(item.objectiveId)).map((item) => item.changeEffectId));
      const effects = changePortfolio.effects.filter((effect) => attributedEffectIds.has(effect.id) || requestIds.has(effect.changeRequestId));
      for (const effect of effects) requestIds.add(effect.changeRequestId);
      selectedRows = rowsForEffects(effects);
      initiativeIds = initiativeIdsForRequests(requestIds);
      platformIds = allRowPlatformIds(selectedRows);
      releaseIds = allRowReleaseIds(selectedRows);
    } else if (kind === "initiative") {
      const initiative = (workspace?.initiatives || []).find((item) => item.id === requestedId);
      const bundle = workspace ? selectInitiativeBundle(workspace, requestedId) : null;
      const plan = governancePortfolio?.initiatives.find((item) => item.id === requestedId);
      label = initiative?.title || plan?.title || requestedId;
      description = "Leadership outcome, funded work, incumbent delivery, baseline scope, and evidence readiness.";
      requestIds = new Set(bundle?.changeRequests.map((item) => item.id) || []);
      objectiveIds = new Set(bundle?.objectives.map((item) => item.id) || []);
      initiativeIds.add(requestedId);
      const productScopeIds = new Set(plan?.scope.filter((item) => item.scopeKind === "product").map((item) => item.scopeId) || []);
      const releaseScopeIds = new Set(plan?.scope.filter((item) => item.scopeKind === "release").map((item) => item.scopeId) || []);
      const baseScopeRows = baseRows.filter((row) => productScopeIds.has(row.__meta.productId || "") || releaseScopeIds.has(row.__meta.releaseId || "") || clean(row.ReleaseName) === initiative?.primaryReleaseName || clean(row.ReleaseName) === plan?.primaryReleaseName);
      const objectiveEffectIds = new Set((workspace?.objectiveEffectAttributions || []).filter((item) => objectiveIds.has(item.objectiveId)).map((item) => item.changeEffectId));
      const effects = changePortfolio.effects.filter((effect) => requestIds.has(effect.changeRequestId) || objectiveEffectIds.has(effect.id));
      const effectRows = rowsForEffects(effects);
      selectedRows = Array.from(new Map([...baseScopeRows, ...effectRows].map((row) => [row.__meta.occurrenceId, row])).values());
      platformIds = allRowPlatformIds(selectedRows);
      releaseIds = allRowReleaseIds(selectedRows);
    } else if (kind === "organization") {
      const organization = masterData.organizations.find((item) => item.id === requestedId || normalized(item.name) === normalized(requestedId)) || platformPortfolio.organizations.find((item) => item.id === requestedId);
      const organizationName = organization?.name || requestedId;
      selectedRows = baseRows.filter((row) => normalized(row.OEM) === normalized(organizationName));
      label = organizationName;
      description = "Supplier or organization baseline footprint, decisions affecting its products, and evidence.";
      const productIds = new Set(selectedRows.map((row) => row.__meta.productId).filter((id): id is string => Boolean(id)));
      requestIds = new Set(changePortfolio.effects.filter((effect) => (effect.subjectKind === "organization" && (effect.subjectId === organization?.id || normalized(effect.subjectLabel) === normalized(organizationName))) || (effect.subjectKind === "product" && productIds.has(effect.subjectId))).map((effect) => effect.changeRequestId));
      objectiveIds = relatedObjectiveIds(requestIds);
      initiativeIds = initiativeIdsForRequests(requestIds);
      platformIds = allRowPlatformIds(selectedRows);
      releaseIds = allRowReleaseIds(selectedRows);
    } else if (kind === "capability") {
      const capability = masterData.capabilities.find((item) => item.id === requestedId || normalized(item.name) === normalized(requestedId));
      const capabilityName = capability?.name || requestedId;
      selectedRows = baseRows.filter((row) => normalized(row["Technical Capability Satisfied by this SW/Tech - Notes"]) === normalized(capabilityName));
      label = capabilityName;
      description = "Capability mapping, fielded Products, linked decision effects, and evidence.";
      const productIds = new Set(selectedRows.map((row) => row.__meta.productId).filter((id): id is string => Boolean(id)));
      requestIds = new Set(changePortfolio.effects.filter((effect) => effect.subjectKind === "product" && productIds.has(effect.subjectId)).map((effect) => effect.changeRequestId));
      objectiveIds = relatedObjectiveIds(requestIds);
      initiativeIds = initiativeIdsForRequests(requestIds);
      platformIds = allRowPlatformIds(selectedRows);
      releaseIds = allRowReleaseIds(selectedRows);
    }

    const scopedEffects = changePortfolio.effects.filter((effect) => requestIds.has(effect.changeRequestId));
    for (const attribution of workspace?.objectiveEffectAttributions || []) if (objectiveIds.has(attribution.objectiveId)) {
      const effect = changePortfolio.effects.find((item) => item.id === attribution.changeEffectId);
      if (effect) requestIds.add(effect.changeRequestId);
    }
    for (const objectiveId of relatedObjectiveIds(requestIds)) objectiveIds.add(objectiveId);
    for (const initiativeId of initiativeIdsForRequests(requestIds)) initiativeIds.add(initiativeId);
    for (const platformId of allRowPlatformIds(selectedRows)) platformIds.add(platformId);
    for (const releaseId of allRowReleaseIds(selectedRows)) releaseIds.add(releaseId);

    const evidenceKeys = new Set<string>();
    if (kind !== "portfolio" && requestedId) evidenceKeys.add(`${kind}:${requestedId}`);
    for (const row of selectedRows) {
      evidenceKeys.add(`occurrence:${row.__meta.occurrenceId}`);
      if (row.__meta.productId) evidenceKeys.add(`product:${row.__meta.productId}`);
      if (row.__meta.configurationNodeId) evidenceKeys.add(`configuration_node:${row.__meta.configurationNodeId}`);
      if (row.__meta.releaseId) evidenceKeys.add(`release:${row.__meta.releaseId}`);
    }
    for (const requestId of requestIds) evidenceKeys.add(`change_request:${requestId}`);
    for (const objectiveId of objectiveIds) evidenceKeys.add(`objective:${objectiveId}`);
    for (const initiativeId of initiativeIds) evidenceKeys.add(`initiative:${initiativeId}`);
    for (const platformId of platformIds) evidenceKeys.add(`platform:${platformId}`);

    return { scope: { kind, id: kind === "portfolio" ? null : requestedId, label: label || "Unidentified object", description, rows: selectedRows, requestIds, objectiveIds, initiativeIds, platformIds, releaseIds, evidenceKeys } satisfies Scope, scopedEffects, requestById, assignmentByOccurrence };
  }, [baseRows, changes.portfolio, decisions.workspace, governance.portfolio, kind, master.portfolio, platforms.portfolio, releaseLens, requestedId]);

  const { scope, scopedEffects, requestById } = analysis;
  const scopedRequests = useMemo(() => changes.portfolio.requests.filter((request) => scope.requestIds.has(request.id)), [changes.portfolio.requests, scope.requestIds]);
  const scopedObjectives = useMemo(() => (decisions.workspace?.objectives || []).filter((objective) => scope.objectiveIds.has(objective.id)), [decisions.workspace?.objectives, scope.objectiveIds]);
  const scopedInitiatives = useMemo(() => (decisions.workspace?.initiatives || []).filter((initiative) => scope.initiativeIds.has(initiative.id)), [decisions.workspace?.initiatives, scope.initiativeIds]);
  const scopedEvidence = useMemo(() => (governance.portfolio?.records || []).filter((record) => scope.kind === "portfolio" || record.links.some((link) => scope.evidenceKeys.has(`${link.entityKind}:${link.entityId}`))), [governance.portfolio?.records, scope.evidenceKeys, scope.kind]);
  const products = useMemo(() => new Map(scope.rows.map((row) => [row.__meta.productId || productIdentityKey(row), productDisplayName(row)])), [scope.rows]);
  const quality = useMemo(() => scope.rows.reduce((result, row) => { const level = dataQualityFor(row).level; if (level === "issue") result.issues += 1; else if (level === "review") result.warnings += 1; else result.ready += 1; return result; }, { ready: 0, warnings: 0, issues: 0 }), [scope.rows]);
  const objectiveEffects = useMemo(() => new Set((decisions.workspace?.objectiveEffectAttributions || []).filter((item) => scope.objectiveIds.has(item.objectiveId)).map((item) => item.changeEffectId)), [decisions.workspace?.objectiveEffectAttributions, scope.objectiveIds]);
  const scopedDependencies = useMemo(() => changes.portfolio.dependencies.filter((dependency) => scope.requestIds.has(dependency.predecessorRequestId) || scope.requestIds.has(dependency.successorRequestId)), [changes.portfolio.dependencies, scope.requestIds]);
  const pressure = useMemo(() => scopedRequests.map((request) => {
    const effects = scopedEffects.filter((effect) => effect.changeRequestId === request.id);
    const dependencies = scopedDependencies.filter((item) => item.predecessorRequestId === request.id || item.successorRequestId === request.id).length;
    const objectives = scopedObjectives.filter((objective) => objectiveRelatedChangeRequestIds(objective, decisions.workspace?.objectiveChangeRequestLinks || []).includes(request.id)).length;
    return { request, effects: effects.length, dependencies, objectives, score: decisionPressure(request, effects, dependencies, objectives) };
  }).sort((left, right) => right.score - left.score || left.request.externalIdentifier.localeCompare(right.request.externalIdentifier)), [decisions.workspace?.objectiveChangeRequestLinks, scopedDependencies, scopedEffects, scopedObjectives, scopedRequests]);

  const objectiveChecks = useMemo(() => scopedObjectives.flatMap((objective) => {
    const requirements = (decisions.workspace?.requirements || []).filter((item) => item.objectiveId === objective.id);
    const criteria = (decisions.workspace?.criteria || []).filter((item) => item.objectiveId === objective.id);
    const effects = (decisions.workspace?.objectiveEffectAttributions || []).filter((item) => item.objectiveId === objective.id);
    const incomplete = objective.status !== "complete" && objective.status !== "cancelled";
    const items: Array<{ severity: "warning" | "blocker"; title: string; detail: string }> = [];
    if (incomplete && (!objective.sourceLocator || !objective.sourceAsOf)) items.push({ severity: "warning", title: "Objective source is incomplete", detail: "Record the external locator and source-as-of date before treating schedule or effort as current." });
    if (incomplete && !effects.length) items.push({ severity: "warning", title: "No technical effect is attributed", detail: "Link the Objective to a Change Request effect before representing baseline impact." });
    if (incomplete && requirements.length && requirements.some((item) => item.traceStatus !== "verified" && item.traceStatus !== "not_applicable")) items.push({ severity: "warning", title: "Requirement trace remains open", detail: `${requirements.filter((item) => item.traceStatus !== "verified" && item.traceStatus !== "not_applicable").length} requirement traces need disposition.` });
    if (incomplete && criteria.length && criteria.some((item) => item.status !== "passed" && item.status !== "waived")) items.push({ severity: "warning", title: "Acceptance is not complete", detail: `${criteria.filter((item) => item.status !== "passed" && item.status !== "waived").length} acceptance criteria remain open.` });
    return items.map((item) => ({ ...item, objective }));
  }), [decisions.workspace?.criteria, decisions.workspace?.objectiveEffectAttributions, decisions.workspace?.requirements, scopedObjectives]);

  const releaseRows = useMemo(() => {
    const available = releaseNames(scope.rows);
    const allRowsForComparison = baseRows;
    return available.map((release, index) => {
      const inRelease = scope.rows.filter((row) => clean(row.ReleaseName) === release);
      const productIds = new Set(inRelease.map((row) => row.__meta.productId).filter(Boolean));
      const occurrences = new Set(inRelease.map((row) => row.__meta.occurrenceId));
      const previous = available[index - 1];
      const changesFromPrior = previous ? compareReleases(allRowsForComparison, previous, release).filter((delta) => scope.kind === "portfolio" || delta.anchorIds.some((anchor) => (anchor.kind === "product" && productIds.has(anchor.id)) || (anchor.kind === "occurrence" && occurrences.has(anchor.id)) || (anchor.kind === "release" && scope.releaseIds.has(anchor.id)))).length : 0;
      const targetedRequests = scopedRequests.filter((request) => request.requestedReleaseName === release).length;
      const review = inRelease.filter((row) => dataQualityFor(row).level === "review").length;
      const issues = inRelease.filter((row) => dataQualityFor(row).level === "issue").length;
      return { release, records: inRelease.length, products: productIds.size, hosts: new Set(inRelease.map((row) => clean(row.HW_Host) || "Not reported")).size, review, issues, changesFromPrior, targetedRequests };
    });
  }, [baseRows, scope.kind, scope.releaseIds, scope.rows, scopedRequests]);

  const traceability = useMemo(() => {
    const requirements = (decisions.workspace?.requirements || []).filter((item) => scope.objectiveIds.has(item.objectiveId));
    const criteria = (decisions.workspace?.criteria || []).filter((item) => scope.objectiveIds.has(item.objectiveId));
    const releasedRows = scope.rows.filter((row) => Boolean(row.__meta.releaseId));
    return {
      attributed: objectiveEffects.size,
      requirements: requirements.length,
      tracedRequirements: requirements.filter((item) => item.traceStatus === "verified" || item.traceStatus === "not_applicable").length,
      criteria: criteria.length,
      acceptedCriteria: criteria.filter((item) => item.status === "passed" || item.status === "waived").length,
      evidence: scopedEvidence.length,
      withRelease: releasedRows.length,
    };
  }, [decisions.workspace?.criteria, decisions.workspace?.requirements, objectiveEffects.size, scope.objectiveIds, scope.rows, scopedEvidence.length]);

  const loading = baselineLoading || master.loading || platforms.loading || changes.loading || decisions.loading || governance.loading;
  const errors = [baselineError, master.error, platforms.error, changes.error, decisions.error, governance.error].filter(Boolean);
  if (loading) return <section className="domain-section"><p className="empty">Loading baseline analytics…</p></section>;

  const runtimeDistribution = distribution(scope.rows, (row) => normalized(row.Containerized) === "yes" ? `${clean(row.Containerized)} · ${clean(row["Container Technology"]) || "technology not reported"}` : clean(row.Containerized) ? "Direct / non-containerized" : "Runtime not reported");
  const languageDistribution = distribution(scope.rows, (row) => clean(row["SW Language"]));
  const supplierDistribution = distribution(scope.rows, (row) => clean(row.OEM));
  const platformLabels = Array.from(scope.platformIds).map((id) => platforms.portfolio.platforms.find((item) => item.id === id)).filter(Boolean);
  const capabilityLabels = unique(scope.rows.map((row) => clean(row["Technical Capability Satisfied by this SW/Tech - Notes"])));
  const pending = scopedRequests.filter((request) => request.decisionStatus === "pending").length;

  return <>
    {errors.length ? <section className="domain-section"><p className="error-copy">Some analytic sources are unavailable: {errors.join(" · ")}</p></section> : null}
    <section className="analytics-scope-strip">
      <div><span className="eyebrow">ANALYSIS SCOPE</span><h2>{scope.label}</h2><p>{scope.description}</p></div>
      <div className="analytics-scope-facts"><span>{scope.kind === "portfolio" ? "Portfolio" : readable(scope.kind)}</span><strong>{releaseLens || "All releases"}</strong><small>{releaseLens ? "Release lens applied to baseline measures" : "Cross-release baseline measures"}</small></div>
    </section>

    <section className="summary analytics-summary" aria-label="Analytics summary">
      <div className="summary-lead"><p>CANONICAL BASELINE POSITION</p><h2>{scope.rows.length} records in scope</h2><span>{products.size} Products · {releaseRows.length} releases · {platformLabels.length} linked Platforms</span></div>
      <div className="metric"><span>Decision pressure</span><strong>{pending}</strong><small>Funding decisions pending</small></div>
      <div className="metric metric-alert"><span>Baseline findings</span><strong>{quality.issues + quality.warnings}</strong><small>{quality.issues} blocking · {quality.warnings} warnings</small></div>
      <div className="metric"><span>Traceability</span><strong>{traceability.evidence}</strong><small>Linked calls and evidence records</small></div>
    </section>

    <section className="split-layout analytics-priority-grid">
      <article className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">ANALYST PRIORITIES</span><h3>Decision and traceability items that need attention</h3></div><span>{pressure.filter((item) => item.request.decisionStatus === "pending").length} decisions pending</span></div><div className="analytics-signal-list">
        {pressure.slice(0, 7).map((item) => <article className={`analytics-signal ${item.request.decisionStatus === "pending" ? "signal-decision" : ""}`} key={item.request.id}><div><span className={`priority-badge priority-${item.request.governmentPriority}`}>{item.request.governmentPriority}</span><Link href={hrefFor("change_request", item.request.id)}><strong>{item.request.externalIdentifier} · {item.request.title}</strong></Link><small>{item.effects} technical effects · {item.objectives} LM Objectives · {item.dependencies} dependency links</small></div><span className={`decision-badge decision-${item.request.decisionStatus}`}>{item.request.decisionStatus}</span></article>)}
        {objectiveChecks.slice(0, Math.max(0, 7 - pressure.length)).map((item) => <article className={`analytics-signal signal-${item.severity}`} key={`${item.objective.id}:${item.title}`}><div><span className="record-type">LM OBJECTIVE</span><Link href={hrefFor("objective", item.objective.id)}><strong>{item.objective.externalIdentifier} · {item.title}</strong></Link><small>{item.detail}</small></div><span className={`status-pill status-${item.severity}`}>{item.severity}</span></article>)}
        {!pressure.length && !objectiveChecks.length ? <p className="empty">No automated decision or traceability gaps were found in this scope. Analyst judgment is still required before briefing leadership.</p> : null}
      </div></article>
      <article className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">TRACEABILITY COVERAGE</span><h3>Can the narrative be supported?</h3></div></div><dl className="analytics-facts"><div><dt>Objective effects</dt><dd>{traceability.attributed}</dd><small>Hard attributed baseline effects</small></div><div><dt>Requirements</dt><dd>{traceability.tracedRequirements}/{traceability.requirements}</dd><small>Verified or dispositioned</small></div><div><dt>Acceptance</dt><dd>{traceability.acceptedCriteria}/{traceability.criteria}</dd><small>Passed or waived criteria</small></div><div><dt>Calls & evidence</dt><dd>{traceability.evidence}</dd><small>Linked governance records</small></div></dl><p className="entity-meta">A count is not proof. Open the supporting object before treating a claim, schedule, or estimate as decision-ready.</p></article>
    </section>

    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">RELEASE POSTURE</span><h3>What is fielded, what changed, and where decisions land</h3></div><Link className="mini-action" href="/reports">Open leadership reports →</Link></div><div className="domain-table-wrap"><table><thead><tr><th>Release</th><th>Baseline records</th><th>Products</th><th>Hosts</th><th>Quality findings</th><th>Observed change</th><th>Targeted Change Requests</th></tr></thead><tbody>{releaseRows.map((item) => <tr key={item.release}><td><Link href={hrefFor("release", item.release)}>{item.release}</Link></td><td>{item.records}</td><td>{item.products}</td><td>{item.hosts}</td><td>{item.issues ? <span className="status-pill status-critical">{item.issues} blocking</span> : item.review ? <span className="status-pill status-decision_required">{item.review} warnings</span> : <span className="status-pill">Pass</span>}</td><td>{item.changesFromPrior || "—"}{item.changesFromPrior ? <small>vs prior release in scope</small> : null}</td><td>{item.targetedRequests || "—"}</td></tr>)}{!releaseRows.length ? <tr><td colSpan={7} className="empty">No baseline records match this scope.</td></tr> : null}</tbody></table></div></section>

    <section className="dashboard-grid analytics-distribution-grid"><Distribution title="Runtime posture" detail="Container state recorded on baseline positions." items={runtimeDistribution} /><Distribution title="Languages" detail="Reported codebase languages in scope." items={languageDistribution} /><Distribution title="Suppliers" detail="Reported OEM or supplier attribution." items={supplierDistribution} /></section>

    <section className="split-layout">
      <article className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">DECISION CHAIN</span><h3>Funding request → objectives → effects</h3></div><span>{scopedRequests.length} Change Requests</span></div><div className="domain-table-wrap"><table><thead><tr><th>Request</th><th>Decision</th><th>Target</th><th>LM Objectives</th><th>Technical effects</th><th>Dependencies</th></tr></thead><tbody>{scopedRequests.map((request) => { const requestObjectives = scopedObjectives.filter((objective) => objectiveRelatedChangeRequestIds(objective, decisions.workspace?.objectiveChangeRequestLinks || []).includes(request.id)); const effects = scopedEffects.filter((effect) => effect.changeRequestId === request.id); const dependencies = scopedDependencies.filter((item) => item.predecessorRequestId === request.id || item.successorRequestId === request.id).length; return <tr key={request.id}><td><Link href={hrefFor("change_request", request.id)}><strong>{request.externalIdentifier}</strong><small>{request.title}</small></Link></td><td><span className={`decision-badge decision-${request.decisionStatus}`}>{request.decisionStatus}</span><small>{request.governmentPriority} priority</small></td><td>{request.requestedReleaseName || "Unassigned"}</td><td>{requestObjectives.length}</td><td>{effects.length}</td><td>{dependencies}</td></tr>; })}{!scopedRequests.length ? <tr><td colSpan={6} className="empty">No Change Requests are linked to this scope.</td></tr> : null}</tbody></table></div></article>
      <article className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">RELATED OBJECTS</span><h3>Objects contributing to this analysis</h3></div></div><div className="chip-list analytics-object-links">{Array.from(products.entries()).slice(0, 18).map(([id, label]) => <Link className="domain-chip" key={`product:${id}`} href={hrefFor("product", id)}><strong>Product</strong><span>{label}</span></Link>)}{platformLabels.slice(0, 12).map((platform) => <Link className="domain-chip" key={`platform:${platform!.id}`} href={hrefFor("platform", platform!.id)}><strong>Platform</strong><span>{platform!.code} · {platform!.name}</span></Link>)}{scopedInitiatives.slice(0, 10).map((initiative) => <Link className="domain-chip" key={`initiative:${initiative.id}`} href={hrefFor("initiative", initiative.id)}><strong>Initiative</strong><span>{initiative.title}</span></Link>)}{capabilityLabels.slice(0, 10).map((capability) => <Link className="domain-chip" key={`capability:${capability}`} href={hrefFor("capability", capability)}><strong>Capability</strong><span>{capability}</span></Link>)}</div>{!products.size && !platformLabels.length && !scopedInitiatives.length && !capabilityLabels.length ? <p className="empty">No related canonical objects are in scope.</p> : null}</article>
    </section>

    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">CALLS & EVIDENCE</span><h3>Recorded facts supporting this scope</h3></div><Link className="mini-action" href="/evidence">Open evidence register →</Link></div><div className="domain-list analytics-evidence-list">{scopedEvidence.slice(0, 8).map((record) => <article className="domain-card" key={record.id}><span className="record-type">{displayStatus(record.recordType)}</span><h3>{record.title}</h3><p className="entity-meta">{record.occurredAt || record.createdAt.slice(0, 10)} · {record.owner || "Owner unassigned"}</p><p>{record.summary || "No discussion summary recorded."}</p><div className="chip-list">{record.links.slice(0, 4).map((link) => link.href ? <Link className="domain-chip" key={link.id} href={link.href}><strong>{displayStatus(link.entityKind)}</strong><span>{link.displayLabel || link.entityId}</span></Link> : <span className="domain-chip" key={link.id}><strong>{displayStatus(link.entityKind)}</strong><span>{link.displayLabel || link.entityId}</span></span>)}</div></article>)}{!scopedEvidence.length ? <article className="domain-card empty-state"><h3>No linked evidence record</h3><p>Record the next architecture call from the relevant object page and use hard links for every Product, Platform, Change Request, Objective, or Initiative discussed.</p></article> : null}</div></section>
  </>;
}
