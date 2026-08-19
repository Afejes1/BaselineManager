"use client";

import Link from "../../../components/app-link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { DomainPageShell } from "../../../components/domain-shell";
import { useWorkspaceContext } from "../../../components/workspace-context";
import { TECHNICAL_BASELINE_COLUMNS } from "../../../lib/technical-baseline-contract";
import { dataQualityForOccurrence } from "../../../lib/baseline-quality";
import { text } from "../../../lib/baseline-data";

type DetailTab = "source" | "normalized" | "quality";

function decodeId(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export default function BaselineRecordReferencePage() {
  const params = useParams<{ id?: string }>();
  const occurrenceId = decodeId(params.id ?? "");
  const { rows, loading, error } = useWorkspaceContext();
  const [tab, setTab] = useState<DetailTab>("source");
  const row = useMemo(() => rows.find((item) => item.__meta.occurrenceId === occurrenceId) ?? null, [rows, occurrenceId]);

  if (loading) return <DomainPageShell title="Loading baseline record" subtitle="Loading the active baseline" contextMode="record"><div className="empty">Loading baseline record…</div></DomainPageShell>;
  if (error || !row) return <DomainPageShell title="Baseline record not found" subtitle="The record is not in the active baseline" contextMode="record"><section className="domain-list"><article className="domain-card"><h3>{error || "No baseline record matches this address."}</h3><p className="entity-actions"><Link href="/">Return to Baseline Records</Link></p></article></section></DomainPageShell>;

  const quality = dataQualityForOccurrence(row, row.__meta.materializationStatus);
  const product = text(row.LongName) || text(row.ShortName) || "Host record";
  const release = text(row.ReleaseName) || "Unassigned";
  return (
    <DomainPageShell
      title={`Record reference: ${product}`}
      subtitle="Read-only Working Technical Baseline reference · contractor-maintained analytical data"
      releaseScope={`${release} · ${row.__meta.baseline.maturity || "working"} · as of ${row.__meta.baseline.asOf || "unknown"}`}
      contextMode="record"
      recordRelease={release}
      breadcrumb={[{ label: "Baseline Records", href: "/" }, { label: release, href: `/releases/${encodeURIComponent(release)}` }, { label: text(row.ShortName) || product }]}
      actions={<><Link className="ghost-button" href={`/evidence?occurrenceId=${encodeURIComponent(occurrenceId)}`}>Link supporting evidence</Link><Link className="primary-button" href="/">Return to Baseline Records</Link></>}
    >
      <section className="decision-principle"><strong>Data status</strong><span>This is a contractor-maintained analytical baseline record. It is not designated as an official Lockheed Martin or Government record. Supporting evidence is linked separately.</span></section>
      <section className="detail-tabs" aria-label="Baseline record detail tabs">
        <button type="button" role="tab" aria-selected={tab === "source"} className={`tab-button ${tab === "source" ? "tab-active" : ""}`} onClick={() => setTab("source")}>Baseline fields</button>
        <button type="button" role="tab" aria-selected={tab === "normalized"} className={`tab-button ${tab === "normalized" ? "tab-active" : ""}`} onClick={() => setTab("normalized")}>Relationships</button>
        <button type="button" role="tab" aria-selected={tab === "quality"} className={`tab-button ${tab === "quality" ? "tab-active" : ""}`} onClick={() => setTab("quality")}>Quality</button>
      </section>
      {tab === "source" ? <section className="domain-section"><div className="section-heading"><h3>Current baseline values</h3><span>Revision {row.__meta.revision} · exact A2O XLSX projection</span></div><div className="domain-table-wrap"><table><tbody>{TECHNICAL_BASELINE_COLUMNS.map((column) => <tr key={column}><th>{column}</th><td>{text(row[column]) || "—"}</td></tr>)}</tbody></table></div></section> : null}
      {tab === "normalized" ? <section className="normal-grid"><div className="normal-card"><h5>Working baseline</h5><p><strong>Release</strong>{text(row.ReleaseName) || "Unassigned"}</p><p><strong>Baseline</strong>{row.__meta.baseline.name || "Working Technical Baseline"}</p><p><strong>Maturity</strong>{row.__meta.baseline.maturity || "working"}</p></div><div className="normal-card"><h5>Configuration node</h5><p><strong>Tier</strong>{text(row.Tier) || "Unassigned"}</p><p><strong>Resource</strong>{text(row.Resource) || "Unassigned"}</p><p><strong>Host</strong>{text(row.HW_Host) || "Unassigned"}</p></div><div className="normal-card"><h5>Product / runtime</h5><p><strong>Product</strong>{product}</p><p><strong>Supplier</strong>{text(row.OEM) || "Unassigned"}</p><p><strong>Container</strong>{text(row["Container Technology"]) || "—"}</p></div></section> : null}
      {tab === "quality" ? <section className="domain-section"><div className="section-heading"><h3>{quality.label} automated checks</h3><span>Review and evidence are application metadata outside the A2O XLSX export</span></div>{quality.issues.length ? <ul className="quality-checks">{quality.issues.map((issue, index) => <li key={`${issue.field}:${index}`} className={`quality-${issue.severity}`}><strong>{issue.field}</strong><span>{issue.message}</span></li>)}</ul> : <p className="quality-complete">The current baseline record passes all configured checks.</p>}</section> : null}
    </DomainPageShell>
  );
}
