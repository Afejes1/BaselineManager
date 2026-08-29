"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "../../../components/app-link";
import { AssistantLauncher } from "../../../components/context-assistant";
import { DomainPageShell } from "../../../components/domain-shell";
import { AuditHistoryPanel } from "../../../components/governed-object";
import { InitiativeSolutionEngineering } from "../../../components/initiative-solution-engineering";
import { ObjectRecordsPanel } from "../../../components/object-workspace";
import { readable, selectInitiativeBundle, type InitiativeLifecycle } from "../../../lib/initiative-decision-model";
import { useSolutionEngineering } from "../../../lib/solution-engineering-client";

function caseState(bundle: NonNullable<ReturnType<typeof selectInitiativeBundle>>) {
  const activeOptions = bundle.solutionOptions.filter((option) => option.status !== "retired");
  const actionOptions = activeOptions.filter((option) => option.optionType !== "status_quo");
  const gaps = [
    !bundle.initiative.problemStatement ? "Problem statement" : null,
    !bundle.initiative.desiredOutcome ? "Shared outcome" : null,
    !bundle.initiative.successMeasures ? "Success measures" : null,
    !bundle.initiative.decisionQuestion ? "Decision question" : null,
    !bundle.initiative.decisionNeededBy ? "Decision needed-by date" : null,
    actionOptions.length === 0 ? "At least one action alternative" : null,
    ...actionOptions.flatMap((option) => {
      const changes = bundle.solutionChangeRequestLinks.filter((link) => link.optionId === option.id);
      const steps = bundle.solutionSteps.filter((step) => step.optionId === option.id);
      const assessments = bundle.solutionAssessments.filter((assessment) => assessment.optionId === option.id && assessment.rating !== "unassessed");
      return [!changes.length ? `${option.title}: selected source work` : null, !steps.length ? `${option.title}: option plan` : null, assessments.length < 7 ? `${option.title}: categorical assessment` : null];
    }),
  ].filter((value): value is string => Boolean(value));
  let lifecycle: InitiativeLifecycle = "draft";
  if (bundle.initiative.closedAt) lifecycle = "closed";
  else if (bundle.solutionDecision && bundle.solutionDecision.disposition !== "pending") lifecycle = "decided";
  else if (!gaps.length) lifecycle = "decision_ready";
  else if (activeOptions.length > 1 || bundle.initiative.problemStatement || bundle.initiative.desiredOutcome) lifecycle = "in_analysis";
  return { lifecycle, gaps, activeOptions };
}

export default function InitiativeCasePage() {
  const params = useParams<{ initiative?: string }>();
  const initiativeId = decodeURIComponent(params.initiative || "");
  const solution = useSolutionEngineering(initiativeId);
  const bundle = useMemo(() => solution.workspace ? selectInitiativeBundle(solution.workspace, initiativeId) : null, [solution.workspace, initiativeId]);

  if (solution.loading) return <DomainPageShell title="Solution Engineering" subtitle="Loading the Government decision case…"><p className="empty">Loading decision case…</p></DomainPageShell>;
  if (solution.error || !solution.workspace || !bundle) return <DomainPageShell title="Initiative not found" subtitle="The requested Government decision case is unavailable." actions={<Link className="ghost-button" href="/initiatives">Initiatives</Link>}><p className="error-copy">{solution.error || "No Initiative matches this identifier."}</p></DomainPageShell>;

  const state = caseState(bundle);
  const selected = bundle.solutionOptions.find((option) => option.id === bundle.solutionDecision?.selectedOptionId)?.title || null;
  const context = { kind: "initiative" as const, id: bundle.initiative.id, label: bundle.initiative.title };

  return <DomainPageShell
    title={bundle.initiative.title}
    subtitle="Government problem/outcome decision case · external systems remain authoritative for performed work"
    releaseScope={`${readable(state.lifecycle)} · ${state.activeOptions.length} options · ${state.gaps.length} analysis gaps`}
    contextMode="portfolio"
    objectContext={context}
    actions={<><AssistantLauncher context={context}/><Link className="ghost-button" href="/initiatives">All Initiatives</Link></>}
  >
    <nav className="initiative-case-nav" aria-label="Decision case sections">
      <a href="#problem">Problem</a><a href="#alternatives">Alternatives</a><a href="#decision-map">Decision map</a><a href="#option-plans">Option plans</a><a href="#comparison">Comparison</a><a href="#adjudication">Adjudication</a><a href="#evidence-history">Evidence &amp; history</a>
    </nav>
    <section className="kpi-grid" aria-label="Decision case state"><div className="kpi-card"><span>Lifecycle</span><strong>{readable(state.lifecycle)}</strong><small>Derived from case completeness and adjudication</small></div><div className="kpi-card"><span>Active alternatives</span><strong>{state.activeOptions.length}</strong><small>Status quo is mandatory</small></div><div className="kpi-card"><span>Analysis gaps</span><strong>{state.gaps.length}</strong><small>{state.gaps.slice(0, 2).join(" · ") || "No structural gaps"}</small></div><div className="kpi-card"><span>Disposition</span><strong>{readable(bundle.solutionDecision?.disposition || "pending")}</strong><small>{selected ? `Selected: ${selected}` : "No selected option"}</small></div></section>
    <InitiativeSolutionEngineering workspace={solution.workspace} bundle={bundle} mutate={solution.mutate} reload={solution.reload}/>
    <section id="evidence-history" className="initiative-evidence-history"><ObjectRecordsPanel context={context}/><AuditHistoryPanel kind="initiative" id={bundle.initiative.id} label={bundle.initiative.title}/></section>
  </DomainPageShell>;
}
