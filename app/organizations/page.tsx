"use client";

import Link from "../../components/app-link";
import { useMemo, useState } from "react";
import {
  getOrganizationSummaries,
  type OrganizationSummary,
} from "../../lib/baseline-data";
import { DomainPageShell } from "../../components/domain-shell";
import { useWorkspaceContext } from "../../components/workspace-context";

export default function OrganizationsPage() {
  const { scopedRows, releaseLens } = useWorkspaceContext();
  const [query, setQuery] = useState("");


  const summaries = useMemo<OrganizationSummary[]>(() => getOrganizationSummaries(scopedRows), [scopedRows]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return summaries;
    return summaries.filter((org) => `${org.name} ${org.id}`.toLowerCase().includes(normalized));
  }, [summaries, query]);

  const totalProducts = summaries.reduce((sum, org) => sum + org.productCount, 0);
  const totalRows = summaries.reduce((sum, org) => sum + org.rowCount, 0);

  return (
    <DomainPageShell
      title="Suppliers"
      subtitle="Organization / OEM perspective"
      releaseScope={releaseLens || "All releases"}
      contextMode="filter"
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter supplier name" />
        </label>
      )}
    >
      <section className="summary">
        <div className="metric"><span>Organizations</span><strong>{summaries.length}</strong><small>Distinct supplier identities</small></div>
        <div className="metric"><span>Products</span><strong>{totalProducts}</strong><small>From all product placements</small></div>
        <div className="metric"><span>Rows</span><strong>{totalRows}</strong><small>Source records across suppliers</small></div>
      </section>

      <section className="domain-list">
        {filtered.map((org) => (
          <article key={org.id} className="domain-card">
            <h3><Link href={`/organizations/${encodeURIComponent(org.name)}`}>{org.name || "Unassigned"}</Link></h3>
            <p className="entity-metric">{org.productCount} products · {org.rowCount} source rows</p>
            <p className="entity-meta">Releases: {org.releases.join(", ") || "Unassigned"}</p>
            <p className="entity-actions"><Link href={`/organizations/${encodeURIComponent(org.name)}`}>Open supplier</Link></p>
          </article>
        ))}
        {!filtered.length ? <div className="empty">No suppliers match this filter.</div> : null}
      </section>
    </DomainPageShell>
  );
}
