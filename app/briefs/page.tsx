"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BASELINE_STORAGE_KEY,
  loadRowsFromStorage,
  type Record24,
} from "../../lib/baseline-data";
import {
  BRIEF_STORAGE_KEY,
  INITIATIVE_STORAGE_KEY,
  briefStatuses,
  getInitiativeReleaseOptions,
  loadBriefs,
  loadInitiatives,
  makeBriefFromInitiative,
  type Brief,
  type BriefStatus,
  type Initiative,
} from "../../lib/steering-data";
import { DomainPageShell } from "../../components/domain-shell";

function loadRows(): Record24[] {
  if (typeof window === "undefined") return [];
  return loadRowsFromStorage(window.localStorage.getItem(BASELINE_STORAGE_KEY));
}

function loadFromStorage() {
  if (typeof window === "undefined") {
    return {
      initiatives: [] as Initiative[],
      briefs: [] as Brief[],
      rows: [] as Record24[],
    };
  }
  return {
    initiatives: loadInitiatives(window.localStorage.getItem(INITIATIVE_STORAGE_KEY)),
    briefs: loadBriefs(window.localStorage.getItem(BRIEF_STORAGE_KEY)),
    rows: loadRows(),
  };
}

function formatDate(value: string) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function decodeId(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function BriefsPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [rows, setRows] = useState<Record24[]>(() => loadRows());
  const [initiatives, setInitiatives] = useState<Initiative[]>(() => loadFromStorage().initiatives);
  const [briefs, setBriefs] = useState<Brief[]>(() => loadFromStorage().briefs);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BriefStatus | "All">("All");
  const [selectedInitiativeId, setSelectedInitiativeId] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const initial = loadFromStorage();
    setRows(initial.rows);
    setInitiatives(initial.initiatives);
    setBriefs(initial.briefs);
  }, []);

  useEffect(() => {
    const preselected = searchParams.get("initiative");
    if (!preselected) return;
    const normalized = decodeId(preselected);
    if (initiatives.some((initiative) => initiative.id === normalized)) {
      setSelectedInitiativeId(normalized);
    }
  }, [searchParams, initiatives]);

  useEffect(() => {
    if (!notice) return;
    const handle = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(handle);
  }, [notice]);

  const releases = useMemo(() => getInitiativeReleaseOptions(rows), [rows]);
  const releaseCount = Math.max(releases.length - 1, 0);

  const initiativeLookup = useMemo(() => {
    const map = new Map<string, Initiative>();
    for (const initiative of initiatives) {
      map.set(initiative.id, initiative);
    }
    return map;
  }, [initiatives]);

  const initiativesSorted = useMemo(() => [...initiatives].sort((left, right) =>
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  ), [initiatives]);

  const selectedInitiative = useMemo(() => initiativeLookup.get(selectedInitiativeId) ?? null, [initiativeLookup, selectedInitiativeId]);

  const filteredBriefs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return briefs
      .filter((brief) => statusFilter === "All" || brief.status === statusFilter)
      .filter((brief) => {
        if (!normalized) return true;
        const initiativeTitle = initiativeLookup.get(brief.initiativeId)?.title || brief.initiativeTitle;
        const haystack = `${brief.title} ${brief.releaseScope} ${brief.status} ${initiativeTitle}`.toLowerCase();
        return haystack.includes(normalized);
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [briefs, initiativeLookup, query, statusFilter]);

  function persist(next: Brief[]) {
    const sorted = [...next].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    setBriefs(sorted);
    window.localStorage.setItem(BRIEF_STORAGE_KEY, JSON.stringify(sorted));
  }

  function createBrief() {
    if (!selectedInitiative) {
      setNotice("Choose an initiative before creating a brief.");
      return;
    }
    const nextBrief = makeBriefFromInitiative(rows, selectedInitiative);
    persist([nextBrief, ...briefs]);
    setNotice(`Created brief "${nextBrief.title}".`);
    window.history.replaceState({}, "", pathname);
  }

  function setBriefStatus(briefId: string, nextStatus: BriefStatus) {
    const nextBriefs = briefs.map((item) => (item.id === briefId ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() } : item));
    persist(nextBriefs);
    setNotice("Brief status updated.");
  }

  function deleteBrief(briefId: string) {
    persist(briefs.filter((item) => item.id !== briefId));
    setNotice("Brief deleted.");
  }

  return (
    <DomainPageShell
      title="Executive Briefs"
      subtitle="Leadership reporting outputs derived from initiatives and source scope."
      releaseScope={`${briefs.length} briefs · ${releaseCount ? `${releaseCount} releases` : "no releases loaded"}`}
      actions={(
        <>
          <label className="search" style={{ width: "240px" }}>
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search briefs" />
          </label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as BriefStatus | "All")}>
            <option>All</option>
            {briefStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
          <select
            value={selectedInitiativeId}
            onChange={(event) => setSelectedInitiativeId(event.target.value)}
            style={{ minWidth: "240px" }}
          >
            <option value="">Create from initiative…</option>
            {initiativesSorted.map((initiative) => (
              <option key={initiative.id} value={initiative.id}>
                {initiative.title}
              </option>
            ))}
          </select>
          <button className="primary-button" onClick={createBrief} disabled={!selectedInitiativeId}>
            ＋ New brief
          </button>
        </>
      )}
    >
      <div className="summary">
        <div className="metric">
          <span>Total briefs</span>
          <strong>{briefs.length}</strong>
          <small>Generated leadership outputs</small>
        </div>
        <div className="metric">
          <span>Draft</span>
          <strong>{briefs.filter((brief) => brief.status === "Draft").length}</strong>
          <small>Needs final stewardship before circulation</small>
        </div>
        <div className="metric">
          <span>Reviewed</span>
          <strong>{briefs.filter((brief) => brief.status === "Reviewed").length}</strong>
          <small>Stewardship complete</small>
        </div>
        <div className="metric metric-alert">
          <span>Published</span>
          <strong>{briefs.filter((brief) => brief.status === "Published").length}</strong>
          <small>Ready for leadership audience</small>
        </div>
      </div>

      {selectedInitiative ? (
        <section className="domain-section">
          <article className="domain-card">
            <div className="section-heading">
              <h3>Initiative-scoped generation</h3>
              <span>Pre-selected from navigation</span>
            </div>
            <p className="entity-meta">{selectedInitiative.title}</p>
            <p className="entity-meta">
              Release scope: {selectedInitiative.affectedRelease}
              {selectedInitiative.affectedProductIds.length ? ` · ${selectedInitiative.affectedProductIds.length} product IDs` : " · all products in release scope"}
            </p>
            <p className="entity-actions">
              <Link href={`/initiatives/${encodeURIComponent(selectedInitiative.id)}`}>Open initiative</Link>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setSelectedInitiativeId("");
                  setNotice("Selection cleared.");
                }}
              >
                Clear selection
              </button>
            </p>
          </article>
        </section>
      ) : null}

      <section className="domain-list">
        {filteredBriefs.length === 0 ? (
          <article className="domain-card">
            <h3>No matching briefs</h3>
            <p className="entity-meta">Create one from an initiative above, then open it from the detail view.</p>
            <p className="entity-meta">
              {initiatives.length === 0
                ? "No initiatives exist yet."
                : "Try clearing filters or creating a new brief for an initiative."}
            </p>
            <p className="entity-actions">
              {initiatives.length ? <Link href="/initiatives">Open initiatives</Link> : null}
              <Link href="/">Return to source intake</Link>
            </p>
          </article>
        ) : (
          filteredBriefs.map((brief) => {
            const initiative = initiativeLookup.get(brief.initiativeId);
            return (
              <article key={brief.id} className="domain-card">
                <div className="section-heading">
                  <h3>
                    <Link href={`/briefs/${encodeURIComponent(brief.id)}`}>{brief.title}</Link>
                  </h3>
                  <span>{brief.status}</span>
                </div>
                <p className="entity-meta">{initiative?.title ?? brief.initiativeTitle}</p>
                <p className="entity-meta">
                  {brief.sourceRows} source rows · {brief.products} products · {brief.releases} releases · {brief.releaseScope}
                </p>
                <p className="entity-meta">
                  Created {formatDate(brief.createdAt)} · updated {formatDate(brief.updatedAt)}
                </p>
                <p className="entity-meta">{brief.notes || "No custom notes yet."}</p>
                <p className="entity-actions">
                  <Link href={`/briefs/${encodeURIComponent(brief.id)}`}>Open brief</Link>
                  {initiative ? <Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>Open initiative</Link> : null}
                  <select
                    value={brief.status}
                    onChange={(event) => setBriefStatus(brief.id, event.target.value as BriefStatus)}
                    title={`Set status for ${brief.title}`}
                  >
                    {briefStatuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                  <button className="ghost-button" type="button" onClick={() => deleteBrief(brief.id)}>Delete</button>
                </p>
              </article>
            );
          })
        )}
      </section>

      {notice ? <div className="toast" role="status">✓ {notice}</div> : null}
    </DomainPageShell>
  );
}
