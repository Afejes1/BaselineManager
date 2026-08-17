"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { TECHNICAL_BASELINE_COLUMNS, type TechnicalBaselineColumn } from "../lib/technical-baseline-contract";
import { releaseOf, tierOf } from "../lib/baseline-scope";
import { dataQualityFor, type DataQuality } from "../lib/baseline-quality";

type Cell = string | number | boolean | null | undefined;
type Record24 = Record<TechnicalBaselineColumn, Cell>;
type ImportDraft = { fileName: string; sheetName: string; rows: Record24[] };
type ReviewStatus = "not_reviewed" | "reviewed" | "follow_up";
type ManualReview = { status: ReviewStatus; reviewedAt: string | null; note?: string | null };

const blankRecord = (): Record24 => Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, ""])) as Record24;
const sample = (values: Partial<Record24>): Record24 => ({ ...blankRecord(), ...values });
const sampleRows: Record24[] = [
  sample({ "#":"000082", ReleaseName:"30P05", Tier:"Mission Systems", Resource:"ALIS Core", TechStackType:"Platform Service", ShortName:"ODIN", HW_Host:"VM-APP-010", "HW_Storage_Type":"SSD", "HW_Storage (GB)":720, HW_CPU_CORES:12, "HW_RAM (GB)":48, "SW Language":"Java", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", "Container Type":"Service", LongName:"Operational Data Integrated Network", Notes:"Prior-release reported placement." }),
  sample({ "#":"000083", ReleaseName:"30P05", Tier:"Mission Systems", Resource:"ALIS Core", TechStackType:"Data Service", ShortName:"DataSvc", HW_Host:"VM-DB-003", "HW_Storage_Type":"SSD", "HW_Storage (GB)":1000, HW_CPU_CORES:10, "HW_RAM (GB)":40, "SW Language":"C#", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", "Container Type":"Service", LongName:"Maintenance Data Service" }),
  sample({ "#":"000119", ReleaseName:"30P05", Tier:"Training", Resource:"Courseware", TechStackType:"Web Application", ShortName:"TMS", HW_Host:"VM-WEB-018", "HW_Storage_Type":"SAN", "HW_Storage (GB)":300, HW_CPU_CORES:8, "HW_RAM (GB)":24, "SW Language":"TypeScript", "Software Type":"GOTS", OEM:"Government", Containerized:"No", LongName:"Training Management System" }),
  sample({ "#":"000184", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"ALIS Core", TechStackType:"Platform Service", ShortName:"ODIN", HW_Host:"VM-APP-012", "HW_Storage_Type":"SSD", "HW_Storage (GB)":850, HW_CPU_CORES:16, "HW_RAM (GB)":64, "SW Language":"Java", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", "Container Type":"Service", LongName:"Operational Data Integrated Network" }),
  sample({ "#":"000185", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"ALIS Core", TechStackType:"Data Service", ShortName:"DataSvc", HW_Host:"VM-DB-004", "HW_Storage_Type":"SSD", "HW_Storage (GB)":1200, HW_CPU_CORES:12, "HW_RAM (GB)":48, "SW Language":"C#", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", "Container Type":"Service", LongName:"Maintenance Data Service", Notes:"Confirm authoritative OEM designation." }),
  sample({ "#":"000219", ReleaseName:"30P06", Tier:"Training", Resource:"Courseware", TechStackType:"Web Application", ShortName:"TMS", HW_Host:"VM-WEB-022", "HW_Storage_Type":"SAN", "HW_Storage (GB)":350, HW_CPU_CORES:8, "HW_RAM (GB)":24, "SW Language":"TypeScript", "Software Type":"GOTS", OEM:"Government", Containerized:"No", LongName:"Training Management System" }),
  sample({ "#":"000241", ReleaseName:"30P06", Tier:"Logistics", Resource:"Supply Chain", TechStackType:"Business Service", ShortName:"SPS", HW_Host:"BLD-07-N03", "HW_Storage_Type":"", "HW_Storage (GB)":500, HW_CPU_CORES:8, "HW_RAM (GB)":32, "SW Language":"Java", "Software Type":"COTS", OEM:"COTS Vendor", Containerized:"Yes", "Container Technology":"Docker", LongName:"Spare Parts Service", Notes:"Storage type is unresolved." }),
  sample({ "#":"000258", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"Flight Data", TechStackType:"Custom Software", ShortName:"FDP", HW_Host:"VM-API-031", "HW_Storage_Type":"SSD", "HW_Storage (GB)":640, HW_CPU_CORES:24, "HW_RAM (GB)":96, "SW Language":"C++", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", LongName:"Flight Data Processor" }),
  sample({ "#":"000276", ReleaseName:"30P06", Tier:"Cyber", Resource:"Identity", TechStackType:"COTS", ShortName:"IDAM", HW_Host:"VM-IAM-002", "HW_Storage_Type":"SAN", "HW_Storage (GB)":280, HW_CPU_CORES:8, "HW_RAM (GB)":32, "SW Language":"Java", "Software Type":"COTS", OEM:"OEM Partner", Containerized:"No", LongName:"Identity and Access Manager", "Technical Capability Satisfied by this SW/Tech - Notes":"Identity assurance" }),
];

const text = (value: Cell) => value == null ? "" : String(value);
const reviewIdentity = (row: Record24) => `${text(row.ReleaseName).trim()}\u001f${text(row["#"]).trim()}`;
const manualReviewLabel = (status: ReviewStatus) => status === "reviewed" ? "Reviewed" : status === "follow_up" ? "Follow-up" : "Not reviewed";
const reviewDate = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", year:"numeric" }).format(new Date(value)) : "No review date";
const nav = ["Baseline Manager", "Imports", "Data Quality", "Initiatives", "Executive Briefs"];

function Mark({ quality }: { quality: DataQuality }) {
  return <span className={`mark mark-${quality.level}`}>{quality.label}</span>;
}

export function BaselineManager() {
  const [rows, setRows] = useState<Record24[]>(sampleRows);
  const [query, setQuery] = useState("");
  const [activeRelease, setActiveRelease] = useState("All releases");
  const [activeTier, setActiveTier] = useState("All records");
  const [activeQuality, setActiveQuality] = useState("All checks");
  const [activeReview, setActiveReview] = useState("All review statuses");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [importError, setImportError] = useState("");
  const [notice, setNotice] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showQualityHelp, setShowQualityHelp] = useState(false);
  const [showAddRow, setShowAddRow] = useState(false);
  const [reviews, setReviews] = useState<Record<string,ManualReview>>({});
  const [reviewSaving, setReviewSaving] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [newRowRelease, setNewRowRelease] = useState("");
  const [newReleaseName, setNewReleaseName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const stored = window.localStorage.getItem("v3-baseline-draft");
      if (stored) try { setRows(JSON.parse(stored)); } catch { /* keep demonstration rows */ }
      setRailCollapsed(window.localStorage.getItem("v3-rail-collapsed") === "true");
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    fetch("/api/baseline/reviews").then((response) => response.ok ? response.json() : Promise.reject()).then((payload:{reviews?:Record<string,ManualReview>}) => setReviews(payload.reviews ?? {})).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (selectedIndex === null) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelectedIndex(null); setShowAll(false); } };
    window.addEventListener("keydown",closeOnEscape);
    return () => window.removeEventListener("keydown",closeOnEscape);
  }, [selectedIndex]);

  const selected = selectedIndex === null ? blankRecord() : rows[selectedIndex] ?? blankRecord();
  const selectedQuality = dataQualityFor(selected);
  const selectedReview = reviews[reviewIdentity(selected)] ?? { status:"not_reviewed" as ReviewStatus, reviewedAt:null };
  const filtered = useMemo(() => rows.map((row,index) => ({ row,index })).filter(({row}) => {
    const releaseMatch = activeRelease === "All releases" || releaseOf(row) === activeRelease;
    const tierMatch = activeTier === "All records" || tierOf(row) === activeTier;
    const qualityMatch = activeQuality === "All checks" || dataQualityFor(row).label === activeQuality;
    const rowReview = reviews[reviewIdentity(row)]?.status ?? "not_reviewed";
    const reviewMatch = activeReview === "All review statuses" || manualReviewLabel(rowReview) === activeReview;
    return releaseMatch && tierMatch && qualityMatch && reviewMatch && TECHNICAL_BASELINE_COLUMNS.map((column) => text(row[column])).join(" ").toLowerCase().includes(query.toLowerCase());
  }), [rows, reviews, query, activeRelease, activeTier, activeQuality, activeReview]);
  const releases = Array.from(new Set(rows.map(releaseOf)));
  const releaseGroups = releases.map((release) => {
    const releaseRows = rows.filter((row) => releaseOf(row) === release);
    return { release, rows:releaseRows, tiers:Array.from(new Set(releaseRows.map(tierOf))) };
  });
  const scopeRows = activeRelease === "All releases" ? rows : rows.filter((row) => releaseOf(row) === activeRelease);
  const scopeTiers = new Set(scopeRows.map(tierOf));
  const availableTiers = Array.from(scopeTiers);
  const issueCount = scopeRows.filter((row) => dataQualityFor(row).level !== "ready").length;
  const productCount = new Set(scopeRows.map((row) => text(row.LongName) || text(row.ShortName)).filter(Boolean)).size;
  const nextSourceKey = String(Math.max(0, ...rows.map((row) => Number(text(row["#"])) || 0)) + 1).padStart(6,"0");
  const resolvedNewRowRelease = newRowRelease === "__new__" ? newReleaseName.trim() : newRowRelease;

  function persist(next: Record24[], message: string) {
    setRows(next); window.localStorage.setItem("v3-baseline-draft", JSON.stringify(next)); setNotice(message); window.setTimeout(() => setNotice(""), 2600);
  }
  function edit(column: TechnicalBaselineColumn, value: string) {
    if (selectedIndex === null) return;
    setRows((current) => {
      const next = current.map((row, index) => index === selectedIndex ? { ...row, [column]: value } : row);
      window.localStorage.setItem("v3-baseline-draft",JSON.stringify(next));
      return next;
    });
  }
  function toggleRail() {
    setRailCollapsed((current) => { const next=!current; window.localStorage.setItem("v3-rail-collapsed",String(next)); return next; });
  }
  async function setManualReview(status: ReviewStatus) {
    const releaseName = text(selected.ReleaseName).trim();
    const sourceKey = text(selected["#"]).trim();
    if (!releaseName || !sourceKey) { setNotice("Add both # and ReleaseName before recording a manual review."); return; }
    const key = reviewIdentity(selected);
    const previous = reviews[key];
    const optimistic = { status, reviewedAt:status === "not_reviewed" ? null : new Date().toISOString() };
    setReviews((current) => ({ ...current, [key]:optimistic })); setReviewSaving(true);
    try {
      const response = await fetch("/api/baseline/reviews", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ releaseName, sourceKey, status }) });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { review:ManualReview };
      setReviews((current) => ({ ...current, [key]:payload.review }));
      setNotice(status === "not_reviewed" ? "Cleared the manual review for this source occurrence." : `Recorded ${manualReviewLabel(status).toLowerCase()} on this source occurrence.`);
    } catch {
      setReviews((current) => { const next={...current}; if(previous) next[key]=previous; else delete next[key]; return next; });
      setNotice("Manual review could not be saved. Try again.");
    } finally { setReviewSaving(false); window.setTimeout(() => setNotice(""),2600); }
  }
  function openAddRow() {
    setNewRowRelease(activeRelease === "All releases" || activeRelease === "Unassigned" ? "" : activeRelease);
    setNewReleaseName(""); setShowAddRow(true);
  }
  function addRow() {
    const chosenRelease = newRowRelease === "__new__" ? newReleaseName.trim() : newRowRelease;
    if (!chosenRelease) { setNotice("Select an existing release or enter a new ReleaseName."); return; }
    const nextNumber = Math.max(0, ...rows.map((row) => Number(text(row["#"])) || 0)) + 1;
    const row = { ...blankRecord(), "#": String(nextNumber).padStart(6, "0"), ReleaseName: chosenRelease };
    const next = [...rows,row]; setSelectedIndex(rows.length); persist(next, `Created a new source occurrence in release ${chosenRelease}.`); setActiveTier("All records"); setActiveQuality("All checks"); setActiveReview("All review statuses"); setShowAll(false); setShowAddRow(false);
  }
  function toggleChecked(index: number) { setChecked((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; }); }
  async function readWorkbook(file: File) {
    setImportError("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type:"array", cellDates:false, raw:true });
      const sheetName = workbook.SheetNames[0];
      const cells = XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[sheetName], { header:1, defval:"", raw:true });
      const headers = (cells[0] ?? []).map(text);
      const mismatch = headers.length !== 24 || headers.some((header, index) => header !== TECHNICAL_BASELINE_COLUMNS[index]);
      if (mismatch) throw new Error("The first worksheet must contain the exact 24 headers in the retained order. No columns were imported.");
      const imported = cells.slice(1).filter((line) => line.some((cell) => text(cell).trim())).map((line) => Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column, index) => [column, line[index] ?? ""])) as Record24);
      setDraft({ fileName:file.name, sheetName, rows:imported });
    } catch (error) { setImportError(error instanceof Error ? error.message : "The workbook could not be read."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  async function acceptImport() {
    if (!draft) return;
    persist(draft.rows, `Imported ${draft.rows.length} rows across ${new Set(draft.rows.map(releaseOf)).size} releases from ${draft.fileName}.`); setSelectedIndex(null); setActiveRelease("All releases"); setActiveTier("All records"); setActiveQuality("All checks"); setActiveReview("All review statuses");
    fetch("/api/baseline/import", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(draft) }).catch(() => undefined);
    setDraft(null);
  }
  function exportWorkbook() {
    const exportRows = activeRelease === "All releases" ? rows : scopeRows;
    const data = [TECHNICAL_BASELINE_COLUMNS, ...exportRows.map((row) => TECHNICAL_BASELINE_COLUMNS.map((column) => row[column] ?? ""))];
    const sheet = XLSX.utils.aoa_to_sheet(data); sheet["!cols"] = TECHNICAL_BASELINE_COLUMNS.map((column) => ({ wch: Math.min(46, Math.max(12, column.length + 2)) }));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "Technical Baseline"); XLSX.writeFile(workbook, `Technical_Baseline_${activeRelease === "All releases" ? "All_Releases" : activeRelease}.xlsx`);
    setNotice(`Exported ${exportRows.length} rows for ${activeRelease} in the exact 24-column projection.`);
  }

  return <main className="shell">
    <input ref={fileRef} className="visually-hidden" type="file" accept=".xlsx,.xls" onChange={(event) => event.target.files?.[0] && readWorkbook(event.target.files[0])}/>
    <aside className={railCollapsed?"rail rail-collapsed":"rail"}><div className="brand"><span className="brand-mark">V3</span><span className="brand-name">JSF Baseline</span><button className="rail-toggle" type="button" onClick={toggleRail} aria-label={railCollapsed?"Expand navigation":"Collapse navigation"} title={railCollapsed?"Expand navigation":"Collapse navigation"}>{railCollapsed?"›":"‹"}</button></div><nav aria-label="Primary navigation"><p className="rail-label">Workspace</p>{nav.map((item,index)=><button key={item} className={index===0?"nav-item active":"nav-item"} title={railCollapsed?item:undefined}><span className="nav-icon">{["▦","⇩","◇","⌁","▤"][index]}</span><span className="nav-label">{item}</span>{index>2&&<em>Soon</em>}</button>)}</nav><div className="rail-context"><span className="context-dot"/><div><strong>Release scope</strong><small>{activeRelease} · Reported</small></div></div><button className="profile"><span>AC</span><div><strong>Baseline steward</strong><small>Government team</small></div><b>···</b></button></aside>
    <section className="workspace"><header className="topbar"><div><span className="eyebrow">TECHNICAL BASELINE</span><h1>Baseline Manager</h1></div><div className="top-actions"><label className="release-selector"><span>Release scope</span><select value={activeRelease} onChange={(event)=>{setActiveRelease(event.target.value);setActiveTier("All records");}}><option>All releases</option>{releases.map((release)=><option key={release}>{release}</option>)}</select></label><button className="ghost-button">Activity</button><button className="primary-button" onClick={()=>fileRef.current?.click()}>Import workbook</button></div></header>
      <section className="summary"><div className="summary-lead"><p>{activeRelease === "All releases" ? `${releases.length} RELEASES IN SCOPE` : `RELEASE ${activeRelease}`}</p><h2>{activeRelease === "All releases" ? "Reported baselines across releases" : "Reported technical baseline"}</h2><span>Working draft · ReleaseName retained on every source occurrence</span></div><div className="metric"><span>Source records</span><strong>{scopeRows.length}</strong><small>{activeRelease} · exact projection</small></div><div className="metric"><span>Canonical products</span><strong>{productCount}</strong><small>Across {scopeTiers.size} tiers in scope</small></div><div className="metric metric-alert"><span>Automated attention</span><strong>{issueCount}</strong><small>{scopeRows.filter(r=>dataQualityFor(r).level==="issue").length} blocking · {scopeRows.filter(r=>dataQualityFor(r).level==="review").length} warnings</small></div></section>
      <div className="content-grid"><aside className="tree-panel"><div className="panel-heading"><div><span className="eyebrow">STRUCTURE</span><h3>Release configuration</h3></div><button>•••</button></div><div className="tree-list"><button className={activeRelease==="All releases"&&activeTier==="All records"?"tree-row selected":"tree-row"} onClick={()=>{setActiveRelease("All releases");setActiveTier("All records");}}><span>▦</span><b>All releases</b><em>{rows.length}</em></button>{releaseGroups.map((group)=><div className="release-tree" key={group.release}><button className={activeRelease===group.release&&activeTier==="All records"?"tree-row release-row selected":"tree-row release-row"} onClick={()=>{setActiveRelease(group.release);setActiveTier("All records");}}><span>◆</span><b>{group.release}</b><em>{group.rows.length}</em></button>{group.tiers.map((tier)=><button key={`${group.release}:${tier}`} className={activeRelease===group.release&&activeTier===tier?"tree-row tree-child selected":"tree-row tree-child"} onClick={()=>{setActiveRelease(group.release);setActiveTier(tier);}}><span>└</span><b>{tier}</b><em>{group.rows.filter((row)=>tierOf(row)===tier).length}</em></button>)}</div>)}</div><div className="quality-card"><span className="quality-score">{scopeRows.length?Math.round((scopeRows.length-issueCount)/scopeRows.length*100):100}%</span><div><strong>Automated health</strong><small>{scopeRows.length-issueCount} of {scopeRows.length} pass checks</small></div></div></aside>
        <section className="records-panel"><div className="records-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search products, hosts, or OEM…"/></label><button className={showFilters?"tool-button tool-active":"tool-button"} onClick={()=>setShowFilters((value)=>!value)} aria-expanded={showFilters}>≡ Filter <span>{(activeRelease==="All releases"?0:1)+(activeTier==="All records"?0:1)+(activeQuality==="All checks"?0:1)+(activeReview==="All review statuses"?0:1)}</span></button><div className="spacer"/><button className="tool-button" onClick={exportWorkbook}>Export {activeRelease==="All releases"?"all":activeRelease} .xlsx</button><button className="add-button" onClick={openAddRow}>＋ Add row</button></div>
          {showFilters&&<section className="filter-panel" aria-label="Source record filters"><div><span>ReleaseName</span><select value={activeRelease} onChange={(event)=>{setActiveRelease(event.target.value);setActiveTier("All records");}}><option>All releases</option>{releases.map((release)=><option key={release}>{release}</option>)}</select></div><div><span>Tier</span><select value={activeTier} onChange={(event)=>setActiveTier(event.target.value)}><option>All records</option>{availableTiers.map((tier)=><option key={tier}>{tier}</option>)}</select></div><div><span>Automated checks</span><select value={activeQuality} onChange={(event)=>setActiveQuality(event.target.value)}><option>All checks</option><option>Pass</option><option>Warning</option><option>Blocking</option></select></div><div><span>Manual review</span><select value={activeReview} onChange={(event)=>setActiveReview(event.target.value)}><option>All review statuses</option><option>Not reviewed</option><option>Reviewed</option><option>Follow-up</option></select></div><button onClick={()=>{setActiveRelease("All releases");setActiveTier("All records");setActiveQuality("All checks");setActiveReview("All review statuses");setQuery("");}}>Clear filters</button></section>}
          <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select all visible rows" checked={filtered.length>0&&filtered.every(({index})=>checked.has(index))} onChange={()=>setChecked(filtered.every(({index})=>checked.has(index))?new Set():new Set(filtered.map(({index})=>index)))}/></th><th>#</th><th>Release</th><th>Product</th><th>Placement</th><th>Host</th><th>Type</th><th>OEM</th><th>Runtime</th><th><span className="quality-heading">Automated checks<button type="button" className="quality-info" aria-label="Explain automated health checks" onClick={()=>setShowQualityHelp(true)}>?</button></span></th><th>Manual review</th><th></th></tr></thead><tbody>{filtered.map(({row,index})=>{const key=text(row["#"]);const quality=dataQualityFor(row);const rowReview=reviews[reviewIdentity(row)]??{status:"not_reviewed" as ReviewStatus,reviewedAt:null};return <tr key={`${text(row.ReleaseName)}:${key}:${index}`} className={selectedIndex===index?"row-selected":""} onClick={()=>setSelectedIndex(index)}><td><input type="checkbox" checked={checked.has(index)} onClick={e=>e.stopPropagation()} onChange={()=>toggleChecked(index)} aria-label={`Select ${text(row.LongName)||key} in ${text(row.ReleaseName)}`}/></td><td className="mono">{key}</td><td><span className="release-chip">{text(row.ReleaseName)||"Unassigned"}</span></td><td><strong>{text(row.ShortName)||"Unnamed"}</strong><small>{text(row.LongName)||"Canonical name missing"}</small></td><td><strong>{text(row.Tier)||"Unassigned"}</strong><small>{text(row.Resource)||"Resource missing"}</small></td><td className="mono">{text(row.HW_Host)||"—"}</td><td>{text(row.TechStackType)||"—"}</td><td>{text(row.OEM)||"—"}</td><td>{text(row.Containerized)==="Yes"?`${text(row.Containerized)} · ${text(row["Container Technology"])}`:text(row.Containerized)||"—"}</td><td><Mark quality={quality}/></td><td><span className={`review-mark review-${rowReview.status}`}>{manualReviewLabel(rowReview.status)}</span><small>{reviewDate(rowReview.reviewedAt)}</small></td><td>›</td></tr>})}</tbody></table>{!filtered.length&&<div className="empty">No source records match the selected scope and health filters.</div>}</div><footer className="table-footer"><span>Showing {filtered.length} records · {scopeRows.length} in {activeRelease}</span><div><button disabled>‹</button><b>1</b><button>›</button></div></footer></section>
        {selectedIndex!==null&&<div className="detail-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget){setSelectedIndex(null);setShowAll(false);}}}><aside className="detail-panel detail-sheet" role="dialog" aria-modal="true" aria-label={`Source record ${text(selected["#"])}`}><div className="detail-head"><div><span className="eyebrow">SOURCE RECORD #{text(selected["#"])||"NEW"}</span><h3>{text(selected.ShortName)||"New product"}</h3><p>{text(selected.LongName)||"Complete the retained source columns."}</p><span className="autosave-label">✓ Changes save automatically</span></div><button type="button" aria-label="Close record details" title="Close" onClick={()=>{setSelectedIndex(null);setShowAll(false);}}>×</button></div><div className="detail-tabs"><button className="tab-active">Record</button><button>Lineage</button><button>History</button></div><div className="detail-body"><div className="detail-status quality-summary"><Mark quality={selectedQuality}/><div><strong>Automated health checks</strong><span>Calculated from source values · not included in XLSX export</span></div><button type="button" className="quality-info" aria-label="Explain automated health checks" onClick={()=>setShowQualityHelp(true)}>?</button></div>
          <section className="quality-checks"><h4>Automated check results</h4>{selectedQuality.issues.length===0?<p className="quality-complete">✓ The current source values pass all configured checks.</p>:<ul>{selectedQuality.issues.map((issue,index)=><li key={`${issue.field}:${index}`} className={`quality-${issue.severity}`}><strong>{issue.field}</strong><span>{issue.message}</span></li>)}</ul>}<p className="quality-guidance">Edit the flagged source field below and the check reruns automatically. This does not replace a steward review.</p></section>
          <section className="manual-review"><div className="section-heading"><h4>Manual review</h4><span>Application metadata</span></div><label>Review status<select value={selectedReview.status} disabled={reviewSaving} onChange={(event)=>setManualReview(event.target.value as ReviewStatus)}><option value="not_reviewed">Not reviewed</option><option value="reviewed">Reviewed</option><option value="follow_up">Needs follow-up</option></select></label><div className="review-date"><span>Last reviewed</span><strong>{reviewDate(selectedReview.reviewedAt)}</strong></div><p>Stored separately from the 24 source columns and retained across sessions.</p></section>
          <section><h4>Workbook identity</h4><label>LongName<input value={text(selected.LongName)} onChange={e=>edit("LongName",e.target.value)}/></label><div className="field-pair"><label>ShortName<input value={text(selected.ShortName)} onChange={e=>edit("ShortName",e.target.value)}/></label><label>ReleaseName<select value={text(selected.ReleaseName)} onChange={e=>edit("ReleaseName",e.target.value)}><option value="">Unassigned</option>{releases.filter((release)=>release!=="Unassigned").map((release)=><option key={release}>{release}</option>)}</select></label></div></section><section><h4>Configuration placement</h4>{(["Tier","Resource","HW_Host"] as TechnicalBaselineColumn[]).map(column=><label key={column}>{column}<input className={column==="HW_Host"?"mono":""} value={text(selected[column])} onChange={e=>edit(column,e.target.value)}/></label>)}</section><section><h4>Reported node state</h4><div className="field-pair"><label>Storage type<input value={text(selected.HW_Storage_Type)} placeholder="e.g., SSD or SAN" onChange={e=>edit("HW_Storage_Type",e.target.value)}/></label><label>Storage (GB)<input value={text(selected["HW_Storage (GB)"])} onChange={e=>edit("HW_Storage (GB)",e.target.value)}/></label></div><div className="field-pair"><label>CPU cores<input value={text(selected.HW_CPU_CORES)} onChange={e=>edit("HW_CPU_CORES",e.target.value)}/></label><label>RAM (GB)<input value={text(selected["HW_RAM (GB)"])} onChange={e=>edit("HW_RAM (GB)",e.target.value)}/></label></div></section>
          {showAll&&<section className="all-fields"><h4>All retained source columns</h4>{TECHNICAL_BASELINE_COLUMNS.filter(c=>!["LongName","ShortName","ReleaseName","Tier","Resource","HW_Host","HW_Storage_Type","HW_CPU_CORES","HW_RAM (GB)","HW_Storage (GB)"].includes(c)).map(column=><label key={column}>{column}<input value={text(selected[column])} onChange={e=>edit(column,e.target.value)}/></label>)}</section>}
          <button className="show-all" onClick={()=>setShowAll(v=>!v)}>{showAll?"Collapse retained columns":"Show all 24 source columns"}<span>{showAll?"↑":"↓"}</span></button></div></aside></div>}
      </div>
    </section>
    {showAddRow&&<div className="modal-backdrop" role="presentation"><section className="import-modal add-row-modal" role="dialog" aria-modal="true" aria-labelledby="add-row-title"><span className="eyebrow">NEW SOURCE OCCURRENCE</span><h2 id="add-row-title">Choose the release first</h2><p>A source row cannot be created from <strong>All releases</strong> without an explicit ReleaseName. This prevents the application from silently assigning the row to the wrong reported baseline.</p><div className="new-row-summary"><span>Proposed source key</span><strong>#{nextSourceKey}</strong></div><label className="modal-field">ReleaseName<select value={newRowRelease} onChange={(event)=>setNewRowRelease(event.target.value)}><option value="">Select a release…</option>{releases.filter((release)=>release!=="Unassigned").map((release)=><option key={release}>{release}</option>)}<option value="__new__">＋ Create a new release…</option></select></label>{newRowRelease==="__new__"&&<label className="modal-field">New ReleaseName<input value={newReleaseName} onChange={(event)=>setNewReleaseName(event.target.value)} placeholder="Enter the exact source value"/></label>}<div className={resolvedNewRowRelease?"assignment-preview ready":"assignment-preview"}><span>{resolvedNewRowRelease?"Row will be assigned to":"Waiting for release selection"}</span><strong>{resolvedNewRowRelease||"No release selected"}</strong></div><footer><button className="ghost-button" onClick={()=>setShowAddRow(false)}>Cancel</button><button className="primary-button" disabled={!resolvedNewRowRelease} onClick={addRow}>Create source row</button></footer></section></div>}
    {showQualityHelp&&<div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setShowQualityHelp(false);}}><section className="import-modal quality-help-modal" role="dialog" aria-modal="true" aria-labelledby="quality-help-title"><span className="eyebrow">AUTOMATED HEALTH CHECKS</span><h2 id="quality-help-title">Why does the system check each row?</h2><p>Automated checks catch missing or inconsistent source values before the row is normalized into canonical records. They are <strong>not one of the 24 spreadsheet columns</strong> and are not included in XLSX export.</p><div className="quality-key"><div><Mark quality={{level:"ready",label:"Pass",issues:[]}}/><span>No configured source-value checks failed.</span></div><div><Mark quality={{level:"review",label:"Warning",issues:[]}}/><span>The row is usable, but a value is incomplete or inconsistent.</span></div><div><Mark quality={{level:"issue",label:"Blocking",issues:[]}}/><span>The row cannot be reliably materialized until a required identity is corrected.</span></div></div><p className="modal-note">Automated health and manual review are separate. A row can pass its checks and still be waiting for a steward to review it.</p><footer><button className="primary-button" onClick={()=>setShowQualityHelp(false)}>Got it</button></footer></section></div>}
    {(draft||importError)&&<div className="modal-backdrop" role="presentation"><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><span className="eyebrow">WORKBOOK INTAKE</span><h2 id="import-title">{importError?"Contract mismatch":"Ready to reconcile"}</h2>{importError?<><p className="error-copy">{importError}</p><div className="contract-strip">Expected: {TECHNICAL_BASELINE_COLUMNS.length} columns · exact names · exact order</div><footer><button className="primary-button" onClick={()=>setImportError("")}>Return to baseline</button></footer></>:draft&&<><p><strong>{draft.fileName}</strong> · {draft.sheetName}</p><div className="import-stats four"><div><strong>{draft.rows.length}</strong><span>Source rows</span></div><div><strong>{new Set(draft.rows.map(releaseOf)).size}</strong><span>Releases</span></div><div><strong>{draft.rows.filter(r=>dataQualityFor(r).level==="ready").length}</strong><span>Checks pass</span></div><div><strong>{draft.rows.filter(r=>dataQualityFor(r).level!=="ready").length}</strong><span>Needs attention</span></div></div><div className="release-list"><span>ReleaseName values</span>{Array.from(new Set(draft.rows.map(releaseOf))).map((release)=><b key={release}>{release} · {draft.rows.filter((row)=>releaseOf(row)===release).length} rows</b>)}</div><p className="modal-note">Each source occurrence retains ReleaseName. Import reuses the canonical product while linking its reported configuration and deployment state to the correct release baseline.</p><footer><button className="ghost-button" onClick={()=>setDraft(null)}>Cancel</button><button className="primary-button" onClick={acceptImport}>Import and reconcile</button></footer></>}</section></div>}
    {notice&&<div className="toast" role="status">✓ {notice}</div>}
  </main>;
}
