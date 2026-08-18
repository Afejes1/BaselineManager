"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BASELINE_STORAGE_KEY, loadRowsFromStorage, productDisplayName, productIdentityKey, text, type Record24 } from "../../../lib/baseline-data";
import {
  BRIEF_STORAGE_KEY,
  INITIATIVE_STORAGE_KEY,
  type Brief,
  getInitiativeProductOptions,
  initiativeAffectedRows,
  initiativeSummary,
  type Initiative,
  loadBriefs,
  loadInitiatives,
  type InitiativeEvidence,
  type InitiativeStatus,
  type WorkPackage,
  type WorkPackageStatus,
} from "../../../lib/steering-data";
import { DomainPageShell } from "../../../components/domain-shell";

type DetailTab = "summary" | "scope" | "delivery" | "evidence";

const tabItems: Array<{ id: DetailTab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "scope", label: "Technical scope" },
  { id: "delivery", label: "Delivery" },
  { id: "evidence", label: "Evidence & history" },
];

function loadRows(): Record24[] {
  if (typeof window === "undefined") return [];
  return loadRowsFromStorage(window.localStorage.getItem(BASELINE_STORAGE_KEY));
}

function formatDate(value: string) {
  if (!value) return "Not set";
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

export default function InitiativeDetailPage({ params }: { params: { initiative: string } }) {
  const initiativeId = decodeId(params.initiative);
  const [rows, setRows] = useState<Record24[]>(() => {
    if (typeof window === "undefined") return [];
    return loadRows();
  });
  const [initiatives, setInitiatives] = useState<Initiative[]>(() => {
    if (typeof window === "undefined") return [];
    return loadInitiatives(window.localStorage.getItem(INITIATIVE_STORAGE_KEY));
  });
  const [briefs, setBriefs] = useState<Brief[]>(() => {
    if (typeof window === "undefined") return [];
    return loadBriefs(window.localStorage.getItem(BRIEF_STORAGE_KEY));
  });
  const [activeTab, setActiveTab] = useState<DetailTab>("summary");
  const [notice, setNotice] = useState("");

  const [newWorkPackageTitle, setNewWorkPackageTitle] = useState("");
  const [newWorkPackageOwner, setNewWorkPackageOwner] = useState("");
  const [newWorkPackageDue, setNewWorkPackageDue] = useState("");
  const [newWorkPackageStatus, setNewWorkPackageStatus] = useState<WorkPackageStatus>("Planned");
  const [newWorkPackageNotes, setNewWorkPackageNotes] = useState("");

  const [newEvidenceAuthor, setNewEvidenceAuthor] = useState("");
  const [newEvidenceKind, setNewEvidenceKind] = useState<"Decision" | "Technical note" | "Risk" | "Question">("Decision");
  const [newEvidenceNote, setNewEvidenceNote] = useState("");
  const [statusFilter, setStatusFilter] = useState<InitiativeStatus | "">("");

  useEffect(() => {
    setRows(loadRows());
    setInitiatives(loadInitiatives(window.localStorage.getItem(INITIATIVE_STORAGE_KEY)));
    setBriefs(loadBriefs(window.localStorage.getItem(BRIEF_STORAGE_KEY)));
  }, []);

  const initiative = useMemo(() => initiatives.find((item) => item.id === initiativeId) ?? null, [initiatives, initiativeId]);
  const summary = useMemo(() => initiativeSummary(rows, initiative), [rows, initiative]);
  const scopeRows = useMemo(() => initiativeAffectedRows(rows, initiative), [rows, initiative]);

  const productOptions = useMemo(() => {
    if (!initiative) return [];
    return getInitiativeProductOptions(rows, initiative.affectedRelease);
  }, [rows, initiative]);

  const productMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of scopeRows) {
      const id = productIdentityKey(row);
      if (!map.has(id)) {
        map.set(id, productDisplayName(row));
      }
    }
    return map;
  }, [scopeRows]);

  const linkedBriefs = useMemo(() => briefs.filter((brief) => brief.initiativeId === initiativeId), [briefs, initiativeId]);

  useEffect(() => {
    if (!notice) return;
    const handle = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(handle);
  }, [notice]);

  function persist(next: Initiative[]) {
    const updated = next.map((entry) => (entry.id === initiative?.id ? { ...entry, updatedAt: new Date().toISOString() } : entry));
    const sorted = updated.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    setInitiatives(sorted);
    window.localStorage.setItem(INITIATIVE_STORAGE_KEY, JSON.stringify(sorted));
    setNotice("Saved changes.");
  }

  function updateInitiative(patch: Partial<Initiative>) {
    if (!initiative) return;
    const next = initiatives.map((entry) => {
      if (entry.id !== initiative.id) return entry;
      return { ...entry, ...patch, updatedAt: new Date().toISOString() };
    });
    persist(next);
  }

  function toggleProductInScope(productId: string) {
    if (!initiative) return;
    const hasProduct = initiative.affectedProductIds.includes(productId);
    const nextIds = hasProduct
      ? initiative.affectedProductIds.filter((id) => id !== productId)
      : [...initiative.affectedProductIds, productId];
    const next = initiatives.map((entry) => {
      if (entry.id !== initiative.id) return entry;
      return { ...entry, affectedProductIds: nextIds, updatedAt: new Date().toISOString() };
    });
    persist(next);
  }

  function addWorkPackage() {
    if (!initiative || !newWorkPackageTitle.trim()) {
      setNotice("Enter a package title before saving.");
      return;
    }
    const packageItem: WorkPackage = {
      id: `wp-${Date.now()}`,
      title: newWorkPackageTitle.trim(),
      owner: newWorkPackageOwner.trim() || "Unassigned",
      dueDate: newWorkPackageDue,
      status: newWorkPackageStatus,
      notes: newWorkPackageNotes.trim(),
    };
    const next = initiatives.map((entry) => {
      if (entry.id !== initiative.id) return entry;
      return { ...entry, workPackages: [...entry.workPackages, packageItem], updatedAt: new Date().toISOString() };
    });
    persist(next);
    setNewWorkPackageTitle("");
    setNewWorkPackageOwner("");
    setNewWorkPackageDue("");
    setNewWorkPackageStatus("Planned");
    setNewWorkPackageNotes("");
  }

  function updateWorkPackageStatus(workPackageId: string, status: WorkPackageStatus) {
    if (!initiative) return;
    const next = initiatives.map((entry) => {
      if (entry.id !== initiative.id) return entry;
      return {
        ...entry,
        workPackages: entry.workPackages.map((item) => (item.id === workPackageId ? { ...item, status } : item)),
        updatedAt: new Date().toISOString(),
      };
    });
    persist(next);
  }

  function addEvidence() {
    if (!initiative || !newEvidenceAuthor.trim() || !newEvidenceNote.trim()) {
      setNotice("Add author and note before saving evidence.");
      return;
    }
    const evidence: InitiativeEvidence = {
      id: `e-${Date.now()}`,
      author: newEvidenceAuthor.trim(),
      kind: newEvidenceKind,
      recordedAt: new Date().toISOString(),
      note: newEvidenceNote.trim(),
    };
    const next = initiatives.map((entry) => {
      if (entry.id !== initiative.id) return entry;
      return { ...entry, evidence: [evidence, ...entry.evidence], updatedAt: new Date().toISOString() };
    });
    persist(next);
    setNewEvidenceAuthor("");
    setNewEvidenceKind("Decision");
    setNewEvidenceNote("");
  }

  if (!initiative) {
    return (
      <DomainPageShell
        title="Initiative not found"
        subtitle="That initiative identifier is no longer available in workspace storage."
        releaseScope="No linked records"
        actions={<Link href="/initiatives">Back to initiatives</Link>}
      >
        <section className="domain-list">
          <article className="domain-card">
            <h3>Unknown initiative</h3>
            <p className="entity-meta">Paste or open the correct item from the Initiative list.</p>
          </article>
        </section>
      </DomainPageShell>
    );
  }

  return (
    <DomainPageShell
      title={initiative.title}
      subtitle="Steering workspace for one Government outcome"
      releaseScope={`${summary.sourceRows} source rows · ${summary.products} products`}
      actions={(
        <>
          <select value={statusFilter || initiative.status} onChange={(event) => {
            const value = event.target.value;
            if (!value) return;
            const nextStatus = value as InitiativeStatus;
            setStatusFilter(nextStatus);
            updateInitiative({ status: nextStatus });
          }}>
            <option value="">Quick status</option>
            <option value="Draft">Draft</option>
            <option value="Active">Active</option>
            <option value="Decision required">Decision required</option>
            <option value="Closed">Closed</option>
          </select>
          <Link href="/initiatives">← Back</Link>
        </>
      )}
    >
      <div className="summary">
        <div className="metric">
          <span>Outcome owner</span>
          <strong>{initiative.owner}</strong>
          <small>Target date: {formatDate(initiative.targetDate)}</small>
        </div>
        <div className="metric">
          <span>Scope</span>
          <strong>{initiative.affectedRelease}</strong>
          <small>{summary.products} products · {summary.releases} releases</small>
        </div>
        <div className="metric">
          <span>Quality</span>
          <strong>{summary.blockingIssues + summary.warnings}</strong>
          <small>{summary.blockingIssues} blocking · {summary.warnings} warnings</small>
        </div>
        <div className="metric metric-alert">
          <span>Linked briefs</span>
          <strong>{linkedBriefs.length}</strong>
          <small>Leadership outputs generated</small>
        </div>
      </div>

      <div className="detail-tabs">
        {tabItems.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "tab-button tab-active" : "tab-button"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "summary" && (
        <section className="domain-section">
          <article className="domain-card">
            <h3>Consequence</h3>
            <p className="entity-meta">{initiative.consequence || "Not entered."}</p>
          </article>
          <article className="domain-card">
            <h3>Outcome</h3>
            <p className="entity-meta">{initiative.outcome || "Not entered."}</p>
          </article>
          <article className="domain-card">
            <h3>Source rows in scope</h3>
            <p className="entity-meta">{summary.sourceRows} rows from retained dataset are in this initiative scope.</p>
          </article>
          <article className="domain-card">
            <h3>Linked briefs</h3>
            <p className="entity-meta">
              {linkedBriefs.map((brief) => (
                <span key={brief.id}><Link href={`/briefs/${encodeURIComponent(brief.id)}`}>{brief.title}</Link>{" "}</span>
              ))}
            </p>
          </article>
        </section>
      )}

      {activeTab === "scope" && (
        <section className="domain-section">
          <div className="section-heading">
            <h3>Affected products and release rows</h3>
            <span>Product-level scope controls are editable here</span>
          </div>
          <section className="domain-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>In scope</th>
                  <th>Product</th>
                  <th>Product key</th>
                  <th>Rows</th>
                  <th>Latest release</th>
                </tr>
              </thead>
              <tbody>
                {productOptions.map((productId) => {
                  const productRows = scopeRows.filter((row) => productIdentityKey(row) === productId);
                  const releaseNames = new Set(productRows.map((row) => text(row.ReleaseName)));
                  return (
                    <tr key={productId}>
                      <td><input type="checkbox" checked={initiative.affectedProductIds.includes(productId) || initiative.affectedProductIds.length === 0} onChange={() => toggleProductInScope(productId)} /></td>
                      <td>{productMap.get(productId) || productId}</td>
                      <td className="mono">{productId}</td>
                      <td className="mono">{productRows.length}</td>
                      <td>{[...releaseNames].filter(Boolean).join(", ") || initiative.affectedRelease}</td>
                    </tr>
                  );
                })}
                {!productOptions.length ? <tr><td colSpan={5} className="empty">No products are currently in this scope.</td></tr> : null}
              </tbody>
            </table>
          </section>
        </section>
      )}

      {activeTab === "delivery" && (
        <section className="domain-section">
          <div className="section-heading">
            <h3>Work packages</h3>
            <span>{initiative.workPackages.length} packages</span>
          </div>
          <section className="domain-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Owner</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {initiative.workPackages.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.owner}</td>
                    <td>{item.dueDate || "—"}</td>
                    <td>
                      <select value={item.status} onChange={(event) => updateWorkPackageStatus(item.id, event.target.value as WorkPackageStatus)}>
                        <option>Planned</option>
                        <option>In progress</option>
                        <option>On hold</option>
                        <option>Complete</option>
                      </select>
                    </td>
                    <td>{item.notes || "—"}</td>
                  </tr>
                ))}
                {!initiative.workPackages.length ? (
                  <tr><td colSpan={5} className="empty">No work packages yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>

          <section className="domain-card">
            <div className="section-heading">
              <h4>Add work package</h4>
              <span>Program/WBS traceability can be captured here.</span>
            </div>
            <label className="modal-field">Title</label>
            <input value={newWorkPackageTitle} onChange={(event) => setNewWorkPackageTitle(event.target.value)} placeholder="e.g., Validate OData gateway patching" />
            <label className="modal-field">Owner</label>
            <input value={newWorkPackageOwner} onChange={(event) => setNewWorkPackageOwner(event.target.value)} placeholder="Team or point of contact" />
            <label className="modal-field">Due date</label>
            <input type="date" value={newWorkPackageDue} onChange={(event) => setNewWorkPackageDue(event.target.value)} />
            <label className="modal-field">
              Status
              <select value={newWorkPackageStatus} onChange={(event) => setNewWorkPackageStatus(event.target.value as WorkPackageStatus)}>
                <option>Planned</option>
                <option>In progress</option>
                <option>On hold</option>
                <option>Complete</option>
              </select>
            </label>
            <label className="modal-field">Notes</label>
            <textarea value={newWorkPackageNotes} onChange={(event) => setNewWorkPackageNotes(event.target.value)} className="review-note" rows={4} />
            <button className="primary-button" onClick={addWorkPackage}>Add package</button>
          </section>
        </section>
      )}

      {activeTab === "evidence" && (
        <section className="domain-section">
          <div className="section-heading">
            <h3>Evidence and history</h3>
            <span>{initiative.evidence.length} records</span>
          </div>
          {initiative.evidence.map((entry) => (
            <article className="domain-card" key={entry.id}>
              <p className="entity-meta">
                <strong>{entry.author}</strong> · {entry.kind} · {new Date(entry.recordedAt).toLocaleString()}
              </p>
              <p>{entry.note}</p>
            </article>
          ))}
          {initiative.evidence.length === 0 ? <p className="empty">No evidence records yet.</p> : null}

          <section className="domain-card">
            <h4>Add evidence</h4>
            <label className="modal-field">Author</label>
            <input value={newEvidenceAuthor} onChange={(event) => setNewEvidenceAuthor(event.target.value)} placeholder="Analyst or office" />
            <label className="modal-field">
              Type
              <select value={newEvidenceKind} onChange={(event) => setNewEvidenceKind(event.target.value as "Decision" | "Technical note" | "Risk" | "Question")}>
                <option>Decision</option>
                <option>Technical note</option>
                <option>Risk</option>
                <option>Question</option>
              </select>
            </label>
            <label className="modal-field">Note</label>
            <textarea value={newEvidenceNote} onChange={(event) => setNewEvidenceNote(event.target.value)} className="review-note" rows={6} />
            <button className="primary-button" onClick={addEvidence}>Add evidence</button>
          </section>
        </section>
      )}

      {notice ? <div className="toast" role="status">✓ {notice}</div> : null}
    </DomainPageShell>
  );
}
