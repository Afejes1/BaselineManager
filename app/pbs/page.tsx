"use client";

import { useMemo, useState } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import type { ManagedRecord24 } from "../../lib/baseline-client";
import { useWorkspaceContext } from "../../components/workspace-context";

type ProductNode = { id: string; label: string; rows: ManagedRecord24[] };

export default function PbsPage() {
  const { scopedRows, releases, releaseLens, loading, error } = useWorkspaceContext();
  const [query, setQuery] = useState("");
  const products = useMemo(() => {
    const selectedRows = scopedRows.filter((row) => `${row.LongName || ""} ${row.ShortName || ""} ${row["#"] || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
    const grouped = new Map<string, ProductNode>();
    for (const row of selectedRows) {
      const id = row.__meta.productId || `source:${String(row["#"] || "unknown")}`;
      const label = String(row.LongName || row.ShortName || row["#"] || "Unassigned product");
      const current = grouped.get(id) || { id, label, rows: [] };
      current.rows.push(row); grouped.set(id, current);
    }
    return [...grouped.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [query, scopedRows]);
  const uniqueConfiguration = new Set(scopedRows.map((row) => [row.Tier, row.Resource, row.HW_Host].filter(Boolean).join(" / ")).filter(Boolean)).size;

  return <DomainPageShell title="Product Deployment Structure" subtitle="Products organized by release and configuration placement." releaseScope={releaseLens || "All releases"} contextMode="filter" actions={<label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find product, alias, or A2O key" /></label>}>
    <section className="decision-principle"><strong>Structure boundary</strong><span>This is a deployment structure derived from the Working Technical Baseline. It does not claim a Product Breakdown Structure of internal components; component relationships require governed supporting evidence before they are added.</span></section>
    <section className="kpi-grid" aria-label="Product structure summary"><div className="kpi-card"><span>Products</span><strong>{products.length}</strong><small>In the working baseline</small></div><div className="kpi-card"><span>Releases</span><strong>{releaseLens ? 1 : releases.length}</strong><small>Selected release scope</small></div><div className="kpi-card"><span>Baseline records</span><strong>{products.reduce((total, product) => total + product.rows.length, 0)}</strong><small>Product-release records</small></div><div className="kpi-card"><span>Configuration paths</span><strong>{uniqueConfiguration}</strong><small>Tier / resource / host combinations</small></div></section>
    {loading && <section className="domain-section"><p className="empty">Loading product structure…</p></section>}
    {error && <section className="domain-section"><p className="error-copy">{error}</p></section>}
    {!loading && !error && <section className="tree-explorer">{products.length ? products.map((product) => { const byRelease = new Map<string, typeof product.rows>(); for (const row of product.rows) { const name = String(row.ReleaseName || "Unassigned").trim() || "Unassigned"; byRelease.set(name, [...(byRelease.get(name) || []), row]); } return <details className="tree-node" key={product.id} open={products.length < 7}><summary><span className="tree-title">{product.id.startsWith("source:") ? product.label : <Link href={`/products/${encodeURIComponent(product.id)}`}>{product.label}</Link>}</span><span>{product.rows.length} occurrence{product.rows.length === 1 ? "" : "s"}</span></summary>{[...byRelease.entries()].map(([releaseName, releaseRows]) => <details className="tree-branch" key={releaseName}><summary><strong>{releaseName}</strong><span>{releaseRows.length} source rows</span></summary><div className="domain-table-wrap"><table><thead><tr><th>Tier</th><th>Resource</th><th>Host / VM</th><th>Runtime profile</th><th>Baseline capacity</th></tr></thead><tbody>{releaseRows.map((row) => <tr key={row.__meta.occurrenceId || `${row.ReleaseName}:${row["#"]}:${row.HW_Host}`}><td>{String(row.Tier || "Not reported")}</td><td>{String(row.Resource || "Not reported")}</td><td className="mono">{String(row.HW_Host || "Not reported")}</td><td>{[row.Containerized, row["Container Technology"], row["Container Type"]].filter(Boolean).join(" / ") || "Not reported"}</td><td>{[row.HW_Storage_Type, row["HW_Storage (GB)"] && `${row.HW_Storage_Type || "Storage"} ${row["HW_Storage (GB)"] || ""} GB`, row.HW_CPU_CORES && `${row.HW_CPU_CORES} cores`, row["HW_RAM (GB)"] && `${row["HW_RAM (GB)"]} GB RAM`].filter(Boolean).join(" · ") || "Not reported"}</td></tr>)}</tbody></table></div></details>)}</details>; }) : <article className="domain-card empty-state"><h3>No deployment records match</h3><p>Import an A2O Tech Stack workbook or adjust the release and product search.</p><Link href="/">Open source intake</Link></article>}</section>}
  </DomainPageShell>;
}
