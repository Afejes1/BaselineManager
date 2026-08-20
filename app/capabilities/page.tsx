"use client";

import Link from "../../components/app-link";
import { useMemo, useState } from "react";
import {
  getCapabilitySummaries,
  type CapabilitySummary,
} from "../../lib/baseline-data";
import { DomainPageShell } from "../../components/domain-shell";
import { useWorkspaceContext } from "../../components/workspace-context";
import { useMasterData } from "../../lib/master-data-client";
import { MasterEntityEditorDialog } from "../../components/master-data-editor";

export default function CapabilitiesPage() {
  const { scopedRows, releaseLens } = useWorkspaceContext();
  const master = useMasterData();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);


  const summaries = useMemo<CapabilitySummary[]>(() => getCapabilitySummaries(scopedRows), [scopedRows]);
  const combined = useMemo(() => {
    const sourceByName = new Map(summaries.map((item) => [item.name.trim().toLowerCase(), item]));
    const governed = master.portfolio.capabilities.map((item) => ({ master: item, summary: sourceByName.get(item.name.trim().toLowerCase()) }));
    const names = new Set(governed.map((item) => item.master.name.trim().toLowerCase()));
    return [...governed, ...summaries.filter((item) => !names.has(item.name.trim().toLowerCase())).map((summary) => ({ master: undefined, summary }))];
  }, [master.portfolio.capabilities, summaries]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return combined;
    return combined.filter(({ master: record, summary }) => `${record?.name || summary?.name || ""} ${record?.code || ""} ${record?.lifecycleStatus || ""}`.toLowerCase().includes(normalized));
  }, [combined, query]);

  return (
    <DomainPageShell
      title="Capabilities"
      subtitle="Capabilities mapped from reported baseline notes"
      releaseScope={releaseLens || "All releases"}
      contextMode="filter"
      actions={(<>
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter capability text" />
        </label><button className="primary-button" type="button" onClick={() => setCreating(true)}>＋ New Capability</button></>)}
    >
      <section className="summary">
        <div className="metric"><span>Capabilities</span><strong>{combined.length}</strong><small>Governed capability identities</small></div>
        <div className="metric"><span>Records linked</span><strong>{summaries.reduce((sum, cap) => sum + cap.rowCount, 0)}</strong><small>Baseline records with capability text</small></div>
      </section>

      <section className="domain-list">
        {filtered.map(({ master: record, summary: capability }) => (
          <article key={record?.id || capability?.id} className="domain-card">
            <span className={`status-pill status-${record?.lifecycleStatus || "active"}`}>{record?.lifecycleStatus || "active"}</span>
            <h3><Link href={`/capabilities/${encodeURIComponent(record?.id || capability?.name || "")}`}>{record?.name || capability?.name}</Link></h3>
            <p>{record?.description || "Capability description not recorded."}</p>
            <p className="entity-metric">{capability?.productCount || 0} products · {capability?.rowCount || 0} baseline records</p>
            <p className="entity-actions"><Link className="mini-action" href={`/capabilities/${encodeURIComponent(record?.id || capability?.name || "")}`}>Open Capability</Link></p>
          </article>
        ))}
        {!filtered.length ? <div className="empty">No capabilities found for this filter.</div> : null}
      </section>
      {creating ? <MasterEntityEditorDialog kind="capability" portfolio={master.portfolio} onDismiss={() => setCreating(false)} onSaved={() => { setCreating(false); void master.reload(); }} /> : null}
    </DomainPageShell>
  );
}
