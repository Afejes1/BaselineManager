"use client";

import Link from "../../components/app-link";
import { useMemo, useState } from "react";
import {
  getReleaseSummaries,
  getReleaseSummary,
} from "../../lib/baseline-data";
import { DomainPageShell } from "../../components/domain-shell";
import { useWorkspaceContext } from "../../components/workspace-context";

export default function ReleasesPage() {
  const { rows, releaseLens } = useWorkspaceContext();
  const [query, setQuery] = useState("");


  const releases = useMemo(() => getReleaseSummaries(rows), [rows]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return releases;
    return releases.filter((entry) => entry.release.toLowerCase().includes(normalized));
  }, [query, releases]);

  const totals = {
    rows: rows.length,
    releases: releases.length,
    products: new Set(rows.map((row) => String(row["LongName"] || row.ShortName || "")).filter(Boolean)).size,
  };

  const releaseTotals = releases.reduce(
    (acc, release) => {
      acc.rows += release.rows;
      acc.products += release.products;
      return acc;
    },
    { rows: 0, products: 0 },
  );

  return (
    <DomainPageShell
      title="Releases"
      subtitle="Select a release for its operational home page"
      releaseScope={releaseLens || `${releases.length} releases in working dataset`}
      contextMode="browse"
      actions={(
        <>
          <label className="search" style={{ width: "280px" }}>
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search release names" />
          </label>
        </>
      )}
    >
      <div className="summary release-summary-row">
        <div className="metric"><span>Baseline records</span><strong>{releaseTotals.rows}</strong><small>Across visible releases</small></div>
        <div className="metric"><span>Baseline releases</span><strong>{releases.length}</strong><small>{totals.products} products</small></div>
        <div className="metric"><span>Unresolved blockers</span><strong>{releases.reduce((sum, release) => sum + release.issues, 0)}</strong><small>{releases.reduce((sum, release) => sum + release.warnings, 0)} warnings</small></div>
      </div>

      <section className="domain-list">
        {filtered.length === 0 ? (
          <div className="empty">No releases match {query ? `"${query}"` : "the current scope"}.</div>
        ) : (
          filtered.map((release) => {
            const detail = getReleaseSummary(rows, release.release);
            return (
              <article key={release.release} className={releaseLens === release.release ? "domain-card domain-card-selected" : "domain-card"}>
                <h3><Link href={`/releases/${encodeURIComponent(release.release)}`}>{release.release}</Link></h3>
                <p className="entity-metric">{release.rows} rows · {release.products} products · {release.tiers} tiers</p>
                <p className="entity-meta">{release.issues} blocking issues · {release.warnings} warnings · {release.hosts} hosts</p>
                <p className="entity-actions"><Link href={`/releases/${encodeURIComponent(release.release)}`}>Open release</Link></p>
                <p className="entity-meta">{detail?.issues ? `Current quality blockers: ${detail.issues}` : "Ready for operational view"}</p>
              </article>
            );
          })
        )}
      </section>
    </DomainPageShell>
  );
}
