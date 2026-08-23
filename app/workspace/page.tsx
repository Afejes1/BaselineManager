"use client";

import { useEffect, useState } from "react";
import { DomainPageShell } from "../../components/domain-shell";
import type { WorkspacePackagePreview } from "../../lib/workspace-transfer";
import type { OperatorDiagnostics } from "../../lib/operator-diagnostics";

type ApiResponse = WorkspacePackagePreview & { ok?: boolean; error?: string };

export default function WorkspaceTransferPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<WorkspacePackagePreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<"export" | "validate" | "replace" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<OperatorDiagnostics | null>(null);
  const transferAvailable = diagnostics?.workspaceTransferMode === "local";

  useEffect(() => { void fetch("/api/diagnostics").then(async (response) => { if (response.ok) setDiagnostics(await response.json() as OperatorDiagnostics); }); }, []);

  async function download() {
    setBusy("export"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/workspace-transfer");
      if (!response.ok) { const payload = await response.json() as { error?: string }; throw new Error(payload.error || "Export failed."); }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const name = disposition.match(/filename="([^"]+)"/)?.[1] || "A2O-Workspace.a2oworkspace";
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = href; anchor.download = name; anchor.click(); URL.revokeObjectURL(href);
      setMessage("Workspace package created. Store it as controlled application data.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Export failed."); }
    finally { setBusy(null); }
  }

  async function submit(mode: "validate" | "replace") {
    if (!file) { setError("Select a Workspace Transfer Package."); return; }
    setBusy(mode); setError(""); setMessage("");
    try {
      const form = new FormData(); form.append("file", file); form.append("mode", mode); if (mode === "replace") form.append("confirmation", confirmation);
      const response = await fetch("/api/workspace-transfer", { method: "POST", body: form });
      const payload = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(payload.error || "Import failed.");
      if (mode === "validate") { setPreview(payload); setConfirmation(""); setMessage("Package validated. Review the counts before replacement."); }
      else { setMessage("Workspace replaced. Reloading the application data…"); window.setTimeout(() => window.location.assign("/"), 800); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Import failed."); }
    finally { setBusy(null); }
  }

  return <DomainPageShell title="Workspace Transfer" subtitle="Move the complete governed dataset between application deployments." contextMode="portfolio" breadcrumb={[{ label: "Workspace Transfer" }]}>
    {!transferAvailable ? <section className="domain-card"><p className="modal-note"><strong>Local operator control.</strong> Full package export, validation, and replacement are disabled on the hosted Site because the operation exceeds bounded Worker transaction limits. Use the rehearsed local runtime.</p></section> : null}
    <section className="domain-list workspace-transfer-grid">
      <article className="domain-card transfer-card">
        <span className="eyebrow">EXPORT</span>
        <h2>Create Workspace Transfer Package</h2>
        <p>Exports baseline records, master data, Releases, Platforms, Change Request references, LM Objectives, Initiatives, WBS, requirements, acceptance, call records, archived audit history, and attached evidence. Restore preserves the destination audit trail and records the import as a new event.</p>
        <p className="modal-note"><strong>Not included:</strong> authentication credentials and destination access roles. The A2O XLSX export remains a separate stakeholder exchange product.</p>
        <button className="primary-button" type="button" disabled={!transferAvailable || busy !== null} onClick={() => void download()}>{busy === "export" ? "Creating package…" : "Export full workspace"}</button>
      </article>
      <article className="domain-card transfer-card">
        <span className="eyebrow">IMPORT</span>
        <h2>Validate and Replace Workspace</h2>
        <p>Validation checks package version, table structure, row counts, document counts, CRC values, and SHA-256 checksums. No application data changes during validation.</p>
        <label className="modal-field">Workspace package<input type="file" disabled={!transferAvailable} accept=".a2oworkspace,application/zip" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setConfirmation(""); setError(""); }} /></label>
        <button className="ghost-button" type="button" disabled={!transferAvailable || !file || busy !== null} onClick={() => void submit("validate")}>{busy === "validate" ? "Validating…" : "Validate package"}</button>
        {preview ? <div className="transfer-preview">
          <div><span>Classification</span><strong>{preview.manifest.classification}</strong></div>
          <div><span>Exported</span><strong>{new Date(preview.manifest.exportedAt).toLocaleString()}</strong></div>
          <div><span>Application</span><strong>v{preview.manifest.applicationVersion}</strong></div>
          <div><span>Dataset</span><strong>{preview.manifest.totals.rows.toLocaleString()} rows · {preview.manifest.totals.documents} files</strong></div>
          {preview.warnings.map((warning) => <p className="warning-copy" key={warning}>{warning}</p>)}
          <p className="destructive-note"><strong>Replacement is destructive.</strong> Export the current workspace first. This operation replaces all application-owned data and retains destination users and access roles.</p>
          <label className="modal-field">Authorization phrase<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="REPLACE WORKSPACE" autoComplete="off" /></label>
          <button className="danger-button" type="button" disabled={busy !== null || confirmation !== "REPLACE WORKSPACE"} onClick={() => void submit("replace")}>{busy === "replace" ? "Replacing workspace…" : "Replace workspace"}</button>
        </div> : null}
      </article>
    </section>
    {message ? <p className="success-copy" role="status">{message}</p> : null}
    {error ? <p className="error-copy" role="alert">{error}</p> : null}
    <section className="domain-card transfer-rules"><span className="eyebrow">TRANSFER RULES</span><h2>Controlled movement</h2><ol><li>Export the current workspace before an application upgrade or machine move.</li><li>Retain the package with the application version and transfer date.</li><li>Validate the package in the destination.</li><li>Replace only an empty workspace or a workspace whose current package has been secured.</li><li>Run Analyst Control and the initiative one-page report after import.</li></ol></section>
    <section className="domain-card operator-readiness"><div className="section-toolbar"><div><span className="eyebrow">OPERATOR DIAGNOSTICS</span><h2>Deployment and recovery readiness</h2></div><span className={`status-pill status-${diagnostics?.overall || "loading"}`}>{diagnostics?.overall || "checking"}</span></div>{diagnostics ? <><div className="transfer-preview"><div><span>Application</span><strong>v{diagnostics.applicationVersion} · {diagnostics.buildSource}</strong></div><div><span>Latest migration</span><strong>{diagnostics.latestMigration || "Not reported"}</strong></div><div><span>Baseline</span><strong>{diagnostics.counts.baselineRecords} records</strong></div><div><span>Decision model</span><strong>{diagnostics.counts.changeRequests} requests · {diagnostics.counts.objectives} Objectives · {diagnostics.counts.initiatives} Initiatives</strong></div></div><div className="diagnostic-list">{diagnostics.checks.map((check) => <div className={`diagnostic-${check.status}`} key={check.id}><span>{check.status}</span><strong>{check.label}</strong><p>{check.detail}</p></div>)}</div><p className="entity-meta">Checked {new Date(diagnostics.generatedAt).toLocaleString()}</p></> : <p>Running database, schema, evidence-storage, and recovery checks…</p>}</section>
  </DomainPageShell>;
}
