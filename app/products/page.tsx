"use client";

import Link from "../../components/app-link";
import { useMemo, useState } from "react";
import {
  getProductSummaries,
  type ProductSummary,
} from "../../lib/baseline-data";
import { DomainPageShell } from "../../components/domain-shell";
import { useBaselineWorkspace } from "../../lib/baseline-client";

export default function ProductsPage() {
  const { rows } = useBaselineWorkspace();
  const [query, setQuery] = useState("");


  const productSummaries = useMemo<ProductSummary[]>(() => getProductSummaries(rows), [rows]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return productSummaries;
    return productSummaries.filter((product) => {
      return (
        product.canonical.toLowerCase().includes(normalized) ||
        product.shortName.toLowerCase().includes(normalized) ||
        product.supplier.toLowerCase().includes(normalized)
      );
    });
  }, [productSummaries, query]);

  const canonicalCount = productSummaries.length;
  const uniqueSuppliers = new Set(productSummaries.map((product) => product.supplier || "Unassigned")).size;
  const totalRows = productSummaries.reduce((sum, product) => sum + product.rowCount, 0);
  const releaseCount = new Set(productSummaries.flatMap((product) => product.releases)).size;

  return (
    <DomainPageShell
      title="Products"
      subtitle="Canonical product nodes derived from retained source rows"
      releaseScope={`${canonicalCount} products in working dataset`}
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by product or supplier" />
        </label>
      )}
    >
      <div className="summary">
        <div className="metric"><span>Products</span><strong>{canonicalCount}</strong><small>From {totalRows} source records</small></div>
        <div className="metric"><span>Suppliers</span><strong>{uniqueSuppliers}</strong><small>Distinct OEM identities</small></div>
        <div className="metric"><span>Releases</span><strong>{releaseCount}</strong><small>Where products are reported</small></div>
      </div>

      <section className="domain-list">
        {filtered.map((product) => (
          <article key={product.id} className="domain-card">
            <h3><Link href={`/products/${encodeURIComponent(product.id)}`}>{product.canonical}</Link></h3>
            <p className="entity-metric">{product.shortName || "Unnamed alias"} · {product.rowCount} source rows · {product.rowCount > 0 ? `${product.tiers} tiers` : "No tier data"}</p>
            <p className="entity-meta"><strong>Supplier:</strong> <Link href={`/organizations/${encodeURIComponent(product.supplier)}`}>{product.supplier || "Unassigned"}</Link></p>
            <p className="entity-meta"><strong>Releases:</strong> {product.releases.join(", ") || "Unassigned"}</p>
            <p className="entity-actions">
              <Link href={`/products/${encodeURIComponent(product.id)}`}>Open product</Link>
              <span>{product.issueCount} issues · {product.warningCount} warnings</span>
            </p>
          </article>
        ))}
        {!filtered.length ? (
          <div className="empty">No products match this filter.</div>
        ) : null}
      </section>
    </DomainPageShell>
  );
}
