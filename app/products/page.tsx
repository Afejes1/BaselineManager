"use client";

import Link from "../../components/app-link";
import { useMemo, useState } from "react";
import {
  getProductSummaries,
  type ProductSummary,
} from "../../lib/baseline-data";
import { DomainPageShell } from "../../components/domain-shell";
import { useWorkspaceContext } from "../../components/workspace-context";
import { useMasterData } from "../../lib/master-data-client";
import { MasterEntityEditorDialog } from "../../components/master-data-editor";

export default function ProductsPage() {
  const { rows, releaseLens } = useWorkspaceContext();
  const master = useMasterData();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);


  const productSummaries = useMemo<ProductSummary[]>(() => getProductSummaries(rows), [rows]);
  const combined = useMemo(() => {
    const sourceByName = new Map(productSummaries.map((item) => [item.canonical.trim().toLowerCase(), item]));
    const allMasterNames = new Set(master.portfolio.products.map((item) => item.canonicalName.trim().toLowerCase()));
    // A reconciled spelling variant is retained for audit in Identity
    // Stewardship, not presented as a second active Product in the portfolio.
    const governed = master.portfolio.products.filter((item) => item.lifecycleStatus !== "retired").map((item) => ({ master: item, summary: sourceByName.get(item.canonicalName.trim().toLowerCase()) }));
    return [...governed, ...productSummaries.filter((item) => !allMasterNames.has(item.canonical.trim().toLowerCase())).map((summary) => ({ master: undefined, summary }))];
  }, [master.portfolio.products, productSummaries]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return combined;
    return combined.filter(({ master: record, summary }) => `${record?.canonicalName || summary?.canonical || ""} ${record?.shortName || summary?.shortName || ""} ${summary?.supplier || ""} ${record?.lifecycleStatus || ""}`.toLowerCase().includes(normalized));
  }, [combined, query]);

  const canonicalCount = combined.length;
  const uniqueSuppliers = new Set(productSummaries.map((product) => product.supplier || "Unassigned")).size;
  const totalRows = productSummaries.reduce((sum, product) => sum + product.rowCount, 0);
  const releaseCount = new Set(productSummaries.flatMap((product) => product.releases)).size;
  const unfieldedCount = combined.filter(({ master: record, summary }) => record?.lifecycleStatus === "active" && !summary).length;

  return (
    <DomainPageShell
      title="Products"
      subtitle="Canonical Product catalog, Release fielding history, and related decisions."
      releaseScope={releaseLens ? `Catalog not filtered · release lens: ${releaseLens}` : "Cross-release Product catalog"}
      contextMode="portfolio"
      actions={(<>
        <label className="search" style={{ width: "260px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by product or supplier" />
        </label><Link className="ghost-button" href="/stewardship">Resolve duplicate</Link><button className="primary-button" type="button" onClick={() => setCreating(true)}>＋ New Product</button></>)}
    >
      <div className="summary">
        <div className="metric"><span>Product catalog</span><strong>{canonicalCount}</strong><small>{unfieldedCount ? `${unfieldedCount} not fielded in a Release` : "All active Products are fielded"}</small></div>
        <div className="metric"><span>Fielded Products</span><strong>{productSummaries.length}</strong><small>Present in Release baseline records</small></div>
        <div className="metric"><span>Suppliers</span><strong>{uniqueSuppliers}</strong><small>Distinct OEM identities</small></div>
        <div className="metric"><span>Release records</span><strong>{totalRows}</strong><small>Across {releaseCount} releases</small></div>
      </div>

      {unfieldedCount ? <section className="domain-section product-fielding-notice"><div><span className="eyebrow">RELEASE FIELDING</span><h3>Products not yet fielded in a Release</h3><p>A Product can be governed before deployment planning is complete. These catalog records have no runtime, placement, capacity, or baseline-quality status until a Release-specific baseline record is created.</p></div><div className="chip-list">{combined.filter(({ master: record, summary }) => record?.lifecycleStatus === "active" && !summary).map(({ master: record }) => record ? <Link key={record.id} href={`/products/${encodeURIComponent(record.id)}`} className="domain-chip"><strong>{record.shortName || record.canonicalName}</strong><span>Open Product</span></Link> : null)}</div></section> : null}

      <section className="domain-list">
        {filtered.map(({ master: record, summary: product }) => (
          <article key={record?.id || product?.id} className="domain-card">
            <span className={`status-pill status-${record?.lifecycleStatus || "active"}`}>{record?.lifecycleStatus || "active"}</span>
            <h3><Link href={`/products/${encodeURIComponent(record?.id || product?.id || "")}`}>{record?.canonicalName || product?.canonical}</Link></h3>
            <p className="entity-metric">{record?.shortName || product?.shortName || "Short name not recorded"} · {product?.rowCount ? `${product.rowCount} Release baseline records` : "Not fielded in a Release"}</p>
            <p className="entity-meta"><strong>Supplier:</strong> {product?.supplier || master.portfolio.organizations.find((item) => item.id === record?.ownerOrganizationId)?.name || "Unassigned"}</p>
            <p className="entity-meta"><strong>Releases:</strong> {product?.releases.join(", ") || "No Release fielding recorded"}</p>
            <p className="entity-actions">
              <Link className="mini-action" href={`/products/${encodeURIComponent(record?.id || product?.id || "")}`}>Open Product</Link>
              {product ? <span>{product.issueCount} issues · {product.warningCount} warnings</span> : <span>Baseline QA applies after fielding</span>}
            </p>
          </article>
        ))}
        {!filtered.length ? (
          <div className="empty">No products match this filter.</div>
        ) : null}
      </section>
      {creating ? <MasterEntityEditorDialog kind="product" portfolio={master.portfolio} onDismiss={() => setCreating(false)} onSaved={() => { setCreating(false); void master.reload(); }} /> : null}
    </DomainPageShell>
  );
}
