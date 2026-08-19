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
    if (!window.confirm(`Restore ${item.fileName} as the active working projection? The current package remains retained in history.`)) return;
    setRestoring(item.id); setPackageError("");
    try {
      const sourceResponse = await fetch(`/api/intake?packageId=${encodeURIComponent(item.id)}`, { cache: "no-store" });
      const source = await sourceResponse.json() as { package?: { fileName: string; sheetName: string | null; rows: Array<Record<string, unknown>> }; error?: string };
      if (!sourceResponse.ok || !source.package) throw new Error(source.error || "The retained package could not be read.");
      const response = await fetch("/api/baseline/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(source.package) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The retained package could not be restored.");
      setNotice(`${item.fileName} restored as the active working projection.`);
      window.setTimeout(() => window.location.reload(), 600);
    } catch (reason) { setPackageError(reason instanceof Error ? reason.message : "The retained package could not be restored."); }
    finally { setRestoring(""); }
  }
  return <DomainPageShell title="Intake & Quality" subtitle="24-column source package history, validation signal, and manual-review readiness." releaseScope={active ? `Active: ${active.fileName}` : "No active source package"} actions={<Link className="primary-button" href="/">Open source intake grid</Link>}>
    <section className="kpi-grid" aria-label="Intake summary"><div className="kpi-card"><span>Active source rows</span><strong>{rows.length}</strong><small>Materialized current working baseline</small></div><div className="kpi-card"><span>Releases</span><strong>{releases.size}</strong><small>ReleaseName retained per occurrence</small></div><div className="kpi-card"><span>Data-quality issues</span><strong>{quality.issues}</strong><small>Automated conditions needing correction</small></div><div className="kpi-card"><span>Manual review queue</span><strong>{quality.warnings}</strong><small>Records needing steward judgement</small></div></section>
    {(loading || packageError || error) && <section className="domain-section">{loading && <p className="empty">Loading source intake and quality history…</p>}{(error || packageError) && <p className="error-copy">{error || packageError}</p>}</section>}
    <section className="split-layout"><article className="domain-card"><span className="eyebrow">AUTHORITATIVE INPUT</span><h3>Retained 24-column contract</h3><p>The workbook remains the ingestion source. The system materializes canonical releases, products, configuration nodes, suppliers, capabilities, and product-release occurrences without changing the stakeholder export shape.</p><p className="entity-actions"><Link href="/">Import workbook or edit source projection</Link><Link href="/pbs">Inspect normalized PBS</Link></p></article><article className="domain-card"><span className="eyebrow">QUALITY & REVIEW</span><h3>Two distinct signals</h3><p><strong>Automated quality</strong> identifies incomplete or internally inconsistent source values. <strong>Manual review</strong> records that a steward assessed a source occurrence; it does not alter the original 24-column projection.</p><p className="entity-actions"><Link href="/">Open quality and manual-review controls</Link></p></article></section>
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">SOURCE PACKAGE HISTORY</span><h3>Imports received</h3></div><span>{packages.length} package{packages.length === 1 ? "" : "s"}</span></div><div className="domain-table-wrap"><table><thead><tr><th>Source package</th><th>Worksheet</th><th>Received</th><th>Rows</th><th>Accepted</th><th>Exceptions</th><th>Releases</th><th>State</th><th>Action</th></tr></thead><tbody>{packages.map((item) => <tr key={item.id}><td><strong>{item.fileName}</strong></td><td>{item.sheetName || "—"}</td><td>{dateLabel(item.receivedAt)}</td><td className="mono">{item.rowCount}</td><td className="mono">{item.acceptedCount}</td><td className="mono">{item.exceptionCount}</td><td className="mono">{item.releaseCount}</td><td><span className={`status-pill status-${item.active ? "active" : item.status}`}>{item.active ? "Active baseline" : item.status}</span></td><td>{item.active ? "—" : <button className="ghost-button" disabled={Boolean(restoring)} onClick={() => void restorePackage(item)}>{restoring === item.id ? "Restoring…" : "Restore projection"}</button>}</td></tr>)}{!packages.length && <tr><td colSpan={9} className="empty">No imported source packages yet. Start with the 24-column workbook on the Baseline Manager.</td></tr>}</tbody></table></div></section>{notice ? <div className="toast">✓ {notice}</div> : null}
  </DomainPageShell>;
}
