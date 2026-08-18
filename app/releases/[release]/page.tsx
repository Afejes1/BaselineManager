"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import {
  BASELINE_STORAGE_KEY,
  configNodeIdentity,
  getReleases,
  getReleaseSummary,
  loadRowsFromStorage,
  productDisplayName,
  productIdentityKey,
  releaseComparisonSummary,
  supplierIdentity,
  text,
  type Record24,
} from "../../../lib/baseline-data";
import { DomainPageShell } from "../../../components/domain-shell";

function decodeRelease(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function loadRows(): Record24[] {
  if (typeof window === "undefined") return [];
  return loadRowsFromStorage(window.localStorage.getItem(BASELINE_STORAGE_KEY));
}

function uniqueCount(items: string[]) {
  return new Set(items.filter(Boolean)).size;
}

export default function ReleaseDetailPage({ params }: { params: { release: string } }) {
  const releaseName = decodeRelease(params.release);
  const [rows, setRows] = useState<Record24[]>(() => {
    if (typeof window === "undefined") return [];
    return loadRows();
  });
  const [query, setQuery] = useState("");

  useEffect(() => {
    setRows(loadRows());
  }, []);

  const allReleases = useMemo(() => getReleases(rows), [rows]);
  const releaseRows = useMemo(() => rows.filter((row) => text(row.ReleaseName) === releaseName), [rows, releaseName]);
  const comparison = useMemo(() => releaseComparisonSummary(rows, releaseName), [rows, releaseName]);

  const summary = useMemo(() => getReleaseSummary(rows, releaseName), [rows, releaseName]);

  const productList = useMemo(() => {
    const byProduct = new Map<string, {
      id: string;
      canonical: string;
      shortName: string;
      supplier: string;
      tiers: Set<string>;
      hosts: Set<string>;
      rows: Record24[];
      issues: number;
    }>();

    for (const row of releaseRows) {
      const key = productIdentityKey(row);
      const existing = byProduct.get(key);
      if (!existing) {
        byProduct.set(key, {
          id: key,
          canonical: productDisplayName(row),
          shortName: text(row.ShortName).trim(),
          supplier: text(row.OEM).trim() || "Unassigned",
          tiers: new Set([text(row.Tier)]),
          hosts: new Set([text(row.HW_Host)]),
          rows: [row],
          issues: text(row.HW_Storage_Type) === "" && text(row["HW_Storage (GB)"]) ? 1 : 0,
        });
        continue;
      }

      existing.rows.push(row);
      const storageValue = text(row.HW_Storage_Type) === "" && text(row["HW_Storage (GB)"]) ? 1 : 0;
      existing.issues += storageValue;
      existing.tiers.add(text(row.Tier));
      existing.hosts.add(text(row.HW_Host));
      if (text(row.LongName).trim()) existing.canonical = productDisplayName(row);
      if (text(row.OEM).trim()) existing.supplier = text(row.OEM).trim();
      if (text(row.ShortName).trim() && !existing.shortName) existing.shortName = text(row.ShortName).trim();
    }

    return Array.from(byProduct.values())
      .map((item) => ({
        ...item,
        shortName: item.shortName || item.canonical,
      }))
      .sort((left, right) => left.canonical.localeCompare(right.canonical));
  }, [releaseRows]);

  const configNodes = useMemo(() => {
    const values = releaseRows.map((row) => configNodeIdentity(row));
    return values
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 12);
  }, [releaseRows]);

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return productList;
    return productList.filter((product) => {
      const textMatch = `${product.canonical} ${product.shortName} ${product.supplier}`.toLowerCase();
      return textMatch.includes(normalized);
    });
  }, [productList, query]);

  const supplierRows = useMemo(() => {
    const suppliers = new Map<string, { id: string; name: string; rowCount: number; products: Set<string> }>();
    for (const row of releaseRows) {
      const name = text(row.OEM).trim() || "Unassigned";
      const id = supplierIdentity(name);
      const productId = productIdentityKey(row);
      const existing = suppliers.get(id);
      if (!existing) {
        suppliers.set(id, { id, name, rowCount: 1, products: new Set([productId]) });
      } else {
        existing.rowCount += 1;
        existing.products.add(productId);
      }
    }
    return Array.from(suppliers.values())
      .map((supplier) => ({
        ...supplier,
        productCount: supplier.products.size,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [releaseRows]);

  const capabilityRows = useMemo(() => {
    const capabilities = new Map<string, { id: string; name: string; products: Set<string>; rows: number }>();
    for (const row of releaseRows) {
      const name = text(row["Technical Capability Satisfied by this SW/Tech - Notes"]).trim() || "Unspecified";
      const id = name.toLowerCase();
      const productId = productIdentityKey(row);
      const existing = capabilities.get(id);
      if (!existing) {
        capabilities.set(id, { id, name, products: new Set([productId]), rows: 1 });
      } else {
        existing.rows += 1;
        existing.products.add(productId);
      }
    }
    return Array.from(capabilities.values())
      .map((capability) => ({
        ...capability,
        productCount: capability.products.size,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [releaseRows]);

  const supplierIdentifiers = useMemo(() => releaseRows.map((row) => supplierIdentity(text(row.OEM).trim())), [releaseRows]);
  const supplierCount = useMemo(() => uniqueCount(supplierIdentifiers), [supplierIdentifiers]);

  if (!summary) {
    return (
      <DomainPageShell
        title={`Release ${releaseName}`}
        subtitle="No records currently match this release in the working dataset."
        releaseScope="Release context unavailable"
      >
        <section className="domain-list">
          <div className="domain-card">
            <h3>Release not present</h3>
            <p className="entity-meta">No source rows are currently marked with this release name.</p>
            <p className="entity-actions"><Link href="/releases">Return to release overview</Link></p>
          </div>
        </section>
      </DomainPageShell>
    );
  }

  return (
    <DomainPageShell
      title={`Release ${releaseName}`}
      subtitle={`Compared against ${comparison.previous ?? "first available"} release context`}
      releaseScope={`${summary.rows} rows · ${summary.rows === 1 ? "one row" : `${summary.rows} rows`} in baseline`}
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter products in this release" />
        </label>
      )}
    >
      <div className="summary">
        <div className="metric">
          <span>Release baseline</span>
          <strong>{releaseName}</strong>
          <small>{summary.rows} source rows · {allReleases.length} releases total</small>
        </div>
        <div className="metric"><span>Product lineage</span><strong>{summary.products}</strong><small>{supplierCount} suppliers</small></div>
        <div className="metric"><span>Quality</span><strong>{summary.issues + summary.warnings}</strong><small>{summary.issues} blocking · {summary.warnings} warnings</small></div>
        <div className="metric metric-alert"><span>Scope</span><strong>{summary.rows}</strong><small>{configNodes.length} configuration nodes</small></div>
      </div>

      {(comparison.previous || comparison.added.length || comparison.removed.length) ? (
        <section className="domain-card domain-comparison">
          <h3>Release comparison</h3>
          <div className="comparison-grid">
            <p><strong>Previous:</strong> {comparison.previous ?? "None (first configured release)"}</p>
            <p><strong>Added products:</strong> {comparison.added.length ? comparison.added.join(", ") : "No new products"}</p>
            <p><strong>Removed products:</strong> {comparison.removed.length ? comparison.removed.join(", ") : "No removals from previous"} </p>
          </div>
          <div className="entity-actions"><Link href="/releases">All releases</Link></div>
        </section>
      ) : null}

      <section className="domain-section">
        <div className="section-heading"><h3>Products in {releaseName}</h3><span>{filteredProducts.length} of {summary.products}</span></div>
        <section className="domain-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Alias</th>
                <th>Supplier</th>
                <th>Tiers</th>
                <th>Hosts</th>
                <th>Rows</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td><strong><Link href={`/products/${encodeURIComponent(product.id)}`}>{product.canonical}</Link></strong></td>
                  <td>{product.shortName}</td>
                  <td><Link href={`/organizations/${encodeURIComponent(product.supplier)}`}>{product.supplier}</Link></td>
                  <td>{product.tiers.size}</td>
                  <td>{product.hosts.size}</td>
                  <td className="mono">{product.rows.length}</td>
                  <td>{product.issues}</td>
                </tr>
              ))}
              {!filteredProducts.length ? (
                <tr>
                  <td colSpan={7} className="empty">No rows match your query in this release.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </section>

      <section className="domain-section">
        <div className="section-heading"><h3>Active configuration nodes</h3><span>Top {configNodes.length} nodes</span></div>
        <div className="chip-list">
          {configNodes.map((id) => {
            const row = releaseRows.find((candidate) => configNodeIdentity(candidate) === id);
            if (!row) return null;
            const parts = id.split("|");
            const release = parts[0] || "Unassigned";
            const tier = parts[1] || "Unassigned";
            const resource = parts[2] || "Unassigned";
            const host = parts[3] || "Unassigned";
            return (
              <Link key={id} href={`/configuration/${encodeURIComponent(id)}`} className="domain-chip">
                <strong>{release}</strong>
                <span>{tier} / {resource} / {host}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="domain-section">
        <div className="section-heading"><h3>Release suppliers</h3><span>{supplierRows.length} suppliers</span></div>
        <div className="chip-list">
          {supplierRows.length ? supplierRows.map((supplier) => (
            <Link key={supplier.id} href={`/organizations/${encodeURIComponent(supplier.name)}`} className="domain-chip">
              <strong>{supplier.name}</strong>
              <span>{supplier.rowCount} rows · {supplier.productCount} products</span>
            </Link>
          )) : <p className="empty">No suppliers recorded for this release.</p>}
        </div>
      </section>

      <section className="domain-section">
        <div className="section-heading"><h3>Release capabilities</h3><span>{capabilityRows.length} capability values</span></div>
        <section className="domain-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Capability</th>
                <th>Products</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {capabilityRows.map((capability) => (
                <tr key={capability.id}>
                  <td><Link href={`/capabilities/${encodeURIComponent(capability.name)}`}>{capability.name}</Link></td>
                  <td>{capability.productCount}</td>
                  <td className="mono">{capability.rows}</td>
                </tr>
              ))}
              {!capabilityRows.length ? (
                <tr>
                  <td colSpan={3} className="empty">No mapped capabilities for this release.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </section>
    </DomainPageShell>
  );
}
