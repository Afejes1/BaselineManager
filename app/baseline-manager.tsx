"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import Link from "../components/app-link";
import { usePathname } from "next/navigation";
import { TECHNICAL_BASELINE_COLUMNS, type TechnicalBaselineColumn } from "../lib/technical-baseline-contract";
import { releaseOf, tierOf } from "../lib/baseline-scope";
import { dataQualityForOccurrence, type DataQuality } from "../lib/baseline-quality";
import { APP_NAV_ITEMS } from "../lib/site-nav";
import { configNodeIdentity, productIdentityKey } from "../lib/baseline-data";
import { projectionOf, useBaselineWorkspace, type ManagedRecord24 } from "../lib/baseline-client";

type Cell = string | number | boolean | null | undefined;
type Record24 = Record<TechnicalBaselineColumn, Cell>;
type ImportDraft = { fileName: string; sheetName: string; rows: Record24[] };
type ReviewStatus = "not_reviewed" | "reviewed" | "follow_up";
type ManualReview = { status: ReviewStatus; reviewedAt: string | null; note?: string | null };
type DemoValues = Partial<Record<TechnicalBaselineColumn, Cell>>;

type DetailTab = "record" | "quality" | "review" | "occurrences" | "normalized";
type IndexedRow = { row: ManagedRecord24; index: number };

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "record", label: "Record" },
  { id: "quality", label: "Quality" },
  { id: "review", label: "Review" },
  { id: "occurrences", label: "Occurrences" },
  { id: "normalized", label: "Normalized" },
];

const blankRecord = (): Record24 => Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, ""])) as Record24;

/** A small, valid baseline that demonstrates repeated products across releases. */
function demoRecord(values: DemoValues): Record24 {
  return Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, values[column] ?? ""])) as Record24;
}

const DEMONSTRATION_ROWS: Record24[] = [
  demoRecord({
    "#": "DEMO-R5-001", ReleaseName: "Release 5", Tier: "Integration", Resource: "Mission systems", TechStackType: "Application service", ShortName: "MPS", HW_Host: "VM-MPS-05", HW_Storage_Type: "SSD", "HW_Storage (GB)": 180, HW_CPU_CORES: 8, "HW_RAM (GB)": 32, "SW Language": "Java", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Deployment", LongName: "Mission Planning Service", Notes: "Demonstration baseline record.", "Technical Capability Satisfied by this SW/Tech - Notes": "Mission planning",
  }),
  demoRecord({
    "#": "DEMO-R5-002", ReleaseName: "Release 5", Tier: "Integration", Resource: "Threat intelligence", TechStackType: "Data service", ShortName: "TLS", HW_Host: "VM-TLS-05", HW_Storage_Type: "SSD", "HW_Storage (GB)": 120, HW_CPU_CORES: 4, "HW_RAM (GB)": 16, "SW Language": "Python", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "StatefulSet", LongName: "Threat Library Service", Notes: "Demonstration baseline record.", "Technical Capability Satisfied by this SW/Tech - Notes": "Threat data management",
  }),
  demoRecord({
    "#": "DEMO-R5-003", ReleaseName: "Release 5", Tier: "Enterprise", Resource: "Data exchange", TechStackType: "Integration service", ShortName: "DG", HW_Host: "VM-DG-05", HW_Storage_Type: "SAN", "HW_Storage (GB)": 500, HW_CPU_CORES: 8, "HW_RAM (GB)": 48, "SW Language": "C#", "Software Type": "COTS", OEM: "Boeing", Containerized: "No", LongName: "Data Gateway", Notes: "Demonstration baseline record.", "Technical Capability Satisfied by this SW/Tech - Notes": "Data interchange",
  }),
  demoRecord({
    "#": "DEMO-R6-001", ReleaseName: "Release 6", Tier: "Integration", Resource: "Mission systems", TechStackType: "Application service", ShortName: "MPS", HW_Host: "VM-MPS-06", HW_Storage_Type: "SSD", "HW_Storage (GB)": 240, HW_CPU_CORES: 12, "HW_RAM (GB)": 48, "SW Language": "Java", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Deployment", LongName: "Mission Planning Service", Notes: "Demonstration baseline record.", "Technical Capability Satisfied by this SW/Tech - Notes": "Mission planning",
  }),
  demoRecord({
    "#": "DEMO-R6-002", ReleaseName: "Release 6", Tier: "Integration", Resource: "Threat intelligence", TechStackType: "Data service", ShortName: "TLS", HW_Host: "VM-TLS-06", HW_Storage_Type: "SSD", "HW_Storage (GB)": 160, HW_CPU_CORES: 8, "HW_RAM (GB)": 24, "SW Language": "Python", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "StatefulSet", LongName: "Threat Library Service", Notes: "Demonstration baseline record.", "Technical Capability Satisfied by this SW/Tech - Notes": "Threat data management",
  }),
  demoRecord({
    "#": "DEMO-R6-003", ReleaseName: "Release 6", Tier: "Enterprise", Resource: "Data exchange", TechStackType: "Integration service", ShortName: "DG", HW_Host: "VM-DG-06", HW_Storage_Type: "SAN", "HW_Storage (GB)": 750, HW_CPU_CORES: 12, "HW_RAM (GB)": 64, "SW Language": "C#", "Software Type": "COTS", OEM: "Boeing", Containerized: "No", LongName: "Data Gateway", Notes: "Demonstration baseline record.", "Technical Capability Satisfied by this SW/Tech - Notes": "Data interchange",
  }),
];

const text = (value: Cell) => value == null ? "" : String(value);
const manualReviewLabel = (status: ReviewStatus) => status === "reviewed" ? "Reviewed" : status === "follow_up" ? "Follow-up" : "Not reviewed";
const reviewDate = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "No review date";
const qualityIssueOrder: Array<DataQuality["issues"][number]["severity"]> = ["blocking", "review"];

function isActivePath(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href === "/") return pathname === "/";
  return pathname.startsWith(`${href}/`);
}

const occurrenceDiffColumns = [
  "ReleaseName",
  "Tier",
  "Resource",
  "HW_Host",
  "HW_Storage_Type",
  "HW_Storage (GB)",
  "HW_CPU_CORES",
  "HW_RAM (GB)",
  "Containerized",
  "Container Technology",
  "Container Type",
  "SW Language",
  "Software Type",
  "OEM",
  "TechStackType",
] as TechnicalBaselineColumn[];

function Mark({ quality }: { quality: DataQuality }) {
  return <span className={`mark mark-${quality.level}`}>{quality.label}</span>;
}

function qualityForRecord(row: Record24 | ManagedRecord24) {
  return dataQualityForOccurrence(row, "__meta" in row ? row.__meta.materializationStatus : undefined);
}

function fieldPairs<T extends Array<TechnicalBaselineColumn | string>>(cols: T, row: Record24) {
  return cols.map((column) => <p key={column}><strong>{column}</strong>{text((row as Record<string, Cell>)[column]) || "—"}</p>);
}

export function BaselineManager() {
  const { rows, setRows, workspace, loading, error: workspaceError, reload } = useBaselineWorkspace();
  const [query, setQuery] = useState("");
  const [activeRelease, setActiveRelease] = useState("All releases");
  const [activeTier, setActiveTier] = useState("All records");
  const [activeQuality, setActiveQuality] = useState("All checks");
  const [activeReview, setActiveReview] = useState("All review statuses");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [importError, setImportError] = useState("");
  const [notice, setNotice] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showQualityHelp, setShowQualityHelp] = useState(false);
  const [showAddRow, setShowAddRow] = useState(false);
  const [reviews, setReviews] = useState<Record<string, ManualReview>>({});
  const [reviewSaving, setReviewSaving] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("v3-rail-collapsed") === "true");
  const [newRowRelease, setNewRowRelease] = useState("");
  const [newReleaseName, setNewReleaseName] = useState("");
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>("record");
  const [reviewDraftStatus, setReviewDraftStatus] = useState<ReviewStatus>("not_reviewed");
  const [reviewDraftNote, setReviewDraftNote] = useState("");
  const [showStewardMenu, setShowStewardMenu] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimers = useRef<Map<string, number>>(new Map());
  const saveChains = useRef<Map<string, Promise<void>>>(new Map());
  const saveRevisions = useRef<Map<string, number>>(new Map());
  const [savingOccurrences, setSavingOccurrences] = useState<Set<string>>(new Set());
  const pathname = usePathname();

  useEffect(() => {
    rows.forEach((row) => saveRevisions.current.set(row.__meta.occurrenceId, row.__meta.revision));
  }, [rows]);

  useEffect(() => {
    fetch("/api/baseline/reviews")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { reviews?: Record<string, ManualReview> }) => setReviews(payload.reviews ?? {}))
      .catch(() => undefined);
  }, []);

  const selected = selectedIndex === null ? blankRecord() : rows[selectedIndex] ?? blankRecord();
  const selectedMeta = selectedIndex === null ? null : rows[selectedIndex]?.__meta ?? null;
  const selectedQuality = qualityForRecord(selected);
  const selectedReview = !selectedMeta ? { status: "not_reviewed" as ReviewStatus, reviewedAt: null, note: null } : reviews[selectedMeta.sourceRowId] ?? { status: "not_reviewed" as ReviewStatus, reviewedAt: null, note: null };

  useEffect(() => {
    if (selectedIndex === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedIndex(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedIndex]);

  const filtered = useMemo(() => rows.map((row, index) => ({ row, index })).filter(({ row }) => {
    const releaseMatch = activeRelease === "All releases" || releaseOf(row) === activeRelease;
    const tierMatch = activeTier === "All records" || tierOf(row) === activeTier;
    const qualityMatch = activeQuality === "All checks" || qualityForRecord(row).label === activeQuality;
    const rowReview = reviews[row.__meta.sourceRowId]?.status ?? "not_reviewed";
    const reviewMatch = activeReview === "All review statuses" || manualReviewLabel(rowReview) === activeReview;
    return releaseMatch && tierMatch && qualityMatch && reviewMatch && TECHNICAL_BASELINE_COLUMNS.map((column) => text(row[column])).join(" ").toLowerCase().includes(query.toLowerCase());
  }), [rows, reviews, query, activeRelease, activeTier, activeQuality, activeReview]);

  const releases = useMemo(() => Array.from(new Set(rows.map(releaseOf))), [rows]);
  const releaseGroups = useMemo(() => releases.map((release) => {
    const releaseRows = rows.filter((row) => releaseOf(row) === release);
    return { release, rows: releaseRows, tiers: Array.from(new Set(releaseRows.map(tierOf))) };
  }), [releases, rows]);

  const scopeRows = useMemo(() => activeRelease === "All releases" ? rows : rows.filter((row) => releaseOf(row) === activeRelease), [rows, activeRelease]);
  const scopeTiers = useMemo(() => new Set(scopeRows.map(tierOf)), [scopeRows]);
  const availableTiers = useMemo(() => Array.from(scopeTiers), [scopeTiers]);
  const issueCount = useMemo(() => scopeRows.filter((row) => qualityForRecord(row).level !== "ready").length, [scopeRows]);
  const productCount = useMemo(() => new Set(scopeRows.map((row) => text(row.LongName) || text(row.ShortName)).filter(Boolean)).size, [scopeRows]);
  const issueBlocks = useMemo(() => scopeRows.filter(r => qualityForRecord(r).level === "issue").length, [scopeRows]);
  const warningCount = useMemo(() => scopeRows.filter(r => qualityForRecord(r).level === "review").length, [scopeRows]);
  const resolvedNewRowRelease = newRowRelease === "__new__" ? newReleaseName.trim() : newRowRelease;

  const selectedProductId = selectedMeta?.productId ?? null;
  const occurrenceRows = useMemo<IndexedRow[]>(() => {
    if (selectedIndex === null || !selectedProductId) return [];
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.__meta.productId === selectedProductId)
      .sort((left, right) => text(left.row.ReleaseName).localeCompare(text(right.row.ReleaseName)));
  }, [rows, selectedIndex, selectedProductId]);

  const normalizedProjection = useMemo(() => {
    if (selectedIndex === null) return null;
    const canonicalName = text(selected.LongName).trim() || text(selected.ShortName).trim() || "Unnamed product";
    const release = text(selected.ReleaseName).trim() || "Unassigned";
    return {
      productNode: {
        id: selectedProductId ?? "Not materialized as a product",
        canonicalName,
        alias: text(selected.ShortName).trim() || "—",
        classification: text(selected["Software Type"]).trim() || "—",
        category: text(selected.TechStackType).trim() || "—",
        supplier: text(selected.OEM).trim() || "—",
      },
      deploymentNode: {
        release,
        tier: text(selected.Tier).trim() || "Unassigned",
        resource: text(selected.Resource).trim() || "Unassigned",
        host: text(selected.HW_Host).trim() || "Unassigned",
        containerized: text(selected.Containerized).trim() || "Unassigned",
        containerTechnology: text(selected["Container Technology"]).trim() || "—",
        containerType: text(selected["Container Type"]).trim() || "—",
      },
      baselineStateNode: {
        storageType: text(selected["HW_Storage_Type"]).trim() || "Unassigned",
        storageGb: text(selected["HW_Storage (GB)"]).trim() || "0",
        cpuCores: text(selected.HW_CPU_CORES).trim() || "0",
        ramGb: text(selected["HW_RAM (GB)"]).trim() || "0",
      },
      runtimeNode: {
        language: text(selected["SW Language"]).trim() || "Unassigned",
        capability: text(selected["Technical Capability Satisfied by this SW/Tech - Notes"]).trim() || "—",
        notes: text(selected.Notes).trim() || "—",
      },
    };
  }, [selected, selectedIndex, selectedProductId]);

  const reviewDraftHasChanges = useMemo(() => {
    const note = reviewDraftNote.trim();
    const savedNote = selectedReview.note?.trim() ?? "";
    return reviewDraftStatus !== selectedReview.status || note !== savedNote;
  }, [reviewDraftStatus, reviewDraftNote, selectedReview.note, selectedReview.status]);

  function queueOccurrenceSave(row: ManagedRecord24) {
    const occurrenceId = row.__meta.occurrenceId;
    const previous = saveChains.current.get(occurrenceId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const expectedRevision = saveRevisions.current.get(occurrenceId) ?? row.__meta.revision;
        setSavingOccurrences((current) => new Set(current).add(occurrenceId));
        const response = await fetch("/api/baseline", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ occurrenceId, expectedRevision, row: projectionOf(row) }),
        });
        const payload = await response.json() as { error?: string; revision?: number; materializationStatus?: string; baseline?: ManagedRecord24["__meta"]["baseline"] };
        if (!response.ok || payload.revision === undefined) {
          await reload();
          throw new Error(payload.error || "The automatic save could not be completed.");
        }
        saveRevisions.current.set(occurrenceId, payload.revision);
        setRows((current) => current.map((item) => item.__meta.occurrenceId === occurrenceId ? {
          ...item,
          __meta: {
            ...item.__meta,
            revision: payload.revision ?? item.__meta.revision,
            materializationStatus: payload.materializationStatus ?? item.__meta.materializationStatus,
            baseline: payload.baseline ?? item.__meta.baseline,
          },
        } : item));
      })
      .catch((reason) => {
        setNotice(reason instanceof Error ? reason.message : "The automatic save could not be completed.");
        window.setTimeout(() => setNotice(""), 4200);
      })
      .finally(() => {
        setSavingOccurrences((current) => {
          const nextSaving = new Set(current);
          nextSaving.delete(occurrenceId);
          return nextSaving;
        });
      });
    saveChains.current.set(occurrenceId, next);
  }

  function edit(column: TechnicalBaselineColumn, value: string) {
    if (selectedIndex === null) return;
    const current = rows[selectedIndex];
    if (!current) return;
    const nextRow = { ...current, [column]: value } as ManagedRecord24;
    setRows((existing) => existing.map((row, index) => index === selectedIndex ? nextRow : row));
    const occurrenceId = current.__meta.occurrenceId;
    const existingTimer = saveTimers.current.get(occurrenceId);
    if (existingTimer) window.clearTimeout(existingTimer);
    saveTimers.current.set(occurrenceId, window.setTimeout(() => queueOccurrenceSave(nextRow), 650));
  }

  function selectRecord(index: number) {
    const record = rows[index];
    if (!record) return;
    if (selectedIndex === index) {
      setSelectedIndex(null);
      return;
    }
    const review = reviews[record.__meta.sourceRowId] ?? { status: "not_reviewed" as ReviewStatus, reviewedAt: null, note: null };
    setSelectedIndex(index);
    setActiveDetailTab("record");
    setReviewDraftStatus(review.status);
    setReviewDraftNote(review.note ?? "");
  }

  function toggleRail() {
    setRailCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("v3-rail-collapsed", String(next));
      return next;
    });
  }

  async function setManualReview(status: ReviewStatus, note?: string) {
    const sourceRowId = selectedMeta?.sourceRowId;
    if (!sourceRowId) {
      setNotice("Choose a saved source occurrence before recording a manual review.");
      return;
    }

    const key = sourceRowId;
    const previous = reviews[key];
    const cleanedNote = note?.trim() ?? "";
    const optimistic = { status, reviewedAt: status === "not_reviewed" ? null : new Date().toISOString(), note: cleanedNote || null };
    setReviews((current) => ({ ...current, [key]: optimistic }));
    setReviewSaving(true);

    try {
      const response = await fetch("/api/baseline/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceRowId, status, note: cleanedNote }),
      });
      if (!response.ok) throw new Error("Unable to save review.");
      const payload = await response.json() as { review: ManualReview };
      setReviews((current) => ({ ...current, [key]: payload.review }));
      setNotice(status === "not_reviewed" ? "Cleared the manual review for this source occurrence." : `Recorded ${manualReviewLabel(status).toLowerCase()} on this source occurrence.`);
    } catch {
      setReviews((current) => {
        const next = { ...current };
        if (previous) next[key] = previous;
        else delete next[key];
        return next;
      });
      setNotice("Manual review could not be saved. Try again.");
    } finally {
      setReviewSaving(false);
      window.setTimeout(() => setNotice(""), 2600);
    }
  }

  function openAddRow() {
    setNewRowRelease(activeRelease === "All releases" || activeRelease === "Unassigned" ? "" : activeRelease);
    setNewReleaseName("");
    setShowAddRow(true);
  }

  async function addRow() {
    const chosenRelease = newRowRelease === "__new__" ? newReleaseName.trim() : newRowRelease;
    if (!chosenRelease) {
      setNotice("Select an existing release or enter a new ReleaseName.");
      return;
    }
    const response = await fetch("/api/baseline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ row: { ...blankRecord(), ReleaseName: chosenRelease } }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      setNotice(payload.error || "The source occurrence could not be created.");
      return;
    }
    await reload();
    setActiveRelease(chosenRelease);
    setActiveTier("All records");
    setActiveQuality("All checks");
    setActiveReview("All review statuses");
    setShowAddRow(false);
    setNotice(`Created a new source occurrence in release ${chosenRelease}.`);
  }

  function toggleChecked(index: number) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function readWorkbook(file: File) {
    setImportError("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: true });
      const sheetName = workbook.SheetNames[0];
      const cells = XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
      const headers = (cells[0] ?? []).map(text);
      const mismatch = headers.length !== 24 || headers.some((header, index) => header !== TECHNICAL_BASELINE_COLUMNS[index]);
      if (mismatch) throw new Error("The first worksheet must contain the exact 24 headers in the retained order. No columns were imported.");
      const importLines = cells.slice(1).filter((line) => line.some((cell) => text(cell).trim()));
      const imported: Record24[] = importLines.map((line) => {
        const row = Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column, index) => [column, line[index] ?? ""]));
        return row as Record24;
      });
      setDraft({ fileName: file.name, sheetName, rows: imported });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The workbook could not be read.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function acceptImport() {
    if (!draft) return;
    const response = await fetch("/api/baseline/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      setImportError(payload.error || "The workbook could not be accepted into the authoritative baseline workspace.");
      return;
    }
    await reload();
    setSelectedIndex(null);
    setActiveRelease("All releases");
    setActiveTier("All records");
    setActiveQuality("All checks");
    setActiveReview("All review statuses");
    setDraft(null);
    setNotice(`Imported ${draft.rows.length} rows across ${new Set(draft.rows.map(releaseOf)).size} releases into the authoritative workspace.`);
  }

  async function loadDemonstrationWorkspace() {
    setDemoError("");
    setDemoLoading(true);
    try {
      const response = await fetch("/api/baseline/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "JSF_V3_Demonstration_Baseline.xlsx",
          sheetName: "Technical Baseline",
          rows: DEMONSTRATION_ROWS,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The demonstration dataset could not be loaded.");
      await reload();
      setSelectedIndex(null);
      setActiveRelease("All releases");
      setActiveTier("All records");
      setActiveQuality("All checks");
      setActiveReview("All review statuses");
      setShowStewardMenu(false);
      setNotice(`Loaded ${DEMONSTRATION_ROWS.length} demonstration source occurrences across Release 5 and Release 6.`);
    } catch (reason) {
      setDemoError(reason instanceof Error ? reason.message : "The demonstration dataset could not be loaded.");
    } finally {
      setDemoLoading(false);
    }
  }

  async function exportWorkbook() {
    const exportRows = activeRelease === "All releases" ? rows : scopeRows;
    if (!exportRows.length) {
      setNotice("There are no source occurrences in the requested export scope.");
      return;
    }
    const localBlockers = exportRows.filter((row) => qualityForRecord(row).level === "issue");
    if (localBlockers.length) {
      setActiveQuality("Blocking");
      setNotice(`Export is blocked by ${localBlockers.length} source occurrence${localBlockers.length === 1 ? "" : "s"}. The grid is filtered to show them.`);
      return;
    }
    const readiness = await fetch("/api/baseline/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ releaseScope: activeRelease, occurrenceIds: exportRows.map((row) => row.__meta.occurrenceId) }),
    });
    const publication = await readiness.json() as { error?: string; blockers?: Array<{ message: string }> };
    if (!readiness.ok) {
      setNotice(publication.error || "The export readiness check could not be completed.");
      return;
    }
    const data = [TECHNICAL_BASELINE_COLUMNS, ...exportRows.map((row) => TECHNICAL_BASELINE_COLUMNS.map((column) => row[column] ?? ""))];
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet["!cols"] = TECHNICAL_BASELINE_COLUMNS.map((column) => ({ wch: Math.min(46, Math.max(12, column.length + 2)) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Technical Baseline");
    XLSX.writeFile(workbook, `Technical_Baseline_${activeRelease === "All releases" ? "All_Releases" : activeRelease}.xlsx`);
    setNotice(`Exported ${exportRows.length} rows for ${activeRelease} from the validated working baseline.`);
  }

  return <main className="shell">
    <input
      ref={fileRef}
      className="visually-hidden"
      type="file"
      accept=".xlsx,.xls"
      onChange={(event) => event.target.files?.[0] && readWorkbook(event.target.files[0])}
    />

    <aside className={railCollapsed ? "rail rail-collapsed" : "rail"}>
      <div className="brand">
        <span className="brand-mark">V3</span><span className="brand-name">JSF Baseline</span>
        <button className="rail-toggle" type="button" onClick={toggleRail} aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"} title={railCollapsed ? "Expand navigation" : "Collapse navigation"}>{railCollapsed ? "›" : "‹"}</button>
      </div>
      <nav aria-label="Primary navigation">
        <p className="rail-label">Workspace</p>
        {APP_NAV_ITEMS.filter((item) => item.enabled).map((item) => (
          <Link
            href={item.href}
            key={item.href}
            className={`nav-item ${isActivePath(pathname, item.href) ? "active" : ""}`}
            title={railCollapsed ? item.label : undefined}
          >
            <span className="nav-icon">{item.icon}</span><span className="nav-label">{item.label}</span>{item.tag ? <em>{item.tag}</em> : null}
          </Link>
        ))}
      </nav>
      <div className="rail-context">
        <span className="context-dot"/>
        <div><strong>Release scope</strong><small>{activeRelease} · Working workspace</small></div>
      </div>
      <button
        className="profile"
        type="button"
        onClick={() => { setShowStewardMenu(true); setDemoError(""); }}
        aria-haspopup="dialog"
        aria-expanded={showStewardMenu}
        aria-controls="steward-menu"
      ><span>AC</span><div><strong>Baseline steward</strong><small>Government team</small></div><b>···</b></button>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div><span className="eyebrow">TECHNICAL BASELINE</span><h1>Baseline Manager</h1></div>
        <div className="top-actions">
          <label className="release-selector"><span>Release scope</span><select value={activeRelease} onChange={(event) => { setActiveRelease(event.target.value); setActiveTier("All records"); }}><option value="All releases">All releases</option>{releases.map((release) => <option key={release}>{release}</option>)}</select></label>
          <button className="primary-button" onClick={() => fileRef.current?.click()}>Import workbook</button>
        </div>
      </header>

      <section className="summary">
        <div className="summary-lead">
          <p>{activeRelease === "All releases" ? `${releases.length} RELEASES IN SCOPE` : `RELEASE ${activeRelease}`}</p>
          <h2>{activeRelease === "All releases" ? "Reported baselines across releases" : "Reported technical baseline"}</h2>
          <span>{workspace?.label || "Current Government working baseline"} · ReleaseName retained on every source occurrence</span>
        </div>
        <div className="metric"><span>Source records</span><strong>{scopeRows.length}</strong><small>{activeRelease} · exact projection</small></div>
        <div className="metric"><span>Canonical products</span><strong>{productCount}</strong><small>Across {scopeTiers.size} tiers in scope</small></div>
        <div className="metric metric-alert"><span>Automated attention</span><strong>{issueCount}</strong><small>{issueBlocks} blocking · {warningCount} warnings</small></div>
      </section>

      <div className="content-grid">
        <aside className="tree-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">STRUCTURE</span><h3>Release configuration</h3></div>
            <button>•••</button>
          </div>
          <div className="tree-list">
            <button className={activeRelease === "All releases" && activeTier === "All records" ? "tree-row selected" : "tree-row"} onClick={() => { setActiveRelease("All releases"); setActiveTier("All records"); }}>
              <span>▦</span><b>All releases</b><em>{rows.length}</em>
            </button>
            {releaseGroups.map((group) => (
              <div className="release-tree" key={group.release}>
                <button className={activeRelease === group.release && activeTier === "All records" ? "tree-row release-row selected" : "tree-row release-row"} onClick={() => { setActiveRelease(group.release); setActiveTier("All records"); }}>
                  <span>◆</span><b>{group.release}</b><em>{group.rows.length}</em>
                </button>
                {group.tiers.map((tier) => (
                  <button key={`${group.release}:${tier}`} className={activeRelease === group.release && activeTier === tier ? "tree-row tree-child selected" : "tree-row tree-child"} onClick={() => { setActiveRelease(group.release); setActiveTier(tier); }}>
                    <span>└</span><b>{tier}</b><em>{group.rows.filter((row) => tierOf(row) === tier).length}</em>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="quality-card">
            <span className="quality-score">{scopeRows.length ? Math.round((scopeRows.length - issueCount) / scopeRows.length * 100) : 100}%</span>
            <div><strong>Automated health</strong><small>{scopeRows.length - issueCount} of {scopeRows.length} pass checks</small></div>
          </div>
        </aside>

        <section className="records-panel">
          {selectedIndex === null ? (
            <>
              <div className="records-toolbar">
                <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products, hosts, or OEM…"/></label>
                <button className={showFilters ? "tool-button tool-active" : "tool-button"} onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}>≡ Filter <span>{(activeRelease === "All releases" ? 0 : 1) + (activeTier === "All records" ? 0 : 1) + (activeQuality === "All checks" ? 0 : 1) + (activeReview === "All review statuses" ? 0 : 1)}</span></button>
                <div className="spacer" />
                <button className="tool-button" onClick={exportWorkbook}>Export {activeRelease === "All releases" ? "all" : activeRelease} .xlsx</button>
                <button className="add-button" onClick={openAddRow}>＋ Add row</button>
              </div>

              {showFilters && <section className="filter-panel" aria-label="Source record filters">
                <div><span>ReleaseName</span><select value={activeRelease} onChange={(event) => { setActiveRelease(event.target.value); setActiveTier("All records"); }}><option>All releases</option>{releases.map((release) => <option key={release}>{release}</option>)}</select></div>
                <div><span>Tier</span><select value={activeTier} onChange={(event) => setActiveTier(event.target.value)}><option>All records</option>{availableTiers.map((tier) => <option key={tier}>{tier}</option>)}</select></div>
                <div><span>Automated checks</span><select value={activeQuality} onChange={(event) => setActiveQuality(event.target.value)}><option>All checks</option><option>Pass</option><option>Warning</option><option>Blocking</option></select></div>
                <div><span>Manual review</span><select value={activeReview} onChange={(event) => setActiveReview(event.target.value)}><option>All review statuses</option><option>Not reviewed</option><option>Reviewed</option><option>Follow-up</option></select></div>
                <button onClick={() => {
                  setActiveRelease("All releases");
                  setActiveTier("All records");
                  setActiveQuality("All checks");
                  setActiveReview("All review statuses");
                  setQuery("");
                }}>Clear filters</button>
              </section>}

              {workspaceError ? <div className="empty">{workspaceError} Use Import workbook to establish a new authoritative workspace.</div> : null}
              {loading ? <div className="empty">Loading the authoritative baseline workspace…</div> : null}

              {!workspaceError && !loading && <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th><input type="checkbox" aria-label="Select all visible rows" checked={filtered.length > 0 && filtered.every(({ index }) => checked.has(index))} onChange={() => setChecked(filtered.every(({ index }) => checked.has(index)) ? new Set() : new Set(filtered.map(({ index }) => index)))} /></th>
                      <th>#</th>
                      <th>Release</th>
                      <th>Product</th>
                      <th>Placement</th>
                      <th>Host</th>
                      <th>Type</th>
                      <th>OEM</th>
                      <th>Runtime</th>
                      <th><span className="quality-heading">Automated checks<button type="button" className="quality-info" aria-label="Explain automated health checks" onClick={() => setShowQualityHelp(true)}>?</button></span></th>
                      <th>Manual review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(({ row, index }) => {
                      const key = text(row["#"]);
                      const quality = qualityForRecord(row);
                      const rowReview = reviews[row.__meta.sourceRowId] ?? { status: "not_reviewed" as ReviewStatus, reviewedAt: null };
                      return <tr
                        key={row.__meta.occurrenceId}
                        className={selectedIndex === index ? "row-selected" : ""}
                        onClick={() => selectRecord(index)}
                      >
                        <td><input type="checkbox" checked={checked.has(index)} onClick={(event) => event.stopPropagation()} onChange={() => toggleChecked(index)} aria-label={`Select ${text(row.LongName) || key} in ${text(row.ReleaseName)}`} /></td>
                        <td className="mono"><Link href={`/occurrences/${encodeURIComponent(row.__meta.occurrenceId)}`} className="row-nav-link" onClick={(event) => event.stopPropagation()}>{key || "Open"}</Link></td>
                        <td>
                          <Link
                            href={`/releases/${encodeURIComponent(text(row.ReleaseName) || "Unassigned")}`}
                            className="row-nav-link"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span className="release-chip">{text(row.ReleaseName) || "Unassigned"}</span>
                          </Link>
                        </td>
                        <td>
                          <Link
                            href={`/products/${encodeURIComponent(productIdentityKey(row))}`}
                            className="row-nav-link"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <strong>{text(row.ShortName) || "Unnamed"}</strong><small>{text(row.LongName) || "Canonical name missing"}</small>
                          </Link>
                        </td>
                        <td>
                          <Link
                            href={`/configuration/${encodeURIComponent(configNodeIdentity(row))}`}
                            className="row-nav-link"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <strong>{text(row.Tier) || "Unassigned"}</strong><small>{text(row.Resource) || "Resource missing"}</small>
                          </Link>
                        </td>
                        <td className="mono">{text(row.HW_Host) || "—"}</td>
                        <td>{text(row.TechStackType) || "—"}</td>
                        <td>
                          <Link
                            href={`/organizations/${encodeURIComponent(text(row.OEM) || "Unassigned")}`}
                            className="row-nav-link"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {text(row.OEM) || "—"}
                          </Link>
                        </td>
                        <td>{text(row.Containerized) === "Yes" ? `${text(row.Containerized)} · ${text(row["Container Technology"])}` : text(row.Containerized) || "—"}</td>
                        <td><Mark quality={quality} /></td>
                        <td><span className={`review-mark review-${rowReview.status}`}>{manualReviewLabel(rowReview.status)}</span><small>{reviewDate(rowReview.reviewedAt)}</small></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
                {!filtered.length && <div className="empty">{rows.length ? "No source records match the selected scope and health filters." : "No source package is in the current workspace. Import the retained 24-column workbook to begin."}</div>}
              </div>}
              {!workspaceError && !loading && <footer className="table-footer"><span>Showing {filtered.length} records · {scopeRows.length} in {activeRelease}</span><div><b>All loaded</b></div></footer>}
            </>
          ) : (
            <>
              <div className="detail-head">
                <button className="ghost-button record-back-button" type="button" onClick={() => setSelectedIndex(null)}>← Back to grid</button>
                <div><span className="eyebrow">SOURCE RECORD #{text(selected["#"]) || "UNASSIGNED"}</span><h3>{text(selected.ShortName) || "New product"}</h3><p>{text(selected.LongName) || "Complete the retained source columns."}</p><span className="autosave-label">{selectedMeta && savingOccurrences.has(selectedMeta.occurrenceId) ? "Saving changes…" : "✓ Changes saved to the working baseline"}</span></div>
                <div className="detail-head-actions">{selectedMeta ? <Link className="ghost-button" href={`/occurrences/${encodeURIComponent(selectedMeta.occurrenceId)}`}>Open record page</Link> : null}<button type="button" aria-label="Close record details" title="Close" onClick={() => setSelectedIndex(null)}>×</button></div>
              </div>

              <div className="detail-tabs" role="tablist">
                {detailTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    className={`tab-button ${activeDetailTab === tab.id ? "tab-active" : ""}`}
                    onClick={() => setActiveDetailTab(tab.id)}
                    aria-selected={activeDetailTab === tab.id}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="detail-body">
                <div className="detail-status quality-summary">
                  <Mark quality={selectedQuality} />
                  <div><strong>Automated health checks</strong><span>Calculated from source values · not included in XLSX export</span></div>
                  <button type="button" className="quality-info" aria-label="Explain automated health checks" onClick={() => setShowQualityHelp(true)}>?</button>
                </div>

                {activeDetailTab === "record" && (
                  <>
                    <section>
                      <h4>Workbook identity</h4>
                      <label>LongName<input value={text(selected.LongName)} onChange={(event) => edit("LongName", event.target.value)} /></label>
                      <div className="field-pair">
                        <label>ShortName<input value={text(selected.ShortName)} onChange={(event) => edit("ShortName", event.target.value)} /></label>
                        <label>ReleaseName<select value={text(selected.ReleaseName)} onChange={(event) => edit("ReleaseName", event.target.value)}><option value="">Unassigned</option>{releases.filter((release) => release !== "Unassigned").map((release) => <option key={release}>{release}</option>)}</select></label>
                      </div>
                    </section>
                    <section>
                      <h4>Configuration placement</h4>
                      {(["Tier", "Resource", "HW_Host"] as TechnicalBaselineColumn[]).map((column) => <label key={column}>{column}<input className={column === "HW_Host" ? "mono" : ""} value={text(selected[column])} onChange={(event) => edit(column, event.target.value)} /></label>)}
                    </section>
                    <section>
                      <h4>Reported node state</h4>
                      <div className="field-pair">
                        <label>Storage type<input value={text(selected.HW_Storage_Type)} placeholder="e.g., SSD or SAN" onChange={(event) => edit("HW_Storage_Type", event.target.value)} /></label>
                        <label>Storage (GB)<input value={text(selected["HW_Storage (GB)"])} onChange={(event) => edit("HW_Storage (GB)", event.target.value)} /></label>
                      </div>
                      <div className="field-pair">
                        <label>CPU cores<input value={text(selected.HW_CPU_CORES)} onChange={(event) => edit("HW_CPU_CORES", event.target.value)} /></label>
                        <label>RAM (GB)<input value={text(selected["HW_RAM (GB)"])} onChange={(event) => edit("HW_RAM (GB)", event.target.value)} /></label>
                      </div>
                    </section>
                    <section>
                      <h4>All retained source columns</h4>
                      {TECHNICAL_BASELINE_COLUMNS.filter((column) => !["LongName","ShortName","ReleaseName","Tier","Resource","HW_Host","HW_Storage_Type","HW_CPU_CORES","HW_RAM (GB)","HW_Storage (GB)"].includes(column)).map((column) => <label key={column}>{column}<input value={text(selected[column])} onChange={(event) => edit(column, event.target.value)} /></label>)}
                    </section>
                  </>
                )}

                {activeDetailTab === "quality" && (
                  <section className="quality-checks">
                    <div className="section-heading">
                      <h4>Automated check results</h4>
                      <span>{selectedQuality.issues.length === 0 ? "No issues detected." : `${selectedQuality.issues.length} issue${selectedQuality.issues.length === 1 ? "" : "s"} flagged.`}</span>
                    </div>
                    {selectedQuality.issues.length === 0 ? <p className="quality-complete">✓ The current source values pass all configured checks.</p> : (
                      <ul>
                        {selectedQuality.issues
                          .slice()
                          .sort((a, b) => qualityIssueOrder.indexOf(a.severity) - qualityIssueOrder.indexOf(b.severity))
                          .map((issue, index) => <li key={`${issue.field}:${index}`} className={`quality-${issue.severity}`}><strong>{issue.field}</strong><span>{issue.message}</span></li>)}
                      </ul>
                    )}
                    <p className="quality-guidance">Edit the flagged source fields on the Record tab; this panel updates automatically as you type. A pass/fail status is advisory and not a replacement for steward review.</p>
                  </section>
                )}

                {activeDetailTab === "review" && (
                  <section className="manual-review">
                    <div className="section-heading"><h4>Manual review</h4><span>Application metadata</span></div>
                    <label>Review status
                      <select value={reviewDraftStatus} disabled={reviewSaving} onChange={(event) => setReviewDraftStatus(event.target.value as ReviewStatus)}>
                        <option value="not_reviewed">Not reviewed</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="follow_up">Needs follow-up</option>
                      </select>
                    </label>
                    <label>Review note
                      <textarea className="review-note" value={reviewDraftNote} onChange={(event) => setReviewDraftNote(event.target.value)} placeholder="Optional steward note: evidence, rationale, and action required." rows={6} />
                    </label>
                    <div className="review-actions">
                      <button className="primary-button" disabled={reviewSaving || !reviewDraftHasChanges} onClick={() => setManualReview(reviewDraftStatus, reviewDraftNote)}>
                        {reviewSaving ? "Saving…" : "Save review"}
                      </button>
                      <span>Last reviewed <strong>{reviewDate(selectedReview.reviewedAt)}</strong></span>
                    </div>
                    <p>Stored separately from the 24 source columns and retained across sessions.</p>
                  </section>
                )}

                {activeDetailTab === "occurrences" && (
                  <section className="occurrence-details">
                    <div className="section-heading">
                      <h4>Release occurrences for this canonical product</h4>
                      <span>{occurrenceRows.length} row{occurrenceRows.length === 1 ? "" : "s"} linked by the materialized product identity</span>
                    </div>
                    {!occurrenceRows.length ? (
                      <p className="manual-review-note">This row has no matching `#` in scope. Keep track manually or normalize it after import.</p>
                    ) : (
                      <div className="occurrence-list">
                        {occurrenceRows.map(({ row, index }) => {
                          const rowQuality = qualityForRecord(row);
                          const isCurrent = index === selectedIndex;
                          const deltas = occurrenceDiffColumns
                            .filter((column) => text(row[column]) !== text(selected[column]))
                            .map((column) => `${column}: ${text(selected[column]) || "—"} → ${text(row[column]) || "—"}`);
                          const rowReview = reviews[row.__meta.sourceRowId] ?? { status: "not_reviewed" as ReviewStatus, reviewedAt: null };
                          return <button type="button" key={`${text(row.ReleaseName)}:${index}`} className={`occurrence-row ${isCurrent ? "occurrence-row-current" : ""}`} onClick={() => selectRecord(index)}>
                            <div className="occurrence-row-head">
                              <strong>{text(row.ReleaseName) || "Unassigned"}<small>Release baseline</small></strong>
                              <span className={`review-mark review-${rowReview.status}`}>{manualReviewLabel(rowReview.status)}</span>
                              <span className={`mark mark-${rowQuality.level}`}>{rowQuality.label}</span>
                            </div>
                            <div className="occurrence-meta">{fieldPairs(["ShortName","LongName","Tier","Resource","HW_Host","Containerized","Container Technology"], row)}</div>
                            <p><strong>From selected baseline</strong> {deltas.length === 0 ? "No changed fields." : deltas.join(" · ")}</p>
                            {isCurrent && <small className="occurrence-current-chip">Current row in focus</small>}
                          </button>;
                        })}
                      </div>
                    )}
                  </section>
                )}

                {activeDetailTab === "normalized" && normalizedProjection && (
                  <section className="normalized-view">
                    <div className="section-heading"><h4>Normalized projection</h4><span>Derived from source row for canonical modeling</span></div>
                    <div className="normalized-grid">
                      <div className="normal-card">
                        <h5>Product node</h5>
                        <p><strong>Product ID</strong>{normalizedProjection.productNode.id}</p>
                        <p><strong>Canonical name</strong>{normalizedProjection.productNode.canonicalName}</p>
                        <p><strong>Alias</strong>{normalizedProjection.productNode.alias}</p>
                        <p><strong>Classification</strong>{normalizedProjection.productNode.classification}</p>
                        <p><strong>Category</strong>{normalizedProjection.productNode.category}</p>
                        <p><strong>Supplier</strong>{normalizedProjection.productNode.supplier}</p>
                      </div>
                      <div className="normal-card">
                        <h5>Deployment position</h5>
                        <p><strong>Release</strong>{normalizedProjection.deploymentNode.release}</p>
                        <p><strong>Tier</strong>{normalizedProjection.deploymentNode.tier}</p>
                        <p><strong>Resource</strong>{normalizedProjection.deploymentNode.resource}</p>
                        <p><strong>Host</strong>{normalizedProjection.deploymentNode.host}</p>
                        <p><strong>Containerized</strong>{normalizedProjection.deploymentNode.containerized}</p>
                        <p><strong>Container technology</strong>{normalizedProjection.deploymentNode.containerTechnology}</p>
                        <p><strong>Container type</strong>{normalizedProjection.deploymentNode.containerType}</p>
                      </div>
                      <div className="normal-card">
                        <h5>Baseline state</h5>
                        <p><strong>Storage type</strong>{normalizedProjection.baselineStateNode.storageType}</p>
                        <p><strong>Storage (GB)</strong>{normalizedProjection.baselineStateNode.storageGb}</p>
                        <p><strong>CPU cores</strong>{normalizedProjection.baselineStateNode.cpuCores}</p>
                        <p><strong>RAM (GB)</strong>{normalizedProjection.baselineStateNode.ramGb}</p>
                      </div>
                      <div className="normal-card">
                        <h5>Capability</h5>
                        <p><strong>Language</strong>{normalizedProjection.runtimeNode.language}</p>
                        <p><strong>Capability note</strong>{normalizedProjection.runtimeNode.capability}</p>
                        <p><strong>Source note</strong>{normalizedProjection.runtimeNode.notes}</p>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </section>

    {showAddRow && <div className="modal-backdrop" role="presentation">
      <section className="import-modal add-row-modal" role="dialog" aria-modal="true" aria-labelledby="add-row-title">
        <span className="eyebrow">NEW SOURCE OCCURRENCE</span>
        <h2 id="add-row-title">Choose the release first</h2>
        <p>A source row cannot be created from <strong>All releases</strong> without an explicit ReleaseName. This prevents the application from silently assigning the row to the wrong reported baseline.</p>
        <div className="new-row-summary"><span>Source key</span><strong>Leave blank until the reported source key is known</strong></div>
        <label className="modal-field">ReleaseName<select value={newRowRelease} onChange={(event) => setNewRowRelease(event.target.value)}><option value="">Select a release…</option>{releases.filter((release) => release !== "Unassigned").map((release) => <option key={release}>{release}</option>)}<option value="__new__">＋ Create a new release…</option></select></label>
        {newRowRelease === "__new__" && <label className="modal-field">New ReleaseName<input value={newReleaseName} onChange={(event) => setNewReleaseName(event.target.value)} placeholder="Enter the exact source value" /></label>}
        <div className={resolvedNewRowRelease ? "assignment-preview ready" : "assignment-preview"}><span>{resolvedNewRowRelease ? "Row will be assigned to" : "Waiting for release selection"}</span><strong>{resolvedNewRowRelease || "No release selected"}</strong></div>
        <footer><button className="ghost-button" onClick={() => setShowAddRow(false)}>Cancel</button><button className="primary-button" disabled={!resolvedNewRowRelease} onClick={addRow}>Create source row</button></footer>
      </section>
    </div>}

    {showQualityHelp && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowQualityHelp(false); }}>
      <section className="import-modal quality-help-modal" role="dialog" aria-modal="true" aria-labelledby="quality-help-title">
        <span className="eyebrow">AUTOMATED HEALTH CHECKS</span>
        <h2 id="quality-help-title">Why does the system check each row?</h2>
        <p>Automated checks catch missing or inconsistent source values before the row is normalized into canonical records. They are <strong>not one of the 24 spreadsheet columns</strong> and are not included in XLSX export.</p>
        <div className="quality-key">
          <div><Mark quality={{ level: "ready", label: "Pass", issues: [] }} /><span>No configured source-value checks failed.</span></div>
          <div><Mark quality={{ level: "review", label: "Warning", issues: [] }} /><span>The row is usable, but a value is incomplete or inconsistent.</span></div>
          <div><Mark quality={{ level: "issue", label: "Blocking", issues: [] }} /><span>The row cannot be reliably materialized until a required identity is corrected.</span></div>
        </div>
        <p className="modal-note">Automated health and manual review are separate. A row can pass its checks and still be waiting for a steward to review it.</p>
        <footer><button className="primary-button" onClick={() => setShowQualityHelp(false)}>Got it</button></footer>
      </section>
    </div>}

    {(draft || importError) && <div className="modal-backdrop" role="presentation">
      <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <span className="eyebrow">WORKBOOK INTAKE</span>
        <h2 id="import-title">{importError ? "Contract mismatch" : "Ready to reconcile"}</h2>
        {importError ? <>
          <p className="error-copy">{importError}</p>
          <div className="contract-strip">Expected: {TECHNICAL_BASELINE_COLUMNS.length} columns · exact names · exact order</div>
          <footer><button className="primary-button" onClick={() => setImportError("")}>Return to baseline</button></footer>
        </> : draft && <>
          <p><strong>{draft.fileName}</strong> · {draft.sheetName}</p>
          <div className="import-stats four">
            <div><strong>{draft.rows.length}</strong><span>Source rows</span></div>
            <div><strong>{new Set(draft.rows.map(releaseOf)).size}</strong><span>Releases</span></div>
            <div><strong>{draft.rows.filter((row) => qualityForRecord(row).level === "ready").length}</strong><span>Checks pass</span></div>
            <div><strong>{draft.rows.filter((row) => qualityForRecord(row).level !== "ready").length}</strong><span>Needs attention</span></div>
          </div>
          <div className="release-list"><span>ReleaseName values</span>{Array.from(new Set(draft.rows.map(releaseOf))).map((release) => <b key={release}>{release} · {draft.rows.filter((row) => releaseOf(row) === release).length} rows</b>)}</div>
          <p className="modal-note">Each source occurrence retains ReleaseName. Import reuses the canonical product while linking its reported configuration and deployment state to the correct release baseline.</p>
          <footer><button className="ghost-button" onClick={() => setDraft(null)}>Cancel</button><button className="primary-button" onClick={acceptImport}>Import and reconcile</button></footer>
        </>}
      </section>
    </div>}

    {showStewardMenu && <div className="modal-backdrop steward-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !demoLoading) setShowStewardMenu(false);
    }}>
      <section className="import-modal steward-menu" id="steward-menu" role="dialog" aria-modal="true" aria-labelledby="steward-title">
        <button className="modal-close" type="button" aria-label="Close Baseline steward menu" disabled={demoLoading} onClick={() => setShowStewardMenu(false)}>×</button>
        <span className="eyebrow">BASELINE STEWARD</span>
        <h2 id="steward-title">Demo workspace</h2>
        <p>Load a compact, valid 24-column dataset to explore the baseline, release, product, configuration, and capability views.</p>
        <div className="import-stats three">
          <div><strong>{DEMONSTRATION_ROWS.length}</strong><span>Source records</span></div>
          <div><strong>2</strong><span>Releases</span></div>
          <div><strong>3</strong><span>Products reused</span></div>
        </div>
        <p className="modal-note">This replaces the current <strong>working workspace</strong> with demonstration occurrences. Prior source packages remain retained; import your retained workbook at any time to re-establish the active workspace.</p>
        {demoError ? <p className="error-copy" role="alert">{demoError}</p> : null}
        <footer><button className="ghost-button" type="button" disabled={demoLoading} onClick={() => setShowStewardMenu(false)}>Cancel</button><button className="primary-button" type="button" disabled={demoLoading} onClick={loadDemonstrationWorkspace}>{demoLoading ? "Loading demonstration data…" : "Load demonstration dataset"}</button></footer>
      </section>
    </div>}

    {notice && <div className="toast" role="status">✓ {notice}</div>}
  </main>;
}
