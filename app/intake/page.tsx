"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { useWorkspaceContext } from "../../components/workspace-context";
import { dataQualityFor } from "../../lib/baseline-quality";
import type { IntakePackage } from "../../lib/governance-model";

function dateLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function IntakePage() {
  const { rows, loading, error } = useWorkspaceContext();
  const [packages, setPackages] = useState<IntakePackage[]>([]);
  const [packageError, setPackageError] = useState("");
  const [restoring, setRestoring] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { void (async () => {
    try {
      const response = await fetch("/api/intake", { cache: "no-store" });
      const payload = await response.json() as { packages?: IntakePackage[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "The A2O Tech Stack intake history could not be loaded.");
      setPackages(payload.packages || []);
    } catch (reason) { setPackageError(reason instanceof Error ? reason.message : "The intake history could not be loaded."); }
  })(); }, []);

  const quality = useMemo(() => rows.reduce((counts, row) => {
    const item = dataQualityFor(row);
    if (item.level === "issue") counts.issues += 1;
    else if (item.level === "review") counts.warnings += 1;
    else counts.healthy += 1;
    return counts;
  }, { issues: 0, warnings: 0, healthy: 0 }), [rows]);
  const active = packages.find((item) => item.active) ?? null;
  const releases = new Set(rows.map((row) => String(row.ReleaseName || "").trim()).filter(Boolean));

  async function restorePackage(item: IntakePackage) {
    if (!window.confirm(`Restore ${item.fileName} as the active baseline? The current package remains retained in history.`)) return;
    setRestoring(item.id); setPackageError("");
    try {
      const sourceResponse = await fetch(`/api/intake?packageId=${encodeURIComponent(item.id)}`, { cache: "no-store" });
      const source = await sourceResponse.json() as { package?: { fileName: string; sheetName: string | null; rows: Array<Record<string, unknown>> }; error?: string };
      if (!sourceResponse.ok || !source.package) throw new Error(source.error || "The retained package could not be read.");
      const response = await fetch("/api/baseline/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(source.package) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The retained package could not be restored.");
      setNotice(`${item.fileName} restored as the active baseline.`);
      window.setTimeout(() => window.location.reload(), 600);
    } catch (reason) { setPackageError(reason instanceof Error ? reason.message : "The retained package could not be restored."); }
    finally { setRestoring(""); }
  }

  return <DomainPageShell title="Import Hub & Quality" subtitle="Choose the source you received. Preview, reconcile, and approve before any governed record is updated." releaseScope={active ? `Current A2O import: ${active.fileName}` : "No A2O workbook imported"} contextMode="portfolio" actions={<><Link className="ghost-button" href="/intake/lockheed-daily">Lockheed daily delivery</Link><Link className="primary-button" href="/intake/a2o">Import A2O workbook</Link></>}>
    <section className="decision-principle"><strong>Import control</strong><span>Each import retains its source receipt and compares the incoming values to the current record. The review screen lets the analyst approve, skip, or correct proposed trace links. A missing row never silently deletes a governed record.</span></section>
    <section className="kpi-grid" aria-label="Baseline and quality summary"><div className="kpi-card"><span>Active baseline records</span><strong>{rows.length}</strong><small>Current governed baseline</small></div><div className="kpi-card"><span>Releases</span><strong>{releases.size}</strong><small>ReleaseName retained per baseline record</small></div><div className="kpi-card"><span>Data-quality issues</span><strong>{quality.issues}</strong><small>Automated checks requiring correction</small></div><div className="kpi-card"><span>Review queue</span><strong>{quality.warnings}</strong><small>Records needing analyst review</small></div></section>
    {(loading || packageError || error) && <section className="domain-section">{loading && <p className="empty">Loading import history…</p>}{(error || packageError) && <p className="error-copy">{error || packageError}</p>}</section>}

    <section className="section-toolbar import-hub-heading"><div><span className="eyebrow">SELECT THE DELIVERY YOU HAVE</span><h2>Import by file type, not by application area</h2></div><span>All imports require review before application</span></section>
    <section className="import-hub-grid">
      <article className="domain-card import-source-card"><span className="eyebrow">A2O TECH STACK</span><h3>Baseline workbook</h3><p><strong>Use for:</strong> the working technical baseline, one row per deployment/release.</p><p><strong>Expected:</strong> the exact 24-column A2O Tech Stack <code>.xlsx</code> exchange.</p><p>Header validation, record-by-record comparison, and XLSX compatibility export.</p><Link className="primary-button" href="/intake/a2o">Import A2O workbook</Link></article>
      <article className="domain-card import-source-card"><span className="eyebrow">LOCKHEED OBJECTIVE FEED</span><h3>FOR_JPO JSON</h3><p><strong>Use for:</strong> Lockheed objective snapshots, Jira identifiers, JPO/MCP associations, dates, ROM, percent complete, and dependencies.</p><p><strong>Expected:</strong> the delivered JSON from GitLab Pages.</p><p>Retains a dated supplier observation and shows field-level changes over time.</p><Link className="primary-button" href="/objectives/feed">Import Objective JSON</Link></article>
      <article className="domain-card import-source-card"><span className="eyebrow">LOCKHEED DAILY DELIVERY</span><h3>CAPES, Jira, MCP/DSOR, and Objective files</h3><p><strong>Use for:</strong> the daily CSV/XLSX delivery set, including <code>FOR_JPO_CAPES</code>, <code>FOR_JPO_JIRA</code>, <code>FOR_JPO_MCPS</code>, and <code>FOR_JPO_OBJS</code>.</p><p>Load one or more files together; verify the detected dataset before previewing.</p><Link className="primary-button" href="/intake/lockheed-daily">Import daily delivery</Link></article>
      <article className="domain-card import-source-card"><span className="eyebrow">CONFLUENCE CHANGE REQUEST EXPORT</span><h3>MCP and DSOR dashboard</h3><p><strong>Use for:</strong> the contractor-created CSV/XLSX derived from the Confluence MCP/DSOR dashboard.</p><p>Maps external IDs, titles, status, release information, and source locators to Government Change Request references for analyst review.</p><Link className="primary-button" href="/changes/import">Import Change Request export</Link></article>
    </section>
    <section className="domain-card optional-import-card"><span className="eyebrow">OPTIONAL / MANUAL FORMAT</span><h3>Structured LM Objective workbook</h3><p>This is a separate, manually structured workbook format. It is not the daily Lockheed JSON feed and it is not the CAPES/Jira/MCP/Objective CSV delivery. Use it only when someone provides that specific structured workbook.</p><Link href="/objectives/import">Open structured workbook import</Link></section>
    <section className="domain-card"><span className="eyebrow">QUALITY AND REVIEW</span><h3>Two separate indicators</h3><p><strong>Automated checks</strong> identify missing or inconsistent values in Release baseline records. <strong>Analyst review</strong> records that a person assessed the record. Neither is part of the A2O Tech Stack exchange.</p><p className="entity-actions"><Link href="/">Open quality and review controls</Link></p></section>
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">A2O TECH STACK HISTORY</span><h3>Imported baseline workbooks</h3></div><span>{packages.length} package{packages.length === 1 ? "" : "s"}</span></div><div className="domain-table-wrap"><table><thead><tr><th>Workbook</th><th>Worksheet</th><th>Received</th><th>Rows</th><th>Accepted</th><th>Exceptions</th><th>Releases</th><th>State</th><th>Action</th></tr></thead><tbody>{packages.map((item) => <tr key={item.id}><td><strong>{item.fileName}</strong></td><td>{item.sheetName || "—"}</td><td>{dateLabel(item.receivedAt)}</td><td className="mono">{item.rowCount}</td><td className="mono">{item.acceptedCount}</td><td className="mono">{item.exceptionCount}</td><td className="mono">{item.releaseCount}</td><td><span className={`status-pill status-${item.active ? "active" : item.status}`}>{item.active ? "Current baseline package" : item.status}</span></td><td>{item.active ? "—" : <button className="ghost-button" disabled={Boolean(restoring)} onClick={() => void restorePackage(item)}>{restoring === item.id ? "Restoring…" : "Use as current package"}</button>}</td></tr>)}{!packages.length && <tr><td colSpan={9} className="empty">No A2O Tech Stack workbook has been imported.</td></tr>}</tbody></table></div></section>
    {notice ? <div className="toast">✓ {notice}</div> : null}
  </DomainPageShell>;
}
