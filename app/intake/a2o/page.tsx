"use client";

import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import Link from "../../../components/app-link";
import { DomainPageShell } from "../../../components/domain-shell";
import { GovernedImportReview } from "../../../components/governed-import-review";
import { useWorkspaceContext } from "../../../components/workspace-context";
import { importResolutions, type GovernedImportItem, type ImportDecision } from "../../../lib/governed-import";
import { reconcileIntake } from "../../../lib/import-reconciliation";
import { describeTechnicalBaselineHeaderIssue, diagnoseTechnicalBaselineHeaders, TECHNICAL_BASELINE_COLUMNS, type CellValue, type TechnicalBaselineColumn, type TechnicalBaselineHeaderDiagnostic } from "../../../lib/technical-baseline-contract";
import { releaseOf } from "../../../lib/baseline-scope";

type Record24 = Record<TechnicalBaselineColumn, CellValue>;
type ImportDraft = { fileName: string; sheetName: string; rows: Record24[] };
type HeaderReview = { fileName: string; diagnostic: TechnicalBaselineHeaderDiagnostic; message: string };

const text = (value: unknown) => String(value ?? "").normalize("NFKC").trim();

export default function A2OTechStackImportPage() {
  const { rows: currentRows, loading, error: workspaceError, reload } = useWorkspaceContext();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [headerReview, setHeaderReview] = useState<HeaderReview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const reconciliation = useMemo(() => draft ? reconcileIntake(currentRows, draft.rows) : null, [currentRows, draft]);
  const items = useMemo<GovernedImportItem[]>(() => reconciliation ? reconciliation.rows.map((item) => ({
    id: `a2o-${item.rowNumber}-${item.identity}`,
    rowNumber: item.rowNumber,
    sourceKey: String(item.row["#"] || item.identity),
    title: String(item.row.LongName || item.row.ShortName || item.row.HW_Host || "Unnamed baseline record"),
    detail: String(item.row.ReleaseName || "Release not reported"),
    disposition: item.disposition,
    issues: item.issues,
    changes: item.changes,
    defaultDecision: item.disposition === "blocked" ? "skip" : "approve",
  })) : [], [reconciliation]);
  const resolutions = useMemo(() => importResolutions(items, decisions, {}), [decisions, items]);

  async function readWorkbook(file: File) {
    setBusy(true); setMessage(""); setDraft(null); setHeaderReview(null); setDecisions({});
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error(`${file.name} has no worksheet.`);
      const worksheet = workbook.Sheets[sheetName];
      const cells = XLSX.utils.sheet_to_json<CellValue[]>(worksheet, { header: 1, defval: "", raw: true });
      const headers = (cells[0] ?? []).map(text);
      const diagnostic = diagnoseTechnicalBaselineHeaders(headers);
      if (!diagnostic.valid) {
        setHeaderReview({ fileName: file.name, diagnostic, message: describeTechnicalBaselineHeaderIssue(headers) });
        return;
      }
      const dataLines = cells.slice(1).filter((line) => line.some((cell) => text(cell)));
      if (!dataLines.length) throw new Error(`${file.name} has the required headers but no baseline records.`);
      const imported = dataLines.map((line) => Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column, index) => [column, line[index] ?? ""])) as Record24);
      setDraft({ fileName: file.name, sheetName, rows: imported });
      setMessage(`${imported.length} baseline record${imported.length === 1 ? "" : "s"} loaded from ${sheetName}. Review the proposed changes before applying.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The A2O Tech Stack workbook could not be read.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function applyImport() {
    if (!draft) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/baseline/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, resolutions }),
      });
      const payload = await response.json() as { error?: string; added?: number; updated?: number; unchanged?: number; absent?: number };
      if (!response.ok) throw new Error(payload.error || "The reviewed A2O Tech Stack import could not be applied.");
      await reload();
      setDraft(null); setDecisions({});
      setMessage(`Applied reviewed baseline records: ${payload.added || 0} added, ${payload.updated || 0} updated, ${payload.unchanged || 0} unchanged. ${payload.absent || 0} existing record${payload.absent === 1 ? " was" : "s were"} absent from this file and retained.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The reviewed A2O Tech Stack import could not be applied.");
    } finally { setBusy(false); }
  }

  const releaseCount = draft ? new Set(draft.rows.map(releaseOf).filter(Boolean)).size : 0;
  return <DomainPageShell title="A2O Tech Stack Import" subtitle="Load the 24-column exchange, inspect the proposed baseline changes, then apply only the rows you approve." releaseScope="A2O baseline intake" contextMode="portfolio" actions={<><Link className="ghost-button" href="/intake">Import Hub</Link><Link className="ghost-button" href="/workspace">Transfer and recovery</Link><button className="primary-button" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Reading…" : "Choose A2O workbook"}</button></>}>
    <input ref={fileRef} className="visually-hidden" type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readWorkbook(file); }} />
    <section className="decision-principle"><strong>Exchange rule</strong><span>The A2O Tech Stack workbook is a compatibility exchange. Its exact 24 columns seed and update the governed baseline; it does not replace the rest of the application data model.</span></section>
    <section className="import-hub-grid">
      <article className="domain-card import-start-card"><span className="eyebrow">WORKBOOK REQUIRED</span><h2>Exact 24-column A2O Tech Stack XLSX</h2><p>Use the first worksheet. Header names and their order must match the exchange contract. The import is reconciled: new and changed records are presented for approval; records absent from a later file are retained.</p><button className="primary-button" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Reading workbook…" : "Select workbook"}</button></article>
      <article className="domain-card import-contract-card"><span className="eyebrow">WHAT IS CHECKED</span><h3>Before any baseline change</h3><ul className="compact-list"><li>Worksheet one contains all 24 required columns in the required order.</li><li>Rows are matched by release and source key, then shown as new, changed, unchanged, or blocked.</li><li>Approved records update the governed baseline without deleting absent rows, reviews, or linked analysis.</li></ul><details><summary>Show the 24 required headers</summary><ol className="contract-header-list">{TECHNICAL_BASELINE_COLUMNS.map((column, index) => <li key={column}><span>{index + 1}</span><code>{column}</code></li>)}</ol></details></article>
    </section>
    {workspaceError ? <p className="error-copy">Current baseline comparison is unavailable: {workspaceError}</p> : null}
    {loading ? <p className="entity-meta">Loading the current governed baseline for comparison…</p> : null}
    {headerReview ? <section className="domain-section header-validation-result"><div className="section-toolbar"><div><span className="eyebrow">WORKBOOK HEADER REVIEW</span><h3>{headerReview.fileName} needs correction before import</h3></div><span className="status-pill status-blocked">Not applied</span></div><p className="error-copy">{headerReview.message}</p><div className="header-diagnostic-grid"><article><span>Expected</span><strong>{headerReview.diagnostic.expectedColumnCount} columns</strong></article><article><span>Found</span><strong>{headerReview.diagnostic.actualColumnCount} columns</strong></article><article><span>Additional fields</span><strong>{headerReview.diagnostic.unexpected.length || "None"}</strong><small>{headerReview.diagnostic.unexpected.length ? headerReview.diagnostic.unexpected.map((item) => `${item.name || "(blank)"} · column ${item.actualPosition}`).join("; ") : "No unexpected column names"}</small></article><article><span>Missing fields</span><strong>{headerReview.diagnostic.missing.length || "None"}</strong><small>{headerReview.diagnostic.missing.length ? headerReview.diagnostic.missing.map((item) => item.name).join("; ") : "All required column names are present"}</small></article></div><p className="warning-copy"><strong>Additional columns, including CSCI, are not silently discarded.</strong> They are outside the retained 24-column exchange and are not yet mapped to a governed baseline property. Keep the original file intact; use a working copy with the exact 24 exchange columns for this import until the CSCI meaning and ownership are governed.</p></section> : null}
    {message ? <p className={message.includes("could not") || message.includes("has no") ? "error-copy" : "notice-copy"}>{message}</p> : null}
    {draft && reconciliation ? <><section className="summary"><div className="metric"><span>Imported rows</span><strong>{draft.rows.length}</strong><small>{draft.fileName}</small></div><div className="metric"><span>Releases represented</span><strong>{releaseCount}</strong><small>From ReleaseName</small></div><div className="metric"><span>New</span><strong>{reconciliation.added}</strong><small>Not in the current baseline</small></div><div className="metric"><span>Changed</span><strong>{reconciliation.changed}</strong><small>Source-controlled cells differ</small></div></section><GovernedImportReview items={items} decisions={decisions} busy={busy} applyLabel="Apply reviewed A2O baseline" onDecision={(id, decision) => setDecisions((current) => ({ ...current, [id]: decision }))} onBulkDecision={(decision) => setDecisions(Object.fromEntries(items.map((item) => [item.id, item.disposition === "blocked" ? "skip" : decision])))} onApply={() => void applyImport()} /><p className="warning-copy"><strong>{reconciliation.removedFromWorkingProjection} current baseline record{reconciliation.removedFromWorkingProjection === 1 ? " is" : "s are"} absent from this workbook.</strong> They will remain retained and visible; this import does not delete or void them.</p></> : null}
  </DomainPageShell>;
}
