"use client";

import Link from "../../../components/app-link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { DomainPageShell } from "../../../components/domain-shell";
import { useBaselineWorkspace } from "../../../lib/baseline-client";
import { TECHNICAL_BASELINE_COLUMNS } from "../../../lib/technical-baseline-contract";
import { dataQualityForOccurrence } from "../../../lib/baseline-quality";
import { text } from "../../../lib/baseline-data";

type DetailTab = "source" | "normalized" | "quality";

function decodeId(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export default function SourceOccurrencePage() {
  const params = useParams<{ id?: string }>();
  const occurrenceId = decodeId(params.id ?? "");
  const { rows, loading, error } = useBaselineWorkspace();
  const [tab, setTab] = useState<DetailTab>("source");
  const row = useMemo(() => rows.find((item) => item.__meta.occurrenceId === occurrenceId) ?? null, [rows, occurrenceId]);

  if (loading) return <DomainPageShell title="Loading source occurrence" subtitle="Retrieving the authoritative working projection"><div className="empty">Loading the source occurrence…</div></DomainPageShell>;
  if (error || !row) return <DomainPageShell title="Source occurrence not found" subtitle="The record is not in the current working workspace"><section className="domain-list"><article className="domain-card"><h3>{error || "No current source occurrence matches this address."}</h3><p className="entity-actions"><Link href="/">Return to Baseline Manager</Link></p></article></section></DomainPageShell>;

  const quality = dataQualityForOccurrence(row, row.__meta.materializationStatus);
  const product = text(row.LongName) || text(row.ShortName) || "Host-only occurrence";
  return (
    <DomainPageShell
      title={`Source occurrence: ${product}`}
      subtitle={`Immutable source row with a separately managed working projection · ${row.__meta.baseline.name || "Reported baseline"}`}
      releaseScope={`${text(row.ReleaseName) || "Unassigned"} · ${row.__meta.baseline.maturity || "reported"} · as of ${row.__meta.baseline.asOf || "unknown"}`}
      actions={<Link className="primary-button" href="/">Return to Baseline Manager</Link>}
    >
      <section className="detail-tabs" aria-label="Source occurrence detail tabs">
        <button type="button" role="tab" aria-selected={tab === "source"} className={`tab-button ${tab === "source" ? "tab-active" : ""}`} onClick={() => setTab("source")}>24-column projection</button>
        <button type="button" role="tab" aria-selected={tab === "normalized"} className={`tab-button ${tab === "normalized" ? "tab-active" : ""}`} onClick={() => setTab("normalized")}>Normalized context</button>
        <button type="button" role="tab" aria-selected={tab === "quality"} className={`tab-button ${tab === "quality" ? "tab-active" : ""}`} onClick={() => setTab("quality")}>Quality</button>
      </section>
      {tab === "source" ? <section className="domain-section"><div className="section-heading"><h3>Current working projection</h3><span>Revision {row.__meta.revision} · source remains retained separately</span></div><div className="domain-table-wrap"><table><tbody>{TECHNICAL_BASELINE_COLUMNS.map((column) => <tr key={column}><th>{column}</th><td>{text(row[column]) || "—"}</td></tr>)}</tbody></table></div></section> : null}
      {tab === "normalized" ? <section className="normal-grid"><div className="normal-card"><h5>Release baseline</h5><p><strong>Release</strong>{text(row.ReleaseName) || "Unassigned"}</p><p><strong>Baseline</strong>{row.__meta.baseline.name || "Reported"}</p><p><strong>Maturity</strong>{row.__meta.baseline.maturity || "reported"}</p></div><div className="normal-card"><h5>Configuration node</h5><p><strong>Tier</strong>{text(row.Tier) || "Unassigned"}</p><p><strong>Resource</strong>{text(row.Resource) || "Unassigned"}</p><p><strong>Host</strong>{text(row.HW_Host) || "Unassigned"}</p></div><div className="normal-card"><h5>Product / runtime</h5><p><strong>Product</strong>{product}</p><p><strong>Supplier</strong>{text(row.OEM) || "Unassigned"}</p><p><strong>Container</strong>{text(row["Container Technology"]) || "—"}</p></div></section> : null}
      {tab === "quality" ? <section className="domain-section"><div className="section-heading"><h3>{quality.label} automated checks</h3><span>Manual review is stored separately from the workbook projection</span></div>{quality.issues.length ? <ul className="quality-checks">{quality.issues.map((issue, index) => <li key={`${issue.field}:${index}`} className={`quality-${issue.severity}`}><strong>{issue.field}</strong><span>{issue.message}</span></li>)}</ul> : <p className="quality-complete">The current projection passes all configured checks.</p>}</section> : null}
    </DomainPageShell>
  );
}
