"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "../../../components/app-link";
import { DomainPageShell } from "../../../components/domain-shell";
import { downloadBriefDocx, downloadBriefMarkdown, downloadBriefPdf } from "../../../lib/brief-export";
import { useGovernancePortfolio } from "../../../lib/governance-client";
import { briefStatuses, displayStatus, type BriefStatus } from "../../../lib/governance-model";
import { AuditHistoryPanel } from "../../../components/governed-object";

function dateLabel(value: string | null) {
  if (!value) return "Not yet published";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function BriefDetailPage() {
  const params = useParams<{ id?: string }>();
  const briefId = decodeURIComponent(params.id ?? "");
  const { portfolio, loading, error, mutate } = useGovernancePortfolio();
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"overview" | "snapshot" | "text" | "history">("overview");
  const brief = portfolio?.briefs.find((item) => item.id === briefId) ?? null;
  const initiative = portfolio?.initiatives.find((item) => item.id === brief?.initiativeId) ?? null;

  const notes = notesDraft ?? brief?.notes ?? "";

  async function update(patch: Record<string, unknown>, confirmation: string) {
    if (!brief) return;
    try { await mutate("update_executive_brief", { briefId: brief.id, ...patch }); setNotice(confirmation); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "The executive brief could not be updated."); }
  }

  async function exportBrief(format: "markdown" | "pdf" | "docx") {
    if (!brief) return;
    if (format === "markdown") downloadBriefMarkdown(brief);
    if (format === "pdf") downloadBriefPdf(brief);
    if (format === "docx") await downloadBriefDocx(brief);
    try { await mutate("record_brief_publication", { briefId: brief.id, format }); setNotice(`Downloaded ${format.toUpperCase()} and recorded its publication history.`); }
    catch { setNotice(`Downloaded ${format.toUpperCase()}. Publication history will be retried on the next export.`); }
  }

  if (loading) return <DomainPageShell title="Saved report" subtitle="Loading report snapshot…" releaseScope="Loading"><section className="domain-section"><p className="empty">Loading report…</p></section></DomainPageShell>;
  if (error || !brief) return <DomainPageShell title="Brief not found" subtitle={error || "This leadership output is no longer available."} releaseScope="No brief selected" actions={<Link href="/briefs">Back to briefs</Link>}><section className="domain-section"><article className="domain-card empty-state"><h3>Choose a brief from the shared portfolio</h3><p>Executive briefs are now stored with their source snapshot and export history.</p></article></section></DomainPageShell>;

  return <DomainPageShell title={brief.title} subtitle="Saved baseline snapshot, decision context, and publication record." releaseScope={`${brief.snapshot.releaseName} · Snapshot ${dateLabel(brief.snapshot.asOf)}`} actions={<><button className="ghost-button" type="button" onClick={() => void exportBrief("docx")}>Download DOCX</button><button className="primary-button" type="button" onClick={() => void exportBrief("pdf")}>Download PDF</button></>}>
    <section className="kpi-grid" aria-label="Brief summary"><div className="kpi-card"><span>Lifecycle</span><strong>{displayStatus(brief.status)}</strong><small>Published {dateLabel(brief.publishedAt)}</small></div><div className="kpi-card"><span>Baseline scope</span><strong>{brief.snapshot.sourceRows}</strong><small>Working baseline records</small></div><div className="kpi-card"><span>Products</span><strong>{brief.snapshot.products}</strong><small>Across {brief.snapshot.releases} releases</small></div><div className="kpi-card"><span>Review attention</span><strong>{brief.snapshot.reviewRows}</strong><small>Review records at snapshot time</small></div></section>
    <nav className="detail-tabs" aria-label="Brief views">{(["overview", "snapshot", "text", "history"] as const).map((item) => <button key={item} type="button" className={tab === item ? "tab-button tab-active" : "tab-button"} onClick={() => setTab(item)}>{item === "text" ? "Brief text" : displayStatus(item)}</button>)}</nav>
    {tab === "overview" && <section className="split-layout"><article className="domain-card"><span className="eyebrow">INITIATIVE CONTEXT</span><h3>{initiative ? <Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>{initiative.title}</Link> : "Independent report"}</h3><p>{initiative?.consequence || "Consequence not recorded."}</p><p className="entity-meta">Decision required: {initiative?.decisionAsk || "Not recorded"}</p><p className="entity-meta">Desired outcome: {initiative?.desiredOutcome || "Not recorded"}</p></article><article className="domain-card"><span className="eyebrow">REPORT CONTROLS</span><h3>Status and notes</h3><label className="modal-field">Status<select value={brief.status} onChange={(event) => void update({ status: event.target.value as BriefStatus }, "Report status updated.")}>{briefStatuses.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></label><label className="modal-field">Analyst notes<textarea rows={5} value={notes} onChange={(event) => setNotesDraft(event.target.value)} placeholder="Context for the next reviewer" /></label><button className="primary-button" type="button" onClick={() => void update({ notes }, "Report notes saved.")}>Save notes</button><p className="entity-meta">Created {dateLabel(brief.createdAt)} · Updated {dateLabel(brief.updatedAt)}</p></article></section>}
    {tab === "snapshot" && <section className="domain-section"><article className="domain-card"><div className="section-toolbar"><div><span className="eyebrow">BASELINE SNAPSHOT</span><h3>What this one-pager represents</h3></div><span>{brief.snapshot.releaseName}</span></div><p className="entity-meta">This snapshot is frozen when the brief is created; later baseline imports or edits will not silently change a leadership artifact.</p><div className="domain-table-wrap"><table><tbody><tr><th>As of</th><td>{dateLabel(brief.snapshot.asOf)}</td></tr><tr><th>Baseline records</th><td>{brief.snapshot.sourceRows}</td></tr><tr><th>Products</th><td>{brief.snapshot.products}</td></tr><tr><th>Releases</th><td>{brief.snapshot.releases}</td></tr><tr><th>Review records</th><td>{brief.snapshot.reviewRows}</td></tr></tbody></table></div><h4>Representative products</h4><p>{brief.snapshot.productNames.length ? brief.snapshot.productNames.join(" · ") : "No products matched the selected scope."}</p><h4>Linked supporting records</h4>{brief.snapshot.linkedRecords.length ? <ul>{brief.snapshot.linkedRecords.map((record) => <li key={`${record.type}-${record.title}`}>{displayStatus(record.type)}: {record.title} ({displayStatus(record.status)})</li>)}</ul> : <p>No MCPs, technical calls, decisions, or risks were linked at snapshot time.</p>}</article></section>}
    {tab === "text" && <section className="domain-section"><article className="domain-card"><div className="section-toolbar"><div><span className="eyebrow">LEADERSHIP CONTENT</span><h3>Generated one-pager text</h3></div><span>Export-ready</span></div><textarea className="review-note" style={{ minHeight: 440 }} value={brief.bodyMarkdown} readOnly /><p className="entity-actions"><button className="ghost-button" type="button" onClick={() => void exportBrief("markdown")}>Download Markdown</button><button className="ghost-button" type="button" onClick={() => void exportBrief("docx")}>Download DOCX</button><button className="primary-button" type="button" onClick={() => void exportBrief("pdf")}>Download PDF</button></p></article></section>}
    {tab === "history" ? <AuditHistoryPanel kind="executive_brief" id={brief.id} label={brief.title} /> : null}
    {notice && <div className="toast" role="status">✓ {notice}</div>}
  </DomainPageShell>;
}
