"use client";

import Link from "../../components/app-link";
import { useMemo, useState } from "react";
import { getConfigurationNodeSummaries, type ConfigNodeSummary } from "../../lib/baseline-data";
import { DomainPageShell } from "../../components/domain-shell";
import { useWorkspaceContext } from "../../components/workspace-context";
import { useMasterData } from "../../lib/master-data-client";
import { MasterEntityEditorDialog } from "../../components/master-data-editor";

export default function ConfigurationPage() {
  const { scopedRows, releaseLens } = useWorkspaceContext();
  const master = useMasterData();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);


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
      subtitle="Tier descriptor, Resource Platform, and host combinations reported in the baseline"
      releaseScope={releaseLens || "All releases"}
      contextMode="filter"
      actions={(<>
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tier, Resource Platform, or host" />
        </label><button className="primary-button" type="button" onClick={() => setCreating(true)}>＋ New Configuration Node</button></>)}
    >
      <section className="summary">
        <div className="metric"><span>Configuration nodes</span><strong>{nodes.length}</strong><small>{counts.rows} baseline records</small></div>
        <div className="metric"><span>Releases</span><strong>{counts.releases}</strong><small>Where nodes are reported</small></div>
        <div className="metric"><span>Products</span><strong>{nodes.reduce((sum, node) => sum + node.productCount, 0)}</strong><small>Associated placements</small></div>
      </section>

      <section className="domain-section"><div className="section-heading"><div><span className="eyebrow">CANONICAL HIERARCHY</span><h3>Governed Configuration Nodes</h3></div><span>{master.portfolio.configurationNodes.length}</span></div><div className="domain-list">{master.portfolio.configurationNodes.filter((item) => !query.trim() || `${item.name} ${item.code || ""} ${item.nodeType}`.toLowerCase().includes(query.trim().toLowerCase())).map((item) => <article className="domain-card" key={item.id}><span className={`status-pill status-${item.lifecycleStatus}`}>{item.lifecycleStatus}</span><h3><Link href={`/configuration/${encodeURIComponent(item.id)}`}>{item.code ? `${item.code} · ` : ""}{item.name}</Link></h3><p>{item.description || "Description not recorded."}</p><p className="entity-meta">{item.nodeType} · Parent {master.portfolio.configurationNodes.find((parent) => parent.id === item.parentId)?.name || "none"}</p><p className="entity-actions"><Link className="mini-action" href={`/configuration/${encodeURIComponent(item.id)}`}>Open Configuration Node</Link></p></article>)}</div></section>
      <section className="domain-section">
        <div className="section-heading"><div><span className="eyebrow">RELEASE-SPECIFIC PLACEMENTS</span><h3>Reported Tier descriptor, Resource Platform, and host combinations</h3></div><span>{filtered.length} / {nodes.length}</span></div>
        <section className="domain-list">
          {filtered.map((node) => (
            <article key={node.id} className="domain-card">
              <h3><Link href={`/configuration/${encodeURIComponent(node.id)}`}>{node.release} / {node.tier} / {node.resource}</Link></h3>
              <p className="entity-metric">Host: <strong>{node.host || "Unassigned"}</strong> · {node.rowCount} baseline records</p>
              <p className="entity-meta">{node.productCount} products reported in this node</p>
              <p className="entity-actions"><Link href={`/releases/${encodeURIComponent(node.release)}`}>View release</Link></p>
            </article>
          ))}
          {!filtered.length ? <div className="empty">No configuration nodes match this search.</div> : null}
        </section>
      </section>
      {creating ? <MasterEntityEditorDialog kind="configuration_node" portfolio={master.portfolio} onDismiss={() => setCreating(false)} onSaved={() => { setCreating(false); void master.reload(); }} /> : null}
    </DomainPageShell>
  );
}
