"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "../../../components/app-link";
import { DomainPageShell } from "../../../components/domain-shell";
import { useBaselineWorkspace } from "../../../lib/baseline-client";
import { useGovernancePortfolio } from "../../../lib/governance-client";
import { displayStatus, workPackageStatuses, type WorkPackageStatus } from "../../../lib/governance-model";

type Tab = "overview" | "wbs" | "scope" | "records";

function dateLabel(value: string | null) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export default function InitiativeDetailPage() {
  const params = useParams<{ initiative?: string }>();
  const initiativeId = decodeURIComponent(params.initiative ?? "");
  const { rows } = useBaselineWorkspace();
  const { portfolio, loading, error, mutate } = useGovernancePortfolio();
  const [tab, setTab] = useState<Tab>("overview");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [wbsCode, setWbsCode] = useState("");
  const [workStatus, setWorkStatus] = useState<WorkPackageStatus>("planned");
  const [workNotes, setWorkNotes] = useState("");

  const initiative = portfolio?.initiatives.find((item) => item.id === initiativeId) ?? null;
  const linkedRecords = useMemo(() => portfolio?.records.filter((record) => record.links.some((link) => link.entityKind === "initiative" && link.entityId === initiativeId)) ?? [], [initiativeId, portfolio?.records]);
  const scopedProductIds = useMemo(() => new Set(initiative?.scope.filter((scope) => scope.scopeKind === "product").map((scope) => scope.scopeId) ?? []), [initiative?.scope]);
  const sourceRows = useMemo(() => rows.filter((row) => {
    if (!initiative) return false;
    const releaseMatches = !initiative.primaryReleaseName || String(row.ReleaseName || "").trim() === initiative.primaryReleaseName;
    return releaseMatches && (!scopedProductIds.size || scopedProductIds.has(row.__meta.productId));
  }), [initiative, rows, scopedProductIds]);
  const productLabels = useMemo(() => {
    const output = new Map<string, string>();
    for (const row of sourceRows) if (row.__meta.productId && !output.has(row.__meta.productId)) output.set(row.__meta.productId, String(row.LongName || row.ShortName || "Unassigned product"));
    return output;
  }, [sourceRows]);

  async function updateStatus(status: string) {
    if (!initiative) return;
    try { await mutate("update_initiative", { initiativeId: initiative.id, status }); setNotice("Initiative status updated."); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "The initiative could not be updated."); }
  }

  async function addWorkPackage() {
    if (!initiative || !title.trim()) { setNotice("Enter a work-package title."); return; }
    setSaving(true);
    try {
      await mutate("create_work_package", { initiativeId: initiative.id, title, owner, dueDate, wbsCode, status: workStatus, notes: workNotes });
      setTitle(""); setOwner(""); setDueDate(""); setWbsCode(""); setWorkStatus("planned"); setWorkNotes(""); setNotice("WBS work package added.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "The work package could not be added."); }
    finally { setSaving(false); }
  }

  async function changeWorkStatus(workPackageId: string, status: string) {
    try { await mutate("update_work_package", { workPackageId, status }); setNotice("Work-package status updated."); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "The work package could not be updated."); }
  }

  if (loading) return <DomainPageShell title="Initiative" subtitle="Loading shared Government steering record…" releaseScope="Loading"><section className="domain-section"><p className="empty">Loading durable initiative data…</p></section></DomainPageShell>;
  if (error || !initiative) return <DomainPageShell title="Initiative not found" subtitle={error || "That shared initiative is no longer available."} releaseScope="No linked records" actions={<Link href="/initiatives">Back to initiatives</Link>}><section className="domain-section"><article className="domain-card empty-state"><h3>Choose an initiative from the portfolio</h3><p>The planning workspace now uses shared, durable records rather than this browser’s local data.</p></article></section></DomainPageShell>;

  return <DomainPageShell title={initiative.title} subtitle="Governed outcome, delivery structure, source scope, and Government evidence." releaseScope={`${initiative.primaryReleaseName || "All releases"} · ${sourceRows.length} source rows`} actions={<><select value={initiative.status} aria-label="Initiative status" onChange={(event) => void updateStatus(event.target.value)}><option value="draft">Draft</option><option value="active">Active</option><option value="decision_required">Decision required</option><option value="closed">Closed</option></select><Link href="/initiatives">← Portfolio</Link></>}>
    <section className="kpi-grid" aria-label="Initiative summary">
      <div className="kpi-card"><span>Lifecycle</span><strong>{displayStatus(initiative.status)}</strong><small>{displayStatus(initiative.priority)} priority</small></div>
      <div className="kpi-card"><span>Technical scope</span><strong>{productLabels.size || "All"}</strong><small>{sourceRows.length} retained source rows</small></div>
      <div className="kpi-card"><span>WBS delivery</span><strong>{initiative.workPackages.length}</strong><small>Accountable work packages</small></div>
      <div className="kpi-card"><span>Government evidence</span><strong>{linkedRecords.length}</strong><small>MCPs, calls, decisions, and risks</small></div>
    </section>
    <nav className="detail-tabs" aria-label="Initiative views">{(["overview", "wbs", "scope", "records"] as Tab[]).map((item) => <button key={item} type="button" className={tab === item ? "tab-button tab-active" : "tab-button"} onClick={() => setTab(item)}>{item === "wbs" ? "WBS delivery" : item === "records" ? "Evidence & records" : displayStatus(item)}</button>)}</nav>

    {tab === "overview" && <section className="split-layout"><article className="domain-card"><span className="eyebrow">CONSEQUENCE</span><h3>Why this needs attention</h3><p>{initiative.consequence || "No consequence statement recorded."}</p><span className="eyebrow">DESIRED OUTCOME</span><p>{initiative.desiredOutcome || "No desired outcome recorded."}</p><span className="eyebrow">GOVERNMENT DECISION ASK</span><p>{initiative.decisionAsk || "No decision ask recorded."}</p></article><article className="domain-card"><h3>Accountability</h3><p className="entity-meta">Owner: <strong>{initiative.owner || "Unassigned"}</strong></p><p className="entity-meta">Target date: <strong>{dateLabel(initiative.targetDate)}</strong></p><p className="entity-meta">Last updated: {dateLabel(initiative.updatedAt)}</p><p className="entity-actions"><Link href={`/briefs?initiative=${encodeURIComponent(initiative.id)}`}>Create executive one-pager</Link><Link href={`/evidence?initiative=${encodeURIComponent(initiative.id)}`}>Add MCP, call, or evidence</Link></p></article></section>}

    {tab === "wbs" && <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">WORK BREAKDOWN STRUCTURE</span><h3>Delivery packages</h3></div><span>{initiative.workPackages.length} packages</span></div><div className="domain-table-wrap"><table><thead><tr><th>WBS</th><th>Work package</th><th>Owner</th><th>Due</th><th>Status</th><th>Notes</th></tr></thead><tbody>{initiative.workPackages.map((item) => <tr key={item.id}><td className="mono">{item.wbsCode}</td><td>{item.title}</td><td>{item.owner || "Unassigned"}</td><td>{dateLabel(item.dueDate)}</td><td><select value={item.status} aria-label={`Status for ${item.title}`} onChange={(event) => void changeWorkStatus(item.id, event.target.value)}>{workPackageStatuses.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></td><td>{item.notes || "—"}</td></tr>)}{!initiative.workPackages.length && <tr><td colSpan={6} className="empty">No delivery packages yet. Add the accountable next step below.</td></tr>}</tbody></table></div><article className="domain-card"><div className="section-toolbar"><div><span className="eyebrow">NEW WORK PACKAGE</span><h3>Add a WBS element</h3></div><span>Shared, audit logged</span></div><div className="form-grid"><label className="modal-field">Work package title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g., Validate system interface impact" /></label><label className="modal-field">WBS code<input value={wbsCode} onChange={(event) => setWbsCode(event.target.value)} placeholder="Auto: WP-01" /></label><label className="modal-field">Accountable owner<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Office / team" /></label><label className="modal-field">Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><label className="modal-field">Status<select value={workStatus} onChange={(event) => setWorkStatus(event.target.value as WorkPackageStatus)}>{workPackageStatuses.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></label></div><label className="modal-field">Notes<textarea rows={3} value={workNotes} onChange={(event) => setWorkNotes(event.target.value)} placeholder="Definition of done, dependency, or delivery note" /></label><button className="primary-button" type="button" disabled={saving} onClick={() => void addWorkPackage()}>{saving ? "Adding…" : "Add work package"}</button></article></section>}

    {tab === "scope" && <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">PRODUCT BREAKDOWN STRUCTURE</span><h3>Baseline scope</h3></div><span>{initiative.primaryReleaseName || "All releases"}</span></div><div className="domain-table-wrap"><table><thead><tr><th>Product</th><th>Release</th><th>Source rows</th><th>Configuration samples</th></tr></thead><tbody>{[...productLabels.entries()].map(([productId, label]) => { const productRows = sourceRows.filter((row) => row.__meta.productId === productId); return <tr key={productId}><td><Link href={`/products/${encodeURIComponent(productId)}`}>{label}</Link></td><td>{[...new Set(productRows.map((row) => String(row.ReleaseName || "").trim()).filter(Boolean))].join(", ") || "Unassigned"}</td><td className="mono">{productRows.length}</td><td>{[...new Set(productRows.map((row) => String(row.Resource || row.Tier || "").trim()).filter(Boolean))].slice(0, 3).join(", ") || "Not reported"}</td></tr>; })}{!productLabels.size && <tr><td colSpan={4} className="empty">This initiative has no materialized product scope. It currently covers its selected release as a whole.</td></tr>}</tbody></table></div><p className="entity-actions"><Link href="/pbs">Open PBS Explorer</Link><Link href="/">Return to intake grid</Link></p></section>}

    {tab === "records" && <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">TRACEABILITY</span><h3>Government records and evidence</h3></div><Link href={`/evidence?initiative=${encodeURIComponent(initiative.id)}`}>+ Add record</Link></div>{linkedRecords.length ? <div className="domain-list">{linkedRecords.map((record) => <article className="domain-card" key={record.id}><div className="section-toolbar"><div><span className="record-type">{displayStatus(record.recordType)}</span><h3>{record.title}</h3></div><span className={`status-pill status-${record.status}`}>{displayStatus(record.status)}</span></div><p className="entity-meta">{record.externalReference || "No external reference"} · Owner: {record.owner || "Unassigned"}</p><p>{record.summary || "No summary recorded."}</p><p className="entity-meta">{record.documents.length} attached evidence file(s) · {record.links.length} traceability link(s)</p></article>)}</div> : <article className="domain-card empty-state"><h3>No Government records linked yet</h3><p>Capture the MCP, technical call, decision, risk, or question that substantiates this initiative. Files can be attached to the record.</p><Link href={`/evidence?initiative=${encodeURIComponent(initiative.id)}`}>Create linked record</Link></article>}</section>}
    {notice && <div className="toast" role="status">✓ {notice}</div>}
  </DomainPageShell>;
}
