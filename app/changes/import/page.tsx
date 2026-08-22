"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Link from "../../../components/app-link";
import { DomainPageShell } from "../../../components/domain-shell";
import { GovernedImportReview } from "../../../components/governed-import-review";
import {
  CHANGE_REQUEST_IMPORT_COLUMNS,
  CONFLUENCE_CHANGE_SOURCE_SYSTEM,
  inferChangeRequestImportMapping,
  type ChangeRequestImportColumn,
  type ChangeRequestImportMapping,
} from "../../../lib/change-import";
import { importResolutions, type GovernedImportItem, type ImportDecision } from "../../../lib/governed-import";

type Preview = { items: GovernedImportItem[]; canApply: boolean };
type HistoryRow = { id: string; source_system: string; file_name: string; sheet_name?: string | null; source_as_of?: string | null; status: string; record_count: number; added_count: number; changed_count: number; unchanged_count: number; skipped_count: number; blocked_count: number; applied_at?: string | null };

const today = () => new Date().toISOString().slice(0, 10);

export default function ChangeRequestImportPage() {
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<ChangeRequestImportMapping>(() => inferChangeRequestImportMapping([]));
  const [sourceSystem, setSourceSystem] = useState(CONFLUENCE_CHANGE_SOURCE_SYSTEM);
  const [sourceAsOf, setSourceAsOf] = useState(today());
  const [sourceLocator, setSourceLocator] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadHistory = useCallback(async () => {
    const response = await fetch("/api/changes/import", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { history?: HistoryRow[] };
    setHistory(payload.history || []);
  }, []);
  useEffect(() => { queueMicrotask(() => void loadHistory()); }, [loadHistory]);

  // An MCP/DSOR/JPO column is preferred.  A row-specific Confluence URL is a
  // valid fallback identity when the delivered dashboard omits one.  Title,
  // Requested Release, and the other source attributes are deliberately
  // optional; the import must not require analysts to manufacture values.
  const requiredMappingReady = Boolean((mapping.ExternalIdentifier || mapping.SourceLocator) && sourceSystem.trim() && sourceAsOf);
  const resolutions = useMemo(() => preview ? importResolutions(preview.items, decisions, {}) : [], [decisions, preview]);

  async function chooseFile(file?: File) {
    if (!file) return;
    setMessage(""); setPreview(null); setDecisions({}); setFileName(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
      const first = workbook.SheetNames[0];
      if (!first) throw new Error("The file contains no worksheet or CSV table.");
      const values = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[first], { defval: "", raw: false });
      if (!values.length) throw new Error("The selected file contains no Change Request rows.");
      const discovered = Object.keys(values[0]);
      setSheetName(first); setHeaders(discovered); setRawRows(values); setMapping(inferChangeRequestImportMapping(discovered));
      setMessage(`${values.length} rows parsed. Verify the source-column mapping before preview.`);
    } catch (cause) {
      setHeaders([]); setRawRows([]); setMessage(cause instanceof Error ? cause.message : "The source file could not be read.");
    }
  }

  async function call(mode: "preview" | "apply") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/changes/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, adapterKey: "confluence_change_csv", fileName, sheetName, sourceSystem, sourceLocator, sourceAsOf, mapping, rawRows, resolutions }) });
      const payload = await response.json() as { preview?: Preview; error?: string; duplicate?: boolean; message?: string; applied?: number; skipped?: number };
      if (payload.preview) {
        setPreview(payload.preview);
        if (mode === "preview") {
          setDecisions(Object.fromEntries(payload.preview.items.map((item) => [item.id, item.defaultDecision])));
        }
      }
      if (!response.ok) throw new Error(payload.error || "The source file was not applied.");
      if (mode === "apply") {
        setMessage(payload.duplicate ? payload.message || "This exact source snapshot was already applied. No records were changed." : `${payload.applied || 0} approved records applied; ${payload.skipped || 0} rows skipped. Government analysis was retained.`);
        await loadHistory();
      } else setMessage("Preview complete. Valid external identifiers will create or refresh canonical Change Requests automatically. Review the proposed field changes before applying.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The source file was not applied."); }
    finally { setBusy(false); }
  }

  function setMappingField(field: ChangeRequestImportColumn, header: string) {
    setMapping((current) => ({ ...current, [field]: header })); setPreview(null); setDecisions({});
  }

  function bulkDecision(decision: ImportDecision) {
    if (!preview) return;
    setDecisions(Object.fromEntries(preview.items.map((item) => [item.id, item.disposition === "blocked" ? "skip" : decision])));
  }

  return <DomainPageShell title="Change Request Source Import" subtitle="Stage, review, and apply the Confluence DSOR/MCP export without overwriting Government analysis." actions={<><Link className="ghost-button" href="/intake">Import Hub</Link><Link className="ghost-button" href="/changes">Return to Change Requests</Link></>}>
    <section className="decision-principle"><strong>Controlled merge</strong><span>Valid MCP/DSOR identifiers create or refresh canonical Change Requests automatically. The source file retains its receipt and field changes; Government analysis and decisions remain separate. Review is needed only to approve, skip, or correct an invalid or duplicate source identity.</span></section>
    <section className="split-layout"><article className="domain-section"><span className="eyebrow">CONFLUENCE EXPORT</span><h3>Select the generated CSV or workbook</h3><label className="modal-field">Source file<input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(event) => void chooseFile(event.target.files?.[0])} /></label><div className="form-grid"><label className="modal-field">Source snapshot date<input type="date" value={sourceAsOf} onChange={(event) => { setSourceAsOf(event.target.value); setPreview(null); }} /></label><label className="modal-field">Source system<input value={sourceSystem} onChange={(event) => { setSourceSystem(event.target.value); setPreview(null); }} /></label></div><label className="modal-field">Export or Confluence locator<input value={sourceLocator} onChange={(event) => setSourceLocator(event.target.value)} placeholder="Optional export job, Confluence page, or script reference" /></label>{fileName ? <p className="entity-meta">{fileName} · {sheetName} · {rawRows.length} source rows · {headers.length} columns</p> : null}<button className="primary-button" disabled={!rawRows.length || !requiredMappingReady || busy} onClick={() => void call("preview")}>{busy ? "Processing…" : "Preview reconciliation"}</button></article><article className="domain-section"><span className="eyebrow">MERGE AUTHORITY</span><h3>Fields controlled by this import</h3><p>External identity, title, source status, source owner, source locator, source date, request type, and requested Release may be refreshed.</p><p className="entity-meta">Government priority, fund/defer/decline decisions, consequences, affected objects, dependencies, Objectives, requirements, acceptance, and WBS records are never overwritten.</p></article></section>

    {headers.length ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">COLUMN MAPPING</span><h3>Verify how the source columns map to canonical fields</h3></div><span>Required: MCP/DSOR/JPO or row URL</span></div><div className="import-column-map">{CHANGE_REQUEST_IMPORT_COLUMNS.map((field) => <label className="modal-field" key={field}>{field}{field === "ExternalIdentifier" || field === "SourceLocator" ? <small>Identity source</small> : <small>Optional</small>}<select value={mapping[field]} onChange={(event) => setMappingField(field, event.target.value)}><option value="">{field === "ExternalSystem" || field === "SourceAsOf" ? "Use import-level value" : "Not mapped — optional"}</option>{headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>)}</div><p className="entity-meta">The delivered <span className="mono">jpo_code</span> and <span className="mono">Title_url</span> headers map automatically. Requested Release is optional. If a row has no MCP/DSOR/JPO but has a row-specific Confluence URL, that URL supplies a stable external identity. Unmapped columns remain in the immutable source snapshot and are compared on later imports.</p></section> : null}

    {preview ? <GovernedImportReview items={preview.items} decisions={decisions} busy={busy} applyLabel="Apply approved rows" onDecision={(id, decision) => setDecisions((current) => ({ ...current, [id]: decision }))} onBulkDecision={bulkDecision} onApply={() => void call("apply")} /> : null}

    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">IMPORT HISTORY</span><h3>Applied Confluence source snapshots</h3></div><button className="ghost-button" type="button" onClick={() => void loadHistory()}>Refresh history</button></div><div className="domain-table-wrap"><table><thead><tr><th>Snapshot</th><th>Source</th><th>Result</th><th>Applied</th></tr></thead><tbody>{history.map((run) => <tr key={run.id}><td><strong>{run.file_name}</strong><small>{run.source_as_of || "No source date"}</small></td><td>{run.source_system}<small>{run.record_count} rows</small></td><td>{run.added_count} new · {run.changed_count} changed · {run.unchanged_count} unchanged<small>{run.skipped_count} skipped · {run.blocked_count} blocked</small></td><td>{run.applied_at ? new Date(run.applied_at).toLocaleString() : run.status}</td></tr>)}{!history.length ? <tr><td colSpan={4} className="empty">No Confluence Change Request source snapshot has been applied.</td></tr> : null}</tbody></table></div></section>
    {message ? <p className={/required|could not|failed|invalid|older/i.test(message) ? "toast toast-error" : "toast"}>{message}</p> : null}
  </DomainPageShell>;
}
