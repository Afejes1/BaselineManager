"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Link from "../../../components/app-link";
import { CollectionControls, CollectionPager, useCollectionBrowser } from "../../../components/collection-browser";
import { DomainPageShell } from "../../../components/domain-shell";
import { GovernedImportReview } from "../../../components/governed-import-review";
import { importResolutions, type GovernedImportItem, type ImportDecision } from "../../../lib/governed-import";
import { classifyLockheedDailyFile, LOCKHEED_DAILY_SOURCE_SYSTEM, type LockheedDailyDataset, type LockheedDailyFile } from "../../../lib/lockheed-daily-import";

type Preview = { items: GovernedImportItem[]; canApply: boolean };
type HistoryRow = { id: string; adapter_key: string; file_name: string; source_as_of: string; record_count: number; added_count: number; changed_count: number; unchanged_count: number; skipped_count: number; blocked_count: number; applied_at: string };
type SubjectRow = { id: string; dataset_key: LockheedDailyDataset; entity_kind: string; source_key: string; title: string; canonical_entity_kind: string | null; canonical_entity_id: string | null; canonical_title: string | null; canonical_status: string | null; first_seen_at: string; last_seen_at: string; source_as_of: string; disposition: string; normalized_payload: string };
type Observation = { id: string; disposition: string; source_as_of: string; source_updated_at?: string | null; observed_at: string; file_name: string; normalized?: { fields?: Record<string, string>; relations?: Array<{ relationType: string; targetReference: string }> }; deltas: Array<{ field_name: string; before_value: string | null; after_value: string | null }>; relations: Array<{ relation_type: string; target_reference: string }> };

const today = () => new Date().toISOString().slice(0, 10);
const DATASET_LABELS: Record<LockheedDailyDataset, string> = { capes: "CAPES capability planning", jira: "Jira planning work", mcps: "Lockheed MCP/DSOR projection", objectives: "Lockheed Objective projection" };
function canonicalHref(subject: SubjectRow) {
  if (!subject.canonical_entity_id) return "";
  if (subject.canonical_entity_kind === "capability") return `/capabilities/${encodeURIComponent(subject.canonical_entity_id)}`;
  if (subject.canonical_entity_kind === "change_request") return `/changes/${encodeURIComponent(subject.canonical_entity_id)}`;
  if (subject.canonical_entity_kind === "objective") return `/objectives/${encodeURIComponent(subject.canonical_entity_id)}`;
  return "";
}

export default function LockheedDailyIntakePage() {
  const [files, setFiles] = useState<LockheedDailyFile[]>([]);
  const [sourceAsOf, setSourceAsOf] = useState(today());
  const [sourceSystem, setSourceSystem] = useState(LOCKHEED_DAILY_SOURCE_SYSTEM);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<SubjectRow | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadState = useCallback(async () => {
    const response = await fetch("/api/intake/lockheed-daily", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { history?: HistoryRow[]; subjects?: SubjectRow[] };
    setHistory(payload.history || []); setSubjects(payload.subjects || []);
  }, []);
  useEffect(() => { queueMicrotask(() => void loadState()); }, [loadState]);

  const resolutions = useMemo(() => preview ? importResolutions(preview.items, decisions, {}) : [], [decisions, preview]);
  const subjectBrowser = useCollectionBrowser(subjects, (subject) => `${DATASET_LABELS[subject.dataset_key] || subject.dataset_key} ${subject.source_key} ${subject.title} ${subject.source_as_of} ${subject.disposition} ${subject.canonical_title || ""} ${subject.canonical_status || ""}`);

  async function selectFiles(list?: FileList | null) {
    if (!list?.length) return;
    setBusy(true); setMessage(""); setPreview(null); setDecisions({});
    try {
      const parsed: LockheedDailyFile[] = [];
      for (const source of Array.from(list)) {
        const workbook = XLSX.read(await source.arrayBuffer(), { type: "array", raw: false });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error(`${source.name} contains no table.`);
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
        const headerIndex = matrix.findIndex((row) => {
          const values = row.map((value) => String(value || "").trim().toLocaleLowerCase("en-US"));
          return values.includes("key") || values.includes("mcp/dsor") || (values.includes("jira id") && values.includes("summary"));
        });
        if (headerIndex < 0) throw new Error(`${source.name} does not contain a recognized CAPES, Jira, MCP/DSOR, or Objective header row.`);
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { range: headerIndex, defval: "", raw: false });
        if (!rows.length) throw new Error(`${source.name} contains no data rows.`);
        parsed.push({ fileId: crypto.randomUUID(), fileName: source.name, sheetName, dataset: classifyLockheedDailyFile(source.name, Object.keys(rows[0])), rows });
      }
      setFiles(parsed);
      setMessage(`${parsed.length} file${parsed.length === 1 ? "" : "s"} loaded. Verify each dataset classification, then preview.`);
    } catch (error) { setFiles([]); setMessage(error instanceof Error ? error.message : "The source files could not be read."); }
    finally { setBusy(false); }
  }

  function changeDataset(fileId: string, dataset: LockheedDailyDataset) {
    setFiles((current) => current.map((file) => file.fileId === fileId ? { ...file, dataset } : file));
    setPreview(null); setDecisions({});
  }

  async function reconcile(mode: "preview" | "apply") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/intake/lockheed-daily", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, sourceAsOf, sourceSystem, files, resolutions }) });
      const payload = await response.json() as { preview?: Preview; error?: string; duplicate?: boolean; message?: string; applied?: number; skipped?: number; duplicateFiles?: number };
      if (payload.preview) {
        setPreview(payload.preview);
        if (mode === "preview") {
          setDecisions(Object.fromEntries(payload.preview.items.map((item) => [item.id, item.defaultDecision])));
        }
      }
      if (!response.ok) throw new Error(payload.error || "The delivery was not applied.");
      if (mode === "apply") {
        setMessage(payload.duplicate ? payload.message || "This delivery was already applied." : `${payload.applied || 0} source observations retained; ${payload.skipped || 0} rows skipped; ${payload.duplicateFiles || 0} duplicate files ignored.`);
        await loadState();
      } else setMessage("Preview complete. Valid source identities will create or refresh canonical objects automatically. Verify each file, row decision, and proposed field change.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The delivery was not applied."); }
    finally { setBusy(false); }
  }

  async function inspectSubject(subject: SubjectRow) {
    setSelectedSubject(subject); setObservations([]);
    const response = await fetch(`/api/intake/lockheed-daily?subjectId=${encodeURIComponent(subject.id)}`, { cache: "no-store" });
    const payload = await response.json() as { observations?: Observation[]; error?: string };
    if (!response.ok) { setMessage(payload.error || "Source history is unavailable."); return; }
    setObservations(payload.observations || []);
  }

  return <DomainPageShell title="Lockheed Daily Delivery" subtitle="Retain supplier planning observations, materialize canonical records, and compare source changes over time." releaseScope={`${history.length} retained file snapshots`} contextMode="portfolio" actions={<><Link className="ghost-button" href="/intake">Import Hub</Link><Link className="ghost-button" href="/objectives/feed">Objective JSON feed</Link></>}>
    <section className="decision-principle"><strong>Source rule</strong><span>These files are Lockheed-reported observations. Valid identities create or refresh canonical Capabilities, Change Requests, and LM Objectives automatically; source values do not replace Government priority, estimates, or funding decisions. A row missing from a later file is not deleted.</span></section>
    <section className="split-layout"><article className="domain-section"><span className="eyebrow">DAILY DELIVERY</span><h3>Select the delivered files</h3><label className="modal-field">CSV or workbook files<input type="file" multiple accept=".csv,.xlsx,.xls,text/csv" onChange={(event) => void selectFiles(event.target.files)} /></label><div className="form-grid"><label className="modal-field">Source snapshot date<input type="date" value={sourceAsOf} onChange={(event) => { setSourceAsOf(event.target.value); setPreview(null); }} /></label><label className="modal-field">Source system<input value={sourceSystem} onChange={(event) => { setSourceSystem(event.target.value); setPreview(null); }} /></label></div><button className="primary-button" type="button" disabled={!files.length || !sourceAsOf || busy} onClick={() => void reconcile("preview")}>{busy ? "Processing…" : "Preview delivery"}</button></article><article className="domain-section"><span className="eyebrow">CONTROLLED ANALYTICS</span><h3>What the import does</h3><p>Each accepted row becomes an immutable source observation and creates or refreshes the corresponding canonical record from its external identity. Later deliveries are compared field by field. Dates, ROM, budget hours, percent complete, status, release, and dependency changes remain attributable to the source date.</p><p className="entity-meta">Only duplicate or invalid identities require intervention. Supplier values remain source claims and do not overwrite Government analysis.</p></article></section>
    {files.length ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">FILE CLASSIFICATION</span><h3>Verify every selected dataset</h3></div><span>{files.reduce((sum, file) => sum + file.rows.length, 0)} total rows</span></div><div className="domain-table-wrap"><table><thead><tr><th>File</th><th>Detected dataset</th><th>Rows</th><th>Worksheet</th></tr></thead><tbody>{files.map((file) => <tr key={file.fileId}><td><strong>{file.fileName}</strong></td><td><select value={file.dataset} onChange={(event) => changeDataset(file.fileId, event.target.value as LockheedDailyDataset)}>{Object.entries(DATASET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td>{file.rows.length}</td><td>{file.sheetName || "—"}</td></tr>)}</tbody></table></div><p className="entity-meta">Classification is inferred from the filename and headers. Correct it here before preview when an automated export uses an unexpected name.</p></section> : null}
    {message ? <p className={message.toLocaleLowerCase().includes("could not") || message.toLocaleLowerCase().includes("required") ? "error-copy" : "notice-copy"}>{message}</p> : null}
    {preview ? <GovernedImportReview items={preview.items} decisions={decisions} busy={busy} applyLabel="Apply reviewed delivery" onDecision={(id, decision) => setDecisions((current) => ({ ...current, [id]: decision }))} onBulkDecision={(decision) => setDecisions(Object.fromEntries(preview.items.map((item) => [item.id, item.disposition === "blocked" ? "skip" : decision])))} onApply={() => void reconcile("apply")} /> : null}
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">SOURCE SUBJECTS</span><h3>Current supplier projection</h3></div><button className="ghost-button" type="button" onClick={() => void loadState()}>Refresh</button></div><p className="entity-meta">Search the retained supplier subjects before opening their change history. The current view never removes older observations.</p><CollectionControls browser={subjectBrowser} itemLabel="source subjects" placeholder="Filter dataset, source key, title, status, or canonical link" /><div className="review-table-viewport source-subject-viewport"><table><thead><tr><th>Dataset</th><th>Source record</th><th>Latest observation</th><th>Governed trace link</th><th>Action</th></tr></thead><tbody>{subjectBrowser.pageItems.map((subject) => { const normalized = (() => { try { return JSON.parse(subject.normalized_payload || "{}") as { status?: string }; } catch { return {}; } })(); return <tr key={subject.id}><td>{DATASET_LABELS[subject.dataset_key] || subject.dataset_key}</td><td><strong>{subject.source_key}</strong><small>{subject.title}</small></td><td>{subject.source_as_of || subject.last_seen_at}<small><span className={`status-pill status-${subject.disposition || "unchanged"}`}>{subject.disposition || "observed"}</span></small></td><td>{canonicalHref(subject) ? <><Link href={canonicalHref(subject)}>{subject.canonical_title || `Open linked ${subject.canonical_entity_kind?.replace(/_/g, " ")}`}</Link><small>Supplier status: {normalized.status || "not supplied"} · Governed status: {subject.canonical_status || "not supplied"}</small></> : "Not linked"}</td><td><button className="ghost-button compact-button" type="button" onClick={() => void inspectSubject(subject)}>View source history</button></td></tr>; })}{!subjectBrowser.pageItems.length ? <tr><td colSpan={5} className="empty">No source subjects match the current view.</td></tr> : null}</tbody></table></div><CollectionPager browser={subjectBrowser} itemLabel="source subjects" /></section>
    {selectedSubject ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">SOURCE HISTORY</span><h3>{selectedSubject.source_key} · {selectedSubject.title}</h3></div><button className="ghost-button" type="button" onClick={() => { setSelectedSubject(null); setObservations([]); }}>Close history</button></div><p className="entity-meta">Every line below is what Lockheed reported on that source date. Changes are not Government findings until separately assessed.</p><div className="source-history-list">{observations.map((observation) => <article className="domain-card" key={observation.id}><div className="section-toolbar"><div><strong>{observation.source_as_of}</strong><small>{observation.file_name} · received {new Date(observation.observed_at).toLocaleString()}</small></div><span className={`status-pill status-${observation.disposition}`}>{observation.disposition}</span></div>{observation.deltas.length ? <ul className="source-diff-list">{observation.deltas.map((delta) => <li key={delta.field_name}><strong>{delta.field_name}</strong><del>{delta.before_value || "(blank)"}</del><ins>{delta.after_value || "(blank)"}</ins></li>)}</ul> : <p className="entity-meta">No source field changed from the preceding observation.</p>}{observation.relations.length ? <p className="entity-meta">Relationships: {observation.relations.map((relation) => `${relation.relation_type} ${relation.target_reference}`).join(" · ")}</p> : null}</article>)}{!observations.length ? <p className="empty">Loading source history…</p> : null}</div></section> : null}
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">FILE RECEIPTS</span><h3>Applied daily-delivery history</h3></div><span>Exact same file + date is a no-op</span></div><div className="domain-table-wrap"><table><thead><tr><th>Source date</th><th>File</th><th>Dataset</th><th>Results</th><th>Applied</th></tr></thead><tbody>{history.map((run) => <tr key={run.id}><td>{run.source_as_of}</td><td><strong>{run.file_name}</strong></td><td>{run.adapter_key.replace("lockheed_daily_", "").toUpperCase()}</td><td>+{run.added_count} · Δ{run.changed_count} · ={run.unchanged_count}<small>{run.skipped_count} skipped · {run.blocked_count} blocked</small></td><td>{run.applied_at ? new Date(run.applied_at).toLocaleString() : "—"}</td></tr>)}{!history.length ? <tr><td colSpan={5} className="empty">No file receipts have been retained.</td></tr> : null}</tbody></table></div></section>
  </DomainPageShell>;
}
