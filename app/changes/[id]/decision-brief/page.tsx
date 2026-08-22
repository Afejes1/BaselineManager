"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "../../../../components/app-link";
import { useChangePortfolio } from "../../../../lib/change-client";
import { dependencyStatement } from "../../../../lib/change-model";
import { useInitiativeDecisions } from "../../../../lib/initiative-decision-client";
import { objectiveIsRelatedToChangeRequest, readable } from "../../../../lib/initiative-decision-model";

const display = (value: string | null | undefined, fallback = "Not recorded") => value?.trim() || fallback;
const dateLabel = (value: string | null | undefined) => {
  const raw = value?.trim();
  if (!raw) return "Not recorded";
  const date = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
  return Number.isNaN(date.valueOf()) ? raw : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const hoursLabel = (value: number | null | undefined) => value == null ? "Not reported" : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} hours`;

export default function ChangeDecisionBriefPage() {
  const id = decodeURIComponent(useParams<{ id: string }>().id || "");
  const { portfolio, loading, error } = useChangePortfolio();
  const { workspace, loading: decisionLoading, error: decisionError } = useInitiativeDecisions();
  const request = portfolio.requests.find((item) => item.id === id);
  const effects = portfolio.effects.filter((item) => item.changeRequestId === id);
  const dependencies = portfolio.dependencies.filter((item) => item.predecessorRequestId === id || item.successorRequestId === id);
  const requestById = useMemo(() => new Map(portfolio.requests.map((item) => [item.id, item])), [portfolio.requests]);
  const linkedObjectives = useMemo(() => workspace?.objectives.filter((objective) => objectiveIsRelatedToChangeRequest(objective, id, workspace.objectiveChangeRequestLinks)) || [], [id, workspace]);
  const objectiveLinks = workspace?.objectiveChangeRequestLinks || [];
  const attributions = workspace?.objectiveEffectAttributions || [];
  const requirements = workspace?.requirements || [];
  const criteria = workspace?.criteria || [];

  if (loading || decisionLoading) return <main className="decision-brief-loading">Preparing decision brief…</main>;
  if (error || decisionError || !request) return <main className="decision-brief-loading"><p>{error || decisionError || "Change Request not found."}</p><Link href="/changes">Return to Change Requests</Link></main>;

  return <main className="change-decision-brief">
    <nav className="decision-brief-actions" aria-label="Decision brief actions"><Link href={`/changes/${encodeURIComponent(request.id)}`}>← Return to Change Request</Link><button type="button" onClick={() => window.print()}>Print / Save PDF</button></nav>
    <article className="decision-brief-document">
      <header className="decision-brief-header">
        <div><span>JSF TECHNICAL BASELINE · GOVERNMENT DECISION BRIEF</span><h1>{request.externalIdentifier} · {request.title}</h1><p>{request.typeCode} · External system: {display(request.externalSystem)} · Source checked: {dateLabel(request.sourceAsOf)} · Brief generated: {dateLabel(request.updatedAt)}</p></div>
        <div className={`decision-brief-status decision-${request.decisionStatus}`}><strong>{readable(request.decisionStatus)}</strong><span>{request.decisionStatus === "pending" ? "Government decision required" : display(request.decisionAuthority, "Decision authority not recorded")}</span></div>
      </header>

      <section className="decision-brief-ask">
        <div><span>DECISION REQUIRED</span><h2>Fund this Change Request?</h2><p>{display(request.summary, "Decision summary has not been assessed.")}</p></div>
        <dl><div><dt>Priority</dt><dd>{request.governmentPriority}</dd></div><div><dt>Requested release</dt><dd>{request.requestedReleaseName || "Unassigned"}</dd></div><div><dt>External status</dt><dd>{display(request.externalStatus)}</dd></div><div><dt>Decision basis</dt><dd>{display(request.decisionRationale, "No decision rationale recorded.")}</dd></div></dl>
      </section>

      <section className="decision-brief-consequences">
        <article className="brief-funded"><span>IF FUNDED</span><h3>Expected outcome</h3><p>{display(request.consequenceIfFunded, "Outcome has not been assessed.")}</p></article>
        <article className="brief-deferred"><span>IF DEFERRED / NOT FUNDED</span><h3>Operational consequence</h3><p>{display(request.consequenceIfDeferred, "Consequence has not been assessed.")}</p></article>
        <article className="brief-impact"><span>TECHNICAL EFFECT</span><h3>Baseline impact</h3><p>{display(request.impactSummary, "Technical impact has not been assessed.")}</p></article>
        <article className="brief-knock-on"><span>KNOCK-ON EFFECTS</span><h3>Second-order consequences</h3><p>{display(request.knockOnEffects, "Second-order consequences have not been assessed.")}</p></article>
      </section>

      <section className="decision-brief-section">
        <header><div><span>WHAT · WHERE · WHEN</span><h2>Hard-linked technical effects</h2></div><strong>{effects.length} affected object{effects.length === 1 ? "" : "s"}</strong></header>
        {effects.length ? <div className="decision-brief-effects">{effects.map((effect) => <article key={effect.id}><div><span>{readable(effect.subjectKind)}</span><b>{readable(effect.action)}</b></div><h3>{effect.subjectLabel}</h3><p><strong>{effect.aspect}</strong>{effect.currentValue || effect.targetValue ? ` · ${effect.currentValue || "Not present"} → ${effect.targetValue || "Not present"}` : ""}</p><small>{effect.fromReleaseName || "Current / unspecified"} → {effect.toReleaseName || request.requestedReleaseName || "Target unspecified"} · {readable(effect.confidence)}</small><p>{display(effect.consequence, "Consequence not assessed.")}</p></article>)}</div> : <p className="decision-brief-gap">No Product, Platform, Configuration Node, baseline record, Release, or Organization has been linked as an affected object. Do not treat imported MCP/JPO references as technical-scope evidence.</p>}
      </section>

      <section className="decision-brief-section">
        <header><div><span>DELIVERY DECOMPOSITION</span><h2>LM Objectives and attributed technical scope</h2></div><strong>{linkedObjectives.length} Objective{linkedObjectives.length === 1 ? "" : "s"}</strong></header>
        <p className="decision-brief-method">Reported JPO/MCP values establish external traceability. A technical effect is included under an Objective only when an analyst attributes the owning Change Request effect in the Objective’s Technical scope view.</p>
        {linkedObjectives.length ? <div className="decision-brief-objectives">{linkedObjectives.map((objective) => {
          const relation = objective.changeRequestId === request.id ? "Accountable Objective" : objectiveLinks.find((link) => link.objectiveId === objective.id && link.changeRequestId === request.id)?.relationship || "Reported reference";
          const objectiveEffects = attributions.filter((attribution) => attribution.objectiveId === objective.id).map((attribution) => ({ attribution, effect: portfolio.effects.find((effect) => effect.id === attribution.changeEffectId) })).filter((item): item is { attribution: typeof attributions[number]; effect: typeof portfolio.effects[number] } => Boolean(item.effect));
          const objectiveRequirements = requirements.filter((requirement) => requirement.objectiveId === objective.id);
          const objectiveCriteria = criteria.filter((criterion) => criterion.objectiveId === objective.id);
          const acceptedCriteria = objectiveCriteria.filter((criterion) => ["passed", "waived"].includes(criterion.status)).length;
          const likelyEstimate = objective.estimates.slice().sort((left, right) => right.asOf.localeCompare(left.asOf))[0];
          return <article className="decision-brief-objective" key={objective.id}>
            <header><div><span>{relation}</span><h3>{objective.externalIdentifier} · {objective.title}</h3></div><b>{readable(objective.status)}</b></header>
            <p>{display(objective.summary, "No delivery summary recorded.")}</p>
            <dl><div><dt>Planned window</dt><dd>{dateLabel(objective.plannedStart)} → {dateLabel(objective.plannedFinish)}</dd></div><div><dt>Technical owner</dt><dd>{display(objective.technicalOwner, "Not assigned")}</dd></div><div><dt>Likely effort</dt><dd>{hoursLabel(likelyEstimate?.hoursLikely)}</dd></div><div><dt>Requirements / acceptance</dt><dd>{objectiveRequirements.length} / {acceptedCriteria} of {objectiveCriteria.length} accepted</dd></div></dl>
            <div className="decision-brief-objective-effects"><strong>Attributed technical scope</strong>{objectiveEffects.length ? objectiveEffects.map(({ attribution, effect }) => <span key={attribution.id}>{effect.subjectLabel} · {readable(effect.action)} {effect.aspect} · {readable(attribution.attribution)} / {readable(attribution.confidence)}</span>) : <span className="unattributed">No Change Request effect has been attributed to this Objective.</span>}</div>
          </article>;
        })}</div> : <p className="decision-brief-gap">No LM Objectives are linked to this Change Request. Import the LM Objective source or establish a reviewed reference before using this brief as a delivery plan.</p>}
      </section>

      <section className="decision-brief-section">
        <header><div><span>DEPENDENCY NARRATIVE</span><h2>Request chain and implementation constraints</h2></div><strong>{dependencies.length} recorded link{dependencies.length === 1 ? "" : "s"}</strong></header>
        {dependencies.length ? <div className="decision-brief-dependencies">{dependencies.map((dependency) => { const predecessor = requestById.get(dependency.predecessorRequestId)?.externalIdentifier || dependency.predecessorRequestId; const successor = requestById.get(dependency.successorRequestId)?.externalIdentifier || dependency.successorRequestId; return <article key={dependency.id}><h3>{dependencyStatement(dependency, predecessor, successor)}</h3><p><strong>Basis:</strong> {display(dependency.rationale)}</p><p><strong>If unmet:</strong> {display(dependency.consequenceIfUnmet)}</p><small>{readable(dependency.confidence)} · Owner: {display(dependency.owner, "Unassigned")} · {display(dependency.sourceReference, "Source not recorded")}{dependency.sourceAsOf ? ` · ${dateLabel(dependency.sourceAsOf)}` : ""}</small></article>; })}</div> : <p className="decision-brief-gap">No request-to-request dependency is recorded. This means no dependency conclusion should be drawn from this brief.</p>}
      </section>

      <footer className="decision-brief-footer"><span>Government analysis record. External MCP and Objective systems remain authoritative for their own lifecycle state.</span><span>Evidence source: {display(request.sourceLocator, request.externalIdentifier)}</span></footer>
    </article>
  </main>;
}
