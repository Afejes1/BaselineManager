"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BASELINE_STORAGE_KEY,
  getOrganizationRows,
  loadRowsFromStorage,
  text,
  type Record24,
  supplierIdentity,
  productIdentityKey,
  productDisplayName,
} from "../../../lib/baseline-data";
import { dataQualityFor } from "../../../lib/baseline-quality";
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

export default function OrganizationDetailPage({ params }: { params: { id: string } }) {
  const orgId = decodeId(params.id);
  const [rows, setRows] = useState<Record24[]>(() => {
    if (typeof window === "undefined") return [];
    return loadRows();
  });
  const [query, setQuery] = useState("");

  useEffect(() => {
    setRows(loadRows());
  }, []);

  const orgRows = useMemo(() => getOrganizationRows(rows, supplierIdentity(orgId)), [rows, orgId]);
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return orgRows;
    return orgRows.filter((row) => {
      const haystack = `${text(row.LongName)} ${text(row.ShortName)} ${text(row.ReleaseName)} ${text(row.Tier)} ${text(row.Resource)} ${text(row.HW_Host)}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [orgRows, query]);

  const metrics = useMemo(() => {
    const releases = new Set(orgRows.map((row) => text(row.ReleaseName)).filter(Boolean));
    const products = new Set(orgRows.map((row) => productIdentityKey(row)));
    const issueCount = orgRows.filter((row) => dataQualityFor(row).level === "issue").length;
    const warningCount = orgRows.filter((row) => dataQualityFor(row).level === "review").length;
    return {
      releases: releases.size,
      products: products.size,
      issueCount,
      warningCount,
    };
  }, [orgRows]);

  const supplierName = orgRows[0]?.OEM ? text(orgRows[0].OEM) : orgId;

  if (!orgRows.length) {
    return (
      <DomainPageShell title="Supplier has no rows" subtitle={`No rows found for ${orgId}`} releaseScope="Unassigned">
        <section className="domain-list">
          <article className="domain-card">
            <h3>No rows found</h3>
            <p className="entity-meta">That supplier currently has no retained source rows.</p>
            <p className="entity-actions"><Link href="/organizations">Back to suppliers</Link></p>
          </article>
        </section>
      </DomainPageShell>
    );
  }

  return (
    <DomainPageShell
      title={`Supplier: ${supplierName}`}
      subtitle="OEM and supplier relationship view"
      releaseScope={`${metrics.products} products · ${metrics.releases} releases`}
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products or placement" />
        </label>
      )}
    >
      <section className="summary">
        <div className="metric"><span>Source rows</span><strong>{orgRows.length}</strong><small>For this supplier</small></div>
        <div className="metric"><span>Products</span><strong>{metrics.products}</strong><small>Across {metrics.releases} releases</small></div>
        <div className="metric"><span>Quality</span><strong>{metrics.issueCount + metrics.warningCount}</strong><small>{metrics.issueCount} blocking · {metrics.warningCount} warnings</small></div>
      </section>

      <section className="domain-section">
        <h3>Supplier rows</h3>
        <div className="domain-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Release</th>
                <th>Product</th>
                <th>Placement</th>
                <th>Host</th>
                <th>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={`${text(row["#"])}:${text(row.ReleaseName)}:${text(row.Tier)}`}>
                  <td>{text(row.ReleaseName) || "Unassigned"}</td>
                  <td><Link href={`/products/${encodeURIComponent(productIdentityKey(row))}`}>{productDisplayName(row)}</Link></td>
                  <td>{text(row.Tier) || "Unassigned"} · {text(row.Resource) || "Unassigned"}</td>
                  <td className="mono">{text(row.HW_Host) || "Unassigned"}</td>
                  <td>{`${text(row.Containerized) || "—"} · ${text(row["Container Technology"]) || "—"}`}</td>
                </tr>
              ))}
              {!visibleRows.length ? (
                <tr><td colSpan={5} className="empty">No rows match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </DomainPageShell>
  );
}
