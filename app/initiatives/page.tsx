"use client";

import { useMemo, useState } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { InitiativeScopeHelper } from "../../components/initiative-scope-helper";
import { useGovernancePortfolio } from "../../lib/governance-client";
import { displayStatus, initiativePriorities, initiativeStatuses, type InitiativePriority, type InitiativeStatus } from "../../lib/governance-model";
import { useInitiativeDecisions } from "../../lib/initiative-decision-client";
import { readable } from "../../lib/initiative-decision-model";

function dateLabel(value: string | null) {
  if (!value) return "No target date";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export default function InitiativesPage() {
  const { portfolio, loading, error, mutate } = useGovernancePortfolio();
  const decisionWorkspace = useInitiativeDecisions();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<InitiativeStatus | "all">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [releaseName, setReleaseName] = useState("All releases");
  const [status, setStatus] = useState<InitiativeStatus>("draft");
  const [priority, setPriority] = useState<InitiativePriority>("medium");
  const [targetDate, setTargetDate] = useState("");
  const [consequence, setConsequence] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");
  const [decisionAsk, setDecisionAsk] = useState("");
  const [problemStatement, setProblemStatement] = useState("");
  const [driversConstraints, setDriversConstraints] = useState("");

  const releases = useMemo(() => ["All releases", ...(decisionWorkspace.workspace?.changes.releases.map((release) => release.name) || [])], [decisionWorkspace.workspace?.changes.releases]);
  const initiatives = useMemo(() => portfolio?.initiatives ?? [], [portfolio?.initiatives]);
  const filtered = useMemo(() => initiatives.filter((initiative) => {
    if (statusFilter !== "all" && initiative.status !== statusFilter) return false;
    const terms = `${initiative.title} ${initiative.owner || ""} ${initiative.primaryReleaseName || "All releases"} ${initiative.consequence || ""}`.toLowerCase();
    return terms.includes(query.trim().toLowerCase());
  }), [initiatives, query, statusFilter]);

  function openCreate() {
    setTitle(""); setOwner(""); setReleaseName("All releases"); setStatus("draft"); setPriority("medium"); setTargetDate(""); setConsequence(""); setDesiredOutcome(""); setDecisionAsk(""); setProblemStatement(""); setDriversConstraints(""); setShowCreate(true);
  }

  function changeRelease(nextRelease: string) {
    setReleaseName(nextRelease);
  }

  async function create() {
    if (!title.trim()) { setNotice("Enter an initiative title before saving."); return; }
    setSaving(true);
    try {
      await mutate("create_initiative", { title, owner, releaseName, status, priority, targetDate, consequence, desiredOutcome, decisionAsk, problemStatement, driversConstraints });
      await decisionWorkspace.reload();
      setShowCreate(false);
      setNotice(`Created initiative ${title.trim()}.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The initiative could not be created.");
    } finally { setSaving(false); }
  }

  return <DomainPageShell title="Initiatives" subtitle="Government problem-and-outcome cases with explicit, source-backed solution alternatives." releaseScope={portfolio ? `${portfolio.actor.displayName} · ${displayStatus(portfolio.actor.role)}` : "Loading records"} contextMode="portfolio" actions={<><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search initiatives" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InitiativeStatus | "all")}><option value="all">All statuses</option>{initiativeStatuses.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select><button className="primary-button" type="button" onClick={openCreate}>＋ New initiative</button></>}>
    <section className="kpi-grid" aria-label="Initiative summary">
      <div className="kpi-card"><span>Initiatives</span><strong>{initiatives.length}</strong><small>Government decision records</small></div>
      <div className="kpi-card"><span>Active</span><strong>{initiatives.filter((item) => item.status === "active").length}</strong><small>Under active review</small></div>
      <div className="kpi-card"><span>Decision required</span><strong>{initiatives.filter((item) => item.status === "decision_required").length}</strong><small>Needs Government direction</small></div>
      <div className="kpi-card"><span>Decision ready</span><strong>{Object.values(decisionWorkspace.workspace?.assessments || {}).filter((item) => item.stage === "decision_ready").length}</strong><small>No automated readiness gaps</small></div>
    </section>

    {loading ? <section className="domain-section"><p className="empty">Loading initiative records…</p></section> : null}
    {error ? <section className="domain-section"><p className="error-copy">{error}</p></section> : null}
    {!loading && !error && <section className="domain-list">
      {filtered.length ? filtered.map((initiative) => { const assessment = decisionWorkspace.workspace?.assessments[initiative.id]; const links = decisionWorkspace.workspace?.links.filter((item) => item.initiativeId === initiative.id).length || 0; return <article key={initiative.id} className="domain-card">
        <div className="section-toolbar"><div><span className={`status-pill status-${initiative.status}`}>{displayStatus(initiative.status)}</span><h3 style={{ marginTop: 10 }}><Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>{initiative.title}</Link></h3></div><span className={`status-pill status-${initiative.priority}`}>{displayStatus(initiative.priority)}</span></div>
        <p className="entity-meta">{initiative.primaryReleaseName || "Cross-release"} · {links} linked Change Requests · {assessment?.blockers || 0} blockers · {assessment ? `${assessment.score}% ${readable(assessment.stage)}` : "Readiness loading"}</p>
        <p>{initiative.consequence || "Consequence not recorded."}</p>
        <p className="entity-meta">Owner: {initiative.owner || "Unassigned"} · {dateLabel(initiative.targetDate)} · {initiative.workPackages.length} WBS packages</p>
        <p className="entity-actions"><Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>Open decision workspace</Link><Link href={`/initiatives/${encodeURIComponent(initiative.id)}/one-pager`}>Open leadership one-pager</Link></p>
      </article>; }) : <article className="domain-card empty-state"><h3>No initiatives in this view</h3><p>Create an Initiative, then link its Change Requests, technical Objectives, requirements, acceptance evidence, and Government WBS.</p><button className="primary-button" type="button" onClick={openCreate}>Create initiative</button></article>}
    </section>}

    {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}>
      <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="initiative-create-title">
        <span className="eyebrow">GOVERNMENT DECISION</span><h2 id="initiative-create-title">Create initiative</h2><p>Create the decision record first. Its technical scope is derived from affected objects on linked Change Requests and their LM Objectives; it is never selected here.</p>
        <InitiativeScopeHelper />
        <div className="form-grid"><label className="modal-field">Initiative title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g., Stabilize mission telemetry stack" /></label><label className="modal-field">Owner<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Lead office / team" /></label><label className="modal-field">Release lens (optional)<select value={releaseName} onChange={(event) => changeRelease(event.target.value)}>{releases.map((item) => <option key={item}>{item}</option>)}</select><small>Organizes the decision view; it does not define technical scope.</small></label><label className="modal-field">Target date<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label><label className="modal-field">Status<select value={status} onChange={(event) => setStatus(event.target.value as InitiativeStatus)}>{initiativeStatuses.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select></label><label className="modal-field">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as InitiativePriority)}>{initiativePriorities.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select></label></div>
        <label className="modal-field">Problem statement<textarea rows={3} value={problemStatement} onChange={(event) => setProblemStatement(event.target.value)} placeholder="Why is the current condition unacceptable?" /><small>Describe the undesirable condition without embedding a preferred solution.</small></label>
        <label className="modal-field">Desired outcome<textarea rows={3} value={desiredOutcome} onChange={(event) => setDesiredOutcome(event.target.value)} placeholder="Government end state shared by every option" /><small>Every solution option will be evaluated against this same outcome.</small></label>
        <label className="modal-field">Known drivers / constraints<textarea rows={3} value={driversConstraints} onChange={(event) => setDriversConstraints(event.target.value)} placeholder="EOL dates, security boundaries, fielding windows, policy, or mission constraints" /></label>
        <label className="modal-field">Consequence<input value={consequence} onChange={(event) => setConsequence(event.target.value)} placeholder="What remains at risk if no action is taken?" /></label><label className="modal-field">Decision required<input value={decisionAsk} onChange={(event) => setDecisionAsk(event.target.value)} placeholder="Specific Government decision or direction requested" /></label>
        <footer><button className="ghost-button" type="button" disabled={saving} onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" type="button" disabled={saving} onClick={create}>{saving ? "Saving…" : "Create initiative"}</button></footer>
      </section>
    </div>}
    {notice ? <div className="toast" role="status">✓ {notice}</div> : null}
  </DomainPageShell>;
}
