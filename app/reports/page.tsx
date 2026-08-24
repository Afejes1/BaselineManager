"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { useWorkspaceContext } from "../../components/workspace-context";
import { productDisplayName, text } from "../../lib/baseline-data";
import { useChangePortfolio } from "../../lib/change-client";
import { useGovernancePortfolio } from "../../lib/governance-client";
import { useInitiativeDecisions } from "../../lib/initiative-decision-client";
import { objectiveIsRelatedToChangeRequest, objectiveRelatedChangeRequestIds, readable } from "../../lib/initiative-decision-model";
import { criterionIsAccepted } from "../../lib/initiative-readiness";
import { usePlatformPortfolio } from "../../lib/platform-client";
import { compareReleases, releaseNames } from "../../lib/release-analysis";

type ReportTab = "inventory" | "release" | "funding" | "objectives" | "decomposition" | "wbs";

export default function ReportsPage() {
  const baselineState = useWorkspaceContext();
  const platformState = usePlatformPortfolio();
  const changeState = useChangePortfolio();
  const governanceState = useGovernancePortfolio();
  const decisionState = useInitiativeDecisions();
  const { rows } = baselineState;
  const { portfolio: platforms } = platformState;
  const { portfolio: changes } = changeState;
  const { portfolio: governance } = governanceState;
  const { workspace: decisions } = decisionState;
  const [tab, setTab] = useState<ReportTab>("inventory");
  const releases = releaseNames(rows);
  const [fromRelease, setFromRelease] = useState("");
  const [toRelease, setToRelease] = useState("");
  const sourceErrors = [
    ["Working baseline", baselineState.error],
    ["Platform portfolio", platformState.error],
    ["Change Request portfolio", changeState.error],
    ["Governance portfolio", governanceState.error],
    ["Initiative decisions", decisionState.error],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  const sourcesLoading = baselineState.loading || platformState.loading || changeState.loading || governanceState.loading || decisionState.loading;
  const reportReady = !sourcesLoading && !sourceErrors.length && Boolean(governance) && Boolean(decisions);
  const completedAcceptanceSignoffs = (decisions?.criteria || []).flatMap((criterion) =>
    ["passed", "waived"].includes(criterion.status)
      ? criterion.signoffs.filter((signoff) => ["accepted", "waived"].includes(signoff.decision) && Boolean(signoff.evidenceDocumentId))
      : []
  );
  const uncheckedAcceptanceEvidence = new Set(completedAcceptanceSignoffs.filter((signoff) => signoff.evidenceIntegrityStatus === "not_checked").map((signoff) => signoff.evidenceDocumentId!));
  const unverifiedAcceptanceEvidence = new Set(completedAcceptanceSignoffs.filter((signoff) => signoff.evidenceIntegrityStatus !== "verified" && signoff.evidenceIntegrityStatus !== "not_checked").map((signoff) => signoff.evidenceDocumentId!));
  const exportBlockReason = sourcesLoading
    ? "Loading every governed report source. Print and workbook export remain disabled until the snapshot is complete."
    : sourceErrors.length
      ? `Governed report source failure: ${sourceErrors.map(([source, error]) => `${source}: ${error}`).join(" ")}`
      : !reportReady
        ? "A governed report source returned no usable snapshot. Reload the page before printing or exporting."
        : unverifiedAcceptanceEvidence.size
          ? `${unverifiedAcceptanceEvidence.size} completed acceptance evidence document${unverifiedAcceptanceEvidence.size === 1 ? " is" : "s are"} missing, quarantined, or inconsistent with its integrity seal. Open the affected Initiative and repair or replace the evidence before exporting.`
          : uncheckedAcceptanceEvidence.size
            ? `${uncheckedAcceptanceEvidence.size} completed acceptance evidence document${uncheckedAcceptanceEvidence.size === 1 ? " was" : "s were"} not checked because the global 100-document / 100 MB verification envelope was exhausted. Open the affected Initiative and verify its scoped evidence before exporting.`
            : "";
  const exportBlocked = Boolean(exportBlockReason);
  const handlingMarking = reportReady ? governance?.handlingMarking || "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED" : "GOVERNED REPORT NOT READY";
  const syntheticOutput = handlingMarking.startsWith("SYNTHETIC");
  const effectiveTo = toRelease || releases.at(-1) || "";
  const effectiveFrom = fromRelease || releases.filter((item) => item !== effectiveTo).at(-1) || "";
  const platformByOccurrence = new Map(platforms.assignments.filter((item) => item.assignmentRole === "primary").map((item) => [item.baselineOccurrenceId, platforms.platforms.find((platform) => platform.id === item.platformId)]));
  const inventory = rows.map((row) => { const platform = platformByOccurrence.get(row.__meta.occurrenceId); return { Release: text(row.ReleaseName) || "Unassigned", Product: productDisplayName(row), Supplier: text(row.OEM) || "Unassigned", Platform: platform ? (platform.isA2OResourcePlatform && !platform.isGovernedPlatform ? `${platform.name} · Tier: ${platform.reportedTierName || "not reported"}` : `${platform.code} · ${platform.name}`) : "Platform not assigned", Tier: text(row.Tier) || "Unassigned", Resource: text(row.Resource) || "Unassigned", Host: text(row.HW_Host) || "Unassigned", Runtime: [text(row.Containerized), text(row["Container Technology"])].filter(Boolean).join(" · ") || "Not reported", SourceKey: text(row["#"]) || "Not assigned" }; });
  const deltas = effectiveFrom && effectiveTo ? compareReleases(rows, effectiveFrom, effectiveTo) : [];
  const funding = useMemo(() => changes.requests.map((request) => { const effects = changes.effects.filter((effect) => effect.changeRequestId === request.id); const dependencies = changes.dependencies.filter((item) => item.predecessorRequestId === request.id || item.successorRequestId === request.id); return { Type: request.typeCode, ExternalID: request.externalIdentifier, Title: request.title, GovernmentPriority: request.governmentPriority, FundingDecision: request.decisionStatus, RequestedRelease: request.requestedReleaseName || "Unassigned", AffectedObjects: effects.length, Dependencies: dependencies.length, ConsequenceIfFunded: request.consequenceIfFunded || "", ConsequenceIfDeferred: request.consequenceIfDeferred || "", KnockOnEffects: request.knockOnEffects || "", Authority: request.decisionAuthority || "", Rationale: request.decisionRationale || "" }; }), [changes]);
  const objectiveRows = useMemo(() => (decisions?.objectives || []).map((objective) => {
    const relatedIds = objectiveRelatedChangeRequestIds(objective, decisions?.objectiveChangeRequestLinks || []);
    const accountableRequest = objective.changeRequestId ? changes.requests.find((item) => item.id === objective.changeRequestId) : null;
    const reportedRequests = relatedIds.filter((id) => id !== objective.changeRequestId).map((id) => changes.requests.find((item) => item.id === id)).filter(Boolean);
    const requirements = decisions?.requirements.filter((item) => item.objectiveId === objective.id) || [];
    const criteria = decisions?.criteria.filter((item) => item.objectiveId === objective.id) || [];
    const work = governance?.workPackages.filter((item) => item.objectiveLinks.some((link) => link.objectiveId === objective.id)) || [];
    const latestIncumbent = objective.estimates.find((item) => item.estimateSource === "incumbent");
    const latestGovernment = objective.estimates.find((item) => item.estimateSource === "government" || item.estimateSource === "independent");
    const effectCount = decisions?.objectiveEffectAttributions?.filter((item) => item.objectiveId === objective.id).length || 0;
    const blockedBy = decisions?.objectiveDependencies?.filter((item) => item.prerequisiteObjectiveId === objective.id && item.status === "accepted").length || 0;
    return { ObjectiveID: objective.externalIdentifier, ObjectiveRecordId: objective.id, ItemType: objective.externalItemType, Objective: objective.title, AccountableRequest: accountableRequest?.externalIdentifier || "Not assigned", ReportedRequests: reportedRequests.map((item) => item!.externalIdentifier).join(", ") || "None reported", FundingDecision: accountableRequest?.decisionStatus || "No Government decision implied", TargetRelease: accountableRequest?.requestedReleaseName || "Unassigned", LMStatus: objective.status, TechnicalOwner: objective.technicalOwner || "Unassigned", PlannedFinish: objective.plannedFinish || "Unscheduled", SourceAsOf: objective.sourceAsOf || "Missing", TechnicalEffects: effectCount, Requirements: requirements.length, RequirementsDispositioned: requirements.filter((item) => item.traceStatus === "verified" || item.traceStatus === "not_applicable").length, AcceptanceCriteria: criteria.length, AcceptancePassed: criteria.filter(criterionIsAccepted).length, WorkPackages: work.length, WorkComplete: work.filter((item) => item.status === "complete").length, DownstreamRequests: blockedBy, IncumbentHoursLikely: latestIncumbent?.hoursLikely ?? null, GovernmentHoursLikely: latestGovernment?.hoursLikely ?? null };
  }), [changes.requests, decisions, governance?.workPackages]);
  const wbsRows = useMemo(() => (governance?.workPackages || []).map((work) => {
    const objectives = (decisions?.objectives || []).filter((item) => work.objectiveLinks.some((link) => link.objectiveId === item.id));
    const requestIds = [...new Set(objectives.flatMap((objective) => objectiveRelatedChangeRequestIds(objective, decisions?.objectiveChangeRequestLinks || [])))];
    const requests = requestIds.map((id) => changes.requests.find((item) => item.id === id)).filter(Boolean);
    const incoming = governance?.workPackageDependencies.filter((item) => item.successorWorkPackageId === work.id && item.status === "accepted") || [];
    return { WBS: work.wbsCode, WorkPackage: work.title, Objective: objectives.map((item) => item.externalIdentifier).join(", ") || "No LM Objective link", ChangeRequest: requests.map((item) => item!.externalIdentifier).join(", ") || "Initiative-level", Owner: work.owner || "Unassigned", PlannedStart: work.plannedStart || "", PlannedFinish: work.dueDate || "", Status: work.status, DefinitionOfDone: work.definitionOfDone || "", ProgressBasis: work.progressBasis || "", AcceptedPredecessors: incoming.length };
  }), [changes.requests, decisions?.objectiveChangeRequestLinks, decisions?.objectives, governance]);
  function exportReport() {
    if (exportBlocked) return;
    const workbook = XLSX.utils.book_new();
    const generatedAt = new Date().toISOString();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      [handlingMarking],
      ["Artifact", "A2O leadership decision-support workbook"],
      ["Generated", generatedAt],
      ["Source", "Current governed application snapshot"],
      ["Control status", "Draft / uncontrolled export; verify against authoritative source systems before decision or distribution."],
    ]), "READ ME");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(inventory), "WHAT-WHERE-WHEN");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(deltas.map((item) => ({ FromRelease: effectiveFrom, ToRelease: effectiveTo, ChangeType: item.kind, Product: item.productName, Before: item.beforePlacement || "Not present", After: item.afterPlacement || "Not present", ChangedFields: item.changedFields.join(", ") }))), "Release Comparison");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(funding), "Funding Portfolio");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(objectiveRows), "Objective Delivery");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(wbsRows), "Initiative Work Plan");
    XLSX.writeFile(workbook, `${syntheticOutput ? "SYNTHETIC_" : "WORKING_"}JSF_Decision_Reports_${generatedAt.slice(0, 10)}.xlsx`);
  }
  function printReport() {
    if (exportBlocked) return;
    window.print();
  }
  if (!reportReady) return <DomainPageShell title="Leadership Reports" subtitle="What is where, what changed, and which Change Requests need a decision." releaseScope={sourcesLoading ? "Loading all governed sources" : "Governed source blocked"} contextMode="comparison" actions={<><Link className="ghost-button" href="/briefs">Report archive</Link><button className="ghost-button" type="button" disabled title={exportBlockReason}>Print report</button><button className="primary-button" type="button" disabled title={exportBlockReason}>Export workbook</button></>}>
    <section className="domain-section" role={sourcesLoading ? "status" : "alert"}><span className="eyebrow">GOVERNED SNAPSHOT BLOCKED</span><h3>{sourcesLoading ? "Loading all report sources…" : "The report cannot be assembled from partial state"}</h3><p className={sourcesLoading ? "entity-meta" : "error-copy"}>{exportBlockReason}</p></section>
  </DomainPageShell>;
  return <DomainPageShell title="Leadership Reports" subtitle="What is where, what changed, and which Change Requests need a decision." releaseScope={`${releases.length} releases`} contextMode="comparison" actions={<><Link className="ghost-button" href="/briefs">Report archive</Link><button className="ghost-button" type="button" disabled={exportBlocked} title={exportBlockReason || "Print the complete governed report"} onClick={printReport}>Print report</button><button className="primary-button" type="button" disabled={exportBlocked} title={exportBlockReason || "Export the complete governed report workbook"} onClick={exportReport}>Export workbook</button></>}>
    {exportBlockReason ? <section className="domain-section" role="alert"><span className="eyebrow">EXPORT BLOCKED</span><h3>Acceptance evidence verification is incomplete</h3><p className="error-copy">{exportBlockReason}</p></section> : null}
    <section className="decision-principle"><strong>{handlingMarking}</strong><span>Counts come from baseline records and recorded Platform and Change Request links. Each page shows the current working baseline; exported workbooks include a handling and provenance cover sheet.</span></section>
    <nav className="detail-tabs report-tabs" aria-label="Report views"><button className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}>WHAT · WHERE · WHEN</button><button className={tab === "release" ? "active" : ""} onClick={() => setTab("release")}>Release change book</button><button className={tab === "funding" ? "active" : ""} onClick={() => setTab("funding")}>Funding portfolio</button><button className={tab === "objectives" ? "active" : ""} onClick={() => setTab("objectives")}>Objective delivery</button><button className={tab === "decomposition" ? "active" : ""} onClick={() => setTab("decomposition")}>Change Request decomposition</button><button className={tab === "wbs" ? "active" : ""} onClick={() => setTab("wbs")}>Initiative Work Plan</button></nav>
    {tab === "inventory" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">CONFIGURATION INVENTORY</span><h3>What is installed, where, and in which release</h3></div><span>{inventory.length} baseline records</span></div><div className="domain-table-wrap"><table><thead><tr><th>When</th><th>What</th><th>Where · Platform</th><th>Placement</th><th>Supplier</th><th>Source key</th></tr></thead><tbody>{inventory.map((item, index) => <tr key={`${item.Release}:${item.SourceKey}:${index}`}><td><Link href={`/releases/${encodeURIComponent(item.Release)}`}>{item.Release}</Link></td><td>{item.Product}</td><td>{item.Platform}</td><td>{item.Tier} / {item.Resource} / <span className="mono">{item.Host}</span></td><td>{item.Supplier}</td><td className="mono">{item.SourceKey}</td></tr>)}</tbody></table></div></section> : null}
    {tab === "release" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">AS-IS → TO-BE</span><h3>Explainable source-data differences</h3></div><label className="compare-select"><select value={effectiveFrom} onChange={(event) => setFromRelease(event.target.value)}>{releases.map((item) => <option key={item}>{item}</option>)}</select> → <select value={effectiveTo} onChange={(event) => setToRelease(event.target.value)}>{releases.map((item) => <option key={item}>{item}</option>)}</select></label></div><section className="summary"><div className="metric"><span>Total data changes</span><strong>{deltas.length}</strong><small>{effectiveFrom} → {effectiveTo}</small></div><div className="metric"><span>Additions</span><strong>{deltas.filter((item) => item.kind.includes("added")).length}</strong><small>Product or deployment</small></div><div className="metric"><span>Removals</span><strong>{deltas.filter((item) => item.kind.includes("removed")).length}</strong><small>Absence in target release</small></div><div className="metric"><span>Moves / modifications</span><strong>{deltas.filter((item) => item.kind === "deployment_moved" || item.kind === "configuration_changed").length}</strong><small>Placement or attributes</small></div></section><div className="domain-table-wrap"><table><thead><tr><th>Change</th><th>Product</th><th>Before</th><th>After</th><th>Changed fields</th><th>Linked requests</th></tr></thead><tbody>{deltas.map((item) => { const anchorKeys = new Set(item.anchorIds.map((anchor) => `${anchor.kind}:${anchor.id}`)); const linked = changes.effects.filter((effect) => anchorKeys.has(`${effect.subjectKind}:${effect.subjectId}`)); const requestIds = Array.from(new Set(linked.map((effect) => effect.changeRequestId))); return <tr key={item.id}><td><span className={`effect-action effect-${item.kind.includes("added") ? "add" : item.kind.includes("removed") ? "remove" : item.kind.includes("moved") ? "move" : "modify"}`}>{item.kind.replaceAll("_", " ")}</span></td><td>{item.productName}</td><td>{item.beforePlacement || "Not present"}</td><td>{item.afterPlacement || "Not present"}</td><td>{item.changedFields.join(", ") || "—"}</td><td>{requestIds.length ? requestIds.map((requestId) => { const request = changes.requests.find((candidate) => candidate.id === requestId); return <Link key={requestId} href={`/changes/${encodeURIComponent(requestId)}`}>{request?.externalIdentifier || requestId}</Link>; }) : "Unexplained"}</td></tr>; })}</tbody></table></div></section> : null}
    {tab === "funding" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">LEADERSHIP DECISION REGISTER</span><h3>Fund, defer, or decline the work—not the technical baseline</h3></div><Link href="/changes">Manage Change Requests</Link></div><div className="domain-table-wrap"><table><thead><tr><th>Priority</th><th>Request</th><th>Target</th><th>Decision</th><th>Consequence if deferred</th><th>Effects</th><th>Dependencies</th></tr></thead><tbody>{changes.requests.map((request) => { const row = funding.find((item) => item.ExternalID === request.externalIdentifier)!; return <tr key={request.id}><td><span className={`priority-badge priority-${request.governmentPriority}`}>{request.governmentPriority}</span></td><td><Link href={`/changes/${encodeURIComponent(request.id)}`}><strong>{request.externalIdentifier}</strong><br />{request.title}</Link></td><td>{request.requestedReleaseName || "Unassigned"}</td><td><span className={`decision-badge decision-${request.decisionStatus}`}>{request.decisionStatus}</span></td><td>{request.consequenceIfDeferred || "Not assessed"}</td><td>{row.AffectedObjects}</td><td>{row.Dependencies}</td></tr>; })}</tbody></table></div></section> : null}
    {tab === "objectives" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">OBJECTIVE DELIVERY REGISTER</span><h3>Contractor work, technical scope, and completion evidence</h3></div><Link href="/objectives">Manage LM Objectives</Link></div><div className="domain-table-wrap"><table><thead><tr><th>Objective</th><th>Accountable / reported Change Requests</th><th>Target / status</th><th>Technical scope</th><th>Requirements / acceptance</th><th>WBS</th><th>Estimate variance</th></tr></thead><tbody>{objectiveRows.map((item) => <tr key={item.ObjectiveRecordId}><td><Link href={`/objectives/${encodeURIComponent(item.ObjectiveRecordId)}`}><strong>{item.ObjectiveID}</strong><br />{item.Objective}</Link><small>{item.TechnicalOwner} · source {item.SourceAsOf}</small></td><td><strong>{item.AccountableRequest}</strong><small>Reported: {item.ReportedRequests}</small><small>{item.FundingDecision}</small></td><td>{item.TargetRelease}<small>{readable(item.LMStatus)} · finish {item.PlannedFinish}</small></td><td>{item.TechnicalEffects} attributed effects<small>{item.DownstreamRequests} downstream requests</small></td><td>{item.RequirementsDispositioned}/{item.Requirements} requirements<small>{item.AcceptancePassed}/{item.AcceptanceCriteria} criteria accepted</small></td><td>{item.WorkComplete}/{item.WorkPackages} complete</td><td>LM {item.IncumbentHoursLikely ?? "—"}<small>Government {item.GovernmentHoursLikely ?? "—"}</small></td></tr>)}{!objectiveRows.length ? <tr><td colSpan={7} className="empty">No LM Objectives are available.</td></tr> : null}</tbody></table></div></section> : null}
    {tab === "decomposition" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">CHANGE REQUEST DECOMPOSITION</span><h3>Funding decision → LM Objectives → effects → Government work → acceptance</h3></div><span>{changes.requests.length} Change Requests</span></div><div className="domain-list">{changes.requests.map((request) => { const related = decisions?.objectives.filter((item) => objectiveIsRelatedToChangeRequest(item, request.id, decisions?.objectiveChangeRequestLinks || [])) || []; return <article className="domain-card" key={request.id}><div className="section-toolbar"><div><span className={`decision-badge decision-${request.decisionStatus}`}>{request.decisionStatus}</span><h3><Link href={`/changes/${encodeURIComponent(request.id)}`}>{request.externalIdentifier} · {request.title}</Link></h3></div><span>{request.requestedReleaseName || "No release"}</span></div>{related.length ? related.map((objective) => { const effects = decisions?.objectiveEffectAttributions?.filter((item) => item.objectiveId === objective.id).length || 0; const work = governance?.workPackages.filter((item) => item.objectiveLinks.some((link) => link.objectiveId === objective.id)) || []; const criteria = decisions?.criteria.filter((item) => item.objectiveId === objective.id) || []; const relationship = objective.changeRequestId === request.id ? "Accountable" : "Reported"; return <div className="wbs-branch" key={objective.id}><strong><Link href={`/objectives/${encodeURIComponent(objective.id)}`}>{objective.externalIdentifier} · {objective.title}</Link></strong><span>{relationship} reference · {readable(objective.status)} · {effects} effects · {work.filter((item) => item.status === "complete").length}/{work.length} Government work packages complete · {criteria.filter(criterionIsAccepted).length}/{criteria.length} acceptance complete</span></div>; }) : <p className="empty">No LM Objectives are linked to this Change Request.</p>}</article>; })}</div></section> : null}
      {tab === "wbs" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">INITIATIVE WORK PLAN STATUS</span><h3>Government work and accepted schedule inputs</h3></div><Link href="/delivery">Manage Initiative Work Plan</Link></div><p className="entity-meta">This is an internal Government analysis work plan, not an official DoD WBS or contractor delivery schedule.</p><div className="domain-table-wrap"><table><thead><tr><th>Work package</th><th>Government task</th><th>LM Objective links</th><th>Owner</th><th>Window</th><th>Status</th><th>Schedule inputs</th></tr></thead><tbody>{wbsRows.map((item) => <tr key={`${item.Objective}:${item.WBS}`}><td className="mono">{item.WBS}</td><td><strong>{item.WorkPackage}</strong><small>{item.DefinitionOfDone || "Definition of done not recorded"}</small></td><td>{item.Objective}<small>{item.ChangeRequest}</small></td><td>{item.Owner}</td><td>{item.PlannedStart || "—"} → {item.PlannedFinish || "—"}</td><td><span className={`status-pill status-${item.Status}`}>{readable(item.Status)}</span></td><td>{item.AcceptedPredecessors} accepted predecessors<small>{item.ProgressBasis || "Progress basis not recorded"}</small></td></tr>)}{!wbsRows.length ? <tr><td colSpan={7} className="empty">No work packages are available.</td></tr> : null}</tbody></table></div></section> : null}
  </DomainPageShell>;
}
