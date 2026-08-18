"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BASELINE_STORAGE_KEY,
  getCapabilitySummaries,
  loadRowsFromStorage,
  type CapabilitySummary,
  type Record24,
} from "../../lib/baseline-data";
import { DomainPageShell } from "../../components/domain-shell";

function loadRows(): Record24[] {
  if (typeof window === "undefined") return [];
  return loadRowsFromStorage(window.localStorage.getItem(BASELINE_STORAGE_KEY));
}

export default function CapabilitiesPage() {
  const [rows, setRows] = useState<Record24[]>(() => {
    if (typeof window === "undefined") return [];
    return loadRows();
  });
  const [query, setQuery] = useState("");

  useEffect(() => {
    setRows(loadRows());
  }, []);

  const summaries = useMemo<CapabilitySummary[]>(() => getCapabilitySummaries(rows), [rows]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return summaries;
    return summaries.filter((cap) => cap.name.toLowerCase().includes(normalized));
  }, [summaries, query]);

  return (
    <DomainPageShell
      title="Capabilities"
      subtitle="Governed capabilities mapped from source notes"
      releaseScope={`${summaries.length} capability values`}
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter capability text" />
        </label>
      )}
    >
      <section className="summary">
        <div className="metric"><span>Capabilities</span><strong>{summaries.length}</strong><small>Unique source capability values</small></div>
        <div className="metric"><span>Rows linked</span><strong>{summaries.reduce((sum, cap) => sum + cap.rowCount, 0)}</strong><small>Source rows with capability text</small></div>
      </section>

      <section className="domain-list">
        {filtered.map((capability) => (
          <article key={capability.id} className="domain-card">
            <h3><Link href={`/capabilities/${encodeURIComponent(capability.name)}`}>{capability.name}</Link></h3>
            <p className="entity-metric">{capability.productCount} products · {capability.rowCount} source rows</p>
            <p className="entity-actions"><Link href={`/capabilities/${encodeURIComponent(capability.name)}`}>Open capability</Link></p>
          </article>
        ))}
        {!filtered.length ? <div className="empty">No capabilities found for this filter.</div> : null}
      </section>
    </DomainPageShell>
  );
}
