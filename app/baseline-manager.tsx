"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { TECHNICAL_BASELINE_COLUMNS, type TechnicalBaselineColumn } from "../lib/technical-baseline-contract";

type Cell = string | number | boolean | null | undefined;
type Record24 = Record<TechnicalBaselineColumn, Cell>;
type ImportDraft = { fileName: string; sheetName: string; rows: Record24[] };

const blankRecord = (): Record24 => Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, ""])) as Record24;
const sample = (values: Partial<Record24>): Record24 => ({ ...blankRecord(), ...values });
const sampleRows: Record24[] = [
  sample({ "#":"000184", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"ALIS Core", TechStackType:"Platform Service", ShortName:"ODIN", HW_Host:"VM-APP-012", "HW_Storage_Type":"SSD", "HW_Storage (GB)":850, HW_CPU_CORES:16, "HW_RAM (GB)":64, "SW Language":"Java", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", "Container Type":"Service", LongName:"Operational Data Integrated Network" }),
  sample({ "#":"000185", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"ALIS Core", TechStackType:"Data Service", ShortName:"DataSvc", HW_Host:"VM-DB-004", "HW_Storage_Type":"SSD", "HW_Storage (GB)":1200, HW_CPU_CORES:12, "HW_RAM (GB)":48, "SW Language":"C#", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", "Container Type":"Service", LongName:"Maintenance Data Service", Notes:"Confirm authoritative OEM designation." }),
  sample({ "#":"000219", ReleaseName:"30P06", Tier:"Training", Resource:"Courseware", TechStackType:"Web Application", ShortName:"TMS", HW_Host:"VM-WEB-022", "HW_Storage_Type":"SAN", "HW_Storage (GB)":350, HW_CPU_CORES:8, "HW_RAM (GB)":24, "SW Language":"TypeScript", "Software Type":"GOTS", OEM:"Government", Containerized:"No", LongName:"Training Management System" }),
  sample({ "#":"000241", ReleaseName:"30P06", Tier:"Logistics", Resource:"Supply Chain", TechStackType:"Business Service", ShortName:"SPS", HW_Host:"BLD-07-N03", "HW_Storage_Type":"", "HW_Storage (GB)":500, HW_CPU_CORES:8, "HW_RAM (GB)":32, "SW Language":"Java", "Software Type":"COTS", OEM:"COTS Vendor", Containerized:"Yes", "Container Technology":"Docker", LongName:"Spare Parts Service", Notes:"Storage type is unresolved." }),
  sample({ "#":"000258", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"Flight Data", TechStackType:"Custom Software", ShortName:"FDP", HW_Host:"VM-API-031", "HW_Storage_Type":"SSD", "HW_Storage (GB)":640, HW_CPU_CORES:24, "HW_RAM (GB)":96, "SW Language":"C++", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", LongName:"Flight Data Processor" }),
  sample({ "#":"000276", ReleaseName:"30P06", Tier:"Cyber", Resource:"Identity", TechStackType:"COTS", ShortName:"IDAM", HW_Host:"VM-IAM-002", "HW_Storage_Type":"SAN", "HW_Storage (GB)":280, HW_CPU_CORES:8, "HW_RAM (GB)":32, "SW Language":"Java", "Software Type":"COTS", OEM:"OEM Partner", Containerized:"No", LongName:"Identity and Access Manager", "Technical Capability Satisfied by this SW/Tech - Notes":"Identity assurance" }),
];

const text = (value: Cell) => value == null ? "" : String(value);
const issueFor = (row: Record24) => !text(row["#"]).trim() || !text(row.ReleaseName).trim() || (!text(row.LongName).trim() && !text(row.ShortName).trim()) ? "issue" : !text(row.HW_Storage_Type).trim() || !!text(row.Notes).trim() ? "review" : "ready";
const nav = ["Baseline Manager", "Imports", "Data Quality", "Initiatives", "Executive Briefs"];

function Mark({ status }: { status: "ready" | "review" | "issue" }) {
  return <span className={`mark mark-${status}`}>{status === "ready" ? "Ready" : status === "review" ? "Review" : "Issue"}</span>;
}

export function BaselineManager() {
  const [rows, setRows] = useState<Record24[]>(sampleRows);
  const [query, setQuery] = useState("");
  const [activeTier, setActiveTier] = useState("All records");
  const [selectedKey, setSelectedKey] = useState(text(sampleRows[0]["#"]));
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [importError, setImportError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const stored = window.localStorage.getItem("v3-baseline-draft");
      if (stored) try { setRows(JSON.parse(stored)); } catch { /* keep demonstration rows */ }
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  const selectedIndex = Math.max(0, rows.findIndex((row) => text(row["#"]) === selectedKey));
  const selected = rows[selectedIndex] ?? blankRecord();
  const filtered = useMemo(() => rows.filter((row) => {
    const tierMatch = activeTier === "All records" || text(row.Tier) === activeTier;
    return tierMatch && TECHNICAL_BASELINE_COLUMNS.map((column) => text(row[column])).join(" ").toLowerCase().includes(query.toLowerCase());
  }), [rows, query, activeTier]);
  const tiers = ["All records", ...Array.from(new Set(rows.map((row) => text(row.Tier)).filter(Boolean)))];
  const issueCount = rows.filter((row) => issueFor(row) !== "ready").length;
  const productCount = new Set(rows.map((row) => text(row.LongName) || text(row.ShortName)).filter(Boolean)).size;

  function persist(next: Record24[], message: string) {
    setRows(next); window.localStorage.setItem("v3-baseline-draft", JSON.stringify(next)); setNotice(message); window.setTimeout(() => setNotice(""), 2600);
  }
  function edit(column: TechnicalBaselineColumn, value: string) {
    setRows((current) => current.map((row, index) => index === selectedIndex ? { ...row, [column]: value } : row));
  }
  function saveSelected() { persist(rows, `Saved source record #${text(selected["#"]) || "new"} to the working draft.`); }
  function addRow() {
    const nextNumber = Math.max(0, ...rows.map((row) => Number(text(row["#"])) || 0)) + 1;
    const row = { ...blankRecord(), "#": String(nextNumber).padStart(6, "0"), ReleaseName: text(rows[0]?.ReleaseName) };
    setRows((current) => [...current, row]); setSelectedKey(text(row["#"])); setShowAll(true);
  }
  function toggleChecked(key: string) { setChecked((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
  function bulkReview() {
    if (!checked.size) { setNotice("Select one or more source records first."); return; }
    const next = rows.map((row) => checked.has(text(row["#"])) ? { ...row, Notes: text(row.Notes) || "Flagged for baseline steward review." } : row);
    persist(next, `Updated ${checked.size} source records.`); setChecked(new Set());
  }
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
    persist(draft.rows, `Imported ${draft.rows.length} rows from ${draft.fileName}.`); setSelectedKey(text(draft.rows[0]?.["#"]));
    fetch("/api/baseline/import", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(draft) }).catch(() => undefined);
    setDraft(null);
  }
  function exportWorkbook() {
    const data = [TECHNICAL_BASELINE_COLUMNS, ...rows.map((row) => TECHNICAL_BASELINE_COLUMNS.map((column) => row[column] ?? ""))];
    const sheet = XLSX.utils.aoa_to_sheet(data); sheet["!cols"] = TECHNICAL_BASELINE_COLUMNS.map((column) => ({ wch: Math.min(46, Math.max(12, column.length + 2)) }));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "Technical Baseline"); XLSX.writeFile(workbook, `Technical_Baseline_${text(rows[0]?.ReleaseName) || "Working"}.xlsx`);
    setNotice("Exported the exact 24-column workbook projection.");
  }

  return <main className="shell">
    <input ref={fileRef} className="visually-hidden" type="file" accept=".xlsx,.xls" onChange={(event) => event.target.files?.[0] && readWorkbook(event.target.files[0])}/>
    <aside className="rail"><div className="brand"><span className="brand-mark">V3</span><span>JSF Baseline</span></div><nav aria-label="Primary navigation"><p className="rail-label">Workspace</p>{nav.map((item,index)=><button key={item} className={index===0?"nav-item active":"nav-item"}><span>{["▦","⇩","◇","⌁","▤"][index]}</span>{item}{index>2&&<em>Soon</em>}</button>)}</nav><div className="rail-context"><span className="context-dot"/><div><strong>Working baseline</strong><small>{text(rows[0]?.ReleaseName)||"Unassigned"} · Reported</small></div></div><button className="profile"><span>AC</span><div><strong>Baseline steward</strong><small>Government team</small></div><b>···</b></button></aside>
    <section className="workspace"><header className="topbar"><div><span className="eyebrow">TECHNICAL BASELINE</span><h1>Baseline Manager</h1></div><div className="top-actions"><button className="ghost-button">Activity</button><button className="primary-button" onClick={()=>fileRef.current?.click()}>Import workbook</button></div></header>
      <section className="summary"><div className="summary-lead"><p>Release {text(rows[0]?.ReleaseName)||"Unassigned"}</p><h2>Reported technical baseline</h2><span>Working draft · Exact contract preserved</span></div><div className="metric"><span>Source records</span><strong>{rows.length}</strong><small>Exact 24-column projection</small></div><div className="metric"><span>Canonical products</span><strong>{productCount}</strong><small>Across {Math.max(0,tiers.length-1)} tiers</small></div><div className="metric metric-alert"><span>Needs attention</span><strong>{issueCount}</strong><small>{rows.filter(r=>issueFor(r)==="issue").length} blocking · {rows.filter(r=>issueFor(r)==="review").length} review</small></div></section>
      <div className="content-grid"><aside className="tree-panel"><div className="panel-heading"><div><span className="eyebrow">STRUCTURE</span><h3>Configuration</h3></div><button>•••</button></div><div className="tree-list">{tiers.map((tier)=><button key={tier} className={activeTier===tier?"tree-row selected":"tree-row"} onClick={()=>setActiveTier(tier)}><span>{tier==="All records"?"▦":"⌄"}</span><b>{tier}</b><em>{tier==="All records"?rows.length:rows.filter(r=>text(r.Tier)===tier).length}</em></button>)}</div><div className="quality-card"><span className="quality-score">{rows.length?Math.round((rows.length-issueCount)/rows.length*100):100}%</span><div><strong>Contract health</strong><small>{rows.length-issueCount} of {rows.length} ready to publish</small></div></div></aside>
        <section className="records-panel"><div className="records-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search products, hosts, or OEM…"/></label><button className="tool-button">≡ Filter <span>{activeTier==="All records"?0:1}</span></button><button className="tool-button" onClick={()=>setShowAll(true)}>24 columns</button><div className="spacer"/><button className="tool-button" onClick={bulkReview}>Bulk review {checked.size?`(${checked.size})`:""}</button><button className="tool-button" onClick={exportWorkbook}>Export .xlsx</button><button className="add-button" onClick={addRow}>＋ Add row</button></div>
          <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select all visible rows" checked={filtered.length>0&&filtered.every(r=>checked.has(text(r["#"])))} onChange={()=>setChecked(filtered.every(r=>checked.has(text(r["#"])))?new Set():new Set(filtered.map(r=>text(r["#"]))))}/></th><th>#</th><th>Product</th><th>Placement</th><th>Host</th><th>Type</th><th>OEM</th><th>Runtime</th><th>Status</th><th></th></tr></thead><tbody>{filtered.map(row=>{const key=text(row["#"]);return <tr key={key} className={selectedKey===key?"row-selected":""} onClick={()=>setSelectedKey(key)}><td><input type="checkbox" checked={checked.has(key)} onClick={e=>e.stopPropagation()} onChange={()=>toggleChecked(key)} aria-label={`Select ${text(row.LongName)||key}`}/></td><td className="mono">{key}</td><td><strong>{text(row.ShortName)||"Unnamed"}</strong><small>{text(row.LongName)||"Canonical name missing"}</small></td><td><strong>{text(row.Tier)||"Unassigned"}</strong><small>{text(row.Resource)||"Resource missing"}</small></td><td className="mono">{text(row.HW_Host)||"—"}</td><td>{text(row.TechStackType)||"—"}</td><td>{text(row.OEM)||"—"}</td><td>{text(row.Containerized)==="Yes"?`${text(row.Containerized)} · ${text(row["Container Technology"])}`:text(row.Containerized)||"—"}</td><td><Mark status={issueFor(row)}/></td><td>›</td></tr>})}</tbody></table>{!filtered.length&&<div className="empty">No source records match this view.</div>}</div><footer className="table-footer"><span>Showing {filtered.length} of {rows.length} source records</span><div><button disabled>‹</button><b>1</b><button>›</button></div></footer></section>
        <aside className="detail-panel"><div className="detail-head"><div><span className="eyebrow">SOURCE RECORD #{text(selected["#"])||"NEW"}</span><h3>{text(selected.ShortName)||"New product"}</h3><p>{text(selected.LongName)||"Complete the retained source columns."}</p></div><button>×</button></div><div className="detail-tabs"><button className="tab-active">Record</button><button>Lineage</button><button>History</button></div><div className="detail-body"><div className="detail-status"><Mark status={issueFor(selected)}/><span>Source occurrence → canonical records</span></div>
          <section><h4>Workbook identity</h4><label>LongName<input value={text(selected.LongName)} onChange={e=>edit("LongName",e.target.value)}/></label><div className="field-pair"><label>ShortName<input value={text(selected.ShortName)} onChange={e=>edit("ShortName",e.target.value)}/></label><label>ReleaseName<input value={text(selected.ReleaseName)} onChange={e=>edit("ReleaseName",e.target.value)}/></label></div></section><section><h4>Configuration placement</h4>{(["Tier","Resource","HW_Host"] as TechnicalBaselineColumn[]).map(column=><label key={column}>{column}<input className={column==="HW_Host"?"mono":""} value={text(selected[column])} onChange={e=>edit(column,e.target.value)}/></label>)}</section><section><h4>Reported node state</h4><div className="field-triple">{(["HW_CPU_CORES","HW_RAM (GB)","HW_Storage (GB)"] as TechnicalBaselineColumn[]).map(column=><label key={column}>{column.replace("HW_","")}<input value={text(selected[column])} onChange={e=>edit(column,e.target.value)}/></label>)}</div></section>
          {showAll&&<section className="all-fields"><h4>All retained source columns</h4>{TECHNICAL_BASELINE_COLUMNS.filter(c=>!["LongName","ShortName","ReleaseName","Tier","Resource","HW_Host","HW_CPU_CORES","HW_RAM (GB)","HW_Storage (GB)"].includes(c)).map(column=><label key={column}>{column}<input value={text(selected[column])} onChange={e=>edit(column,e.target.value)}/></label>)}</section>}
          <button className="show-all" onClick={()=>setShowAll(v=>!v)}>{showAll?"Collapse retained columns":"Show all 24 source columns"}<span>{showAll?"↑":"↓"}</span></button></div><footer className="detail-footer"><button className="ghost-button">Discard</button><button className="primary-button" onClick={saveSelected}>Save record</button></footer></aside>
      </div>
    </section>
    {(draft||importError)&&<div className="modal-backdrop" role="presentation"><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><span className="eyebrow">WORKBOOK INTAKE</span><h2 id="import-title">{importError?"Contract mismatch":"Ready to reconcile"}</h2>{importError?<><p className="error-copy">{importError}</p><div className="contract-strip">Expected: {TECHNICAL_BASELINE_COLUMNS.length} columns · exact names · exact order</div><footer><button className="primary-button" onClick={()=>setImportError("")}>Return to baseline</button></footer></>:draft&&<><p><strong>{draft.fileName}</strong> · {draft.sheetName}</p><div className="import-stats"><div><strong>{draft.rows.length}</strong><span>Source rows</span></div><div><strong>{draft.rows.filter(r=>issueFor(r)==="ready").length}</strong><span>Ready</span></div><div><strong>{draft.rows.filter(r=>issueFor(r)!=="ready").length}</strong><span>Review</span></div></div><p className="modal-note">Import preserves every cell, then materializes releases, configuration nodes, products, deployments, suppliers, and baseline states as one governed package.</p><footer><button className="ghost-button" onClick={()=>setDraft(null)}>Cancel</button><button className="primary-button" onClick={acceptImport}>Import and reconcile</button></footer></>}</section></div>}
    {notice&&<div className="toast" role="status">✓ {notice}</div>}
  </main>;
}
