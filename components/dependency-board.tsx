"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "./app-link";
import type { DependencyBoardEdge, DependencyBoardItem, DependencyBoardItemKind, DependencyBoardPortfolio } from "../lib/dependency-board-model";

type PeriodMode = "release" | "calendar";
type Bucket = { key: string; label: string; detail: string };
type DrawnPath = DependencyBoardEdge & { path: string };
const laneOrder: DependencyBoardItemKind[] = ["change_request", "objective", "work_package"];
const laneLabels: Record<DependencyBoardItemKind, { title: string; detail: string }> = {
  change_request: { title: "Change Requests", detail: "Government decision and funding objects" },
  objective: { title: "LM Objectives", detail: "Incumbent delivery commitments and cross-level gates" },
  work_package: { title: "Work Packages", detail: "Government-owned execution and verification work" },
};
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const monthKey = (date: string | null) => /^\d{4}-\d{2}/.test(date || "") ? date!.slice(0, 7) : "";
const quarterKey = (date: string | null) => { const month = monthKey(date); return month ? `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}` : ""; };

function periodBuckets(portfolio: DependencyBoardPortfolio, mode: PeriodMode, items: DependencyBoardItem[]) {
  if (mode === "release") {
    const used = new Set(items.map((item) => item.releaseName).filter(Boolean));
    const buckets = portfolio.releases.filter((release) => used.has(release.name)).map((release) => ({ key: `release:${release.name}`, label: release.name, detail: release.targetDate ? `Target ${release.targetDate}` : "Target date not recorded" }));
    for (const releaseName of [...used].filter((name): name is string => Boolean(name) && !portfolio.releases.some((release) => release.name === name)).sort()) buckets.push({ key: `release:${releaseName}`, label: releaseName, detail: "Referenced release" });
    return [...buckets, { key: "unscheduled", label: "No release", detail: "No governed delivery boundary" }];
  }
  const months = [...new Set(items.map((item) => monthKey(item.scheduleDate)).filter(Boolean))].sort();
  if (!months.length) return [{ key: "unscheduled", label: "Unscheduled", detail: "No source or planning date" }];
  const first = months[0]; const last = months.at(-1)!;
  const start = Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7)) - 1;
  const finish = Number(last.slice(0, 4)) * 12 + Number(last.slice(5, 7)) - 1;
  if (finish - start <= 11) {
    const result: Bucket[] = [];
    for (let cursor = start; cursor <= finish; cursor += 1) {
      const year = Math.floor(cursor / 12); const month = cursor % 12 + 1; const key = `${year}-${String(month).padStart(2, "0")}`;
      result.push({ key, label: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`)), detail: "Known start, finish, due, or target date" });
    }
    return [...result, { key: "unscheduled", label: "Unscheduled", detail: "No source or planning date" }];
  }
  const quarters = [...new Set(items.map((item) => quarterKey(item.scheduleDate)).filter(Boolean))].sort();
  return [...quarters.map((key) => ({ key, label: key.replace("-", " "), detail: "Quarter derived from a recorded date" })), { key: "unscheduled", label: "Unscheduled", detail: "No source or planning date" }];
}

function itemBucket(item: DependencyBoardItem, mode: PeriodMode, buckets: Bucket[]) {
  if (mode === "release") return item.releaseName ? `release:${item.releaseName}` : "unscheduled";
  const month = monthKey(item.scheduleDate);
  if (!month) return "unscheduled";
  return buckets.some((bucket) => bucket.key === month) ? month : quarterKey(item.scheduleDate);
}

export function DependencyBoard() {
  const [portfolio, setPortfolio] = useState<DependencyBoardPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<PeriodMode>("release");
  const [scope, setScope] = useState<"all" | DependencyBoardEdge["scope"]>("all");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [paths, setPaths] = useState<DrawnPath[]>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dependencies", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as DependencyBoardPortfolio & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The dependency board could not be loaded.");
      if (!cancelled) setPortfolio(payload);
    }).catch((reason) => { if (!cancelled) setMessage(reason instanceof Error ? reason.message : "The dependency board could not be loaded."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (portfolio?.items || []).filter((item) => !needle || `${item.identifier} ${item.title} ${item.owner || ""} ${item.releaseName || ""} ${item.parentLabel || ""}`.toLowerCase().includes(needle));
  }, [portfolio?.items, query]);
  const visibleKeys = useMemo(() => new Set(visibleItems.map((item) => item.key)), [visibleItems]);
  const visibleEdges = useMemo(() => (portfolio?.edges || []).filter((edge) => (scope === "all" || edge.scope === scope) && visibleKeys.has(edge.sourceKey) && visibleKeys.has(edge.targetKey)), [portfolio?.edges, scope, visibleKeys]);
  const buckets = useMemo(() => portfolio ? periodBuckets(portfolio, period, visibleItems) : [], [period, portfolio, visibleItems]);
  const selectedEdge = visibleEdges.find((edge) => edge.id === selectedEdgeId) || visibleEdges.find((edge) => edge.cycle) || visibleEdges[0];

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const stageBox = stage.getBoundingClientRect();
      const next: DrawnPath[] = [];
      for (const edge of visibleEdges) {
        const source = itemRefs.current.get(edge.sourceKey); const target = itemRefs.current.get(edge.targetKey);
        if (!source || !target) continue;
        const sourceBox = source.getBoundingClientRect(); const targetBox = target.getBoundingClientRect();
        const forward = targetBox.left >= sourceBox.right;
        const backward = sourceBox.left >= targetBox.right;
        const x1 = (forward ? sourceBox.right : backward ? sourceBox.left : sourceBox.left + sourceBox.width / 2) - stageBox.left;
        const x2 = (forward ? targetBox.left : backward ? targetBox.right : targetBox.left + targetBox.width / 2) - stageBox.left;
        const y1 = sourceBox.top + sourceBox.height / 2 - stageBox.top;
        const y2 = targetBox.top + targetBox.height / 2 - stageBox.top;
        const direction = x2 >= x1 ? 1 : -1; const bend = Math.max(38, Math.abs(x2 - x1) * .45);
        const sameColumnLift = Math.abs(x2 - x1) < 20 ? Math.max(42, Math.abs(y2 - y1) * .35) : 0;
        const path = sameColumnLift
          ? `M ${x1} ${y1} C ${x1 + 42} ${y1 - sameColumnLift}, ${x2 + 42} ${y2 - sameColumnLift}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1 + direction * bend} ${y1}, ${x2 - direction * bend} ${y2}, ${x2} ${y2}`;
        next.push({ ...edge, path });
      }
      setPaths(next);
    };
    const frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(stage);
    window.addEventListener("resize", measure);
    return () => { window.cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [buckets, period, visibleEdges, visibleItems]);

  if (loading) return <section className="domain-section"><p className="empty">Loading governed dependency chains…</p></section>;
  if (!portfolio || message) return <section className="domain-section"><p className="error-copy">{message || "The dependency board is unavailable."}</p></section>;
  const cyclic = visibleEdges.filter((edge) => edge.cycle);
  const stageStyle = { "--dependency-columns": Math.max(1, buckets.length), minWidth: `${190 + Math.max(1, buckets.length) * 250}px` } as CSSProperties;

  return <>
    <section className="dependency-toolbar domain-section"><div><span className="eyebrow">BIG-ROOM PLANNING VIEW</span><h2>Delivery dependencies across governed levels</h2><p>Cards stay in Release or recorded-date columns. Red strings show the relationships you entered; no date or sequence is inferred.</p></div><div className="dependency-controls"><label>View<select value={period} onChange={(event) => setPeriod(event.target.value as PeriodMode)}><option value="release">Release columns</option><option value="calendar">Calendar columns</option></select></label><label>Strings<select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="all">All dependencies</option><option value="change">Change Request</option><option value="objective_gate">Objective gates</option><option value="work_package">Work Package</option></select></label><label>Inspect<select value={selectedEdge?.id || ""} onChange={(event) => setSelectedEdgeId(event.target.value)}><option value="">No visible string</option>{visibleEdges.map((edge) => <option key={edge.id} value={edge.id}>{edge.sourceLabel} → {edge.targetLabel} · {readable(edge.relationship)}</option>)}</select></label><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find MCP, Objective, work, owner" /></label></div></section>
    <section className="dependency-legend"><span><i className="dependency-string-sample" />Recorded dependency</span><span><i className="dependency-string-sample dependency-string-proposed" />Proposed</span><span><i className="dependency-string-sample dependency-string-cycle" />Reciprocal / circular chain</span><span>{visibleItems.length} cards · {visibleEdges.length} visible strings</span></section>
    {cyclic.length ? <aside className="dependency-cycle-warning"><strong>{cyclic.length} dependency strings participate in a circular chain.</strong><span>This may be a valid reciprocal finish gate, like “A starts before B finishes, but B finishes before A finishes.” Review the selected string’s relationship and timing basis rather than deleting the cycle automatically.</span></aside> : null}
    <section className="dependency-board-scroll" aria-label="Dependency planning board"><div className="dependency-board-stage" ref={stageRef} style={stageStyle}>
      <svg className="dependency-strings" aria-hidden="true"><defs><marker id="dependency-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>{paths.map((edge) => <path key={edge.id} d={edge.path} className={`${edge.cycle ? "dependency-path dependency-path-cycle" : "dependency-path"}${edge.status === "proposed" ? " dependency-path-proposed" : ""}${selectedEdge?.id === edge.id ? " dependency-path-selected" : ""}`} markerEnd="url(#dependency-arrow)" onClick={() => setSelectedEdgeId(edge.id)} />)}</svg>
      <header className="dependency-board-header"><div className="dependency-corner"><strong>Delivery level</strong><span>Rows are not dependencies</span></div>{buckets.map((bucket) => <div key={bucket.key}><strong>{bucket.label}</strong><span>{bucket.detail}</span></div>)}</header>
      {laneOrder.map((lane) => <section className={`dependency-lane dependency-lane-${lane}`} key={lane}><header><strong>{laneLabels[lane].title}</strong><span>{laneLabels[lane].detail}</span><small>{visibleItems.filter((item) => item.kind === lane).length} cards</small></header>{buckets.map((bucket) => <div className="dependency-cell" key={bucket.key}>{visibleItems.filter((item) => item.kind === lane && itemBucket(item, period, buckets) === bucket.key).map((item) => <article className={`dependency-card dependency-card-${item.kind}`} key={item.key} ref={(node) => { if (node) itemRefs.current.set(item.key, node); else itemRefs.current.delete(item.key); }}><div><span>{readable(item.kind)}</span><em>{readable(item.status)}</em></div><Link href={item.href}><strong>{item.identifier}</strong><b>{item.title}</b></Link><small>{item.parentLabel || "No parent context"}</small><footer>{item.owner || "Owner not recorded"}{item.plannedStart || item.plannedFinish ? ` · ${item.plannedStart || "?"} → ${item.plannedFinish || "?"}` : " · Dates not recorded"}</footer></article>)}</div>)}</section>)}
    </div></section>
    {selectedEdge ? <section className="dependency-inspector domain-section"><div><span className="eyebrow">SELECTED STRING</span><h3>{selectedEdge.sourceLabel} → {selectedEdge.targetLabel}</h3><p>{readable(selectedEdge.scope)} · {readable(selectedEdge.relationship)} · {readable(selectedEdge.status)}{selectedEdge.cycle ? " · Circular chain" : ""}</p></div><dl><div><dt>Meaning</dt><dd>{selectedEdge.rationale || "Rationale not recorded."}</dd></div><div><dt>Source reference</dt><dd>{selectedEdge.sourceReference || "Not recorded"}</dd></div></dl></section> : <section className="domain-section empty-state"><h3>No dependencies recorded in this view</h3><p>Add or filter dependency records from Change Requests, Objective technical scope, or Initiative Work Plan.</p></section>}
  </>;
}
