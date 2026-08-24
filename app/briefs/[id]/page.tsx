"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "../../../components/app-link";
import { DomainPageShell } from "../../../components/domain-shell";
import { downloadPreparedBrief, prepareBriefDocx, prepareBriefMarkdown, prepareBriefPdf } from "../../../lib/brief-export";
import { useGovernancePortfolio } from "../../../lib/governance-client";
import { briefStatuses, displayStatus, type BriefStatus } from "../../../lib/governance-model";
import { AuditHistoryPanel } from "../../../components/governed-object";
import { briefSourceHash, type BriefPublicationFormat } from "../../../lib/brief-publication";
import { PROGRAM_HANDLING_MARKING } from "../../../lib/output-handling";
import { informationOriginLabel, informationStatusSummary } from "../../../lib/information-status";

const REVIEW_ATTESTATION = "I reviewed the frozen report text and source snapshot.";

function dateLabel(value: string | null) {
  if (!value) return "Not yet published";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function BriefDetailPage() {
  const params = useParams<{ id?: string }>();
  const briefId = decodeURIComponent(params.id ?? "");
  const { portfolio, loading, error, reload, mutate } = useGovernancePortfolio();
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [tab, setTab] = useState<"overview" | "snapshot" | "text" | "history">("overview");
  const brief = portfolio?.briefs.find((item) => item.id === briefId) ?? null;
  const initiative = portfolio?.initiatives.find((item) => item.id === brief?.initiativeId) ?? null;
  const underMarkedHistoricalReport = Boolean(brief && (!brief.snapshotValid || brief.snapshot.handlingMarking !== PROGRAM_HANDLING_MARKING));

  const notes = notesDraft ?? brief?.notes ?? "";
  const editableStatuses = brief?.status === "superseded" ? ["superseded"] as BriefStatus[] : brief?.status === "published" ? ["published", "superseded"] as BriefStatus[] : brief?.status === "draft" ? ["draft", "superseded"] as BriefStatus[] : briefStatuses.filter((status) => status !== "published");

  async function update(patch: Record<string, unknown>, confirmation: string) {
    if (!brief) return;
    try { await mutate("update_executive_brief", { briefId: brief.id, ...patch }); setNotice(confirmation); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "The executive brief could not be updated."); }
  }

  async function preparedBrief(format: BriefPublicationFormat) {
    if (!brief) throw new Error("The report is unavailable.");
    if (underMarkedHistoricalReport) throw new Error("This historical report is under-marked. Regenerate it before export or distribution.");
    return format === "markdown" ? prepareBriefMarkdown(brief) : format === "pdf" ? prepareBriefPdf(brief) : await prepareBriefDocx(brief);
  }

  async function reviewFrozenBrief() {
    if (!brief || brief.status !== "draft") return;
    setExporting(true); setNotice("");
    try {
      if (underMarkedHistoricalReport) throw new Error("This legacy or under-marked report must be regenerated before review.");
      if (!reviewConfirmed) throw new Error("Read the frozen report text and source snapshot, then confirm the review attestation.");
      const sourceHash = await briefSourceHash(brief);
      await mutate("update_executive_brief", { briefId: brief.id, status: "reviewed", expectedUpdatedAt: brief.updatedAt, expectedSourceHash: sourceHash, reviewAttestation: REVIEW_ATTESTATION });
      await reload();
      setReviewConfirmed(false);
      setNotice("Frozen report source attested and marked Reviewed.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "The frozen report review could not be recorded."); }
    finally { setExporting(false); }
  }

  async function downloadDraft(format: BriefPublicationFormat) {
    if (!brief) return;
    setExporting(true); setNotice("");
    try {
      const prepared = await preparedBrief(format);
      downloadPreparedBrief(prepared.blob, prepared.fileName);
      setNotice(`Downloaded an unrecorded ${format.toUpperCase()} draft.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The report draft could not be exported.");
    } finally { setExporting(false); }
  }

  async function publishBrief(format: BriefPublicationFormat) {
    if (!brief) return;
    setExporting(true); setNotice("");
    try {
      if (underMarkedHistoricalReport) throw new Error("This historical report is under-marked. Regenerate it before publication.");
      if (brief.status !== "reviewed" && brief.status !== "published") throw new Error("Move the report to Reviewed before publishing a durable artifact.");
      const sourceHash = await briefSourceHash(brief);
      const response = await fetch("/api/brief-publications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: brief.id, format, expectedUpdatedAt: brief.updatedAt, expectedSourceHash: sourceHash }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "The report artifact could not be published.");
      }
      const storedArtifact = await response.blob();
      const fileName = `${brief.title.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "Executive-Brief"}.${format === "markdown" ? "md" : format}`;
      downloadPreparedBrief(storedArtifact, fileName);
      await reload();
      setNotice(`Published and downloaded the server-attested ${format.toUpperCase()} artifact.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The report could not be published.");
    } finally { setExporting(false); }
  }

  if (loading) return <DomainPageShell title="Saved report" subtitle="Loading report snapshot…" releaseScope="Loading"><section className="domain-section"><p className="empty">Loading report…</p></section></DomainPageShell>;
  if (error || !brief) return <DomainPageShell title="Brief not found" subtitle={error || "This leadership output is no longer available."} releaseScope="No brief selected" actions={<Link href="/briefs">Back to briefs</Link>}><section className="domain-section"><article className="domain-card empty-state"><h3>Choose a brief from the shared portfolio</h3><p>Executive briefs are now stored with their source snapshot and export history.</p></article></section></DomainPageShell>;

  return <DomainPageShell title={brief.title} subtitle="Saved baseline snapshot, decision context, and publication record." releaseScope={`Release context: ${brief.snapshot.releaseName} · Snapshot ${dateLabel(brief.snapshot.asOf)}`} actions={<><button className="ghost-button" type="button" disabled={exporting || underMarkedHistoricalReport} onClick={() => void downloadDraft("docx")}>Download DOCX draft</button><button className="ghost-button" type="button" disabled={exporting || underMarkedHistoricalReport} onClick={() => void downloadDraft("pdf")}>Download PDF draft</button><button className="primary-button" type="button" disabled={exporting || underMarkedHistoricalReport || (brief.status !== "reviewed" && brief.status !== "published")} onClick={() => void publishBrief("pdf")}>{exporting ? "Preparing…" : "Publish PDF"}</button></>}>
    {underMarkedHistoricalReport ? <section className="decision-principle"><strong>REGENERATION REQUIRED</strong><span>This retained historical report has a legacy, invalid, or non-program source snapshot. It remains visible for audit history but cannot be exported, opened as a durable artifact, or republished until regenerated from the current governed workspace.</span></section> : null}
    <section className="kpi-grid" aria-label="Brief summary"><div className="kpi-card"><span>Lifecycle</span><strong>{displayStatus(brief.status)}</strong><small>Published {dateLabel(brief.publishedAt)}</small></div><div className="kpi-card"><span>Explicit baseline records</span><strong>{brief.snapshot.sourceRows}</strong><small>Linked directly by Change Request effects</small></div><div className="kpi-card"><span>Affected Products</span><strong>{brief.snapshot.products}</strong><small>Across {brief.snapshot.releases} recorded release-context values</small></div><div className="kpi-card"><span>Review attention</span><strong>{brief.snapshot.reviewRows}</strong><small>Explicit records at snapshot time</small></div></section>
    <nav className="detail-tabs" aria-label="Brief views">{(["overview", "snapshot", "text", "history"] as const).map((item) => <button key={item} type="button" className={tab === item ? "tab-button tab-active" : "tab-button"} onClick={() => setTab(item)}>{item === "text" ? "Brief text" : displayStatus(item)}</button>)}</nav>
    {tab === "overview" && <section className="split-layout"><article className="domain-card"><span className="eyebrow">FROZEN REPORT SOURCE</span><h3>{brief.initiativeTitle || "Independent report"}</h3><p>This archive entry displays the body and baseline snapshot frozen when the report was saved. Later Initiative edits do not alter the review source.</p>{initiative ? <p className="entity-meta"><Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>Open the current live Initiative separately</Link></p> : null}<button className="ghost-button" type="button" onClick={() => setTab("text")}>Open frozen text for review</button></article><article className="domain-card"><span className="eyebrow">REPORT CONTROLS</span><h3>Status and notes</h3><label className="modal-field">Status<select disabled={brief.status === "superseded"} value={brief.status} onChange={(event) => void update({ status: event.target.value as BriefStatus }, "Report status updated.")}>{editableStatuses.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></label><p className="entity-meta">A draft can enter Reviewed only after explicit attestation of its frozen text and snapshot in the Brief text view. Published is set only when the server stores and verifies an exact artifact.</p><label className="modal-field">Analyst notes<textarea disabled={brief.status === "superseded"} rows={5} value={notes} onChange={(event) => setNotesDraft(event.target.value)} placeholder="Context for the next reviewer" /></label><button className="primary-button" type="button" disabled={brief.status === "superseded"} onClick={() => void update({ notes }, "Report notes saved.")}>Save notes</button><h4>Durable publications</h4>{brief.publications.length ? <ul>{brief.publications.map((publication) => <li key={publication.id}><a href={`/api/brief-publications?id=${encodeURIComponent(publication.id)}`}>{publication.format.toUpperCase()} · {publication.byteSize.toLocaleString()} bytes</a><small>{publication.contentHash} · {dateLabel(publication.createdAt)}</small></li>)}</ul> : <p className="entity-meta">No server-attested artifact has been stored yet.</p>}<p className="entity-meta">Created {dateLabel(brief.createdAt)} · Updated {dateLabel(brief.updatedAt)}</p></article></section>}
    {tab === "snapshot" && <section className="domain-section"><article className="domain-card"><div className="section-toolbar"><div><span className="eyebrow">DERIVED TECHNICAL SCOPE SNAPSHOT</span><h3>What this one-pager represents</h3></div><span>{brief.snapshot.releaseName}</span></div><p className="entity-meta">This snapshot is frozen when the brief is created. Its technical scope comes from the Initiative’s linked Change Request effects; later baseline imports or edits will not silently change a leadership artifact. Release context may be an effect’s From/To transition or its Change Request delivery target; neither expands scope on its own.</p><p className="entity-meta"><strong>Information status:</strong> {informationStatusSummary}</p><div className="domain-table-wrap"><table><tbody><tr><th>As of</th><td>{dateLabel(brief.snapshot.asOf)}</td></tr><tr><th>Explicitly linked baseline records</th><td>{brief.snapshot.sourceRows}</td></tr><tr><th>Explicitly affected Products</th><td>{brief.snapshot.products}</td></tr><tr><th>Recorded release-context values</th><td>{brief.snapshot.releases}</td></tr><tr><th>Explicit records needing review</th><td>{brief.snapshot.reviewRows}</td></tr></tbody></table></div><h4>Explicitly affected Products</h4><p>{brief.snapshot.productNames.length ? brief.snapshot.productNames.join(" · ") : "No Product is explicitly affected by the linked Change Requests."}</p><h4>Linked supporting records</h4>{brief.snapshot.linkedRecords.length ? <ul>{brief.snapshot.linkedRecords.map((record) => <li key={`${record.type}-${record.title}`}>{displayStatus(record.type)}: {record.title} ({displayStatus(record.status)} · {informationOriginLabel(record.informationOrigin)}{record.adjudicationAuthority ? ` · Decision authority: ${record.adjudicationAuthority}` : ""})</li>)}</ul> : <p>No MCPs, technical calls, decisions, or risks were linked at snapshot time.</p>}</article></section>}
    {tab === "text" && <section className="domain-section"><article className="domain-card"><div className="section-toolbar"><div><span className="eyebrow">FROZEN LEADERSHIP CONTENT</span><h3>Generated one-pager text</h3></div><span>{underMarkedHistoricalReport ? "Historical · regeneration required" : brief.status === "draft" ? "Awaiting frozen-source review" : "Export-ready"}</span></div><textarea className="review-note" style={{ minHeight: 440 }} value={brief.bodyMarkdown} readOnly />{brief.status === "draft" ? <div className="decision-principle"><label><input type="checkbox" checked={reviewConfirmed} disabled={underMarkedHistoricalReport || exporting} onChange={(event) => setReviewConfirmed(event.target.checked)} /> {REVIEW_ATTESTATION}</label><button className="primary-button" type="button" disabled={underMarkedHistoricalReport || exporting || !reviewConfirmed} onClick={() => void reviewFrozenBrief()}>{exporting ? "Recording review…" : "Attest and mark Reviewed"}</button></div> : null}<p className="entity-actions"><button className="ghost-button" type="button" disabled={exporting || underMarkedHistoricalReport} onClick={() => void downloadDraft("markdown")}>Download Markdown draft</button><button className="ghost-button" type="button" disabled={exporting || underMarkedHistoricalReport} onClick={() => void downloadDraft("docx")}>Download DOCX draft</button><button className="ghost-button" type="button" disabled={exporting || underMarkedHistoricalReport} onClick={() => void downloadDraft("pdf")}>Download PDF draft</button><button className="primary-button" type="button" disabled={exporting || underMarkedHistoricalReport || (brief.status !== "reviewed" && brief.status !== "published")} onClick={() => void publishBrief("docx")}>Publish DOCX</button><button className="primary-button" type="button" disabled={exporting || underMarkedHistoricalReport || (brief.status !== "reviewed" && brief.status !== "published")} onClick={() => void publishBrief("pdf")}>Publish PDF</button></p></article></section>}
    {tab === "history" ? <AuditHistoryPanel kind="executive_brief" id={brief.id} label={brief.title} /> : null}
    {notice && <div className="toast" role="status">✓ {notice}</div>}
  </DomainPageShell>;
}
