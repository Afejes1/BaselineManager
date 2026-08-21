"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "../../../components/app-link";
import { DomainPageShell } from "../../../components/domain-shell";
import { useInitiativeDecisions } from "../../../lib/initiative-decision-client";

type FeedRecord = {
  externalRecordKey: string;
  externalIdentifier: string;
  jpoIdentifiers: string[];
  relatedTo: string;
  title: string;
  domains: string[];
  blocks: string[];
  blockedBy: string[];
  targetStart: string;
  targetFinish: string;
  rom: string;
  percentComplete: number | null;
  funding: string;
  release: string;
  url: string;
  raw: Record<string, unknown>;
};

type Diff = { field: string; before: string; after: string };
type PreviewRow = FeedRecord & { disposition: "add" | "change" | "unchanged" | "blocked"; diffs: Diff[]; issues: string[]; mappedObjectiveId?: string | null; };
type Preview = { records: PreviewRow[]; added: number; changed: number; unchanged: number; removed: number; blocked: number; canApply: boolean; sourceAsOf?: string };
type History = { id: string; fileName: string; receivedAt: string; sourceAsOf?: string; rowCount: number; addedCount: number; changedCount: number; unchangedCount: number; removedCount: number; blockedCount: number };
type SourceJpoLink = { external_identifier?: string; change_request_id?: string | null; change_request_external_identifier?: string | null };
type SourceSubject = { id: string; feed_key: string; jira_identifier?: string | null; url?: string | null; title?: string | null; canonical_objective_id?: string | null; canonical_objective_title?: string | null; updated_at?: string; latest_snapshot_id?: string | null; presentInLatestSnapshot?: boolean; rel_to?: string | null; domains_json?: string | null; target_start?: string | null; target_finish?: string | null; rom?: string | null; percent_complete?: number | null; funding?: string | null; release?: string | null; blocks?: string[]; blockedBy?: string[]; jpoLinks?: SourceJpoLink[] };
type SourceDependency = { source_feed_key: string; direction: "blocks" | "blocked_by"; target_reference: string; target_subject_id?: string | null };

const text = (value: unknown) => String(value ?? "").normalize("NFKC").trim();
const strings = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(/[,;]+/).map(text).filter(Boolean);
const jpos = (value: unknown) => text(value).split(/[,;]/).map(text).filter(Boolean);
const safeExternalUrl = (value: string) => {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; }
  catch { return null; }
};

function parseFeed(input: unknown): FeedRecord[] {
  // Match the server parser: Lockheed has supplied both a direct keyed object
  // and a `{ objectives: { ... } }` wrapper. The root key is a dependency
  // identifier, so it must survive client-side preview unchanged.
  const root = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  const candidate = root?.objectives && typeof root.objectives === "object" && !Array.isArray(root.objectives) ? root.objectives : input;
  const container = Array.isArray(candidate) ? candidate : candidate && typeof candidate === "object" ? Object.entries(candidate as Record<string, unknown>).map(([key, value]) => ({ ...(value as Record<string, unknown>), __key: key })) : [];
  return container.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")).map((entry, index) => ({
    externalRecordKey: text(entry.__key || entry.sourceKey || entry.id || entry.key || index + 1),
    externalIdentifier: text(entry.jira || entry.Jira || entry.externalIdentifier),
    jpoIdentifiers: jpos(entry.jpo || entry.JPO),
    relatedTo: text(entry["rel-to"] || entry.relTo || entry["cel-to"] || entry.celTo),
    title: text(entry.title || entry.name),
    domains: strings(entry.domains),
    blocks: strings(entry.blocks),
    blockedBy: strings(entry.blocked_by || entry.blockedBy),
    targetStart: text(entry.target_start || entry.targetStart),
    targetFinish: text(entry.target_finish || entry.targetFinish),
    rom: text(entry.rom || entry.ROM),
    percentComplete: Number.isFinite(Number(entry.percent_complete ?? entry.percentComplete)) ? Number(entry.percent_complete ?? entry.percentComplete) : null,
    funding: text(entry.funding),
    release: text(entry.release),
    url: text(entry.url),
    raw: entry,
  })).filter((record) => record.externalRecordKey || record.externalIdentifier || record.title);
}

function relationshipType(row: PreviewRow, target: string) { return row.blocks.includes(target) ? "blocks" : row.blockedBy.includes(target) ? "blocked by" : "related"; }

function normalizeHistory(value: unknown): History[] {
  return Array.isArray(value) ? value.map((item) => {
    const row = item as Record<string, unknown>;
    return { id: text(row.id), fileName: text(row.fileName || row.file_name), receivedAt: text(row.receivedAt || row.received_at || row.observedAt || row.observed_at), sourceAsOf: text(row.sourceAsOf || row.source_as_of) || undefined, rowCount: Number(row.rowCount || row.row_count || row.recordCount || row.record_count || 0), addedCount: Number(row.addedCount || row.added_count || 0), changedCount: Number(row.changedCount || row.changed_count || 0), unchangedCount: Number(row.unchangedCount || row.unchanged_count || 0), removedCount: Number(row.removedCount || row.removed_count || 0), blockedCount: Number(row.blockedCount || row.blocked_count || 0) };
  }).filter((item) => item.id) : [];
}
function normalizePreview(value: unknown): Preview | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw) return null;
  if (Array.isArray(raw.records)) return raw as unknown as Preview;
  if (!Array.isArray(raw.items)) return null;
  const rows = raw.items.map((item) => {
    const source = item as Record<string, unknown>; const record = (source.record || {}) as Record<string, unknown>;
    const diffs = Array.isArray(source.diffs) ? source.diffs as Diff[] : (source.changedFields as unknown[] || []).map((field) => ({ field: text(field), before: "", after: "Updated in this snapshot" }));
    return { externalRecordKey: text(record.sourceKey), externalIdentifier: text(record.jira), jpoIdentifiers: strings(record.jpoIds || record.jpoRaw), relatedTo: text(record.relTo), title: text(record.title), domains: strings(record.domains), blocks: strings(record.blocks), blockedBy: strings(record.blockedBy), targetStart: text(record.targetStart), targetFinish: text(record.targetFinish), rom: text(record.rom), percentComplete: Number.isFinite(Number(record.percentComplete)) ? Number(record.percentComplete) : null, funding: text(record.funding), release: text(record.release), url: text(record.url), raw: (record.raw || record) as Record<string, unknown>, disposition: text(source.disposition) as PreviewRow["disposition"], diffs, issues: Array.isArray(source.issues) ? source.issues.map((issue) => typeof issue === "string" ? issue : text((issue as Record<string, unknown>).message)) : [], mappedObjectiveId: text(source.objectiveId) || null };
  }) as PreviewRow[];
  return { records: rows, added: Number(raw.added || 0), changed: Number(raw.changed || 0), unchanged: Number(raw.unchanged || 0), removed: Array.isArray(raw.removed) ? raw.removed.length : Number(raw.removed || 0), blocked: Number(raw.blocked || 0), canApply: Boolean(raw.canApply) };
}

function normalizeSubjects(value: unknown): SourceSubject[] {
  return Array.isArray(value) ? value.map((item) => {
    const row = item as Record<string, unknown>;
    return { ...row, id: text(row.id), feed_key: text(row.feed_key || row.feedKey), jira_identifier: text(row.jira_identifier || row.jiraIdentifier) || null, url: text(row.url) || null, title: text(row.title) || null, canonical_objective_id: text(row.canonical_objective_id || row.canonicalObjectiveId) || null, canonical_objective_title: text(row.canonical_objective_title || row.canonicalObjectiveTitle) || null, presentInLatestSnapshot: Boolean(row.presentInLatestSnapshot), blocks: Array.isArray(row.blocks) ? row.blocks.map(text).filter(Boolean) : [], blockedBy: Array.isArray(row.blockedBy) ? row.blockedBy.map(text).filter(Boolean) : [], jpoLinks: Array.isArray(row.jpoLinks) ? row.jpoLinks as SourceJpoLink[] : [] } as SourceSubject;
  }).filter((subject) => subject.id && subject.feed_key) : [];
}

function normalizeDependencies(value: unknown): SourceDependency[] {
  return Array.isArray(value) ? value.map((item) => {
    const row = item as Record<string, unknown>;
    return { source_feed_key: text(row.source_feed_key || row.sourceFeedKey), direction: text(row.direction) === "blocked_by" ? "blocked_by" : "blocks", target_reference: text(row.target_reference || row.targetReference), target_subject_id: text(row.target_subject_id || row.targetSubjectId) || null };
  }).filter((dependency) => dependency.source_feed_key && dependency.target_reference) : [];
}

export default function ObjectiveFeedPage() {
  const { workspace } = useInitiativeDecisions();
  const [fileName, setFileName] = useState("");
  const [sourceAsOf, setSourceAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [records, setRecords] = useState<FeedRecord[]>([]);
  const [rawPayload, setRawPayload] = useState<unknown>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [subjects, setSubjects] = useState<SourceSubject[]>([]);
  const [dependencies, setDependencies] = useState<SourceDependency[]>([]);
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});
  const [linkingSubjectId, setLinkingSubjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const objectiveOptions = useMemo(() => [...(workspace?.objectives || [])].sort((left, right) => `${left.externalIdentifier} ${left.title}`.localeCompare(`${right.externalIdentifier} ${right.title}`)), [workspace?.objectives]);
  const persistedRows = useMemo(() => {
    const linksBySource = new Map<string, SourceDependency[]>();
    for (const dependency of dependencies) linksBySource.set(dependency.source_feed_key, [...(linksBySource.get(dependency.source_feed_key) || []), dependency]);
    return subjects.filter((subject) => subject.presentInLatestSnapshot).map((subject) => {
      const links = linksBySource.get(subject.feed_key) || [];
      return {
        externalRecordKey: subject.feed_key,
        externalIdentifier: subject.jira_identifier || "",
        jpoIdentifiers: (subject.jpoLinks || []).map((item) => text(item.external_identifier)).filter(Boolean),
        relatedTo: subject.rel_to || "",
        title: subject.title || "",
        domains: strings(subject.domains_json),
        blocks: links.filter((item) => item.direction === "blocks").map((item) => item.target_reference),
        blockedBy: links.filter((item) => item.direction === "blocked_by").map((item) => item.target_reference),
        targetStart: subject.target_start || "",
        targetFinish: subject.target_finish || "",
        rom: subject.rom || "",
        percentComplete: subject.percent_complete ?? null,
        funding: subject.funding || "",
        release: subject.release || "",
        url: subject.url || "",
        raw: {},
        disposition: "unchanged" as const,
        diffs: [],
        issues: [],
      };
    });
  }, [dependencies, subjects]);
  const graphRows = useMemo(() => preview?.records || (records.length ? records.map((record) => ({ ...record, disposition: "unchanged" as const, diffs: [], issues: [] })) : persistedRows), [persistedRows, preview?.records, records]);
  const selected = useMemo(() => graphRows.find((row) => row.externalRecordKey === selectedKey) || graphRows[0] || null, [graphRows, selectedKey]);
  const graph = useMemo(() => {
    const byKey = new Map(graphRows.map((row) => [row.externalRecordKey, row]));
    return graphRows.map((row) => ({ row, links: [...row.blocks, ...row.blockedBy].map((target) => ({ target, known: byKey.has(target), type: relationshipType(row, target) })) }));
  }, [graphRows]);

  const loadFeedState = useCallback(async () => {
    const response = await fetch("/api/objectives/feed?subjects=1", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { history?: unknown[]; snapshots?: unknown[]; subjects?: unknown[]; dependencies?: unknown[] };
    setHistory(normalizeHistory(payload.history || payload.snapshots));
    setSubjects(normalizeSubjects(payload.subjects));
    setDependencies(normalizeDependencies(payload.dependencies));
  }, []);
  useEffect(() => { const handle = window.setTimeout(() => { void loadFeedState(); }, 0); return () => window.clearTimeout(handle); }, [loadFeedState]);

  async function selectFile(file: File | undefined) {
    if (!file) return;
    setNotice(""); setPreview(null); setFileName(file.name);
    try { const source = JSON.parse(await file.text()); const parsed = parseFeed(source); if (!parsed.length) throw new Error("The JSON file has no Objective records."); setRawPayload(source); setRecords(parsed); setSelectedKey(parsed[0].externalRecordKey); }
    catch (reason) { setRecords([]); setRawPayload(null); setNotice(reason instanceof Error ? reason.message : "The Lockheed Objective feed could not be read."); }
  }
  async function reconcile(mode: "preview" | "apply") {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/objectives/feed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, fileName, sourceAsOf, payload: rawPayload }) });
      const payload = await response.json() as { preview?: unknown; history?: unknown[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "The Lockheed Objective feed could not be processed.");
      const normalizedPreview = normalizePreview(payload.preview);
      if (normalizedPreview) { setPreview(normalizedPreview); setSelectedKey(normalizedPreview.records[0]?.externalRecordKey || ""); }
      if (payload.history) setHistory(normalizeHistory(payload.history));
      if (mode === "apply") { setNotice("Lockheed source snapshot applied. Government assessment and decision records were not overwritten."); await loadFeedState(); }
      else setNotice("Preview complete. Review mapping gaps and source changes before applying this snapshot.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "The Lockheed Objective feed could not be processed."); }
    finally { setBusy(false); }
  }

  async function reconcileSubject(subjectId: string, canonicalObjectiveId: string) {
    if (!canonicalObjectiveId) return;
    setLinkingSubjectId(subjectId); setNotice("");
    try {
      const response = await fetch("/api/objectives/feed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "link_subject", subjectId, canonicalObjectiveId }) });
      const payload = await response.json() as { error?: string; canonicalObjectiveTitle?: string };
      if (!response.ok) throw new Error(payload.error || "The source subject could not be linked.");
      setNotice(`Source subject linked to ${payload.canonicalObjectiveTitle || "the governed LM Objective"}. Ownership and JPO/MCP references were not changed.`);
      await loadFeedState();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "The source subject could not be linked."); }
    finally { setLinkingSubjectId(""); }
  }

  return <DomainPageShell title="Lockheed Objective Feed" subtitle="Import a daily GitLab Pages JSON snapshot. The feed is retained external evidence, not Government delivery authority." releaseScope={`${history.length} retained snapshots`} actions={<><Link className="ghost-button" href="/objectives">LM Objectives</Link><Link className="ghost-button" href="/objectives/import">Workbook import</Link></>}>
    <section className="decision-principle"><strong>Snapshot rule</strong><span>Each file is retained with its received date and field changes. Jira is a Lockheed identifier. JPO/MCP values are reported source references; blank, multiple, or unresolved values remain visible without creating ownership or funding approval.</span></section>
    <section className="split-layout feed-import-grid"><article className="domain-section"><span className="eyebrow">LOCKHEED GITLAB PAGES EXPORT</span><h3>Load source snapshot</h3><label className="modal-field">JSON file<input type="file" accept="application/json,.json" onChange={(event) => void selectFile(event.target.files?.[0])} /></label><label className="modal-field">Source snapshot date<input type="date" value={sourceAsOf} onChange={(event) => setSourceAsOf(event.target.value)} /></label>{fileName ? <p className="entity-meta">{fileName} · {records.length} Objective records parsed</p> : null}<button className="primary-button" type="button" disabled={!records.length || busy} onClick={() => void reconcile("preview")}>{busy ? "Processing…" : "Preview source snapshot"}</button></article><article className="domain-section"><span className="eyebrow">SOURCE FIELDS RETAINED</span><h3>What is read from Lockheed</h3><p>Jira ID, JPO/MCP references, title, domains, ROM, percent complete, schedule, funding, release, and the blocks / blocked-by lists are retained as source claims.</p><p className="entity-meta">Percent complete and ROM are tracked as daily values. A change in Lockheed’s algorithm is visible as a source change; it is not treated as a Government cost or progress assessment.</p></article></section>
    {preview ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">RECONCILIATION PREVIEW</span><h3>Incoming Lockheed snapshot</h3></div><button className="primary-button" disabled={!preview.canApply || busy} onClick={() => void reconcile("apply")}>{preview.canApply ? "Apply snapshot" : "Resolve duplicate or invalid records"}</button></div><section className="summary"><div className="metric"><span>New</span><strong>{preview.added}</strong><small>New external Objectives</small></div><div className="metric"><span>Changed</span><strong>{preview.changed}</strong><small>Reported fields changed</small></div><div className="metric"><span>Unchanged</span><strong>{preview.unchanged}</strong><small>Source confirmed</small></div><div className="metric"><span>Removed</span><strong>{preview.removed}</strong><small>Absent from this supplied file</small></div><div className="metric"><span>Blocked records</span><strong>{preview.blocked}</strong><small>Duplicate or invalid source records</small></div></section></section> : null}
    {graph.length ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">OBJECTIVE DEPENDENCY MAP</span><h3>Lockheed-reported block relationships</h3></div><span>{preview || records.length ? "Previewed file" : "Latest applied source snapshot"} · Click an Objective to inspect its reported values.</span></div><div className="feed-graph-layout"><div className="feed-graph" role="list" aria-label="Lockheed Objective dependency map">{graph.map(({ row, links }) => <button type="button" key={row.externalRecordKey} className={`feed-node ${selected?.externalRecordKey === row.externalRecordKey ? "feed-node-selected" : ""} status-${row.disposition}`} onClick={() => setSelectedKey(row.externalRecordKey)}><span className="record-type">{row.externalIdentifier || `RECORD ${row.externalRecordKey}`}</span><strong>{row.title || "Untitled Objective"}</strong><small>{row.jpoIdentifiers.length ? `JPO / MCP: ${row.jpoIdentifiers.join(", ")}` : "No JPO / MCP supplied"}</small><span className="feed-node-links">{links.length ? links.map((link) => <i key={`${link.type}:${link.target}`} className={link.known ? "known" : "unresolved"}>{link.type} → {link.target}</i>) : "No reported block relationships"}</span></button>)}</div><aside className="feed-inspector">{selected ? <><span className="eyebrow">SELECTED SOURCE RECORD</span><h3>{selected.externalIdentifier || `Record ${selected.externalRecordKey}`}</h3><p>{selected.title}</p><dl className="record-facts"><div><dt>JPO / MCP</dt><dd>{selected.jpoIdentifiers.join(", ") || "Not supplied"}</dd></div><div><dt>Domains</dt><dd>{selected.domains.join(", ") || "Not supplied"}</dd></div><div><dt>Schedule</dt><dd>{selected.targetStart || "—"} → {selected.targetFinish || "—"}</dd></div><div><dt>ROM / completion</dt><dd>{selected.rom || "—"} / {selected.percentComplete ?? "—"}%</dd></div><div><dt>Release / funding</dt><dd>{selected.release || "—"} / {selected.funding || "—"}</dd></div></dl><h4>Snapshot change</h4>{selected.diffs.length ? <ul className="source-diff-list">{selected.diffs.map((diff) => <li key={diff.field}><strong>{diff.field}</strong><del>{diff.before || "(blank)"}</del><ins>{diff.after || "(blank)"}</ins></li>)}</ul> : <p className="entity-meta">No prior source difference for this record.</p>}{selected.issues.length ? <p className="warning-copy">{selected.issues.join(" ")}</p> : null}{safeExternalUrl(selected.url) ? <a className="text-action" href={safeExternalUrl(selected.url) || undefined} target="_blank" rel="noreferrer">Open Lockheed source record ↗</a> : null}</> : <p>Select an Objective to inspect it.</p>}</aside></div></section> : null}
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">CURRENT SOURCE SUBJECTS</span><h3>Trace links and reported Change Request references</h3></div><button className="ghost-button" type="button" onClick={() => void loadFeedState()}>Refresh feed state</button></div><p className="entity-meta">A trace link is an analyst-controlled cross-reference to a governed LM Objective. It does not alter the Objective’s owning Change Request, nor does a reported JPO/MCP reference approve funding or delivery.</p><div className="domain-table-wrap feed-subject-table"><table><thead><tr><th>Lockheed source subject</th><th>Reported JPO / MCP</th><th>Latest source state</th><th>Governed Objective trace link</th></tr></thead><tbody>{subjects.map((subject) => <tr key={subject.id}><td><strong>{subject.jira_identifier || `Record ${subject.feed_key}`}</strong><small>Feed key {subject.feed_key} · {subject.title || "No title supplied"}</small></td><td>{subject.jpoLinks?.length ? subject.jpoLinks.map((link) => link.change_request_id ? <Link key={`${subject.id}:${link.external_identifier}`} href={`/changes/${encodeURIComponent(link.change_request_id)}`}>{link.change_request_external_identifier || link.external_identifier}</Link> : <span className="source-reference" key={`${subject.id}:${link.external_identifier}`}>{link.external_identifier}</span>) : <span className="entity-meta">Not supplied</span>}</td><td><span className={`status-pill ${subject.presentInLatestSnapshot ? "status-accepted" : "status-warning"}`}>{subject.presentInLatestSnapshot ? "PRESENT" : "ABSENT"}</span><small>{subject.presentInLatestSnapshot ? "In latest applied file" : "Not in latest applied file; history retained"}</small></td><td>{subject.canonical_objective_id ? <p className="trace-link-cell"><Link href={`/objectives/${encodeURIComponent(subject.canonical_objective_id)}`}>{subject.canonical_objective_title || "Open linked Objective"}</Link><select aria-label={`Change governed Objective link for ${subject.jira_identifier || subject.feed_key}`} value={linkChoice[subject.id] || ""} onChange={(event) => setLinkChoice({ ...linkChoice, [subject.id]: event.target.value })}><option value="">Change link…</option>{objectiveOptions.map((objective) => <option key={objective.id} value={objective.id}>{objective.externalIdentifier} · {objective.title}</option>)}</select>{linkChoice[subject.id] ? <button className="ghost-button compact-button" type="button" disabled={linkingSubjectId === subject.id} onClick={() => void reconcileSubject(subject.id, linkChoice[subject.id])}>{linkingSubjectId === subject.id ? "Linking…" : "Update link"}</button> : null}</p> : <p className="trace-link-cell"><select aria-label={`Link ${subject.jira_identifier || subject.feed_key} to governed LM Objective`} value={linkChoice[subject.id] || ""} onChange={(event) => setLinkChoice({ ...linkChoice, [subject.id]: event.target.value })}><option value="">Choose governed LM Objective</option>{objectiveOptions.map((objective) => <option key={objective.id} value={objective.id}>{objective.externalIdentifier} · {objective.title}</option>)}</select><button className="ghost-button compact-button" type="button" disabled={!linkChoice[subject.id] || linkingSubjectId === subject.id} onClick={() => void reconcileSubject(subject.id, linkChoice[subject.id])}>{linkingSubjectId === subject.id ? "Linking…" : "Create trace link"}</button></p>}</td></tr>)}{!subjects.length ? <tr><td colSpan={4} className="empty">No Lockheed source subject has been applied.</td></tr> : null}</tbody></table></div></section>
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">SNAPSHOT HISTORY</span><h3>Daily Lockheed feed receipts</h3></div><button className="ghost-button" type="button" onClick={() => void loadFeedState()}>Refresh history</button></div><div className="domain-table-wrap"><table><thead><tr><th>Source file</th><th>Source as of</th><th>Received</th><th>Records</th><th>Changes</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{item.fileName}</td><td>{item.sourceAsOf || "Not supplied"}</td><td>{new Date(item.receivedAt).toLocaleString()}</td><td>{item.rowCount}</td><td>+{item.addedCount} · Δ{item.changedCount} · ={item.unchangedCount} · −{item.removedCount} · !{item.blockedCount}</td></tr>)}{!history.length ? <tr><td colSpan={5} className="empty">No Lockheed source snapshot has been applied.</td></tr> : null}</tbody></table></div></section>
    {notice ? <p className="toast">{notice}</p> : null}
  </DomainPageShell>;
}
