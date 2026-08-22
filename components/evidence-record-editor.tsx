"use client";

import { useEffect, useMemo, useState } from "react";
import { ViewportModal } from "./viewport-modal";
import { displayStatus, governanceRecordStatuses, governanceRecordTypes, type GovernanceRecord, type GovernanceRecordStatus, type GovernanceRecordType, type ObjectCatalogItem } from "../lib/governance-model";

type Mutate = (action: string, payload: Record<string, unknown>) => Promise<{ error?: string; id?: string }>;

export function EvidenceRecordEditor({ record, mutate, reload, onDismiss }: { record: GovernanceRecord; mutate: Mutate; reload: () => Promise<void>; onDismiss: () => void }) {
  const [draft, setDraft] = useState({ recordType: record.recordType, status: record.status, externalReference: record.externalReference || "", title: record.title, owner: record.owner || "", occurredAt: record.occurredAt || "", participants: record.participants || "", dueDate: record.dueDate || "", summary: record.summary || "", decisionAsk: record.decisionAsk || "", actionItems: record.actionItems || "", impact: record.impact || "" });
  const [catalog, setCatalog] = useState<ObjectCatalogItem[]>([]);
  const [selected, setSelected] = useState(() => record.links.map((link) => `${link.entityKind}|${link.entityId}`));
  const [search, setSearch] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [removeDocument, setRemoveDocument] = useState({ id: "", rationale: "" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/governance/catalog", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { items?: ObjectCatalogItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Object catalog unavailable.");
      if (!cancelled) setCatalog(payload.items || []);
    }).catch((reason) => { if (!cancelled) setNotice(reason instanceof Error ? reason.message : "Object catalog unavailable."); });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return catalog.filter((item) => !query || `${item.label} ${item.detail} ${item.kind}`.toLowerCase().includes(query)).slice(0, 100);
  }, [catalog, search]);

  function toggle(item: ObjectCatalogItem) {
    const key = `${item.kind}|${item.id}`;
    setSelected((current) => current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]);
  }

  async function save() {
    if (!draft.title.trim()) { setNotice("Record title is required."); return; }
    setSaving(true); setNotice("");
    try {
      const links = selected.map((key) => { const split = key.indexOf("|"); return { kind: key.slice(0, split), id: key.slice(split + 1), relationship: "discusses" }; });
      await mutate("update_governance_record", { recordId: record.id, ...draft, links });
      if (file) {
        const data = new FormData(); data.set("file", file); data.set("governanceRecordId", record.id);
        const response = await fetch("/api/documents", { method: "POST", body: data });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Record saved; file attachment failed.");
        await reload();
      }
      onDismiss();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "The evidence record could not be saved."); }
    finally { setSaving(false); }
  }

  async function removeFile() {
    if (!removeDocument.id || !removeDocument.rationale.trim()) return;
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/documents", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(removeDocument) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Evidence file could not be removed.");
      await reload(); setRemoveDocument({ id: "", rationale: "" }); onDismiss();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Evidence file could not be removed."); }
    finally { setSaving(false); }
  }

  return <ViewportModal onDismiss={onDismiss} dismissDisabled={saving} labelledBy="edit-evidence-title" className="call-note-modal">
    <span className="eyebrow">EVIDENCE RECORD</span><h2 id="edit-evidence-title">Edit governed evidence</h2>
    <p>Update the record and its hard links. Removed links and files remain documented in audit history.</p>
    <div className="form-grid"><label className="modal-field">Record type<select value={draft.recordType} onChange={(event) => setDraft({ ...draft, recordType: event.target.value as GovernanceRecordType })}>{governanceRecordTypes.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select></label><label className="modal-field">Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as GovernanceRecordStatus })}>{governanceRecordStatuses.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select></label><label className="modal-field">External reference<input value={draft.externalReference} onChange={(event) => setDraft({ ...draft, externalReference: event.target.value })} /></label><label className="modal-field">Owner<input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} /></label><label className="modal-field">Occurred<input type="date" value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} /></label><label className="modal-field">Response due<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label></div>
    <label className="modal-field">Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label className="modal-field">Participants<input value={draft.participants} onChange={(event) => setDraft({ ...draft, participants: event.target.value })} /></label><label className="modal-field">Summary<textarea rows={4} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label><div className="form-grid"><label className="modal-field">Decision / clarification required<textarea rows={3} value={draft.decisionAsk} onChange={(event) => setDraft({ ...draft, decisionAsk: event.target.value })} /></label><label className="modal-field">Action items<textarea rows={3} value={draft.actionItems} onChange={(event) => setDraft({ ...draft, actionItems: event.target.value })} /></label><label className="modal-field field-span">Baseline / delivery impact<textarea rows={2} value={draft.impact} onChange={(event) => setDraft({ ...draft, impact: event.target.value })} /></label></div>
    <section className="object-link-picker"><div className="section-toolbar"><div><span className="eyebrow">HARD LINKS</span><h3>Related objects</h3></div><span>{selected.length} linked</span></div><label className="search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find Product, MCP, Objective, Platform, server, VM, installation, or connection" /></label><div className="object-link-results">{visible.map((item) => { const key = `${item.kind}|${item.id}`; return <label key={key} className={selected.includes(key) ? "selected" : ""}><input aria-label={`Link ${item.label}`} type="checkbox" checked={selected.includes(key)} onChange={() => toggle(item)} /><span><strong>{item.label}</strong><small>{displayStatus(item.kind)} · {item.detail}</small></span></label>; })}</div></section>
    <label className="modal-field">Attach another file<input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
    {record.documents.length ? <section className="evidence-file-editor"><span className="eyebrow">ATTACHED FILES</span>{record.documents.map((document) => <div key={document.id}><a href={`/api/documents?id=${encodeURIComponent(document.id)}`}>{document.fileName}</a><button className="text-action danger-text" type="button" onClick={() => setRemoveDocument({ id: document.id, rationale: "" })}>Remove</button></div>)}{removeDocument.id ? <div className="lifecycle-field"><label className="modal-field">Removal rationale<input value={removeDocument.rationale} onChange={(event) => setRemoveDocument({ ...removeDocument, rationale: event.target.value })} /></label><button className="danger-button" disabled={saving || !removeDocument.rationale.trim()} onClick={() => void removeFile()}>Confirm removal</button></div> : null}</section> : null}
    {notice ? <p className="error-copy" role="alert">{notice}</p> : null}<footer><button className="ghost-button" type="button" disabled={saving} onClick={onDismiss}>Cancel</button><button className="primary-button" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save evidence record"}</button></footer>
  </ViewportModal>;
}
