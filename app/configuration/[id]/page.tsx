"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BASELINE_STORAGE_KEY,
  getConfigurationRows,
  loadRowsFromStorage,
  productIdentityKey,
  productDisplayName,
  text,
  type Record24,
} from "../../../lib/baseline-data";
import { DomainPageShell } from "../../../components/domain-shell";

function decodeId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function loadRows(): Record24[] {
  if (typeof window === "undefined") return [];
  return loadRowsFromStorage(window.localStorage.getItem(BASELINE_STORAGE_KEY));
}

export default function ConfigurationDetailPage({ params }: { params: { id: string } }) {
  const nodeId = decodeId(params.id);
  const [rows, setRows] = useState<Record24[]>(() => {
    if (typeof window === "undefined") return [];
    return loadRows();
  });
  const [query, setQuery] = useState("");

  useEffect(() => {
    setRows(loadRows());
  }, []);

  const configRows = useMemo(() => getConfigurationRows(rows, nodeId), [rows, nodeId]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (!normalizedQuery) return configRows;
    return configRows.filter((row) => {
      const haystack = `${text(row.ReleaseName)} ${text(row.LongName)} ${text(row.ShortName)} ${text(row.HW_Host)} ${text(row.OEM)}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [configRows, normalizedQuery]);

  const summary = useMemo(() => {
    const releases = new Set(configRows.map((row) => text(row.ReleaseName)).filter(Boolean));
    const products = new Map<string, { canonical: string; shortName: string }>();
    let tiers = new Set<string>();
    for (const row of configRows) {
      tiers.add(text(row.Tier));
      const productId = productIdentityKey(row);
      if (!products.has(productId)) {
        products.set(productId, { canonical: productDisplayName(row), shortName: text(row.ShortName) });
      }
    }
    return {
      releaseCount: releases.size,
      resource: text(configRows[0]?.Resource) || "Unassigned",
      tier: text(configRows[0]?.Tier) || "Unassigned",
      host: text(configRows[0]?.HW_Host) || "Unassigned",
      productCount: products.size,
      releaseName: text(configRows[0]?.ReleaseName) || "Unassigned",
      productItems: Array.from(products.values()),
      releases: Array.from(releases),
      tierCount: tiers.size,
    };
  }, [configRows]);

  if (!configRows.length) {
    return (
      <DomainPageShell
        title="Configuration node not found"
        subtitle="No rows currently map to this placement"
        releaseScope="Unassigned"
      >
        <section className="domain-list">
          <article className="domain-card">
            <h3>Empty configuration node</h3>
            <p className="entity-meta">Try reopening from the Configuration page after the source dataset changes.</p>
            <p className="entity-actions"><Link href="/configuration">Back to configuration</Link></p>
          </article>
        </section>
      </DomainPageShell>
    );
  }

  return (
    <DomainPageShell
      title={`Configuration: ${summary.tier} / ${summary.resource} / ${summary.host}`}
      subtitle={`Derived node in ${summary.releaseName}`}
      releaseScope={`${summary.productCount} products in node`}
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product or release rows" />
        </label>
      )}
    >
      <section className="summary">
        <div className="metric"><span>Release scope</span><strong>{summary.releaseName}</strong><small>{summary.releaseCount} releases represented</small></div>
        <div className="metric"><span>Nodes</span><strong>{summary.tierCount}</strong><small>{summary.tier} across {summary.productCount} products</small></div>
        <div className="metric"><span>Host</span><strong>{summary.host}</strong><small>Configuration identity</small></div>
        <div className="metric"><span>Rows</span><strong>{configRows.length}</strong><small>{filteredRows.length} currently visible</small></div>
      </section>

      <section className="domain-section">
        <h3>Products on this node</h3>
        <div className="chip-list">
          {summary.productItems.map((product) => (
            <Link
              key={product.canonical + product.shortName}
              href={`/products/${encodeURIComponent(productIdentityKey({ ...product, LongName: product.canonical } as unknown as Record24))}`}
              className="domain-chip"
            >
              <strong>{product.canonical}</strong>
              <span>{product.shortName || "—"}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="domain-section">
        <h3>Source rows at this configuration node</h3>
        <div className="domain-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Release</th>
                <th>Host</th>
                <th>Storage</th>
                <th>Runtime</th>
                <th>Supplier</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={`${text(row["#"])}:${text(row.ReleaseName)}:${text(row.HW_Host)}`}>
                  <td><Link href={`/products/${encodeURIComponent(productIdentityKey(row))}`}>{productDisplayName(row)}</Link></td>
                  <td>{text(row.ReleaseName) || "Unassigned"}</td>
                  <td className="mono">{text(row.HW_Host) || "Unassigned"}</td>
                  <td>{`${text(row["HW_Storage_Type"]) || "—"}${text(row["HW_Storage (GB)"]) ? ` / ${text(row["HW_Storage (GB)"])}` : ""}`}</td>
                  <td>{`${text(row.Containerized) || "—"} · ${text(row["Container Technology"]) || "—"}`}</td>
                  <td><Link href={`/organizations/${encodeURIComponent(text(row.OEM) || "Unassigned")}`}>{text(row.OEM) || "Unassigned"}</Link></td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr><td colSpan={6} className="empty">No rows match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </DomainPageShell>
  );
}
