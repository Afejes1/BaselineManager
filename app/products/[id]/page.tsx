"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BASELINE_STORAGE_KEY,
  getProductRows,
  text,
  loadRowsFromStorage,
  type Record24,
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

function summarizeRows(rows: Record24[]) {
  const releases = Array.from(new Set(rows.map((row) => text(row.ReleaseName)) ).filter(Boolean)).sort();
  const tiers = Array.from(new Set(rows.map((row) => text(row.Tier)).filter(Boolean)).sort());
  const hosts = Array.from(new Set(rows.map((row) => text(row.HW_Host)).filter(Boolean)).sort());
  const resources = Array.from(new Set(rows.map((row) => text(row.Resource)).filter(Boolean)).sort());
  const issueCount = rows.filter((row) => dataQualityFor(row).level === "issue").length;
  const warningCount = rows.filter((row) => dataQualityFor(row).level === "review").length;
  return { releases, tiers, hosts, resources, issueCount, warningCount };
}

export default function ProductDetailPage({ params }: { params: { id: string } }) {
  const productId = decodeId(params.id);
  const [rows, setRows] = useState<Record24[]>(() => {
    if (typeof window === "undefined") return [];
    return loadRows();
  });
  const [query, setQuery] = useState("");

  useEffect(() => {
    setRows(loadRows());
  }, []);

  const productRows = useMemo(() => getProductRows(rows, productId), [rows, productId]);
  const { releases, tiers, hosts, resources, issueCount, warningCount } = useMemo(() => summarizeRows(productRows), [productRows]);
  const canonical = productRows[0] ? text(productRows[0].LongName || productRows[0].ShortName || "Unnamed product") : "Product not found";
  const supplier = text(productRows[0]?.OEM || "Unassigned");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!normalizedQuery) return productRows;
    return productRows.filter((row) => {
      const haystack = `${text(row.ReleaseName)} ${text(row.Tier)} ${text(row.Resource)} ${text(row.HW_Host)} ${text(row["SW Language"])} ${text(row["Container Technology"])} ${text(row.OEM)}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [productRows, normalizedQuery]);

  const metrics = {
    releases: releases.length,
    tiers: tiers.length,
    resources: resources.length,
    hosts: hosts.length,
  };

  return (
    <DomainPageShell
      title={`Product: ${canonical}`}
      subtitle="Canonical product landing page"
      releaseScope={`${productRows.length || 0} reported rows`}
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search placements or release rows" />
        </label>
      )}
    >
      <section className="summary">
        <div className="metric">
          <span>Source rows</span>
          <strong>{productRows.length}</strong>
          <small>Across {metrics.releases} releases</small>
        </div>
        <div className="metric"><span>Deployment context</span><strong>{metrics.tiers}</strong><small>{metrics.tiers} tiers · {metrics.resources} resources · {metrics.hosts} hosts</small></div>
        <div className="metric"><span>Supplier</span><strong>{supplier || "Unassigned"}</strong><small>Primary source owner</small></div>
        <div className="metric metric-alert"><span>Quality</span><strong>{issueCount + warningCount}</strong><small>{issueCount} blocking · {warningCount} warnings</small></div>
      </section>

      <section className="domain-section">
        <h3>Cross-domain links</h3>
        <div className="chip-list">
          <Link href={`/organizations/${encodeURIComponent(supplier)}`} className="domain-chip"><strong>Supplier</strong><span>{supplier || "Unassigned"}</span></Link>
          {releases.map((release) => <Link key={release} href={`/releases/${encodeURIComponent(release)}`} className="domain-chip"><strong>Release</strong><span>{release}</span></Link>)}
        </div>
      </section>

      <section className="domain-section">
        <h3>Reported source occurrences</h3>
        <section className="domain-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Release</th>
                <th>Tier</th>
                <th>Resource</th>
                <th>Host</th>
                <th>Storage</th>
                <th>Language</th>
                <th>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={`${String(row.ReleaseName)}:${String(row["#"])}`}>
                  <td>{text(row.ReleaseName) || "Unassigned"}</td>
                  <td>{text(row.Tier) || "Unassigned"}</td>
                  <td>{text(row.Resource) || "Unassigned"}</td>
                  <td className="mono">{text(row.HW_Host) || "Unassigned"}</td>
                  <td>{`${text(row["HW_Storage_Type"]) || "—"}${text(row["HW_Storage (GB)"]) ? ` / ${text(row["HW_Storage (GB)"])}` : ""}`}</td>
                  <td>{text(row["SW Language"]) || "—"}</td>
                  <td>{`${text(row.Containerized) || "—"} · ${text(row["Container Technology"]) || "—"}`}</td>
                </tr>
              ))}
              {!visibleRows.length ? (
                <tr><td colSpan={7} className="empty">{productRows.length ? "No rows match your search." : "No source rows are attached to this product."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </section>
    </DomainPageShell>
  );
}
