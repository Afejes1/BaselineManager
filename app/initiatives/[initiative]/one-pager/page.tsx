"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "../../../../components/app-link";
import { useInitiativeDecisions } from "../../../../lib/initiative-decision-client";
import { readable, selectInitiativeBundle, tierLabel } from "../../../../lib/initiative-decision-model";
import { estimateVariance } from "../../../../lib/initiative-readiness";

const dateLabel = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not set";
const compact = (value: number, prefix = "") => value ? `${prefix}${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}` : "—";

export default function InitiativeOnePager() {
  const params = useParams<{ initiative?: string }>();
  const initiativeId = decodeURIComponent(params.initiative || "");
  const { workspace, loading, error } = useInitiativeDecisions();
  const bundle = useMemo(() => workspace ? selectInitiativeBundle(workspace, initiativeId) : null, [workspace, initiativeId]);
  const assessment = workspace?.assessments[initiativeId];
  if (loading) return <main className="one-pager-loading">Preparing report…</main>;
  if (error || !bundle) return <main className="one-pager-loading"><p>{error || "Initiative not found."}</p><Link href="/initiatives">Back to Initiatives</Link></main>;
  const initiative = bundle.initiative;
  const variance = estimateVariance(bundle);
  const effectCount = bundle.changes.effects.filter((effect) => bundle.changeRequests.some((request) => request.id === effect.changeRequestId)).length;
  const pendingCriteria = bundle.criteria.filter((criterion) => !["passed", "waived"].includes(criterion.status));
  const keyFindings = assessment?.findings.filter((item) => item.severity !== "information").slice(0, 6) || [];
  return <main className="initiative-one-pager">
    <div className="one-pager-actions"><Link href={`/initiatives/${encodeURIComponent(initiativeId)}`}>← Return to analysis</Link><button type="button" onClick={() => window.print()}>Print / Save PDF</button></div>
    <article className="wall-sheet">
      <header className="wall-header"><div><span>JSF TECHNICAL BASELINE · GOVERNMENT DECISION PAPER</span><h1>{initiative.title}</h1><p>{initiative.briefingAudience || "Leadership audience not recorded"} · As of {dateLabel(initiative.updatedAt)} · Demonstration records are marked as not program data</p></div><div className={`readiness-seal readiness-${assessment?.stage || "not_ready"}`}><strong>{assessment?.score || 0}%</strong><span>{readable(assessment?.stage || "not_ready")}</span></div></header>
      <section className="wall-state-row"><article><span>LEFT · WHERE WE ARE</span><h2>As-Is</h2><p>{initiative.asIsStatement || "Current state is not yet substantiated."}</p></article><div className="wall-change-path"><strong>{bundle.changeRequests.length}</strong><span>Change Requests</span><b>→</b><small>{bundle.objectives.length} Objectives · {effectCount} effects</small></div><article><span>RIGHT · WHERE WE NEED TO BE</span><h2>To-Be</h2><p>{initiative.toBeStatement || "Target state is not yet defined."}</p></article></section>
      <section className="wall-decision-row"><article className="wall-decision-ask"><span>THE DECISION</span><h2>{initiative.decisionAsk || "Decision ask has not been recorded."}</h2><p><strong>Needed by:</strong> {dateLabel(initiative.decisionNeededBy)} · <strong>Outcome target:</strong> {dateLabel(initiative.targetDate)}</p></article><article><span>IF FUNDED / DIRECTED</span><p>{initiative.desiredOutcome || "Desired outcome not recorded."}</p></article><article className="wall-consequence"><span>IF DEFERRED</span><p>{initiative.consequence || "Consequence not recorded."}</p></article></section>
      <section className="wall-main-grid"><article className="wall-panel wall-crs"><header><span>HOW WE GET THERE</span><strong>{assessment?.decisionsPending || 0} decisions pending</strong></header>{bundle.changeRequests.map((request, index) => { const objectiveCount = bundle.objectives.filter((item) => item.changeRequestId === request.id).length; return <div className="wall-cr" key={request.id}><b>{index + 1}</b><div><strong>{request.externalIdentifier} · {request.title}</strong><p>{request.impactSummary || request.summary || "Impact analysis missing."}</p><small>{objectiveCount} Objectives · {request.requestedReleaseName || "No target release"}</small></div><span className={`wall-status wall-status-${request.decisionStatus}`}>{readable(request.decisionStatus)}</span></div>; })}</article>
        <article className="wall-panel wall-timeline"><header><span>WHEN</span><strong>Delivery timeline</strong></header>{bundle.milestones.slice(0, 7).map((milestone) => <div className="wall-milestone" key={milestone.id}><time>{dateLabel(milestone.plannedDate)}</time><i className={`milestone-dot milestone-${milestone.status}`} /><div><strong>{milestone.title}</strong><small>{readable(milestone.milestoneType)} · {readable(milestone.status)}</small></div></div>)}{!bundle.milestones.length && <p>No milestones recorded.</p>}</article>
        <article className="wall-panel wall-analysis"><header><span>ANALYSIS CHECK</span><strong>Claims vs assessment</strong></header><div className="wall-estimates"><div><span>Incumbent likely hours</span><strong>{compact(variance.incumbentHours)}</strong><small>{compact(variance.incumbentCost, "$")} likely cost</small></div><div><span>Gov./independent hours</span><strong>{compact(variance.assessedHours)}</strong><small>{compact(variance.assessedCost, "$")} likely cost</small></div></div><div className="wall-trace"><span>{bundle.requirements.filter((item) => ["traced", "verified", "not_applicable"].includes(item.traceStatus)).length}/{bundle.requirements.length} requirements traced</span><span>{bundle.criteria.filter((item) => ["passed", "waived"].includes(item.status)).length}/{bundle.criteria.length} criteria accepted</span></div><p className="wall-fineprint">Estimate totals use the latest sourced likely value for each Objective; they are not presented as program-approved cost.</p></article>
      </section>
      <section className="wall-bottom-grid"><article className="wall-panel"><header><span>REQUIREMENTS & ACCEPTANCE</span><strong>{pendingCriteria.length} open criteria</strong></header><div className="wall-criteria">{bundle.criteria.slice(0, 6).map((criterion) => <div key={criterion.id}><strong>{tierLabel(criterion.tier)} · {criterion.code}</strong><p>{criterion.statement}</p><small>{readable(criterion.status)} · {criterion.evidenceReference || "Evidence pending"}</small></div>)}</div></article><article className="wall-panel wall-risks"><header><span>GAPS / KNOCK-ON EFFECTS</span><strong>{assessment?.blockers || 0} blockers · {assessment?.warnings || 0} warnings</strong></header>{keyFindings.map((finding) => <div key={finding.id}><b>{finding.severity === "blocker" ? "!" : "△"}</b><p><strong>{finding.title}</strong><span>{finding.detail}</span></p></div>)}{!keyFindings.length && <p>No automated evidence-chain gaps detected.</p>}</article></section>
      <footer className="wall-footer"><span>Owner: {initiative.owner || "Unassigned"}</span><span>Success: {initiative.successMeasures || "Measures not recorded"}</span><span>Sources: baseline records, Government assessments, and referenced external systems</span></footer>
    </article>
  </main>;
}
