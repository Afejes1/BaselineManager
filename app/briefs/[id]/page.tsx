"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BASELINE_STORAGE_KEY,
  loadRowsFromStorage,
  text,
  type Record24,
} from "../../../lib/baseline-data";
import {
  BRIEF_STORAGE_KEY,
  INITIATIVE_STORAGE_KEY,
  briefMarkdown,
  briefStatuses,
  initiativeAffectedRows,
  loadBriefs,
  loadInitiatives,
  type Brief,
  type BriefStatus,
  type Initiative,
} from "../../../lib/steering-data";
import { DomainPageShell } from "../../../components/domain-shell";

function loadRows(): Record24[] {
  if (typeof window === "undefined") return [];
  return loadRowsFromStorage(window.localStorage.getItem(BASELINE_STORAGE_KEY));
}

function decodeId(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

type ActiveTab = "overview" | "metadata" | "preview";

const tabItems: Array<{ id: ActiveTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "metadata", label: "Context" },
  { id: "preview", label: "Brief text" },
];

function formatDate(value: string) {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function BriefDetailPage({ params }: { params: { id: string } }) {
  const briefId = decodeId(params.id);
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
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [draftStatus, setDraftStatus] = useState<BriefStatus>("Draft");
  const [draftNotes, setDraftNotes] = useState("");
  const [notice, setNotice] = useState("");
  const [copyNotice, setCopyNotice] = useState("");

  useEffect(() => {
    setRows(loadRows());
    setInitiatives(loadInitiatives(window.localStorage.getItem(INITIATIVE_STORAGE_KEY)));
    setBriefs(loadBriefs(window.localStorage.getItem(BRIEF_STORAGE_KEY)));
  }, []);

  const brief = useMemo(() => briefs.find((item) => item.id === briefId) ?? null, [briefs, briefId]);
  const initiative = useMemo(() => initiatives.find((item) => item.id === brief?.initiativeId) ?? null, [brief?.initiativeId, initiatives]);
  const scopedRows = useMemo(() => (initiative ? initiativeAffectedRows(rows, initiative) : []), [initiative, rows]);
  const markdown = useMemo(() => brief ? briefMarkdown(brief, initiative, rows) : "", [brief, initiative, rows]);

  useEffect(() => {
    if (!brief) return;
    setDraftStatus(brief.status);
    setDraftNotes(brief.notes);
  }, [brief]);

  useEffect(() => {
    if (!notice) return;
    const handle = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(handle);
  }, [notice]);

  useEffect(() => {
    if (!copyNotice) return;
    const handle = window.setTimeout(() => setCopyNotice(""), 1800);
    return () => window.clearTimeout(handle);
  }, [copyNotice]);

  const productCount = new Set(scopedRows.map((row) => {
    const primary = text(row.LongName).trim() || text(row.ShortName).trim();
    return primary || `${text(row["#"])}:${text(row.ReleaseName)}`;
  })).size;
  const releaseCount = new Set(scopedRows.map((row) => text(row.ReleaseName))).size;

  function persist(next: Brief[]) {
    const sorted = next.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    setBriefs(sorted);
    window.localStorage.setItem(BRIEF_STORAGE_KEY, JSON.stringify(sorted));
  }

  function updateStatus(next: BriefStatus) {
    if (!brief) return;
    setDraftStatus(next);
    const nextBriefs = briefs.map((item) => (item.id === brief.id ? { ...item, status: next, updatedAt: new Date().toISOString() } : item));
    persist(nextBriefs);
    setNotice("Status updated.");
  }

  function saveNotes() {
    if (!brief) return;
    const nextBriefs = briefs.map((item) => (item.id === brief.id ? { ...item, notes: draftNotes.trim(), updatedAt: new Date().toISOString() } : item));
    persist(nextBriefs);
    setNotice("Notes saved.");
  }

  function copyBrief() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(markdown).then(() => {
      setCopyNotice("Copied brief markdown.");
    });
  }

  async function downloadBrief() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${brief?.title?.replaceAll("/", "-") ?? "brief"}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
    setNotice("Downloaded brief markdown.");
  }

  if (!brief) {
    return (
      <DomainPageShell
        title="Brief not found"
        subtitle="No matching brief exists in workspace storage."
        releaseScope="No brief selected"
        actions={<Link href="/briefs">Back to briefs</Link>}
      >
        <section className="domain-list">
          <article className="domain-card">
            <h3>Unknown brief</h3>
            <p className="entity-meta">Open a brief from the brief list or create one from an initiative.</p>
          </article>
        </section>
      </DomainPageShell>
    );
  }

  return (
    <DomainPageShell
      title={brief.title}
      subtitle="Leadership brief generated from a selected initiative and source scope."
      releaseScope={`${brief.sourceRows} source rows · ${brief.products} products`}
      actions={(
        <button className="primary-button" onClick={downloadBrief}>Download .md</button>
      )}
    >
      <div className="summary">
        <div className="metric">
          <span>Initiative</span>
          <strong>{initiative ? initiative.title : "No linked initiative"}</strong>
          <small>{initiative ? `${initiative.owner} · ${initiative.status}` : "Free-form brief"}</small>
        </div>
        <div className="metric">
          <span>Scope</span>
          <strong>{brief.releases}</strong>
          <small>{brief.releaseScope} · {releaseCount} source releases</small>
        </div>
        <div className="metric">
          <span>Composition</span>
          <strong>{brief.sourceRows}</strong>
          <small>{brief.products} products · {productCount} linked products</small>
        </div>
        <div className="metric metric-alert">
          <span>Status</span>
          <strong>{brief.status}</strong>
          <small>Updated {formatDate(brief.updatedAt)}</small>
        </div>
      </div>

      <section className="detail-tabs">
        {tabItems.map((tab) => (
          <button key={tab.id} type="button" className={activeTab === tab.id ? "tab-button tab-active" : "tab-button"} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === "overview" && (
        <section className="domain-section">
          <article className="domain-card">
            <h3>Brief controls</h3>
            <label className="modal-field">
              Status
              <select value={draftStatus} onChange={(event) => updateStatus(event.target.value as BriefStatus)}>
                {briefStatuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <label className="modal-field">
              Brief notes
              <textarea className="review-note" rows={5} value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
            </label>
            <div className="entity-actions">
              <button className="primary-button" onClick={saveNotes}>Save notes</button>
              <button className="ghost-button" onClick={copyBrief}>Copy brief text</button>
            </div>
            <p className="entity-meta">Created {formatDate(brief.createdAt)} · Last update {formatDate(brief.updatedAt)}</p>
          </article>

          <article className="domain-card">
            <h3>Source scope sample</h3>
            <div className="domain-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Release</th>
                    <th>Product</th>
                    <th>Tier</th>
                    <th>Resource</th>
                    <th>Host</th>
                    <th>Storage</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedRows.length ? scopedRows.slice(0, 18).map((row) => (
                    <tr key={`${text(row.ReleaseName)}:${text(row["#"])}`}>
                      <td>{text(row.ReleaseName) || "Unassigned"}</td>
                      <td>{text(row.LongName) || text(row.ShortName) || "Unassigned"}</td>
                      <td>{text(row.Tier) || "Unassigned"}</td>
                      <td>{text(row.Resource) || "Unassigned"}</td>
                      <td className="mono">{text(row.HW_Host) || "Unassigned"}</td>
                      <td>{`${text(row.HW_Storage_Type) || "—"}${text(row["HW_Storage (GB)"]) ? ` / ${text(row["HW_Storage (GB)"])}` : ""}`}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6} className="empty">No source rows contribute to this scope.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {initiative ? <p className="entity-actions"><Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>Open linked initiative</Link></p> : null}
          </article>
        </section>
      )}

      {activeTab === "metadata" && (
        <section className="domain-section">
          <article className="domain-card">
            <h3>Brief metadata</h3>
            <p className="entity-meta"><strong>Release scope:</strong> {brief.releaseScope}</p>
            <p className="entity-meta"><strong>Source rows:</strong> {brief.sourceRows}</p>
            <p className="entity-meta"><strong>Products:</strong> {brief.products}</p>
            <p className="entity-meta"><strong>Releases in scope:</strong> {brief.releases}</p>
          </article>
          <article className="domain-card">
            <h3>Linked initiative context</h3>
            <p className="entity-meta">{initiative?.consequence || "This brief has no linked initiative."}</p>
            <p className="entity-meta"><strong>Desired outcome:</strong> {initiative?.outcome || "Not yet captured."}</p>
            <p className="entity-meta"><strong>Target date:</strong> {initiative?.targetDate || "Not set"}.</p>
          </article>
        </section>
      )}

      {activeTab === "preview" && (
        <section className="domain-section">
          <article className="domain-card">
            <div className="section-heading">
              <h3>Generated brief text</h3>
              <span>Markdown for leadership workflow</span>
            </div>
            <textarea className="review-note" style={{ minHeight: 420 }} value={markdown} readOnly />
            <div className="entity-actions" style={{ marginTop: 8 }}>
              <button className="ghost-button" onClick={copyBrief}>Copy markdown</button>
              <button className="primary-button" onClick={downloadBrief}>Download .md</button>
            </div>
            <p className="entity-meta">{copyNotice ? copyNotice : "This text is generated from the selected initiative and current source scope."}</p>
          </article>
        </section>
      )}

      {notice ? <div className="toast" role="status">✓ {notice}</div> : null}
    </DomainPageShell>
  );
}

