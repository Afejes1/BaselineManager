"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { useBaselineWorkspace } from "../../lib/baseline-client";
import { dataQualityFor } from "../../lib/baseline-quality";
import type { IntakePackage } from "../../lib/governance-model";

function dateLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function IntakePage() {
  const { rows, loading, error } = useBaselineWorkspace();
  const [packages, setPackages] = useState<IntakePackage[]>([]);
  const [packageError, setPackageError] = useState("");
  const [restoring, setRestoring] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { void (async () => { try { const response = await fetch("/api/intake", { cache: "no-store" }); const payload = await response.json() as { packages?: IntakePackage[]; error?: string }; if (!response.ok) throw new Error(payload.error || "The intake history could not be loaded."); setPackages(payload.packages || []); } catch (reason) { setPackageError(reason instanceof Error ? reason.message : "The intake history could not be loaded."); } })(); }, []);
  const quality = useMemo(() => rows.reduce((counts, row) => { const item = dataQualityFor(row); if (item.level === "issue") counts.issues += 1; else if (item.level === "review") counts.warnings += 1; else counts.healthy += 1; return counts; }, { issues: 0, warnings: 0, healthy: 0 }), [rows]);
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
  return <DomainPageShell title="Import & Data Quality" subtitle="Imported workbook history, automated checks, and analyst review." releaseScope={active ? `Active workbook: ${active.fileName}` : "No active workbook"} actions={<Link className="primary-button" href="/">Open baseline records</Link>}>
    <section className="kpi-grid" aria-label="Import summary"><div className="kpi-card"><span>Active records</span><strong>{rows.length}</strong><small>Active baseline</small></div><div className="kpi-card"><span>Releases</span><strong>{releases.size}</strong><small>ReleaseName retained per record</small></div><div className="kpi-card"><span>Data-quality issues</span><strong>{quality.issues}</strong><small>Automated checks requiring correction</small></div><div className="kpi-card"><span>Review queue</span><strong>{quality.warnings}</strong><small>Records needing analyst review</small></div></section>
    {(loading || packageError || error) && <section className="domain-section">{loading && <p className="empty">Loading workbook history…</p>}{(error || packageError) && <p className="error-copy">{error || packageError}</p>}</section>}
    <section className="split-layout"><article className="domain-card"><span className="eyebrow">REQUIRED FILE FORMAT</span><h3>A2O Tech Stack workbook</h3><p>This is the retained ALIS-to-ODIN technical baseline source. The application links releases, products, configuration nodes, suppliers, capabilities, and release records without changing the required Excel export format.</p><p className="entity-actions"><Link href="/">Import workbook or edit records</Link><Link href="/pbs">Open product structure</Link></p></article><article className="domain-card"><span className="eyebrow">QUALITY AND REVIEW</span><h3>Two separate indicators</h3><p><strong>Automated checks</strong> identify missing or inconsistent source values. <strong>Analyst review</strong> records that a person assessed a baseline record. It does not alter the original A2O Tech Stack values.</p><p className="entity-actions"><Link href="/">Open quality and review controls</Link></p></article></section>
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">WORKBOOK HISTORY</span><h3>Imported A2O Tech Stack workbooks</h3></div><span>{packages.length} workbook{packages.length === 1 ? "" : "s"}</span></div><div className="domain-table-wrap"><table><thead><tr><th>Workbook</th><th>Worksheet</th><th>Received</th><th>Rows</th><th>Accepted</th><th>Exceptions</th><th>Releases</th><th>State</th><th>Action</th></tr></thead><tbody>{packages.map((item) => <tr key={item.id}><td><strong>{item.fileName}</strong></td><td>{item.sheetName || "—"}</td><td>{dateLabel(item.receivedAt)}</td><td className="mono">{item.rowCount}</td><td className="mono">{item.acceptedCount}</td><td className="mono">{item.exceptionCount}</td><td className="mono">{item.releaseCount}</td><td><span className={`status-pill status-${item.active ? "active" : item.status}`}>{item.active ? "Active baseline" : item.status}</span></td><td>{item.active ? "—" : <button className="ghost-button" disabled={Boolean(restoring)} onClick={() => void restorePackage(item)}>{restoring === item.id ? "Restoring…" : "Make active"}</button>}</td></tr>)}{!packages.length && <tr><td colSpan={9} className="empty">No A2O Tech Stack workbook has been imported.</td></tr>}</tbody></table></div></section>{notice ? <div className="toast">✓ {notice}</div> : null}
  </DomainPageShell>;
}
