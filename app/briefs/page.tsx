"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { useGovernancePortfolio } from "../../lib/governance-client";
import { briefStatuses, displayStatus, type BriefStatus } from "../../lib/governance-model";

function dateLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export default function BriefsPage() {
  const searchParams = useSearchParams();
  const { portfolio, loading, error, mutate } = useGovernancePortfolio();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BriefStatus | "all">("all");
  const [initiativeId, setInitiativeId] = useState(() => searchParams.get("initiative") || "");
  const [briefTitle, setBriefTitle] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const initiatives = useMemo(() => portfolio?.initiatives ?? [], [portfolio?.initiatives]);
  const briefs = useMemo(() => portfolio?.briefs ?? [], [portfolio?.briefs]);

  const filtered = useMemo(() => briefs.filter((brief) => {
    if (statusFilter !== "all" && brief.status !== statusFilter) return false;
    return `${brief.title} ${brief.initiativeTitle || ""} ${brief.snapshot.releaseName}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [briefs, query, statusFilter]);
  const effectiveInitiativeId = initiativeId || initiatives[0]?.id || "";
  const selectedInitiative = initiatives.find((item) => item.id === effectiveInitiativeId) ?? null;

  function openCreate() {
    const current = initiatives.find((item) => item.id === effectiveInitiativeId) ?? initiatives[0] ?? null;
    if (current) { setInitiativeId(current.id); setBriefTitle(`${current.title} — Executive One-Pager`); }
    setShowCreate(true);
  }

  async function createBrief() {
    if (!effectiveInitiativeId) { setNotice("Create or choose an initiative first."); return; }
    setSaving(true);
    try {
      const result = await mutate("create_executive_brief", { initiativeId: effectiveInitiativeId, title: briefTitle });
      setShowCreate(false);
      if (result.id) window.location.assign(`/briefs/${encodeURIComponent(String(result.id))}`);
      else setNotice("Executive one-pager created.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "The one-pager could not be created."); }
    finally { setSaving(false); }
  }

  async function updateStatus(briefId: string, status: string) {
    try { await mutate("update_executive_brief", { briefId, status }); setNotice("Brief lifecycle updated."); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "The brief could not be updated."); }
  }

  return <DomainPageShell title="Executive Briefs" subtitle="Decision-ready one-pagers with an immutable baseline snapshot and publication history." releaseScope={portfolio ? `${portfolio.actor.displayName} · ${displayStatus(portfolio.actor.role)}` : "Loading stewardship context"} actions={<><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search briefs" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as BriefStatus | "all")}><option value="all">All statuses</option>{briefStatuses.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}</select><button className="primary-button" type="button" onClick={openCreate}>＋ New brief</button></>}>
    <section className="kpi-grid" aria-label="Executive brief summary"><div className="kpi-card"><span>Total briefs</span><strong>{briefs.length}</strong><small>Generated leadership outputs</small></div><div className="kpi-card"><span>Draft</span><strong>{briefs.filter((item) => item.status === "draft").length}</strong><small>Needs final stewardship</small></div><div className="kpi-card"><span>Reviewed</span><strong>{briefs.filter((item) => item.status === "reviewed").length}</strong><small>Stewardship complete</small></div><div className="kpi-card"><span>Published</span><strong>{briefs.filter((item) => item.status === "published").length}</strong><small>Ready for leadership audience</small></div></section>
    {loading && <section className="domain-section"><p className="empty">Loading durable executive briefs…</p></section>}
    {error && <section className="domain-section"><p className="error-copy">{error}</p></section>}
    {!loading && !error && <section className="domain-list">{filtered.length ? filtered.map((brief) => <article className="domain-card" key={brief.id}><div className="section-toolbar"><div><span className="record-type">One-pager</span><h3><Link href={`/briefs/${encodeURIComponent(brief.id)}`}>{brief.title}</Link></h3></div><span className={`status-pill status-${brief.status}`}>{displayStatus(brief.status)}</span></div><p className="entity-meta">{brief.initiativeTitle || "Independent brief"} · {brief.snapshot.releaseName}</p><p>{brief.snapshot.sourceRows} source records · {brief.snapshot.products} products · {brief.snapshot.reviewRows} review records at snapshot time</p><p className="entity-meta">Created {dateLabel(brief.createdAt)} · Last updated {dateLabel(brief.updatedAt)}</p><p className="entity-actions"><Link href={`/briefs/${encodeURIComponent(brief.id)}`}>Open one-pager</Link>{brief.initiativeId && <Link href={`/initiatives/${encodeURIComponent(brief.initiativeId)}`}>Open initiative</Link>}<select aria-label={`Lifecycle for ${brief.title}`} value={brief.status} onChange={(event) => void updateStatus(brief.id, event.target.value)}>{briefStatuses.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></p></article>) : <article className="domain-card empty-state"><h3>No executive briefs match this view</h3><p>Build an initiative first, then create a one-pager that captures its release/product scope and linked Government records at a point in time.</p><Link href="/initiatives">Open initiatives & WBS</Link></article>}</section>}
    {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="create-brief-title"><span className="eyebrow">LEADERSHIP OUTPUT</span><h2 id="create-brief-title">Create executive one-pager</h2><p>The brief captures the current technical baseline, review status, scoped products, and linked Government records as a durable snapshot.</p><label className="modal-field">Initiative<select value={effectiveInitiativeId} onChange={(event) => { const next = event.target.value; setInitiativeId(next); const item = initiatives.find((initiative) => initiative.id === next); if (item && !briefTitle) setBriefTitle(`${item.title} — Executive One-Pager`); }}><option value="">Select initiative</option>{initiatives.map((initiative) => <option key={initiative.id} value={initiative.id}>{initiative.title}</option>)}</select></label><label className="modal-field">Brief title<input value={briefTitle} onChange={(event) => setBriefTitle(event.target.value)} placeholder="Leadership-ready title" /></label>{selectedInitiative && <div className="preview-card"><strong>{selectedInitiative.primaryReleaseName || "All releases"}</strong><span>{selectedInitiative.scope.filter((scope) => scope.scopeKind === "product").length || "All"} products in initiative scope · {selectedInitiative.linkedRecordCount} linked Government records</span></div>}<footer><button className="ghost-button" type="button" disabled={saving} onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" type="button" disabled={saving} onClick={() => void createBrief()}>{saving ? "Creating…" : "Create one-pager"}</button></footer></section></div>}
    {notice && <div className="toast" role="status">✓ {notice}</div>}
  </DomainPageShell>;
}
