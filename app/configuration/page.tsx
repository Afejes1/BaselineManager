"use client";

import Link from "../../components/app-link";
import { useMemo, useState } from "react";
import { getConfigurationNodeSummaries, type ConfigNodeSummary } from "../../lib/baseline-data";
import { DomainPageShell } from "../../components/domain-shell";
import { useWorkspaceContext } from "../../components/workspace-context";

export default function ConfigurationPage() {
  const { scopedRows, releaseLens } = useWorkspaceContext();
  const [query, setQuery] = useState("");


  const nodes = useMemo<ConfigNodeSummary[]>(() => getConfigurationNodeSummaries(scopedRows), [scopedRows]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return nodes;
    return nodes.filter((node) => {
      const haystack = `${node.release} ${node.tier} ${node.resource} ${node.host}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [nodes, query]);

  const counts = {
    rows: nodes.reduce((sum, node) => sum + node.rowCount, 0),
    releases: new Set(nodes.map((node) => node.release)).size,
    products: new Set(nodes.flatMap((node) => Array(node.productCount))).size,
  };

  return (
    <DomainPageShell
      title="Configuration Nodes"
      subtitle="Tier, resource, and host combinations reported in the baseline"
      releaseScope={releaseLens || "All releases"}
      contextMode="filter"
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tier, resource, or host" />
        </label>
      )}
    >
      <section className="summary">
        <div className="metric"><span>Configuration nodes</span><strong>{nodes.length}</strong><small>{counts.rows} source rows</small></div>
        <div className="metric"><span>Releases</span><strong>{counts.releases}</strong><small>Where nodes are reported</small></div>
        <div className="metric"><span>Products</span><strong>{nodes.reduce((sum, node) => sum + node.productCount, 0)}</strong><small>Associated placements</small></div>
      </section>

      <section className="domain-section">
        <div className="section-heading"><h3>Configuration nodes</h3><span>{filtered.length} / {nodes.length}</span></div>
        <section className="domain-list">
          {filtered.map((node) => (
            <article key={node.id} className="domain-card">
              <h3><Link href={`/configuration/${encodeURIComponent(node.id)}`}>{node.release} / {node.tier} / {node.resource}</Link></h3>
              <p className="entity-metric">Host: <strong>{node.host || "Unassigned"}</strong> · {node.rowCount} source rows</p>
              <p className="entity-meta">{node.productCount} products reported in this node</p>
              <p className="entity-actions"><Link href={`/releases/${encodeURIComponent(node.release)}`}>View release</Link></p>
            </article>
          ))}
          {!filtered.length ? <div className="empty">No configuration nodes match this search.</div> : null}
        </section>
      </section>
    </DomainPageShell>
  );
}
