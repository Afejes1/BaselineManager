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
  const { scopedRows, releaseLens } = useWorkspaceContext();
  const master = useMasterData();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);


  const productSummaries = useMemo<ProductSummary[]>(() => getProductSummaries(scopedRows), [scopedRows]);
  const combined = useMemo(() => {
    const sourceByName = new Map(productSummaries.map((item) => [item.canonical.trim().toLowerCase(), item]));
    const governed = master.portfolio.products.map((item) => ({ master: item, summary: sourceByName.get(item.canonicalName.trim().toLowerCase()) }));
    const governedNames = new Set(governed.map((item) => item.master.canonicalName.trim().toLowerCase()));
    return [...governed, ...productSummaries.filter((item) => !governedNames.has(item.canonical.trim().toLowerCase())).map((summary) => ({ master: undefined, summary }))];
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

  return (
    <DomainPageShell
      title="Products"
      subtitle="Products reported in the working baseline"
      releaseScope={releaseLens || "All releases"}
      contextMode="filter"
      actions={(<>
        <label className="search" style={{ width: "260px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by product or supplier" />
        </label><button className="primary-button" type="button" onClick={() => setCreating(true)}>＋ New Product</button></>)}
    >
      <div className="summary">
        <div className="metric"><span>Products</span><strong>{canonicalCount}</strong><small>From {totalRows} baseline records</small></div>
        <div className="metric"><span>Suppliers</span><strong>{uniqueSuppliers}</strong><small>Distinct OEM identities</small></div>
        <div className="metric"><span>Releases</span><strong>{releaseCount}</strong><small>Where products are reported</small></div>
      </div>

      <section className="domain-list">
        {filtered.map(({ master: record, summary: product }) => (
          <article key={record?.id || product?.id} className="domain-card">
            <span className={`status-pill status-${record?.lifecycleStatus || "active"}`}>{record?.lifecycleStatus || "active"}</span>
            <h3><Link href={`/products/${encodeURIComponent(record?.id || product?.id || "")}`}>{record?.canonicalName || product?.canonical}</Link></h3>
            <p className="entity-metric">{record?.shortName || product?.shortName || "Short name not recorded"} · {product?.rowCount || 0} baseline records</p>
            <p className="entity-meta"><strong>Supplier:</strong> {product?.supplier || master.portfolio.organizations.find((item) => item.id === record?.ownerOrganizationId)?.name || "Unassigned"}</p>
            <p className="entity-meta"><strong>Releases:</strong> {product?.releases.join(", ") || "No baseline records yet"}</p>
            <p className="entity-actions">
              <Link className="mini-action" href={`/products/${encodeURIComponent(record?.id || product?.id || "")}`}>Open Product</Link>
              <span>{product?.issueCount || 0} issues · {product?.warningCount || 0} warnings</span>
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
