"use client";

import { useMemo, useState } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { useGovernancePortfolio } from "../../lib/governance-client";
import { readable, selectInitiativeBundle, type InitiativeLifecycle } from "../../lib/initiative-decision-model";
import { useSolutionEngineering } from "../../lib/solution-engineering-client";

function lifecycleFor(workspace: NonNullable<ReturnType<typeof useSolutionEngineering>["workspace"]>, initiativeId: string) {
  const bundle = selectInitiativeBundle(workspace, initiativeId);
  if (!bundle) return { lifecycle: "draft" as InitiativeLifecycle, gaps: 0, options: 0, selected: null as string | null, disposition: "pending" };
  const active = bundle.solutionOptions.filter((option) => option.status !== "retired");
  const action = active.filter((option) => option.optionType !== "status_quo");
  const gaps = [!bundle.initiative.problemStatement, !bundle.initiative.desiredOutcome, !bundle.initiative.successMeasures, !bundle.initiative.decisionQuestion, !bundle.initiative.decisionNeededBy, !action.length, ...action.map((option) => !bundle.solutionSteps.some((step) => step.optionId === option.id)), ...action.map((option) => !bundle.solutionChangeRequestLinks.some((link) => link.optionId === option.id))].filter(Boolean).length;
  const decision = bundle.solutionDecision;
  const lifecycle: InitiativeLifecycle = bundle.initiative.closedAt ? "closed" : decision && decision.disposition !== "pending" ? "decided" : !gaps ? "decision_ready" : active.length > 1 || Boolean(bundle.initiative.problemStatement) ? "in_analysis" : "draft";
  return { lifecycle, gaps, options: active.length, selected: bundle.solutionOptions.find((option) => option.id === decision?.selectedOptionId)?.title || null, disposition: decision?.disposition || "pending" };
}

export default function InitiativesPage() {
  const solution = useSolutionEngineering();
  const governance = useGovernancePortfolio();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InitiativeLifecycle | "all">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const rows = useMemo(() => (solution.workspace?.initiatives || []).map((initiative) => ({ initiative, state: lifecycleFor(solution.workspace!, initiative.id) })).filter(({ initiative, state }) => (filter === "all" || state.lifecycle === filter) && `${initiative.title} ${initiative.owner || ""} ${state.selected || ""}`.toLowerCase().includes(query.trim().toLowerCase())), [solution.workspace, filter, query]);

  async function create() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const result = await governance.mutate("create_initiative", { title }, { refresh: false });
      await solution.reload();
      setShowCreate(false); setTitle(""); setNotice("Initiative created with its protected status-quo option.");
      if (result.id) window.location.assign(`/initiatives/${encodeURIComponent(result.id)}`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "The Initiative could not be created."); }
    finally { setSaving(false); }
  }

  const allStates = solution.workspace?.initiatives.map((initiative) => lifecycleFor(solution.workspace!, initiative.id)) || [];
  return <DomainPageShell title="Initiatives" subtitle="Government problem/outcome decision cases—not an external execution tracker" releaseScope={solution.workspace ? `${solution.workspace.actor.displayName} · ${readable(solution.workspace.actor.role)}` : "Loading"} contextMode="portfolio" actions={<><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search decision cases"/></label><select value={filter} onChange={(event) => setFilter(event.target.value as InitiativeLifecycle | "all")}><option value="all">All lifecycle states</option>{["draft", "in_analysis", "decision_ready", "decided", "closed"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select><button className="primary-button" type="button" onClick={() => setShowCreate(true)}>＋ New Initiative</button></>}>
    <section className="kpi-grid"><div className="kpi-card"><span>Decision cases</span><strong>{allStates.length}</strong><small>Government-authored Initiatives</small></div><div className="kpi-card"><span>In analysis</span><strong>{allStates.filter((item) => item.lifecycle === "in_analysis").length}</strong><small>Alternatives being evaluated</small></div><div className="kpi-card"><span>Decision ready</span><strong>{allStates.filter((item) => item.lifecycle === "decision_ready").length}</strong><small>No structural analysis gaps</small></div><div className="kpi-card"><span>Decided</span><strong>{allStates.filter((item) => item.lifecycle === "decided").length}</strong><small>Immutable decision revisions retained</small></div></section>
    {solution.loading ? <section className="domain-section"><p className="empty">Loading Initiative cases…</p></section> : null}{solution.error ? <section className="domain-section"><p className="error-copy">{solution.error}</p></section> : null}
    <section className="domain-list">{rows.map(({ initiative, state }) => <article className="domain-card" key={initiative.id}><div className="section-toolbar"><div><span className={`status-pill status-${state.lifecycle}`}>{readable(state.lifecycle)}</span><h3><Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>{initiative.title}</Link></h3></div><span>{state.options} options</span></div><p>{initiative.problemStatement || "Problem statement not yet framed."}</p><div className="record-facts"><div><dt>Analysis gaps</dt><dd>{state.gaps}</dd></div><div><dt>Disposition</dt><dd>{readable(state.disposition)}</dd></div><div><dt>Selected option</dt><dd>{state.selected || "None"}</dd></div><div><dt>Owner</dt><dd>{initiative.owner || "Not assigned"}</dd></div></div><p className="entity-actions"><Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>Open Solution Engineering</Link></p></article>)}{!solution.loading && !rows.length ? <article className="domain-card empty-state"><h3>No Initiative cases in this view</h3><p>Create a title-only decision case. The application will atomically create the required protected status quo, then guide you through problem, alternatives, option plans, comparison, and adjudication.</p><button className="primary-button" type="button" onClick={() => setShowCreate(true)}>Create Initiative</button></article> : null}</section>
    {showCreate ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="create-case-title"><span className="eyebrow">GOVERNMENT DECISION CASE</span><h2 id="create-case-title">Create Initiative</h2><p>Only a title is required. A protected, editable status-quo alternative is created in the same transaction.</p><label className="modal-field">Initiative title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g., Reduce PMA downtime and cyber exposure"/></label><footer><button className="ghost-button" type="button" disabled={saving} onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" type="button" disabled={saving || !title.trim()} onClick={() => void create()}>{saving ? "Creating…" : "Create and open"}</button></footer></section></div> : null}
    {notice ? <div className="toast" role="status">{notice}</div> : null}
  </DomainPageShell>;
}
