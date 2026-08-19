"use client";

import Link from "../../components/app-link";
import { useMemo, useState } from "react";
import { DomainPageShell } from "../../components/domain-shell";
import { ReleaseEditorDialog } from "../../components/master-data-editor";
import { useWorkspaceContext } from "../../components/workspace-context";
import { useMasterData } from "../../lib/master-data-client";
import { displayStatus } from "../../lib/governance-model";

export default function ReleasesPage() {
  const { releaseLens } = useWorkspaceContext();
  const master = useMasterData();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return master.portfolio.releases.filter((entry) => !normalized || `${entry.name} ${entry.code || ""} ${entry.status} ${entry.stateRole}`.toLowerCase().includes(normalized));
  }, [master.portfolio.releases, query]);
  const visible = master.portfolio.releases.filter((item) => !["cancelled", "superseded"].includes(item.status));
  const targets = visible.filter((item) => item.targetDate).sort((a, b) => String(a.targetDate).localeCompare(String(b.targetDate)));

  return <DomainPageShell title="Releases" subtitle="Govern release identity, lifecycle, schedule, baseline content, and comparison role." releaseScope={releaseLens || `${master.portfolio.releases.length} governed releases`} contextMode="browse" actions={<><label className="search" style={{ width: "280px" }}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search releases" /></label><button className="primary-button" type="button" onClick={() => setCreating(true)}>＋ New Release</button></>}>
    {master.error ? <p className="error-copy">{master.error}</p> : null}
    <div className="summary release-summary-row"><div className="metric"><span>Governed Releases</span><strong>{master.portfolio.releases.length}</strong><small>{visible.length} active planning positions</small></div><div className="metric"><span>Baseline records</span><strong>{master.portfolio.releases.reduce((sum, item) => sum + Number(item.baselineRecordCount || 0), 0)}</strong><small>Across all Release positions</small></div><div className="metric"><span>Next target date</span><strong>{targets[0]?.targetDate || "Not set"}</strong><small>{targets[0]?.name || "No scheduled Release"}</small></div></div>
    <section className="domain-list">{master.loading ? <div className="empty">Loading Releases…</div> : filtered.length ? filtered.map((release) => <article key={release.id} className={releaseLens === release.name ? "domain-card domain-card-selected" : "domain-card"}><div className="section-toolbar"><div><span className={`status-pill status-${release.status}`}>{displayStatus(release.status)}</span><h3><Link href={`/releases/${encodeURIComponent(release.id)}`}>{release.name}</Link></h3></div><span>{release.code || "No code"}</span></div><p>{release.description || "Release description not recorded."}</p><p className="entity-metric">{release.baselineRecordCount} baseline records · {release.productCount} products</p><p className="entity-meta">{displayStatus(release.stateRole)} analytical role · Target {release.targetDate || "not scheduled"} · Owner {release.owner || "unassigned"}</p><p className="entity-actions"><Link className="mini-action" href={`/releases/${encodeURIComponent(release.id)}`}>Open Release</Link></p></article>) : <div className="empty">No Releases match the current search.</div>}</section>
    {creating ? <ReleaseEditorDialog portfolio={master.portfolio} onDismiss={() => setCreating(false)} onSaved={() => { setCreating(false); void master.reload(); }} /> : null}
  </DomainPageShell>;
}
