"use client";

import Link from "../../components/app-link";
import { useMemo, useState } from "react";
import {
  getOrganizationSummaries,
  type OrganizationSummary,
} from "../../lib/baseline-data";
import { DomainPageShell } from "../../components/domain-shell";
import { useWorkspaceContext } from "../../components/workspace-context";
import { useMasterData } from "../../lib/master-data-client";
import { MasterEntityEditorDialog } from "../../components/master-data-editor";

export default function OrganizationsPage() {
  const { scopedRows, releaseLens } = useWorkspaceContext();
  const master = useMasterData();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);


  const summaries = useMemo<OrganizationSummary[]>(() => getOrganizationSummaries(scopedRows), [scopedRows]);
  const combined = useMemo(() => {
    const sourceByName = new Map(summaries.map((item) => [item.name.trim().toLowerCase(), item]));
    const governed = master.portfolio.organizations.map((item) => ({ master: item, summary: sourceByName.get(item.name.trim().toLowerCase()) }));
    const names = new Set(governed.map((item) => item.master.name.trim().toLowerCase()));
    return [...governed, ...summaries.filter((item) => !names.has(item.name.trim().toLowerCase())).map((summary) => ({ master: undefined, summary }))];
  }, [master.portfolio.organizations, summaries]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return combined;
    return combined.filter(({ master: record, summary }) => `${record?.name || summary?.name || ""} ${record?.organizationType || ""} ${record?.lifecycleStatus || ""}`.toLowerCase().includes(normalized));
  }, [combined, query]);

  const totalProducts = summaries.reduce((sum, org) => sum + org.productCount, 0);
  const totalRows = summaries.reduce((sum, org) => sum + org.rowCount, 0);

  return (
    <DomainPageShell
      title="Suppliers"
      subtitle="Organization / OEM perspective"
      releaseScope={releaseLens || "All releases"}
      contextMode="filter"
      actions={(<>
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter supplier name" />
        </label><button className="primary-button" type="button" onClick={() => setCreating(true)}>＋ New Organization</button></>)}
    >
      <section className="summary">
        <div className="metric"><span>Organizations</span><strong>{combined.length}</strong><small>Governed identities</small></div>
        <div className="metric"><span>Products</span><strong>{totalProducts}</strong><small>From all product placements</small></div>
        <div className="metric"><span>Baseline records</span><strong>{totalRows}</strong><small>Across suppliers</small></div>
      </section>

      <section className="domain-list">
        {filtered.map(({ master: record, summary: org }) => (
          <article key={record?.id || org?.id} className="domain-card">
            <span className={`status-pill status-${record?.lifecycleStatus || "active"}`}>{record?.lifecycleStatus || "active"}</span>
            <h3><Link href={`/organizations/${encodeURIComponent(record?.id || org?.name || "")}`}>{record?.name || org?.name || "Unassigned"}</Link></h3>
            <p className="entity-metric">{org?.productCount || 0} products · {org?.rowCount || 0} baseline records</p>
            <p className="entity-meta">{record?.organizationType || "Type not recorded"} · Releases: {org?.releases.join(", ") || "No baseline records yet"}</p>
            <p className="entity-actions"><Link className="mini-action" href={`/organizations/${encodeURIComponent(record?.id || org?.name || "")}`}>Open Organization</Link></p>
          </article>
        ))}
        {!filtered.length ? <div className="empty">No suppliers match this filter.</div> : null}
      </section>
      {creating ? <MasterEntityEditorDialog kind="organization" portfolio={master.portfolio} onDismiss={() => setCreating(false)} onSaved={() => { setCreating(false); void master.reload(); }} /> : null}
    </DomainPageShell>
  );
}
