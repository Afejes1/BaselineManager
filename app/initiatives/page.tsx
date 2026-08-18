"use client";

import { useMemo, useState } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { useBaselineWorkspace } from "../../lib/baseline-client";
import { useGovernancePortfolio } from "../../lib/governance-client";
import { displayStatus, initiativePriorities, initiativeStatuses, type InitiativePriority, type InitiativeStatus } from "../../lib/governance-model";

type ProductOption = { id: string; label: string; releaseNames: string[] };

function dateLabel(value: string | null) {
  if (!value) return "No target date";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export default function InitiativesPage() {
  const { rows } = useBaselineWorkspace();
  const { portfolio, loading, error, mutate } = useGovernancePortfolio();
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
  const [productIds, setProductIds] = useState<Set<string>>(new Set());

  const releases = useMemo(() => ["All releases", ...Array.from(new Set(rows.map((row) => String(row.ReleaseName || "").trim()).filter(Boolean))).sort()], [rows]);
  const products = useMemo<ProductOption[]>(() => {
    const grouped = new Map<string, ProductOption>();
    for (const row of rows) {
      const productId = row.__meta.productId;
      if (!productId) continue;
      const label = String(row.LongName || row.ShortName || "Unassigned product");
      const current = grouped.get(productId) ?? { id: productId, label, releaseNames: [] };
      const rowRelease = String(row.ReleaseName || "").trim();
      if (rowRelease && !current.releaseNames.includes(rowRelease)) current.releaseNames.push(rowRelease);
      grouped.set(productId, current);
    }
    return [...grouped.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [rows]);
  const selectableProducts = useMemo(() => products.filter((product) => releaseName === "All releases" || product.releaseNames.includes(releaseName)), [products, releaseName]);
  const initiatives = useMemo(() => portfolio?.initiatives ?? [], [portfolio?.initiatives]);
  const filtered = useMemo(() => initiatives.filter((initiative) => {
    if (statusFilter !== "all" && initiative.status !== statusFilter) return false;
    const terms = `${initiative.title} ${initiative.owner || ""} ${initiative.primaryReleaseName || "All releases"} ${initiative.consequence || ""}`.toLowerCase();
    return terms.includes(query.trim().toLowerCase());
  }), [initiatives, query, statusFilter]);

  function openCreate() {
    setTitle(""); setOwner(""); setReleaseName("All releases"); setStatus("draft"); setPriority("medium"); setTargetDate(""); setConsequence(""); setDesiredOutcome(""); setDecisionAsk(""); setProductIds(new Set(products.map((product) => product.id))); setShowCreate(true);
  }

  function changeRelease(nextRelease: string) {
    setReleaseName(nextRelease);
    setProductIds(new Set(products.filter((product) => nextRelease === "All releases" || product.releaseNames.includes(nextRelease)).map((product) => product.id)));
  }

  async function create() {
    if (!title.trim()) { setNotice("Enter an initiative title before saving."); return; }
    setSaving(true);
    try {
      await mutate("create_initiative", { title, owner, releaseName, status, priority, targetDate, consequence, desiredOutcome, decisionAsk, productScopes: selectableProducts.filter((product) => productIds.has(product.id)).map((product) => ({ id: product.id, label: product.label })) });
      setShowCreate(false);
      setNotice(`Created initiative ${title.trim()}.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The initiative could not be created.");
    } finally { setSaving(false); }
  }

  return <DomainPageShell title="Initiatives & WBS" subtitle="Government outcomes, scoped technical impact, and accountable delivery packages." releaseScope={portfolio ? `${portfolio.actor.displayName} · ${displayStatus(portfolio.actor.role)}` : "Loading stewardship context"} actions={<><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search initiatives" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InitiativeStatus | "all")}><option value="all">All statuses</option>{initiativeStatuses.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select><button className="primary-button" type="button" onClick={openCreate}>＋ New initiative</button></>}>
    <section className="kpi-grid" aria-label="Initiative summary">
      <div className="kpi-card"><span>Portfolio</span><strong>{initiatives.length}</strong><small>Durable Government initiatives</small></div>
      <div className="kpi-card"><span>Active</span><strong>{initiatives.filter((item) => item.status === "active").length}</strong><small>Under active stewardship</small></div>
      <div className="kpi-card"><span>Decision required</span><strong>{initiatives.filter((item) => item.status === "decision_required").length}</strong><small>Needs Government direction</small></div>
      <div className="kpi-card"><span>WBS packages</span><strong>{initiatives.reduce((total, item) => total + item.workPackages.length, 0)}</strong><small>Delivery elements in the portfolio</small></div>
    </section>

    {loading ? <section className="domain-section"><p className="empty">Loading durable initiative records…</p></section> : null}
    {error ? <section className="domain-section"><p className="error-copy">{error}</p></section> : null}
    {!loading && !error && <section className="domain-list">
      {filtered.length ? filtered.map((initiative) => <article key={initiative.id} className="domain-card">
        <div className="section-toolbar"><div><span className={`status-pill status-${initiative.status}`}>{displayStatus(initiative.status)}</span><h3 style={{ marginTop: 10 }}><Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>{initiative.title}</Link></h3></div><span className={`status-pill status-${initiative.priority}`}>{displayStatus(initiative.priority)}</span></div>
        <p className="entity-meta">{initiative.primaryReleaseName || "All releases"} · {initiative.scope.filter((scope) => scope.scopeKind === "product").length || "All"} products · {initiative.linkedRecordCount} linked Government records</p>
        <p>{initiative.consequence || "No consequence statement recorded yet."}</p>
        <p className="entity-meta">Owner: {initiative.owner || "Unassigned"} · {dateLabel(initiative.targetDate)} · {initiative.workPackages.length} WBS packages</p>
        <p className="entity-actions"><Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>Open initiative</Link><Link href={`/briefs?initiative=${encodeURIComponent(initiative.id)}`}>Create one-pager</Link></p>
      </article>) : <article className="domain-card empty-state"><h3>No initiatives match this view</h3><p>Create a durable initiative, scope it to a release and products, then add WBS packages, MCPs, calls, decisions, and evidence.</p><button className="primary-button" type="button" onClick={openCreate}>Create initiative</button></article>}
    </section>}

    {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="initiative-create-title"><span className="eyebrow">GOVERNMENT STEERING</span><h2 id="initiative-create-title">Create initiative</h2><p>This record will be stored in the shared governance workspace and linked to the current baseline by release and product scope.</p><div className="form-grid"><label className="modal-field">Initiative title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g., Stabilize mission telemetry stack" /></label><label className="modal-field">Owner<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Lead office / team" /></label><label className="modal-field">Release scope<select value={releaseName} onChange={(event) => changeRelease(event.target.value)}>{releases.map((item) => <option key={item}>{item}</option>)}</select></label><label className="modal-field">Target date<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label><label className="modal-field">Lifecycle<select value={status} onChange={(event) => setStatus(event.target.value as InitiativeStatus)}>{initiativeStatuses.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select></label><label className="modal-field">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as InitiativePriority)}>{initiativePriorities.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select></label></div><label className="modal-field">Consequence<input value={consequence} onChange={(event) => setConsequence(event.target.value)} placeholder="What is at risk or needs correction?" /></label><label className="modal-field">Desired outcome<input value={desiredOutcome} onChange={(event) => setDesiredOutcome(event.target.value)} placeholder="What good looks like in the working baseline" /></label><label className="modal-field">Decision ask<input value={decisionAsk} onChange={(event) => setDecisionAsk(event.target.value)} placeholder="Specific Government decision or direction requested" /></label><div className="modal-field"><span>Products in scope</span><div className="domain-table-wrap" style={{ marginTop: 8, maxHeight: 190 }}><table><tbody>{selectableProducts.map((product) => <tr key={product.id}><td style={{ width: 34 }}><input type="checkbox" aria-label={product.label} checked={productIds.has(product.id)} onChange={() => setProductIds((current) => { const next = new Set(current); if (next.has(product.id)) next.delete(product.id); else next.add(product.id); return next; })} /></td><td>{product.label}</td><td className="entity-meta">{product.releaseNames.join(", ")}</td></tr>)}{!selectableProducts.length ? <tr><td className="empty">No products in this release.</td></tr> : null}</tbody></table></div></div><footer><button className="ghost-button" type="button" disabled={saving} onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" type="button" disabled={saving} onClick={create}>{saving ? "Saving…" : "Create initiative"}</button></footer></section></div>}
    {notice ? <div className="toast" role="status">✓ {notice}</div> : null}
  </DomainPageShell>;
}
