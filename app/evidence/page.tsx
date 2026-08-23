"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DomainPageShell } from "../../components/domain-shell";
import Link from "../../components/app-link";
import { useGovernancePortfolio } from "../../lib/governance-client";
import { useWorkspaceContext } from "../../components/workspace-context";
import { displayStatus, governanceRecordStatuses, governanceRecordTypes, type GovernanceRecordStatus, type GovernanceRecordType } from "../../lib/governance-model";
import { EvidenceRecordEditor } from "../../components/evidence-record-editor";

export default function EvidencePage() {
  const searchParams = useSearchParams();
  const { portfolio, loading, error, mutate, reload } = useGovernancePortfolio();
  const { rows } = useWorkspaceContext();
  const [showCreate, setShowCreate] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [recordType, setRecordType] = useState<GovernanceRecordType>("technical_call");
  const [status, setStatus] = useState<GovernanceRecordStatus>("open");
  const [title, setTitle] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [owner, setOwner] = useState("");
  const [participants, setParticipants] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [summary, setSummary] = useState("");
  const [decisionAsk, setDecisionAsk] = useState("");
  const [actionItems, setActionItems] = useState("");
  const [impact, setImpact] = useState("");
  const [initiativeId, setInitiativeId] = useState(() => searchParams.get("initiative") || "");
  const [baselineAnchor, setBaselineAnchor] = useState(() => {
    const occurrenceId = searchParams.get("occurrenceId"); const configurationNodeId = searchParams.get("configurationNodeId"); const productId = searchParams.get("productId"); const releaseId = searchParams.get("releaseId");
    return occurrenceId ? `occurrence|${occurrenceId}` : configurationNodeId ? `configuration_node|${configurationNodeId}` : productId ? `product|${productId}` : releaseId ? `release|${releaseId}` : "";
  });
  const [file, setFile] = useState<File | null>(null);
  const selectedRecordId = searchParams.get("record") || "";
  const records = useMemo(() => { const rawRecords = portfolio?.records ?? []; return selectedRecordId ? [...rawRecords].sort((left, right) => Number(right.id === selectedRecordId) - Number(left.id === selectedRecordId)) : rawRecords; }, [portfolio?.records, selectedRecordId]);
  const initiatives = portfolio?.initiatives ?? [];

  const baselineOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const row of rows) {
      const release = String(row.ReleaseName || "").trim() || "Unassigned";
      if (row.__meta.releaseId) values.set(`release|${row.__meta.releaseId}`, `Release · ${release}`);
      if (row.__meta.productId) values.set(`product|${row.__meta.productId}`, `Product · ${String(row.LongName || row.ShortName || "Unassigned")}`);
      if (row.__meta.configurationNodeId) values.set(`configuration_node|${row.__meta.configurationNodeId}`, `Configuration · ${[row.Tier, row.Resource, row.HW_Host].filter(Boolean).join(" / ") || "Unassigned"}`);
      if (row.__meta.occurrenceId) values.set(`occurrence|${row.__meta.occurrenceId}`, `Baseline record · ${release} / ${String(row.LongName || row.ShortName || row["#"] || "Unassigned")}`);
    }
    return [...values.entries()].map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label));
  }, [rows]);

  function openCreate() {
    setRecordType("technical_call"); setStatus("open"); setTitle(""); setExternalReference(""); setOwner(""); setParticipants(""); setOccurredAt(""); setDueDate(""); setSummary(""); setDecisionAsk(""); setActionItems(""); setImpact(""); setFile(null); setShowCreate(true);
  }
  async function createRecord() {
    if (!title.trim()) { setNotice("Enter a record title."); return; }
    setSaving(true);
    try {
      const links: Array<{ kind: string; id: string; relationship: string }> = [];
      if (initiativeId) links.push({ kind: "initiative", id: initiativeId, relationship: "supports" });
      const [kind, id] = baselineAnchor.split("|");
      if (id && ["release", "product", "configuration_node", "occurrence"].includes(kind)) links.push({ kind, id, relationship: "affects" });
      const created = await mutate("create_governance_record", { recordType, status, title, externalReference, owner, participants, occurredAt, dueDate, summary, decisionAsk, actionItems, impact, links });
      if (file && created.id) {
        const data = new FormData(); data.set("file", file); data.set("governanceRecordId", String(created.id)); data.set("initiativeId", initiativeId);
        const response = await fetch("/api/documents", { method: "POST", body: data });
        if (!response.ok) {
          const payload = await response.json() as { error?: string };
          setShowCreate(false);
          await reload();
          throw new Error(`The record was saved without its file. Open “Edit record” to retry the attachment. ${payload.error || "The file could not be attached."}`);
        }
      }
      await reload();
      setShowCreate(false); setNotice("Supporting record saved to the evidence register.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "The supporting record could not be saved."); }
    finally { setSaving(false); }
  }
  async function updateStatus(recordId: string, nextStatus: string) {
    try { await mutate("update_governance_record", { recordId, status: nextStatus }); setNotice("Record status updated."); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "The record could not be updated."); }
  }

  return <DomainPageShell title="Evidence & Traceability" subtitle="Technical calls, decisions, risks, questions, and supporting files linked to governed records." releaseScope={portfolio ? `${portfolio.actor.displayName} · ${displayStatus(portfolio.actor.role)}` : "Loading records"} contextMode="portfolio" actions={<button className="primary-button" type="button" onClick={openCreate}>＋ New record</button>}>
    <section className="kpi-grid" aria-label="Evidence summary"><div className="kpi-card"><span>Supporting records</span><strong>{records.length}</strong><small>Calls, decisions, risks, and notes</small></div><div className="kpi-card"><span>Open</span><strong>{records.filter((record) => record.status === "open").length}</strong><small>Needs action</small></div><div className="kpi-card"><span>Technical calls</span><strong>{records.filter((record) => record.recordType === "technical_call").length}</strong><small>Recorded technical discussions</small></div><div className="kpi-card"><span>Evidence files</span><strong>{records.reduce((total, record) => total + record.documents.length, 0)}</strong><small>Attached files</small></div></section>
    {loading && <section className="domain-section"><p className="empty">Loading change and evidence records…</p></section>}
    {error && <section className="domain-section"><p className="error-copy">{error}</p></section>}
    {!loading && !error && <section className="domain-list">{records.length ? records.map((record) => <article className="domain-card" key={record.id}><div className="section-toolbar"><div><span className="record-type">{displayStatus(record.recordType)}</span><h3>{record.title}</h3></div><div className="entity-actions"><button className="ghost-button" type="button" onClick={() => setEditingRecordId(record.id)}>Edit record</button><select aria-label={`Status for ${record.title}`} value={record.status} onChange={(event) => void updateStatus(record.id, event.target.value)}>{governanceRecordStatuses.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select></div></div><p className="entity-meta">{record.externalReference || "No external reference"} · Owner: {record.owner || "Unassigned"} · Due: {record.dueDate || "Not set"}</p><p>{record.summary || "No summary recorded."}</p>{record.decisionAsk && <p><strong>Decision ask:</strong> {record.decisionAsk}</p>}{record.impact && <p><strong>Baseline impact:</strong> {record.impact}</p>}<div className="traceability-links" aria-label="Hard links">{record.links.length ? record.links.map((link) => { const content = <><strong>{displayStatus(link.entityKind)}</strong><span>{link.displayLabel || link.entityId}</span><small>{displayStatus(link.relationship)}</small></>; return link.href ? <Link className="domain-chip" key={link.id} href={link.href}>{content}</Link> : <span className="domain-chip" key={link.id}>{content}</span>; }) : <p className="entity-meta">No traceability links</p>}</div>{record.documents.length ? <p className="attachment-list">{record.documents.map((document) => <a key={document.id} href={`/api/documents?id=${encodeURIComponent(document.id)}`}>↓ {document.fileName}</a>)}</p> : <p className="entity-meta">No attached evidence files.</p>}</article>) : <article className="domain-card empty-state"><h3>No supporting records yet</h3><p>Start with a technical call, decision, risk, question, or analyst note. Link it to a Change Request, Initiative, or baseline object and attach supporting evidence.</p><button className="primary-button" type="button" onClick={openCreate}>Create record</button></article>}</section>}
    {!loading && !error && <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">ACTIVITY LOG</span><h3>Recent activity</h3></div><span>{portfolio?.actor.role === "steward" ? "Analyst view" : "Shared workspace"}</span></div><div className="domain-table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Activity</th><th>Record</th></tr></thead><tbody>{portfolio?.activity.map((event) => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString()}</td><td>{event.actorName}</td><td>{displayStatus(event.action)}</td><td>{displayStatus(event.entityKind)}</td></tr>)}{!portfolio?.activity.length && <tr><td colSpan={4} className="empty">Activity appears here when records are created or updated.</td></tr>}</tbody></table></div></section>}
    {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="record-create-title"><span className="eyebrow">SUPPORTING EVIDENCE</span><h2 id="record-create-title">Create change or evidence record</h2><p>Record an LM artifact, Government artifact, technical call, contractor assessment, risk, question, or note. Link it to the current working baseline.</p><div className="form-grid"><label className="modal-field">Record type<select value={recordType} onChange={(event) => setRecordType(event.target.value as GovernanceRecordType)}>{governanceRecordTypes.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select></label><label className="modal-field">Status<select value={status} onChange={(event) => setStatus(event.target.value as GovernanceRecordStatus)}>{governanceRecordStatuses.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select></label><label className="modal-field">External reference<input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} placeholder="e.g., MCP-2026-014" /></label><label className="modal-field">Owner<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Office or technical lead" /></label><label className="modal-field">Occurred<input type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label><label className="modal-field">Response due<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div><label className="modal-field">Record title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Short, decision-useful title" /></label><div className="form-grid"><label className="modal-field">Linked initiative<select value={initiativeId} onChange={(event) => setInitiativeId(event.target.value)}><option value="">No initiative link yet</option>{initiatives.map((initiative) => <option key={initiative.id} value={initiative.id}>{initiative.title}</option>)}</select></label><label className="modal-field">Baseline traceability<select value={baselineAnchor} onChange={(event) => setBaselineAnchor(event.target.value)}><option value="">No release/product/configuration link yet</option>{baselineOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Link the record to a release change or baseline record.</small></label></div><label className="modal-field">Summary<textarea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What was reported, discussed, or decided?" /></label><label className="modal-field">Decision ask<textarea rows={2} value={decisionAsk} onChange={(event) => setDecisionAsk(event.target.value)} placeholder="Specific direction needed, if any" /></label><label className="modal-field">Baseline impact<textarea rows={2} value={impact} onChange={(event) => setImpact(event.target.value)} placeholder="Affected release, product, configuration, or data concern" /></label><label className="modal-field">Supporting file (optional)<input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /><small>The file is stored outside the A2O XLSX export and linked to the selected record.</small></label><footer><button className="ghost-button" type="button" disabled={saving} onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-button" type="button" disabled={saving} onClick={() => void createRecord()}>{saving ? "Saving…" : "Save record"}</button></footer></section></div>}
    {editingRecordId && records.find((record) => record.id === editingRecordId) ? <EvidenceRecordEditor record={records.find((record) => record.id === editingRecordId)!} mutate={mutate} reload={reload} onDismiss={() => setEditingRecordId("")} /> : null}
    {notice && <div className="toast" role="status">✓ {notice}</div>}
  </DomainPageShell>;
}
