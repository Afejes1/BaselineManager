"use client";

import Link from "../../../components/app-link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  getCapabilityRows,
  text,
  productIdentityKey,
  productDisplayName,
} from "../../../lib/baseline-data";
import { DomainPageShell } from "../../../components/domain-shell";
import { useBaselineWorkspace } from "../../../lib/baseline-client";

function decodeId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function CapabilityDetailPage() {
  const params = useParams<{ id?: string }>();
  const capability = decodeId(params.id ?? "");
  const { rows } = useBaselineWorkspace();
  const [query, setQuery] = useState("");


  const capabilityRows = useMemo(() => getCapabilityRows(rows, capability), [rows, capability]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!normalizedQuery) return capabilityRows;
    return capabilityRows.filter((row) => {
      const haystack = `${text(row.ReleaseName)} ${text(row.LongName)} ${text(row.ShortName)} ${text(row.OEM)} ${text(row.Resource)}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [capabilityRows, normalizedQuery]);

  const stats = useMemo(() => {
    const releases = new Set(capabilityRows.map((row) => text(row.ReleaseName)).filter(Boolean));
    const products = new Set(capabilityRows.map((row) => productIdentityKey(row))).size;
    return { releases: releases.size, products };
  }, [capabilityRows]);

  if (!capabilityRows.length) {
    return (
      <DomainPageShell title="Capability not found" subtitle={`No records for ${capability}`} releaseScope="Unassigned">
        <section className="domain-list">
          <article className="domain-card">
            <h3>Unknown capability</h3>
            <p className="entity-meta">No retained rows are currently mapped to this capability.</p>
            <p className="entity-actions"><Link href="/capabilities">Back to capabilities</Link></p>
          </article>
        </section>
      </DomainPageShell>
    );
  }

  return (
    <DomainPageShell
      title={`Capability: ${capability}`}
      subtitle="Product capability mapping"
      releaseScope={`${stats.products} products`}
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search rows and products" />
        </label>
      )}
    >
      <section className="summary">
        <div className="metric"><span>Capability</span><strong>{capability}</strong><small>As reported in source notes</small></div>
        <div className="metric"><span>Rows</span><strong>{capabilityRows.length}</strong><small>Source rows linked</small></div>
        <div className="metric"><span>Products</span><strong>{stats.products}</strong><small>Across {stats.releases} releases</small></div>
      </section>

      <section className="domain-section">
        <h3>Rows for this capability</h3>
        <div className="domain-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Release</th>
                <th>Placement</th>
                <th>Supplier</th>
                <th>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={`${text(row["#"])}:${text(row.ReleaseName)}:${text(row.Tier)}`}>
                  <td><Link href={`/products/${encodeURIComponent(productIdentityKey(row))}`}>{productDisplayName(row)}</Link></td>
                  <td>{text(row.ReleaseName) || "Unassigned"}</td>
                  <td>{text(row.Resource) || "Unassigned"} / {text(row.HW_Host) || "Unassigned"}</td>
                  <td><Link href={`/organizations/${encodeURIComponent(text(row.OEM) || "Unassigned")}`}>{text(row.OEM) || "Unassigned"}</Link></td>
                  <td>{`${text(row.TechStackType) || "—"} · ${text(row.Containerized) || "—"}`}</td>
                </tr>
              ))}
              {!visibleRows.length ? <tr><td colSpan={5} className="empty">No rows match this filter.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </DomainPageShell>
  );
}
