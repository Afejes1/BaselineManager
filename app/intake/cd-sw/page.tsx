"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Link from "../../../components/app-link";
import { DomainPageShell } from "../../../components/domain-shell";
import { GovernedImportReview } from "../../../components/governed-import-review";
import { CD_SW_SOURCE_SYSTEM, parseCdSwMatrix, type CdSwDataset } from "../../../lib/cd-sw-import";
import { importResolutions, type GovernedImportItem, type ImportDecision } from "../../../lib/governed-import";

type SheetCandidate = { name: string; matrix: unknown[][]; summary: CdSwDataset };
type Preview = { items: GovernedImportItem[]; canApply: boolean };
type PreviewSummary = { machines: number; softwareRows: number; placements: number; headerRow: number; machineStartColumn: number; ignoredMatrixValues: number; warnings: string[] };
type ReleaseOption = { id: string; name: string; code: string | null; status: string };
type PlatformOption = { id: string; code: string; name: string; platform_type: string; status: string };
type HistoryRow = { id: string; file_name: string; sheet_name: string | null; source_system: string; source_as_of: string; status: string; record_count: number; added_count: number; changed_count: number; unchanged_count: number; skipped_count: number; blocked_count: number; target_snapshot_id: string | null; applied_at: string | null; created_at: string };

const today = () => new Date().toISOString().slice(0, 10);
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function CdSwIntakePage() {
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetCandidate[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [sourceAsOf, setSourceAsOf] = useState(today());
  const [sourceSystem, setSourceSystem] = useState(CD_SW_SOURCE_SYSTEM);
  const [releaseId, setReleaseId] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [releases, setReleases] = useState<ReleaseOption[]>([]);
  const [platforms, setPlatforms] = useState<PlatformOption[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewSummary, setPreviewSummary] = useState<PreviewSummary | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const selectedSheet = sheets.find((sheet) => sheet.name === sheetName) || null;
  const selectedRelease = releases.find((release) => release.id === releaseId) || null;
  const selectedPlatform = platforms.find((platform) => platform.id === platformId) || null;
  const resolutions = useMemo(() => preview ? importResolutions(preview.items, decisions, {}) : [], [decisions, preview]);

  const loadState = useCallback(async () => {
    const response = await fetch("/api/intake/cd-sw", { cache: "no-store" });
    const payload = await response.json() as { history?: HistoryRow[]; releases?: ReleaseOption[]; platforms?: PlatformOption[]; error?: string };
    if (!response.ok) { setMessage(payload.error || "CD SW import options are unavailable."); return; }
    setHistory(payload.history || []);
    setReleases(payload.releases || []);
    setPlatforms(payload.platforms || []);
  }, []);
  useEffect(() => { queueMicrotask(() => void loadState()); }, [loadState]);

  function resetReview() { setPreview(null); setPreviewSummary(null); setDecisions({}); }

  async function selectFile(source?: File | null) {
    if (!source) return;
    setBusy(true); setMessage(""); resetReview();
    try {
      if (source.size > 30 * 1024 * 1024) throw new Error("The CD SW file exceeds the 30 MB local import limit.");
      const workbook = XLSX.read(await source.arrayBuffer(), { type: "array", raw: false });
      const candidates: SheetCandidate[] = [];
      const failures: string[] = [];
      for (const name of workbook.SheetNames) {
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false });
        try { candidates.push({ name, matrix, summary: parseCdSwMatrix(matrix) }); }
        catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : "unrecognized format"}`); }
      }
      if (!candidates.length) throw new Error(`No worksheet matches the CD SW matrix format. ${failures.slice(0, 3).join(" ")}`);
      candidates.sort((left, right) => (right.summary.placementCount + right.summary.softwareRows.length) - (left.summary.placementCount + left.summary.softwareRows.length));
      setFileName(source.name); setSheets(candidates); setSheetName(candidates[0].name);
      setMessage(`${source.name} loaded locally. ${candidates[0].name} was selected because it contains the strongest CD SW matrix match.`);
    } catch (error) {
      setFileName(""); setSheets([]); setSheetName("");
      setMessage(error instanceof Error ? error.message : "The CD SW file could not be read.");
    } finally { setBusy(false); }
  }

  async function reconcile(mode: "preview" | "apply") {
    if (!selectedSheet) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/intake/cd-sw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, fileName, sheetName, sourceAsOf, sourceSystem, releaseId, platformId, matrix: selectedSheet.matrix, resolutions }),
      });
      const payload = await response.json() as { preview?: Preview; summary?: PreviewSummary; duplicate?: boolean; applied?: number; placements?: number; error?: string };
      if (payload.preview) setPreview(payload.preview);
      if (payload.summary) setPreviewSummary(payload.summary);
      if (!response.ok) throw new Error(payload.error || "The CD SW matrix could not be processed.");
      if (mode === "preview" && payload.preview) {
        setDecisions(Object.fromEntries(payload.preview.items.map((item) => [item.id, item.defaultDecision])));
        setMessage(payload.duplicate ? "This exact file, source date, Release, and Platform were already applied. The preview is shown for inspection; applying again will be a no-op." : "Preview complete. Review the machine identities and software rows before applying their reported placements.");
      } else if (mode === "apply") {
        setMessage(payload.duplicate ? "This exact CD SW delivery was already applied; no duplicate records were created." : `${payload.applied || 0} reviewed source rows applied with ${payload.placements || 0} reported Product placements.`);
        await loadState();
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "The CD SW matrix could not be processed."); }
    finally { setBusy(false); }
  }

  return <DomainPageShell title="CD SW Deployment Matrix" subtitle="Import Milwaukee Component Deployment Software machine identities, software catalog entries, and X-marked placements." releaseScope={selectedRelease && selectedPlatform ? `${selectedRelease.name} · ${selectedPlatform.code}` : "Select a Release and owning Platform"} contextMode="portfolio" actions={<><Link className="ghost-button" href="/intake">Import Hub</Link><Link className="ghost-button" href="/platforms">Manage Platforms</Link></>}>
    <section className="decision-principle"><strong>Source rule</strong><span>CD SW is retained as Milwaukee-reported deployment evidence. The selected Platform is the owning system boundary; spreadsheet server columns become infrastructure nodes inside it. An X creates a reported Product placement. Existing assessed or confirmed topology values are never overwritten.</span></section>
    <section className="split-layout"><article className="domain-section"><span className="eyebrow">SOURCE DELIVERY</span><h3>Select the matrix and its governed boundary</h3><label className="modal-field">CD SW CSV or workbook<input type="file" accept=".csv,.xlsx,.xls,text/csv" disabled={busy} onChange={(event) => void selectFile(event.target.files?.[0])} /></label>{sheets.length ? <label className="modal-field">Detected worksheet<select value={sheetName} onChange={(event) => { setSheetName(event.target.value); resetReview(); }} disabled={busy}>{sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name} · {sheet.summary.machines.length} machines · {sheet.summary.softwareRows.length} software rows · {sheet.summary.placementCount} placements</option>)}</select></label> : null}<div className="form-grid"><label className="modal-field">Source snapshot date<input type="date" value={sourceAsOf} onChange={(event) => { setSourceAsOf(event.target.value); resetReview(); }} /></label><label className="modal-field">Source system<input value={sourceSystem} onChange={(event) => { setSourceSystem(event.target.value); resetReview(); }} /></label><label className="modal-field">Target Release<select value={releaseId} onChange={(event) => { setReleaseId(event.target.value); resetReview(); }}><option value="">Choose Release</option>{releases.map((release) => <option key={release.id} value={release.id}>{release.name}{release.code ? ` · ${release.code}` : ""}</option>)}</select></label><label className="modal-field">Owning Platform<select value={platformId} onChange={(event) => { setPlatformId(event.target.value); resetReview(); }}><option value="">Choose Platform</option>{platforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.code} · {platform.name} · {readable(platform.platform_type)}</option>)}</select></label></div><button className="primary-button" type="button" disabled={!selectedSheet || !sourceAsOf || !releaseId || !platformId || busy} onClick={() => void reconcile("preview")}>{busy ? "Processing…" : "Preview CD SW import"}</button></article>
      <article className="domain-section"><span className="eyebrow">MATRIX INTERPRETATION</span><h3>How this file becomes governed data</h3><ol className="source-guidance-list"><li>The importer finds the Software Component header instead of assuming it starts on row 1.</li><li>Machine Type, Machine UUID, Hostname, and ID rows identify each server column.</li><li>Software Name creates or matches a Product; UUID and Alias remain source identifiers.</li><li>Each X records that Product as installed on that machine for the selected Release.</li></ol><p className="entity-meta">Blank spacer rows and columns are ignored. Non-X matrix text is reported but does not create a placement.</p></article></section>
    {selectedSheet ? <section className="summary import-review-summary" aria-label="Locally detected matrix"><div className="metric"><span>Machines</span><strong>{selectedSheet.summary.machines.length}</strong></div><div className="metric"><span>Software rows</span><strong>{selectedSheet.summary.softwareRows.length}</strong></div><div className="metric"><span>X placements</span><strong>{selectedSheet.summary.placementCount}</strong></div><div className="metric"><span>Software header</span><strong>Row {selectedSheet.summary.headerRowNumber}</strong></div><div className="metric"><span>First machine column</span><strong>{selectedSheet.summary.machines[0]?.columnLabel || "—"}</strong></div></section> : null}
    {message ? <p className={/could not|required|exceed|not found|no worksheet/i.test(message) ? "error-copy" : "notice-copy"}>{message}</p> : null}
    {previewSummary?.warnings?.map((warning) => <p className="warning-copy" key={warning}>{warning}</p>)}
    {preview ? <GovernedImportReview items={preview.items} decisions={decisions} busy={busy} applyLabel="Apply reviewed CD SW rows" onDecision={(id, decision) => setDecisions((current) => ({ ...current, [id]: decision }))} onBulkDecision={(decision) => setDecisions(Object.fromEntries(preview.items.map((item) => [item.id, item.disposition === "blocked" ? "skip" : decision])))} onApply={() => void reconcile("apply")} /> : null}
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">SOURCE RECEIPTS</span><h3>Applied CD SW snapshots</h3></div><button className="ghost-button" type="button" onClick={() => void loadState()}>Refresh</button></div><p className="entity-meta">The same file content, source date, Release, and Platform is idempotent. A later delivery creates a new dated receipt; a missing X does not silently delete an adjudicated placement.</p><div className="domain-table-wrap"><table><thead><tr><th>Source date</th><th>File / worksheet</th><th>Boundary</th><th>Review result</th><th>Status</th></tr></thead><tbody>{history.map((run) => { const [runReleaseId, runPlatformId] = (run.target_snapshot_id || "|").split("|"); const release = releases.find((item) => item.id === runReleaseId); const platform = platforms.find((item) => item.id === runPlatformId); return <tr key={run.id}><td>{run.source_as_of || "Not supplied"}</td><td><strong>{run.file_name}</strong><small>{run.sheet_name || "Worksheet not recorded"}</small></td><td>{release?.name || runReleaseId || "—"}<small>{platform ? `${platform.code} · ${platform.name}` : runPlatformId || "—"}</small></td><td>+{run.added_count} · Δ{run.changed_count} · ={run.unchanged_count}<small>{run.skipped_count} skipped · {run.blocked_count} blocked</small></td><td><span className={`status-pill status-${run.status}`}>{readable(run.status)}</span><small>{run.applied_at ? new Date(run.applied_at).toLocaleString() : new Date(run.created_at).toLocaleString()}</small></td></tr>; })}{!history.length ? <tr><td className="empty" colSpan={5}>No CD SW source receipt has been retained.</td></tr> : null}</tbody></table></div></section>
  </DomainPageShell>;
}
