"use client";

import Link from "../../components/app-link";
import { useEffect, useMemo, useState } from "react";
import { getProductSummaries } from "../../lib/baseline-data";
import { useBaselineWorkspace } from "../../lib/baseline-client";
import {
  INITIATIVE_STORAGE_KEY,
  createInitiativeRecord,
  loadInitiatives,
  getInitiativeProductOptions,
  getInitiativeReleaseOptions,
  getInitiativeSummaries,
  initiativeStatuses,
  type Initiative,
  type InitiativeStatus,
} from "../../lib/steering-data";
import { DomainPageShell } from "../../components/domain-shell";

function formatCount(value: number) {
  return value.toLocaleString();
}

function parseDate(value: string) {
  if (!value) return "Unspecified";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

export default function InitiativesPage() {
  const { rows } = useBaselineWorkspace();
  const [initiatives, setInitiatives] = useState<Initiative[]>(() => {
    if (typeof window === "undefined") return [];
    return loadInitiatives(window.localStorage.getItem(INITIATIVE_STORAGE_KEY));
  });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | InitiativeStatus>("All");
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newConsequence, setNewConsequence] = useState("");
  const [newOutcome, setNewOutcome] = useState("");
  const [newTargetDate, setNewTargetDate] = useState("");
  const [newStatus, setNewStatus] = useState<InitiativeStatus>("Draft");
  const [newRelease, setNewRelease] = useState("All releases");
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handle = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(handle);
  }, [notice]);

  const productOptions = useMemo(() => getInitiativeProductOptions(rows, newRelease), [rows, newRelease]);
  const summaries = useMemo(() => getInitiativeSummaries(rows, initiatives), [rows, initiatives]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return summaries.filter((entry) => {
      const initiative = entry.initiative;
      if (statusFilter !== "All" && initiative.status !== statusFilter) return false;
      if (!normalized) return true;
      const haystack = `${initiative.title} ${initiative.owner} ${initiative.consequence} ${initiative.outcome} ${initiative.affectedRelease}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [summaries, query, statusFilter]);
  const releases = useMemo(() => getInitiativeReleaseOptions(rows), [rows]);

  function persist(next: Initiative[]) {
    const payload = next.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    setInitiatives(payload);
    window.localStorage.setItem(INITIATIVE_STORAGE_KEY, JSON.stringify(payload));
  }

  function openCreateForm() {
    setNewTitle("");
    setNewOwner("");
    setNewConsequence("");
    setNewOutcome("");
    setNewTargetDate("");
    setNewStatus("Draft");
    setNewRelease("All releases");
    setSelectedProductIds(new Set(getInitiativeProductOptions(rows, "All releases")));
    setShowCreate(true);
  }

  function chooseNewRelease(release: string) {
    setNewRelease(release);
    setSelectedProductIds(new Set(getInitiativeProductOptions(rows, release)));
  }

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function createInitiative() {
    const initiative = createInitiativeRecord({
      title: newTitle,
      owner: newOwner,
      consequence: newConsequence,
      outcome: newOutcome,
      targetDate: newTargetDate,
      status: newStatus,
      affectedRelease: newRelease,
      affectedProductIds: Array.from(selectedProductIds),
    });

    if (!initiative.title.trim()) {
      setNotice("Enter a title before saving.");
      return;
    }
    const next = [initiative, ...initiatives];
    persist(next);
    setNotice(`Created initiative ${initiative.title}.`);
    setShowCreate(false);
  }

  return (
    <DomainPageShell
      title="Initiatives"
      subtitle="Steering workspace for Government outcomes and technical scope."
      releaseScope={`${initiatives.length} initiatives · ${releases.length ? `${releases.length - 1} releases` : "no release context"} loaded`}
      actions={(
        <>
          <label className="search" style={{ width: "240px" }}>
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search initiatives" />
          </label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "All" | InitiativeStatus)} style={{ minWidth: "150px" }}>
            <option>All</option>
            {initiativeStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
          <button className="primary-button" onClick={openCreateForm}>＋ New initiative</button>
        </>
      )}
    >
      <div className="summary">
        <div className="metric">
          <span>Initiatives</span>
          <strong>{formatCount(initiatives.length)}</strong>
          <small>Total initiatives in workspace</small>
        </div>
        <div className="metric">
          <span>Draft</span>
          <strong>{formatCount(initiatives.filter((initiative) => initiative.status === "Draft").length)}</strong>
          <small>Needs planning or review</small>
        </div>
        <div className="metric">
          <span>Active</span>
          <strong>{formatCount(initiatives.filter((initiative) => initiative.status === "Active").length)}</strong>
          <small>Being executed</small>
        </div>
        <div className="metric metric-alert">
          <span>Closed</span>
          <strong>{formatCount(initiatives.filter((initiative) => initiative.status === "Closed").length)}</strong>
          <small>Formal outcome delivered</small>
        </div>
      </div>

      <section className="domain-list">
        {filtered.length === 0 ? (
          <article className="domain-card">
            <h3>No initiatives found</h3>
            <p className="entity-meta">Create one from the button above, then bind it to a release and affected products.</p>
          </article>
        ) : filtered.map((summary) => {
          const initiative = summary.initiative;
          return (
            <article key={initiative.id} className="domain-card">
              <div className="section-heading">
                <h3><Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>{initiative.title}</Link></h3>
                <span>{initiative.status}</span>
              </div>
              <p className="entity-meta">{initiative.consequence || "No consequence text yet."}</p>
              <p className="entity-metric">{initiative.owner} · target {parseDate(initiative.targetDate)} · scope {initiative.affectedRelease}</p>
              <p className="entity-meta">Source rows {summary.sourceRows} · {summary.products} products · {summary.releases} releases · {summary.blockingIssues + summary.warnings} quality cues</p>
              <p className="entity-actions">
                <Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>Open initiative</Link>
                <Link href={`/briefs?initiative=${encodeURIComponent(initiative.id)}`}>Create brief</Link>
              </p>
            </article>
          );
        })}
      </section>

      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowCreate(false);
      }}>
        <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="initiative-create-title">
          <span className="eyebrow">NEW INITIATIVE</span>
          <h2 id="initiative-create-title">Create initiative</h2>
          <label className="modal-field">
            Initiative title
            <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="e.g., Stabilize 30P06 mission telemetry stack" />
          </label>
          <label className="modal-field">
            Owner
            <input value={newOwner} onChange={(event) => setNewOwner(event.target.value)} placeholder="Lead office / team" />
          </label>
          <label className="modal-field">
            Release scope
            <select value={newRelease} onChange={(event) => chooseNewRelease(event.target.value)}>
              {releases.map((release) => <option key={release}>{release}</option>)}
            </select>
          </label>
          <label className="modal-field">
            Status
            <select value={newStatus} onChange={(event) => setNewStatus(event.target.value as InitiativeStatus)}>
              {initiativeStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label className="modal-field">
            Target date
            <input type="date" value={newTargetDate} onChange={(event) => setNewTargetDate(event.target.value)} />
          </label>
          <label className="modal-field">
            Consequence
            <input value={newConsequence} onChange={(event) => setNewConsequence(event.target.value)} placeholder="What problem is this initiative addressing?" />
          </label>
          <label className="modal-field">
            Desired outcome
            <input value={newOutcome} onChange={(event) => setNewOutcome(event.target.value)} placeholder="Expected working baseline and delivery condition." />
          </label>
          <div className="modal-field">
            <span>Products in scope</span>
            <div className="domain-table-wrap" style={{ marginTop: 8 }}>
              <table>
                <tbody>
                  {productOptions.map((productId) => {
                    const summary = getProductSummaries(rows).find((candidate) => candidate.id === productId);
                    const display = summary?.canonical ?? productId;
                    return (
                      <tr key={productId}>
                        <td style={{ width: "32px" }}>
                          <input type="checkbox" checked={selectedProductIds.has(productId)} onChange={() => toggleProduct(productId)} aria-label={display} />
                        </td>
                        <td><label>{display}</label></td>
                        <td className="mono">{productId}</td>
                      </tr>
                    );
                  })}
                  {!productOptions.length ? (
                    <tr><td colSpan={3} className="empty">No rows for this release.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <footer>
            <button className="ghost-button" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="primary-button" onClick={createInitiative}>Create initiative</button>
          </footer>
        </section>
      </div>}

      {notice ? <div className="toast" role="status">✓ {notice}</div> : null}
    </DomainPageShell>
  );
}
