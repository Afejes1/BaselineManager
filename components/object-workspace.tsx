"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "./app-link";
import { useGovernancePortfolio } from "../lib/governance-client";
import { displayStatus, governanceRecordStatuses, type GovernanceEntityKind, type GovernanceRecordStatus, type ObjectCatalogItem } from "../lib/governance-model";
import { ViewportModal } from "./viewport-modal";

export type ObjectContext = { kind: GovernanceEntityKind; id: string; label: string };
export type ObjectTab = { id: string; label: string; count?: number };

export function ObjectTabBar({ tabs, active, onChange, label = "Object views" }: { tabs: ObjectTab[]; active: string; onChange: (id: string) => void; label?: string }) {
  return <nav className="detail-tabs object-tabs" aria-label={label}>{tabs.map((tab) => <button type="button" key={tab.id} className={active === tab.id ? "active" : ""} onClick={() => onChange(tab.id)}>{tab.label}{tab.count !== undefined ? <span>{tab.count}</span> : null}</button>)}</nav>;
}

const today = () => new Date().toISOString().slice(0, 10);

function CallNoteDialog({ context, onDismiss }: { context?: ObjectContext; onDismiss: () => void }) {
  const governance = useGovernancePortfolio();
  const currentKey = context ? `${context.kind}|${context.id}` : "";
  const [catalog, setCatalog] = useState<ObjectCatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>(currentKey ? [currentKey] : []);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState({ title: `Architecture call — ${today()}`, occurredAt: today(), externalReference: "", owner: "", participants: "", summary: "", decisionAsk: "", actionItems: "", dueDate: "", impact: "", status: "open" as GovernanceRecordStatus });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/governance/catalog", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { items?: ObjectCatalogItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Object catalog unavailable.");
      if (!cancelled) setCatalog(payload.items || []);
    }).catch((reason) => { if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : "Object catalog unavailable."); });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return catalog
      .filter((item) => `${item.kind}|${item.id}` !== currentKey)
      .filter((item) => !normalized || `${item.label} ${item.detail} ${item.kind}`.toLowerCase().includes(normalized))
      .slice(0, 80);
  }, [catalog, currentKey, search]);

  function toggle(item: ObjectCatalogItem) {
    const key = `${item.kind}|${item.id}`;
    setSelected((current) => current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]);
  }

  async function save() {
    if (!draft.title.trim() || !draft.summary.trim()) { setNotice("Title and discussion summary are required."); return; }
    setSaving(true); setNotice("");
    try {
      const selectedKeys = currentKey ? [...new Set([currentKey, ...selected])] : selected;
      const links = selectedKeys.map((key) => { const split = key.indexOf("|"); return { kind: key.slice(0, split), id: key.slice(split + 1), relationship: "discusses" }; });
      await governance.mutate("create_governance_record", { recordType: "technical_call", ...draft, links });
      onDismiss();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Call note could not be saved.");
    } finally { setSaving(false); }
  }

  return <ViewportModal onDismiss={onDismiss} dismissDisabled={saving} labelledBy="call-note-title" className="call-note-modal">
    <span className="eyebrow">ARCHITECT CALL RECORD</span><h2 id="call-note-title">Record architecture call</h2>
    <p>Capture what was stated, what requires action, and every object discussed. Links are hard references and appear on each object page.</p>
    <div className="form-grid"><label className="modal-field">Call date<input type="date" value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} /></label><label className="modal-field">Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as GovernanceRecordStatus })}>{governanceRecordStatuses.map((item) => <option key={item} value={item}>{displayStatus(item)}</option>)}</select></label><label className="modal-field">Call / meeting reference<input value={draft.externalReference} onChange={(event) => setDraft({ ...draft, externalReference: event.target.value })} placeholder="Calendar title, call number, or source reference" /></label><label className="modal-field">Note owner<input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} placeholder="Analyst or office" /></label></div>
    <label className="modal-field">Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
    <label className="modal-field">Participants<input value={draft.participants} onChange={(event) => setDraft({ ...draft, participants: event.target.value })} placeholder="Names, offices, or organizations" /></label>
    <label className="modal-field">Discussion summary<textarea rows={4} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} placeholder="Facts reported, positions stated, and unresolved points" /></label>
    <div className="form-grid"><label className="modal-field">Decision or clarification required<textarea rows={3} value={draft.decisionAsk} onChange={(event) => setDraft({ ...draft, decisionAsk: event.target.value })} /></label><label className="modal-field">Action items<textarea rows={3} value={draft.actionItems} onChange={(event) => setDraft({ ...draft, actionItems: event.target.value })} /></label><label className="modal-field">Follow-up due<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label><label className="modal-field">Baseline / delivery impact<input value={draft.impact} onChange={(event) => setDraft({ ...draft, impact: event.target.value })} /></label></div>
    <section className="object-link-picker"><div className="section-toolbar"><div><span className="eyebrow">HARD LINKS</span><h3>Objects discussed</h3></div><span>{selected.length} linked</span></div>{context ? <div className="locked-object-link"><strong>Current page · linked automatically</strong><span>{context.label}</span></div> : null}<label className="search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find product, MCP, Objective, Platform, release, Initiative, or WBS package" /></label>{catalogError ? <p className="error-copy">{catalogError}</p> : null}<div className="object-link-results">{visible.map((item) => { const key = `${item.kind}|${item.id}`; return <label key={key} className={selected.includes(key) ? "selected" : ""}><input aria-label={`Link ${item.label}`} type="checkbox" checked={selected.includes(key)} onChange={() => toggle(item)} /><span><strong>{item.label}</strong><small>{displayStatus(item.kind)} · {item.detail}</small></span></label>; })}</div></section>
    {notice ? <p className="error-copy" role="alert">{notice}</p> : null}
    <footer><button className="ghost-button" type="button" disabled={saving} onClick={onDismiss}>Cancel</button><button className="primary-button" type="button" disabled={saving || governance.loading} onClick={() => void save()}>{saving ? "Saving…" : "Save call record"}</button></footer>
  </ViewportModal>;
}

export function CallNoteControl({ context, compact = false }: { context?: ObjectContext; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button className={compact ? "mini-action" : "ghost-button"} type="button" onClick={() => setOpen(true)}>Record call note</button>{open ? <CallNoteDialog context={context} onDismiss={() => setOpen(false)} /> : null}</>;
}

export function ObjectRecordsPanel({ context }: { context: ObjectContext }) {
  const { portfolio, loading, error } = useGovernancePortfolio();
  const records = useMemo(() => (portfolio?.records || []).filter((record) => record.links.some((link) => link.entityKind === context.kind && link.entityId === context.id)), [context.id, context.kind, portfolio?.records]);
  if (loading) return <section className="domain-section"><p className="empty">Loading linked call notes and evidence…</p></section>;
  if (error) return <section className="domain-section"><p className="error-copy">{error}</p></section>;
  return <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">CALLS & EVIDENCE</span><h3>Records linked to {context.label}</h3></div><div className="entity-actions"><CallNoteControl context={context} compact /><Link className="mini-action" href="/evidence">Open register</Link></div></div><div className="object-record-list">{records.map((record) => <article className="object-record-card" key={record.id}><header><span className="record-type">{displayStatus(record.recordType)}</span><span className={`status-pill status-${record.status}`}>{displayStatus(record.status)}</span></header><h3>{record.title}</h3><p className="entity-meta">{record.occurredAt || record.createdAt.slice(0, 10)} · {record.owner || "Owner unassigned"}{record.participants ? ` · Participants: ${record.participants}` : ""}</p><p>{record.summary || "No discussion summary recorded."}</p>{record.decisionAsk ? <p><strong>Decision / clarification:</strong> {record.decisionAsk}</p> : null}{record.actionItems ? <p><strong>Action items:</strong> {record.actionItems}{record.dueDate ? ` · Due ${record.dueDate}` : ""}</p> : null}<div className="chip-list">{record.links.filter((link) => !(link.entityKind === context.kind && link.entityId === context.id)).map((link) => { const content = <><strong>{displayStatus(link.entityKind)}</strong><span>{link.displayLabel || link.entityId}</span></>; return link.href ? <Link className="domain-chip" key={link.id} href={link.href}>{content}</Link> : <span className="domain-chip" key={link.id}>{content}</span>; })}</div></article>)}{!records.length ? <article className="domain-card empty-state"><h3>No call notes or evidence linked</h3><p>Record the next architecture call from this page. The current object will be linked automatically.</p><CallNoteControl context={context} /></article> : null}</div></section>;
}
