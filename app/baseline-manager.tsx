"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import Link from "../components/app-link";
import { usePathname, useSearchParams } from "next/navigation";
import { TECHNICAL_BASELINE_COLUMNS, type TechnicalBaselineColumn } from "../lib/technical-baseline-contract";
import { releaseOf, tierOf } from "../lib/baseline-scope";
import { dataQualityForOccurrence, type DataQuality } from "../lib/baseline-quality";
import { APP_NAV_ITEMS } from "../lib/site-nav";
import { configNodeIdentity, productIdentityKey } from "../lib/baseline-data";
import { projectionOf, useBaselineWorkspace, type ManagedRecord24 } from "../lib/baseline-client";
import { reconcileIntake } from "../lib/import-reconciliation";
import { saveChangeAction, useChangePortfolio } from "../lib/change-client";
import { WorkspaceContextControl, useWorkspaceContext } from "../components/workspace-context";
import { useMasterData } from "../lib/master-data-client";

type Cell = string | number | boolean | null | undefined;
type Record24 = Record<TechnicalBaselineColumn, Cell>;
type ImportDraft = { fileName: string; sheetName: string; rows: Record24[] };
type ReviewStatus = "not_reviewed" | "reviewed" | "follow_up";
type ManualReview = { status: ReviewStatus; reviewedAt: string | null; note?: string | null };
type DemoValues = Partial<Record<TechnicalBaselineColumn, Cell>>;

type DetailTab = "record" | "quality" | "review" | "occurrences" | "normalized";
type IndexedRow = { row: ManagedRecord24; index: number };

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "record", label: "Baseline" },
  { id: "quality", label: "Quality" },
  { id: "review", label: "Review & sources" },
  { id: "occurrences", label: "Release comparison" },
  { id: "normalized", label: "Relationships" },
];

const blankRecord = (): Record24 => Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, ""])) as Record24;

/**
 * A deliberately synthetic, but realistic, working baseline. The repeated
 * product identities make the Release workspace useful immediately: it shows
 * additions, removals, moves, configuration changes, an intentional quality
 * warning, and a valid host-only baseline record.
 */
function demoRecord(values: DemoValues): Record24 {
  return Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, values[column] ?? ""])) as Record24;
}

const DEMONSTRATION_ROWS: Record24[] = [
  // Release 5 — reported baseline
  demoRecord({ "#": "DEMO-R5-001", ReleaseName: "Release 5", Tier: "Integration", Resource: "Mission systems", TechStackType: "Application service", ShortName: "MPS", HW_Host: "VM-MPS-05", HW_Storage_Type: "SSD", "HW_Storage (GB)": 180, HW_CPU_CORES: 8, "HW_RAM (GB)": 32, "SW Language": "Java", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Deployment", LongName: "Mission Planning Service", Notes: "Demonstration data — not program data.", "Technical Capability Satisfied by this SW/Tech - Notes": "Mission planning", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R5-002", ReleaseName: "Release 5", Tier: "Integration", Resource: "Threat intelligence", TechStackType: "Data service", ShortName: "TLS", HW_Host: "VM-TLS-05", HW_Storage_Type: "SSD", "HW_Storage (GB)": 120, HW_CPU_CORES: 4, "HW_RAM (GB)": 16, "SW Language": "Python", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "StatefulSet", LongName: "Threat Library Service", Notes: "Demonstration data — not program data.", "Technical Capability Satisfied by this SW/Tech - Notes": "Threat data management", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R5-003", ReleaseName: "Release 5", Tier: "Enterprise", Resource: "Data exchange", TechStackType: "Integration service", ShortName: "DG", HW_Host: "VM-DG-05", HW_Storage_Type: "SAN", "HW_Storage (GB)": 500, HW_CPU_CORES: 8, "HW_RAM (GB)": 48, "SW Language": "C#", "Software Type": "COTS", OEM: "Boeing", Containerized: "No", LongName: "Data Gateway", Notes: "Demonstration data — not program data.", "Technical Capability Satisfied by this SW/Tech - Notes": "Data interchange", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R5-004", ReleaseName: "Release 5", Tier: "Enterprise", Resource: "Shared data", TechStackType: "Data service", ShortName: "SDS", HW_Host: "VM-SDS-05", HW_Storage_Type: "SAN", "HW_Storage (GB)": 900, HW_CPU_CORES: 8, "HW_RAM (GB)": 64, "SW Language": "SQL", "Software Type": "COTS", OEM: "Oracle", Containerized: "No", LongName: "Secure Data Store", Notes: "Demonstration data — not program data.", "Technical Capability Satisfied by this SW/Tech - Notes": "Protected data persistence", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R5-005", ReleaseName: "Release 5", Tier: "Operations", Resource: "User services", TechStackType: "Application service", ShortName: "OC", HW_Host: "VM-OC-05", HW_Storage_Type: "SSD", "HW_Storage (GB)": 100, HW_CPU_CORES: 4, "HW_RAM (GB)": 16, "SW Language": "TypeScript", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Deployment", LongName: "Operations Console", Notes: "Demonstration data — not program data.", "Technical Capability Satisfied by this SW/Tech - Notes": "Operational awareness", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R5-006", ReleaseName: "Release 5", Tier: "Integration", Resource: "Mission systems", TechStackType: "Adapter", ShortName: "LMPA", HW_Host: "VM-LMPA-05", HW_Storage_Type: "SSD", "HW_Storage (GB)": 80, HW_CPU_CORES: 2, "HW_RAM (GB)": 8, "SW Language": "Java", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "No", LongName: "Legacy Mission Planning Adapter", Notes: "Demonstration data — not program data.", "Technical Capability Satisfied by this SW/Tech - Notes": "Mission planning", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R5-007", ReleaseName: "Release 5", Tier: "Platform", Resource: "Edge networking", TechStackType: "Hardware gateway", HW_Host: "NET-GW-05", HW_Storage_Type: "Flash", "HW_Storage (GB)": 64, HW_CPU_CORES: 4, "HW_RAM (GB)": 8, Notes: "Demonstration host record; no product is reported.", "Notes.1": "Demonstration data" }),
  // Release 6 — a proposed move, capacity changes, and one new service
  demoRecord({ "#": "DEMO-R6-001", ReleaseName: "Release 6", Tier: "Integration", Resource: "Mission systems", TechStackType: "Application service", ShortName: "MPS", HW_Host: "VM-MPS-06", HW_Storage_Type: "SSD", "HW_Storage (GB)": 240, HW_CPU_CORES: 12, "HW_RAM (GB)": 48, "SW Language": "Java", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Deployment", LongName: "Mission Planning Service", Notes: "Demonstration data — not program data; relocated to the Release 6 compute host.", "Technical Capability Satisfied by this SW/Tech - Notes": "Mission planning", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R6-002", ReleaseName: "Release 6", Tier: "Integration", Resource: "Threat intelligence", TechStackType: "Data service", ShortName: "TLS", HW_Host: "VM-TLS-05", HW_Storage_Type: "SSD", "HW_Storage (GB)": 160, HW_CPU_CORES: 8, "HW_RAM (GB)": 24, "SW Language": "Python", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "StatefulSet", LongName: "Threat Library Service", Notes: "Demonstration data — not program data; expanded capacity.", "Technical Capability Satisfied by this SW/Tech - Notes": "Threat data management", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R6-003", ReleaseName: "Release 6", Tier: "Enterprise", Resource: "Data exchange", TechStackType: "Integration service", ShortName: "DG", HW_Host: "VM-DG-05", HW_Storage_Type: "SAN", "HW_Storage (GB)": 750, HW_CPU_CORES: 12, "HW_RAM (GB)": 64, "SW Language": "C#", "Software Type": "COTS", OEM: "Boeing", Containerized: "No", LongName: "Data Gateway", Notes: "Demonstration data — not program data; expanded capacity.", "Technical Capability Satisfied by this SW/Tech - Notes": "Data interchange", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R6-004", ReleaseName: "Release 6", Tier: "Enterprise", Resource: "Shared data", TechStackType: "Data service", ShortName: "SDS", HW_Host: "VM-SDS-05", HW_Storage_Type: "SAN", "HW_Storage (GB)": 1200, HW_CPU_CORES: 12, "HW_RAM (GB)": 96, "SW Language": "SQL", "Software Type": "COTS", OEM: "Oracle", Containerized: "No", LongName: "Secure Data Store", Notes: "Demonstration data — not program data; capacity planning update.", "Technical Capability Satisfied by this SW/Tech - Notes": "Protected data persistence", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R6-005", ReleaseName: "Release 6", Tier: "Operations", Resource: "User services", TechStackType: "Application service", ShortName: "OC", HW_Host: "VM-OC-05", HW_Storage_Type: "SSD", "HW_Storage (GB)": 120, HW_CPU_CORES: 4, "HW_RAM (GB)": 16, "SW Language": "TypeScript", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Deployment", LongName: "Operations Console", Notes: "Demonstration data — not program data.", "Technical Capability Satisfied by this SW/Tech - Notes": "Operational awareness", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R6-006", ReleaseName: "Release 6", Tier: "Integration", Resource: "Data exchange", TechStackType: "Integration service", ShortName: "IOS", HW_Host: "VM-IOS-06", HW_Storage_Type: "SSD", "HW_Storage (GB)": 140, HW_CPU_CORES: 6, "HW_RAM (GB)": 24, "SW Language": "Go", "Software Type": "Custom", OEM: "Northrop Grumman", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Deployment", LongName: "Integration Orchestrator Service", Notes: "Demonstration data — not program data; new Release 6 service.", "Technical Capability Satisfied by this SW/Tech - Notes": "Data interchange", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R6-007", ReleaseName: "Release 6", Tier: "Platform", Resource: "Edge networking", TechStackType: "Hardware gateway", HW_Host: "NET-GW-05", HW_Storage_Type: "Flash", "HW_Storage (GB)": 64, HW_CPU_CORES: 4, "HW_RAM (GB)": 8, Notes: "Demonstration host record; no product is reported.", "Notes.1": "Demonstration data" }),
  // Release 7 — a second move, removals, additions, and one deliberate warning
  demoRecord({ "#": "DEMO-R7-001", ReleaseName: "Release 7", Tier: "Integration", Resource: "Mission systems", TechStackType: "Application service", ShortName: "MPS", HW_Host: "VM-MPS-06", HW_Storage_Type: "SSD", "HW_Storage (GB)": 300, HW_CPU_CORES: 12, "HW_RAM (GB)": 64, "SW Language": "Java", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Deployment", LongName: "Mission Planning Service", Notes: "Demonstration data — not program data; memory uplift.", "Technical Capability Satisfied by this SW/Tech - Notes": "Mission planning", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R7-002", ReleaseName: "Release 7", Tier: "Integration", Resource: "Threat intelligence", TechStackType: "Data service", ShortName: "TLS", HW_Host: "VM-TLS-07", HW_Storage_Type: "SSD", "HW_Storage (GB)": 220, HW_CPU_CORES: 8, "HW_RAM (GB)": 32, "SW Language": "Python", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "StatefulSet", LongName: "Threat Library Service", Notes: "Demonstration data — not program data; relocated to the Release 7 compute host.", "Technical Capability Satisfied by this SW/Tech - Notes": "Threat data management", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R7-003", ReleaseName: "Release 7", Tier: "Enterprise", Resource: "Shared data", TechStackType: "Data service", ShortName: "SDS", HW_Host: "VM-SDS-05", HW_Storage_Type: "SAN", "HW_Storage (GB)": 1600, HW_CPU_CORES: 16, "HW_RAM (GB)": 128, "SW Language": "SQL", "Software Type": "COTS", OEM: "Oracle", Containerized: "No", LongName: "Secure Data Store", Notes: "Demonstration data — not program data; capacity planning update.", "Technical Capability Satisfied by this SW/Tech - Notes": "Protected data persistence", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R7-004", ReleaseName: "Release 7", Tier: "Operations", Resource: "User services", TechStackType: "Application service", ShortName: "OC", HW_Host: "VM-OC-05", HW_Storage_Type: "SSD", "HW_Storage (GB)": 140, HW_CPU_CORES: 6, "HW_RAM (GB)": 24, "SW Language": "TypeScript", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Type": "Deployment", LongName: "Operations Console", Notes: "Demonstration data-quality warning: container technology is blank.", "Technical Capability Satisfied by this SW/Tech - Notes": "Operational awareness", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R7-005", ReleaseName: "Release 7", Tier: "Integration", Resource: "Data exchange", TechStackType: "Integration service", ShortName: "IOS", HW_Host: "VM-IOS-06", HW_Storage_Type: "SSD", "HW_Storage (GB)": 180, HW_CPU_CORES: 8, "HW_RAM (GB)": 32, "SW Language": "Go", "Software Type": "Custom", OEM: "Northrop Grumman", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Deployment", LongName: "Integration Orchestrator Service", Notes: "Demonstration data — not program data; scaled throughput.", "Technical Capability Satisfied by this SW/Tech - Notes": "Data interchange", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R7-006", ReleaseName: "Release 7", Tier: "Operations", Resource: "User services", TechStackType: "Analytics service", ShortName: "EIS", HW_Host: "VM-EIS-07", HW_Storage_Type: "SSD", "HW_Storage (GB)": 180, HW_CPU_CORES: 8, "HW_RAM (GB)": 32, "SW Language": "Python", "Software Type": "Custom", OEM: "Lockheed Martin", Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Deployment", LongName: "Execution Insights Service", Notes: "Demonstration data — not program data; new Release 7 service.", "Technical Capability Satisfied by this SW/Tech - Notes": "Operational awareness", "Notes.1": "Demonstration data" }),
  demoRecord({ "#": "DEMO-R7-007", ReleaseName: "Release 7", Tier: "Platform", Resource: "Edge networking", TechStackType: "Hardware gateway", HW_Host: "NET-GW-05", HW_Storage_Type: "Flash", "HW_Storage (GB)": 64, HW_CPU_CORES: 4, "HW_RAM (GB)": 8, Notes: "Demonstration host record; no product is reported.", "Notes.1": "Demonstration data" }),
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
  const { rows, setRows, loading, error: workspaceError, reload } = useBaselineWorkspace({ includeVoided: true });
  const { releaseLens, setReleaseLens, reload: reloadWorkspaceContext } = useWorkspaceContext();
  const { portfolio: changePortfolio, reload: reloadChanges } = useChangePortfolio();
  const master = useMasterData();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [activeTier, setActiveTier] = useState("All records");
  const [activeQuality, setActiveQuality] = useState("All checks");
  const [activeReview, setActiveReview] = useState("All review statuses");
  const [activeLifecycle, setActiveLifecycle] = useState("Active records");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [importError, setImportError] = useState("");
  const [notice, setNotice] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showGridSummary, setShowGridSummary] = useState(false);
  const [showQualityHelp, setShowQualityHelp] = useState(false);
  const [showAddRow, setShowAddRow] = useState(false);
  const [reviews, setReviews] = useState<Record<string, ManualReview>>({});
  const [reviewSaving, setReviewSaving] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("v3-rail-collapsed") === "true");
  const [newRowRelease, setNewRowRelease] = useState("");
  const [newReleaseName, setNewReleaseName] = useState("");
  const [newRowProductId, setNewRowProductId] = useState("");
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>("record");
  const [reviewDraftStatus, setReviewDraftStatus] = useState<ReviewStatus>("not_reviewed");
  const [reviewDraftNote, setReviewDraftNote] = useState("");
  const [showStewardMenu, setShowStewardMenu] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState("");
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [showLifecycleModal, setShowLifecycleModal] = useState(false);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const fieldProductLaunchRef = useRef("");
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [showChangeAssignment, setShowChangeAssignment] = useState(false);
  const [changeAssignment, setChangeAssignment] = useState({ changeRequestId: "", effectAction: "modify", aspect: "configuration", consequence: "" });
  const [changeAssignmentSaving, setChangeAssignmentSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimers = useRef<Map<string, number>>(new Map());
  const saveChains = useRef<Map<string, Promise<void>>>(new Map());
  const saveRevisions = useRef<Map<string, number>>(new Map());
  const [savingOccurrences, setSavingOccurrences] = useState<Set<string>>(new Set());
  const [pendingSaveOccurrences, setPendingSaveOccurrences] = useState<Set<string>>(new Set());
  const [failedSaveOccurrences, setFailedSaveOccurrences] = useState<Set<string>>(new Set());
  const saveSequences = useRef<Map<string, number>>(new Map());
  const pathname = usePathname();
  const activeRelease = releaseLens || "All releases";

  function selectReleaseScope(release: string) {
    setReleaseLens(release === "All releases" ? null : release);
    setActiveTier("All records");
  }

  useEffect(() => {
    rows.forEach((row) => saveRevisions.current.set(row.__meta.occurrenceId, row.__meta.revision));
  }, [rows]);

  useEffect(() => {
    fetch("/api/baseline/reviews")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { reviews?: Record<string, ManualReview> }) => setReviews(payload.reviews ?? {}))
      .catch(() => undefined);
  }, []);

  useEffect(() => { fetch("/api/demo", { cache: "no-store" }).then((response) => response.json()).then((payload: { enabled?: boolean }) => setDemoEnabled(payload.enabled !== false)).catch(() => undefined); }, []);

  const selected = selectedIndex === null ? blankRecord() : rows[selectedIndex] ?? blankRecord();
  const selectedMeta = selectedIndex === null ? null : rows[selectedIndex]?.__meta ?? null;
  const selectedQuality = qualityForRecord(selected);
  const selectedReview = !selectedMeta ? { status: "not_reviewed" as ReviewStatus, reviewedAt: null, note: null } : reviews[selectedMeta.occurrenceId] ?? { status: "not_reviewed" as ReviewStatus, reviewedAt: null, note: null };
  const reviewDraftHasChanges = reviewDraftStatus !== selectedReview.status || reviewDraftNote.trim() !== (selectedReview.note ?? "").trim();
  const selectedSavePending = selectedMeta ? pendingSaveOccurrences.has(selectedMeta.occurrenceId) : false;
  const selectedSaveFailed = selectedMeta ? failedSaveOccurrences.has(selectedMeta.occurrenceId) : false;

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
    const rowReview = reviews[row.__meta.occurrenceId]?.status ?? "not_reviewed";
    const reviewMatch = activeReview === "All review statuses" || manualReviewLabel(rowReview) === activeReview;
    const lifecycleMatch = activeLifecycle === "All lifecycle states" || (activeLifecycle === "Active records" ? row.__meta.lifecycleStatus === "active" : row.__meta.lifecycleStatus === "voided");
    return releaseMatch && tierMatch && qualityMatch && reviewMatch && lifecycleMatch && TECHNICAL_BASELINE_COLUMNS.map((column) => text(row[column])).join(" ").toLowerCase().includes(query.toLowerCase());
  }), [rows, reviews, query, activeRelease, activeTier, activeQuality, activeReview, activeLifecycle]);

  const activeRows = useMemo(() => rows.filter((row) => row.__meta.lifecycleStatus === "active"), [rows]);
  const navigationSections = ["Baseline", "Views", "Decisions"] as const;
  const releases = useMemo(() => Array.from(new Set(activeRows.map(releaseOf))), [activeRows]);
  const releaseGroups = useMemo(() => releases.map((release) => {
    const releaseRows = activeRows.filter((row) => releaseOf(row) === release);
    return { release, rows: releaseRows, tiers: Array.from(new Set(releaseRows.map(tierOf))) };
  }), [releases, activeRows]);

  const scopeRows = useMemo(() => activeRelease === "All releases" ? activeRows : activeRows.filter((row) => releaseOf(row) === activeRelease), [activeRows, activeRelease]);
  const scopeTiers = useMemo(() => new Set(scopeRows.map(tierOf)), [scopeRows]);
  const availableTiers = useMemo(() => Array.from(scopeTiers), [scopeTiers]);
  const issueCount = useMemo(() => scopeRows.filter((row) => qualityForRecord(row).level !== "ready").length, [scopeRows]);
  const productCount = useMemo(() => new Set(scopeRows.map((row) => text(row.LongName) || text(row.ShortName)).filter(Boolean)).size, [scopeRows]);
  const issueBlocks = useMemo(() => scopeRows.filter(r => qualityForRecord(r).level === "issue").length, [scopeRows]);
  const warningCount = useMemo(() => scopeRows.filter(r => qualityForRecord(r).level === "review").length, [scopeRows]);
  const fieldedProductIds = useMemo(() => new Set(activeRows.map((row) => row.__meta.productId).filter((id): id is string => Boolean(id))), [activeRows]);
  const unfieldedProducts = useMemo(() => master.portfolio.products.filter((product) => product.lifecycleStatus === "active" && !fieldedProductIds.has(product.id)), [fieldedProductIds, master.portfolio.products]);
  const requestedFieldProductId = searchParams.get("fieldProduct") || "";
  const requestedFieldProduct = master.portfolio.products.find((product) => product.id === requestedFieldProductId) || null;
  const resolvedNewRowRelease = newRowRelease === "__new__" ? newReleaseName.trim() : newRowRelease;
  const reconciliation = useMemo(() => draft ? reconcileIntake(activeRows, draft.rows) : null, [activeRows, draft]);

  useEffect(() => {
    if (!requestedFieldProduct || fieldProductLaunchRef.current === requestedFieldProduct.id) return;
    fieldProductLaunchRef.current = requestedFieldProduct.id;
    setNewRowProductId(requestedFieldProduct.id);
    setNewRowRelease(activeRelease === "All releases" || activeRelease === "Unassigned" ? "" : activeRelease);
    setNewReleaseName("");
    setShowAddRow(true);
  }, [activeRelease, requestedFieldProduct]);

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
        id: selectedProductId ?? "Not linked to a product",
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

  function queueOccurrenceSave(row: ManagedRecord24, sequence: number) {
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
          await Promise.all([reload(), reloadWorkspaceContext()]);
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
        if (saveSequences.current.get(occurrenceId) === sequence) await Promise.all([reload(), reloadWorkspaceContext()]);
      })
      .catch((reason) => {
        if (saveSequences.current.get(occurrenceId) === sequence) {
          setFailedSaveOccurrences((current) => new Set(current).add(occurrenceId));
          setNotice(reason instanceof Error ? reason.message : "The automatic save could not be completed.");
          window.setTimeout(() => setNotice(""), 4200);
        }
      })
      .finally(() => {
        setSavingOccurrences((current) => {
          const nextSaving = new Set(current);
          nextSaving.delete(occurrenceId);
          return nextSaving;
        });
        if (saveSequences.current.get(occurrenceId) === sequence) {
          setPendingSaveOccurrences((current) => {
            const nextPending = new Set(current);
            nextPending.delete(occurrenceId);
            return nextPending;
          });
        }
      });
    saveChains.current.set(occurrenceId, next);
  }

  function edit(column: TechnicalBaselineColumn, value: string) {
    if (selectedIndex === null) return;
    const current = rows[selectedIndex];
    if (!current) return;
    if (current.__meta.lifecycleStatus !== "active") {
      setNotice("Restore this voided baseline record before editing it.");
      return;
    }
    const nextRow = { ...current, [column]: value } as ManagedRecord24;
    setRows((existing) => existing.map((row, index) => index === selectedIndex ? nextRow : row));
    const occurrenceId = current.__meta.occurrenceId;
    const sequence = (saveSequences.current.get(occurrenceId) ?? 0) + 1;
    saveSequences.current.set(occurrenceId, sequence);
    setPendingSaveOccurrences((existing) => new Set(existing).add(occurrenceId));
    setFailedSaveOccurrences((existing) => {
      const nextFailed = new Set(existing);
      nextFailed.delete(occurrenceId);
      return nextFailed;
    });
    const existingTimer = saveTimers.current.get(occurrenceId);
    if (existingTimer) window.clearTimeout(existingTimer);
    saveTimers.current.set(occurrenceId, window.setTimeout(() => queueOccurrenceSave(nextRow, sequence), 650));
  }

  async function changeLifecycle(action: "void" | "restore") {
    if (!selectedMeta) return;
    setLifecycleSaving(true);
    try {
      const response = await fetch("/api/baseline", {
        method: action === "void" ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "void" ? { occurrenceId: selectedMeta.occurrenceId, reason: lifecycleReason } : { action: "restore_occurrence", occurrenceId: selectedMeta.occurrenceId }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || `Baseline record could not be ${action === "void" ? "voided" : "restored"}.`);
      setSelectedIndex(null);
      setShowLifecycleModal(false);
      setLifecycleReason("");
      await Promise.all([reload(), reloadWorkspaceContext()]);
      setNotice(action === "void" ? "Baseline record voided. Its history is retained and it is excluded from normal views and XLSX export." : "Baseline record restored to the active baseline.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Lifecycle update failed."); }
    finally { setLifecycleSaving(false); }
  }

  async function assignSelectedToChangeRequest() {
    const occurrenceIds = [...checked].map((index) => rows[index]).filter((row) => row?.__meta.lifecycleStatus === "active").map((row) => row.__meta.occurrenceId);
    if (!changeAssignment.changeRequestId || !occurrenceIds.length) return;
    setChangeAssignmentSaving(true);
    try {
      await saveChangeAction({ action: "assign_occurrences", occurrenceIds, ...changeAssignment });
      await reloadChanges();
      setChecked(new Set());
      setShowChangeAssignment(false);
      setChangeAssignment({ changeRequestId: "", effectAction: "modify", aspect: "configuration", consequence: "" });
      setNotice(`${occurrenceIds.length} baseline record${occurrenceIds.length === 1 ? "" : "s"} linked to the Change Request.`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Baseline records could not be linked."); }
    finally { setChangeAssignmentSaving(false); }
  }

  function selectRecord(index: number) {
    const record = rows[index];
    if (!record) return;
    if (selectedIndex === index) {
      setSelectedIndex(null);
      return;
    }
    const review = reviews[record.__meta.occurrenceId] ?? { status: "not_reviewed" as ReviewStatus, reviewedAt: null, note: null };
    setShowGridSummary(false);
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
    const occurrenceId = selectedMeta?.occurrenceId;
    if (!occurrenceId) {
      setNotice("Choose a baseline record before recording a manual review.");
      return;
    }

    const key = occurrenceId;
    const previous = reviews[key];
    const cleanedNote = note?.trim() ?? "";
    const optimistic = { status, reviewedAt: status === "not_reviewed" ? null : new Date().toISOString(), note: cleanedNote || null };
    setReviews((current) => ({ ...current, [key]: optimistic }));
    setReviewSaving(true);

    try {
      const response = await fetch("/api/baseline/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ occurrenceId, status, note: cleanedNote }),
      });
      if (!response.ok) throw new Error("Unable to save review.");
      const payload = await response.json() as { review: ManualReview };
      setReviews((current) => ({ ...current, [key]: payload.review }));
      setNotice(status === "not_reviewed" ? "Cleared the manual review for this baseline record." : `Recorded ${manualReviewLabel(status).toLowerCase()} for this baseline record.`);
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
    setNewRowProductId(requestedFieldProduct?.id || "");
    setShowAddRow(true);
  }

  async function addRow() {
    const chosenRelease = newRowRelease === "__new__" ? newReleaseName.trim() : newRowRelease;
    if (!chosenRelease) {
      setNotice("Select an existing release or enter a new ReleaseName.");
      return;
    }
    const selectedProduct = master.portfolio.products.find((product) => product.id === newRowProductId) || null;
    const row = blankRecord();
    row.ReleaseName = chosenRelease;
    if (selectedProduct) {
      row.LongName = selectedProduct.canonicalName;
      row.ShortName = selectedProduct.shortName || "";
      row.TechStackType = selectedProduct.productType || "";
      row["Software Type"] = selectedProduct.softwareClassification || "";
    }
    const response = await fetch("/api/baseline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ row }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      setNotice(payload.error || "The baseline record could not be created.");
      return;
    }
    await Promise.all([reload(), reloadWorkspaceContext(), master.reload()]);
    selectReleaseScope(chosenRelease);
    setActiveQuality("All checks");
    setActiveReview("All review statuses");
    setShowAddRow(false);
    setNotice(`Created ${selectedProduct ? `${selectedProduct.canonicalName} in ` : "a new baseline record in "}${chosenRelease}.`);
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
      setImportError(error instanceof Error ? error.message : "The A2O Tech Stack file could not be read.");
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
      setImportError(payload.error || "The A2O Tech Stack file could not be accepted into the active baseline.");
      return;
    }
    await Promise.all([reload(), reloadWorkspaceContext()]);
    setSelectedIndex(null);
    selectReleaseScope("All releases");
    setActiveQuality("All checks");
    setActiveReview("All review statuses");
    setDraft(null);
    setNotice(`Imported ${draft.rows.length} records across ${new Set(draft.rows.map(releaseOf)).size} releases into the active baseline.`);
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
      const enrichment = await fetch("/api/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "enrich_workspace" }),
      });
      const enrichmentPayload = await enrichment.json() as { error?: string };
      if (!enrichment.ok) throw new Error(enrichmentPayload.error || "The source demonstration data loaded, but its topology details could not be prepared.");
      await Promise.all([reload(), reloadWorkspaceContext()]);
      setSelectedIndex(null);
      selectReleaseScope("All releases");
      setActiveQuality("All checks");
      setActiveReview("All review statuses");
      setShowStewardMenu(false);
      setNotice(`Loaded ${DEMONSTRATION_ROWS.length} demonstration records across three releases, including topology details and Change Request links.`);
    } catch (reason) {
      setDemoError(reason instanceof Error ? reason.message : "The demonstration dataset could not be loaded.");
    } finally {
      setDemoLoading(false);
    }
  }

  async function exportWorkbook() {
    const exportRows = activeRelease === "All releases" ? activeRows : scopeRows;
    if (!exportRows.length) {
      setNotice("There are no baseline records in the requested export scope.");
      return;
    }
    const localBlockers = exportRows.filter((row) => qualityForRecord(row).level === "issue");
    if (localBlockers.length) {
      setActiveQuality("Blocking");
      setNotice(`Export is blocked by ${localBlockers.length} baseline record${localBlockers.length === 1 ? "" : "s"}. The grid is filtered to show them.`);
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
        {navigationSections.map((section) => <div className="nav-section" key={section}>
          <p className="rail-label">{section}</p>
          {APP_NAV_ITEMS.filter((item) => item.section === section && item.enabled).map((item) => (
            <Link
              href={item.href}
              key={item.href}
              className={`nav-item ${isActivePath(pathname, item.href) ? "active" : ""}`}
              title={railCollapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span><span className="nav-label">{item.label}</span>{item.tag ? <em>{item.tag}</em> : null}
            </Link>
          ))}
        </div>)}
      </nav>
      <div className="rail-context">
        <span className="context-dot"/>
        <div><strong>Release scope</strong><small>{activeRelease} · {activeRelease === "All releases" ? "Cross-release view" : "Release filter"}</small></div>
      </div>
      <button
        className="profile"
        type="button"
        onClick={() => { setShowStewardMenu(true); setDemoError(""); }}
        aria-haspopup="dialog"
        aria-expanded={showStewardMenu}
        aria-controls="steward-menu"
      ><span>WS</span><div><strong>Workspace</strong><small>Demo data and workspace actions</small></div><b>···</b></button>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div><span className="eyebrow">TECHNICAL BASELINE</span><h1>Baseline Records</h1></div>
        <div className="top-actions">
          <WorkspaceContextControl mode="filter" />
          <button className="primary-button" onClick={() => fileRef.current?.click()}>Import A2O XLSX</button>
        </div>
      </header>

      {selectedIndex === null ? <>
        <section className="baseline-context" aria-label="Grid scope">
          <div><strong>{activeRelease}</strong><span>{scopeRows.length} records · {productCount} products · {issueCount ? `${issueCount} data-quality ${issueCount === 1 ? "finding" : "findings"}` : "No data-quality findings"}</span></div>
          <button className={showGridSummary ? "tool-button tool-active baseline-summary-toggle" : "tool-button baseline-summary-toggle"} type="button" onClick={() => setShowGridSummary((value) => !value)} aria-expanded={showGridSummary} aria-controls="baseline-summary">{showGridSummary ? "Hide summary" : "Show summary"}</button>
        </section>
        {showGridSummary ? <>
          <section className="summary baseline-expanded-summary" id="baseline-summary">
            <div className="summary-lead">
              <p>{activeRelease === "All releases" ? `${releases.length} RELEASES IN SCOPE` : `RELEASE ${activeRelease}`}</p>
              <h2>{activeRelease === "All releases" ? "Working technical baseline across releases" : "Working technical baseline"}</h2>
              <span>Working baseline · ReleaseName retained on every record</span>
            </div>
            <div className="metric"><span>Baseline records</span><strong>{scopeRows.length}</strong><small>{activeRelease} · exact A2O XLSX export available</small></div>
            <div className="metric"><span>Products</span><strong>{productCount}</strong><small>Across {scopeTiers.size} tiers in scope</small></div>
            <div className="metric metric-alert"><span>Data-quality findings</span><strong>{issueCount}</strong><small>{issueBlocks} blocking · {warningCount} warnings</small></div>
          </section>
        </> : null}
        {!master.loading && unfieldedProducts.length ? <section className="unfielded-products-notice" aria-label="Products not fielded in a Release">
          <div><span className="eyebrow">PRODUCT CATALOG</span><strong>{unfieldedProducts.length} active Product{unfieldedProducts.length === 1 ? " is" : "s are"} not fielded in a Release</strong><p>Catalog Products can be governed before a deployment is planned. They do not appear in this Release baseline grid and do not receive baseline quality checks until a Release record is created.</p></div>
          <div className="unfielded-products-actions">{unfieldedProducts.slice(0, 3).map((product) => <Link key={product.id} className="domain-chip" href={`/products/${encodeURIComponent(product.id)}`}><strong>{product.shortName || product.canonicalName}</strong><span>Open Product</span></Link>)}<Link className="ghost-button" href="/products">Open Product catalog</Link></div>
        </section> : null}
      </> : null}

      <div className={selectedIndex === null ? "content-grid" : "content-grid content-grid-detail"}>
        {selectedIndex === null ? <aside className="tree-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">BROWSE WORKING BASELINE</span><h3>Release and tier</h3></div>
          </div>
          <div className="tree-list">
            <button className={activeRelease === "All releases" && activeTier === "All records" ? "tree-row selected" : "tree-row"} onClick={() => selectReleaseScope("All releases")}>
              <span>▦</span><b>All releases</b><em>{activeRows.length}</em>
            </button>
            {releaseGroups.map((group) => (
              <div className="release-tree" key={group.release}>
                <button className={activeRelease === group.release && activeTier === "All records" ? "tree-row release-row selected" : "tree-row release-row"} onClick={() => selectReleaseScope(group.release)}>
                  <span>◆</span><b>{group.release}</b><em>{group.rows.length}</em>
                </button>
                {group.tiers.map((tier) => (
                  <button key={`${group.release}:${tier}`} className={activeRelease === group.release && activeTier === tier ? "tree-row tree-child selected" : "tree-row tree-child"} onClick={() => { selectReleaseScope(group.release); setActiveTier(tier); }}>
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
        </aside> : null}

        <section className="records-panel">
          {selectedIndex === null ? (
            <>
              <div className="records-toolbar">
                <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products, hosts, or OEM…"/></label>
                <button className={showFilters ? "tool-button tool-active" : "tool-button"} onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}>≡ Filter <span>{(activeRelease === "All releases" ? 0 : 1) + (activeTier === "All records" ? 0 : 1) + (activeQuality === "All checks" ? 0 : 1) + (activeReview === "All review statuses" ? 0 : 1) + (activeLifecycle === "Active records" ? 0 : 1)}</span></button>
                <div className="spacer" />
                {checked.size ? <button className="tool-button tool-active" onClick={() => setShowChangeAssignment(true)}>Assign {checked.size} to Change Request</button> : null}
                <button className="tool-button" onClick={exportWorkbook}>Export A2O XLSX</button>
                <button className="add-button" onClick={openAddRow}>＋ Add Release record</button>
              </div>

              {showFilters && <section className="filter-panel" aria-label="Baseline record filters">
                <div><span>Tier</span><select value={activeTier} onChange={(event) => setActiveTier(event.target.value)}><option>All records</option>{availableTiers.map((tier) => <option key={tier}>{tier}</option>)}</select></div>
                <div><span>Automated checks</span><select value={activeQuality} onChange={(event) => setActiveQuality(event.target.value)}><option>All checks</option><option>Pass</option><option>Warning</option><option>Blocking</option></select></div>
                <div><span>Manual review</span><select value={activeReview} onChange={(event) => setActiveReview(event.target.value)}><option>All review statuses</option><option>Not reviewed</option><option>Reviewed</option><option>Follow-up</option></select></div>
                <div><span>Lifecycle</span><select value={activeLifecycle} onChange={(event) => setActiveLifecycle(event.target.value)}><option>Active records</option><option>Voided records</option><option>All lifecycle states</option></select></div>
                <button className="filter-clear-button" type="button" onClick={() => {
                  selectReleaseScope("All releases");
                  setActiveQuality("All checks");
                  setActiveReview("All review statuses");
                  setActiveLifecycle("Active records");
                  setQuery("");
                }}>Clear filters</button>
              </section>}

              {workspaceError ? <div className="empty">{workspaceError} Use Import A2O XLSX to establish the active baseline.</div> : null}
              {loading ? <div className="empty">Loading active baseline…</div> : null}

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
                      const rowReview = reviews[row.__meta.occurrenceId] ?? { status: "not_reviewed" as ReviewStatus, reviewedAt: null };
                      return <tr
                        key={row.__meta.occurrenceId}
                        className={`${selectedIndex === index ? "row-selected" : ""} ${row.__meta.lifecycleStatus === "voided" ? "row-voided" : ""}`}
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
                            <span className="release-chip">{text(row.ReleaseName) || "Unassigned"}</span>{row.__meta.lifecycleStatus === "voided" ? <span className="voided-badge">Voided</span> : null}
                          </Link>
                        </td>
                        <td>
                          <Link
                            href={`/products/${encodeURIComponent(productIdentityKey(row))}`}
                            className="row-nav-link"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <strong>{text(row.ShortName) || "Unnamed"}</strong><small>{text(row.LongName) || "Product name missing"}</small>
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
                {!filtered.length && <div className="empty">{rows.length ? "No baseline records match the selected filters." : "No working baseline records are available. Import an A2O Tech Stack XLSX file or add a Release record to begin."}</div>}
              </div>}
              {!workspaceError && !loading && <footer className="table-footer"><span>Showing {filtered.length} records · {scopeRows.length} in {activeRelease}</span><div><b>All loaded</b></div></footer>}
            </>
          ) : (
            <>
              <div className="detail-head">
                <button className="ghost-button record-back-button" type="button" onClick={() => setSelectedIndex(null)}>← Back to grid</button>
                <div><span className="eyebrow">{text(selected.ReleaseName) || "UNASSIGNED RELEASE"} · BASELINE RECORD #{text(selected["#"]) || "UNASSIGNED"}</span><h3>{text(selected.ShortName) || "New product"}</h3><p>{text(selected.LongName) || "Complete the required source fields."}</p><span className={selectedSaveFailed ? "autosave-label autosave-error" : "autosave-label"}>{selectedSaveFailed ? "Save failed — edit the field to retry" : selectedSavePending || (selectedMeta && savingOccurrences.has(selectedMeta.occurrenceId)) ? "Saving changes…" : "✓ Changes saved to the active baseline"}</span></div>
                <div className="detail-head-actions">{selectedMeta ? <Link className="ghost-button" href={`/occurrences/${encodeURIComponent(selectedMeta.occurrenceId)}`}>Record reference</Link> : null}{selectedMeta?.lifecycleStatus === "voided" ? <button className="ghost-button" type="button" disabled={lifecycleSaving} onClick={() => void changeLifecycle("restore")}>Restore record</button> : <button className="danger-button" type="button" onClick={() => setShowLifecycleModal(true)}>Void record</button>}</div>
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
                {selectedMeta?.lifecycleStatus === "voided" ? <div className="lifecycle-banner"><strong>Voided baseline record</strong><span>{selectedMeta.lifecycleReason || "No reason recorded"} · {selectedMeta.voidedAt?.slice(0, 10) || "date unavailable"}. Restore it before editing.</span></div> : null}
                <div className="detail-status quality-summary">
                  <Mark quality={selectedQuality} />
                  <div><strong>Automated health checks</strong><span>Calculated from current baseline values · not included in XLSX export</span></div>
                  <button type="button" className="quality-info" aria-label="Explain automated health checks" onClick={() => setShowQualityHelp(true)}>?</button>
                </div>

                {activeDetailTab === "record" && (
                  <>
                    <section>
                      <h4>Product and release</h4>
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
                      <h4>Node state</h4>
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
                      <h4>A2O exchange fields</h4>
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
                    {selectedQuality.issues.length === 0 ? <p className="quality-complete">✓ The current baseline values pass all configured checks.</p> : (
                      <ul>
                        {selectedQuality.issues
                          .slice()
                          .sort((a, b) => qualityIssueOrder.indexOf(a.severity) - qualityIssueOrder.indexOf(b.severity))
                          .map((issue, index) => <li key={`${issue.field}:${index}`} className={`quality-${issue.severity}`}><strong>{issue.field}</strong><span>{issue.message}</span></li>)}
                      </ul>
                    )}
                    <p className="quality-guidance">Edit the flagged fields on the Record tab. Automated checks do not replace analyst review.</p>
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
                      <textarea className="review-note" value={reviewDraftNote} onChange={(event) => setReviewDraftNote(event.target.value)} placeholder="Optional note: evidence, rationale, and required action." rows={6} />
                    </label>
                    <div className="review-actions">
                      <button className="primary-button" disabled={reviewSaving || !reviewDraftHasChanges} onClick={() => setManualReview(reviewDraftStatus, reviewDraftNote)}>
                        {reviewSaving ? "Saving…" : "Save review"}
                      </button>
                      <span>Last reviewed <strong>{reviewDate(selectedReview.reviewedAt)}</strong></span>
                    </div>
                    <p>Review metadata is retained with the baseline record and excluded from A2O XLSX export.</p>
                  </section>
                )}

                {activeDetailTab === "occurrences" && (
                  <section className="occurrence-details">
                    <div className="section-heading">
                      <h4>Release records for this product</h4>
                      <span>{occurrenceRows.length} record{occurrenceRows.length === 1 ? "" : "s"} linked to this product</span>
                    </div>
                    {!occurrenceRows.length ? (
                      <p className="manual-review-note">This row has no matching source key in the active baseline. Review it before using it for comparisons.</p>
                    ) : (
                      <div className="occurrence-list">
                        {occurrenceRows.map(({ row, index }) => {
                          const rowQuality = qualityForRecord(row);
                          const isCurrent = index === selectedIndex;
                          const deltas = occurrenceDiffColumns
                            .filter((column) => text(row[column]) !== text(selected[column]))
                            .map((column) => ({
                              column,
                              selectedValue: text(selected[column]),
                              comparedValue: text(row[column]),
                            }));
                          const rowReview = reviews[row.__meta.occurrenceId] ?? { status: "not_reviewed" as ReviewStatus, reviewedAt: null };
                          return <button type="button" key={`${text(row.ReleaseName)}:${index}`} className={`occurrence-row ${isCurrent ? "occurrence-row-current" : ""}`} onClick={() => selectRecord(index)}>
                            <div className="occurrence-row-head">
                              <strong>{text(row.ReleaseName) || "Unassigned"}<small>Release baseline</small></strong>
                              <span className={`review-mark review-${rowReview.status}`}>{manualReviewLabel(rowReview.status)}</span>
                              <span className={`mark mark-${rowQuality.level}`}>{rowQuality.label}</span>
                            </div>
                            <div className="occurrence-meta">{fieldPairs(["ShortName","LongName","Tier","Resource","HW_Host","Containerized","Container Technology"], row)}</div>
                            <div className="occurrence-diff">
                              {deltas.length === 0 ? (
                                <p className="occurrence-diff-empty">Same tracked configuration values as selected {text(selected.ReleaseName) || "release"}.</p>
                              ) : (
                                <>
                                  <div className="occurrence-diff-heading">
                                    <strong>{deltas.length} changed field{deltas.length === 1 ? "" : "s"}</strong>
                                    <span>Selected {text(selected.ReleaseName) || "release"} <b aria-hidden="true">→</b> {text(row.ReleaseName) || "release"}</span>
                                  </div>
                                  <div className="occurrence-diff-grid">
                                    {deltas.map(({ column, selectedValue, comparedValue }) => {
                                      const changeKind = !selectedValue ? "added" : !comparedValue ? "removed" : "changed";
                                      return <div className={`occurrence-diff-item occurrence-diff-${changeKind}`} key={column}>
                                        <span className="occurrence-diff-field">{column}</span>
                                        <div className="occurrence-diff-values" aria-label={`${column}: selected ${selectedValue || "not reported"}; compared ${comparedValue || "not reported"}`}>
                                          <span className="occurrence-diff-before">{selectedValue ? <del>{selectedValue}</del> : <em>Not reported</em>}</span>
                                          <b className="occurrence-diff-arrow" aria-hidden="true">→</b>
                                          <span className="occurrence-diff-after">{comparedValue ? <ins>{comparedValue}</ins> : <em>Not reported</em>}</span>
                                        </div>
                                      </div>;
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                            {isCurrent && <small className="occurrence-current-chip">Current row in focus</small>}
                          </button>;
                        })}
                      </div>
                    )}
                  </section>
                )}

                {activeDetailTab === "normalized" && normalizedProjection && (
                  <section className="normalized-view">
                    <div className="section-heading"><h4>Canonical relationships</h4><span>Product and configuration relationships materialized from the current baseline</span></div>
                    <div className="normalized-grid">
                      <div className="normal-card">
                        <h5>Product node</h5>
                        <p><strong>Product ID</strong>{normalizedProjection.productNode.id}</p>
                        <p><strong>Product name</strong>{normalizedProjection.productNode.canonicalName}</p>
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
        <span className="eyebrow">NEW BASELINE RECORD</span>
        <h2 id="add-row-title">Create a Release record</h2>
        <p>A baseline record is always release-specific. Choose the Product and Release before entering placement, infrastructure, and runtime values.</p>
        <div className="new-row-summary"><span>External record key (#)</span><strong>Optional until the identifier is known</strong></div>
        <label className="modal-field">Product<select value={newRowProductId} onChange={(event) => setNewRowProductId(event.target.value)}><option value="">Host or infrastructure record — no Product</option>{master.portfolio.products.filter((product) => product.lifecycleStatus === "active").map((product) => <option key={product.id} value={product.id}>{product.shortName ? `${product.shortName} · ` : ""}{product.canonicalName}</option>)}</select><small>A selected catalog Product pre-fills its name and classification. You can complete release-specific values after creating the record.</small></label>
        <label className="modal-field">ReleaseName<select value={newRowRelease} onChange={(event) => setNewRowRelease(event.target.value)}><option value="">Select a release…</option>{releases.filter((release) => release !== "Unassigned").map((release) => <option key={release}>{release}</option>)}<option value="__new__">＋ Create a new release…</option></select></label>
        {newRowRelease === "__new__" && <label className="modal-field">New ReleaseName<input value={newReleaseName} onChange={(event) => setNewReleaseName(event.target.value)} placeholder="Enter the release name" /></label>}
        <div className={resolvedNewRowRelease ? "assignment-preview ready" : "assignment-preview"}><span>{resolvedNewRowRelease ? "Row will be assigned to" : "Waiting for release selection"}</span><strong>{resolvedNewRowRelease || "No release selected"}</strong></div>
        <footer><button className="ghost-button" onClick={() => setShowAddRow(false)}>Cancel</button><button className="primary-button" disabled={!resolvedNewRowRelease} onClick={addRow}>Create baseline record</button></footer>
      </section>
    </div>}

    {showQualityHelp && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowQualityHelp(false); }}>
      <section className="import-modal quality-help-modal" role="dialog" aria-modal="true" aria-labelledby="quality-help-title">
        <span className="eyebrow">AUTOMATED HEALTH CHECKS</span>
        <h2 id="quality-help-title">Why does the system check each row?</h2>
        <p>Automated checks apply to <strong>release baseline records</strong>. They identify missing or inconsistent values in a fielded record. They are calculated indicators, not source data or manual assessment, and are not included in the A2O Tech Stack XLSX export.</p>
        <div className="quality-key">
          <div><Mark quality={{ level: "ready", label: "Pass", issues: [] }} /><span>No configured baseline-value checks failed.</span></div>
          <div><Mark quality={{ level: "review", label: "Warning", issues: [] }} /><span>The row is usable, but a value is incomplete or inconsistent.</span></div>
          <div><Mark quality={{ level: "issue", label: "Blocking", issues: [] }} /><span>The row cannot be used until a required identity is corrected.</span></div>
        </div>
        <p className="modal-note">Product catalog entries do not receive this status until they are fielded in a Release. Automated checks and manual review are separate; a record can pass checks and still need analyst review.</p>
        <footer><button className="primary-button" onClick={() => setShowQualityHelp(false)}>Got it</button></footer>
      </section>
    </div>}

    {showLifecycleModal && selectedMeta ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !lifecycleSaving) setShowLifecycleModal(false); }}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="void-title"><span className="eyebrow">RECORD LIFECYCLE</span><h2 id="void-title">Void this baseline record?</h2><p>The record will be excluded from dashboards, comparisons, and XLSX export. Its original intake snapshot, review history, revisions, and audit events are retained.</p><label className="modal-field">Required reason<textarea rows={4} value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} placeholder="Why this record is erroneous, duplicate, or no longer part of the active baseline" /></label><footer><button className="ghost-button" disabled={lifecycleSaving} onClick={() => setShowLifecycleModal(false)}>Cancel</button><button className="danger-button" disabled={lifecycleSaving || !lifecycleReason.trim()} onClick={() => void changeLifecycle("void")}>{lifecycleSaving ? "Voiding…" : "Void record"}</button></footer></section></div> : null}

    {showChangeAssignment ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !changeAssignmentSaving) setShowChangeAssignment(false); }}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="assign-change-title"><span className="eyebrow">CHANGE IMPACT</span><h2 id="assign-change-title">Link {checked.size} baseline record{checked.size === 1 ? "" : "s"} to a Change Request</h2><p>The baseline record remains current analytical data. This relationship records proposed impact for consequence analysis and funding reports.</p><label className="modal-field">Change Request<select value={changeAssignment.changeRequestId} onChange={(event) => setChangeAssignment({ ...changeAssignment, changeRequestId: event.target.value })}><option value="">Choose request</option>{changePortfolio.requests.map((request) => <option key={request.id} value={request.id}>{request.externalIdentifier} · {request.title}</option>)}</select></label><div className="form-grid"><label className="modal-field">Action<select value={changeAssignment.effectAction} onChange={(event) => setChangeAssignment({ ...changeAssignment, effectAction: event.target.value })}>{["add", "remove", "move", "modify", "assess"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="modal-field">Aspect<input value={changeAssignment.aspect} onChange={(event) => setChangeAssignment({ ...changeAssignment, aspect: event.target.value })} placeholder="configuration, fielding, capacity…" /></label></div><label className="modal-field">Consequence<textarea rows={3} value={changeAssignment.consequence} onChange={(event) => setChangeAssignment({ ...changeAssignment, consequence: event.target.value })} placeholder="What changes or remains at risk for these baseline records" /></label><footer><button className="ghost-button" disabled={changeAssignmentSaving} onClick={() => setShowChangeAssignment(false)}>Cancel</button><button className="primary-button" disabled={changeAssignmentSaving || !changeAssignment.changeRequestId} onClick={() => void assignSelectedToChangeRequest()}>{changeAssignmentSaving ? "Assigning…" : "Add impact link"}</button></footer></section></div> : null}

    {(draft || importError) && <div className="modal-backdrop" role="presentation">
      <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <span className="eyebrow">A2O TECH STACK EXCHANGE</span>
        <h2 id="import-title">{importError ? "Contract mismatch" : "Ready to reconcile"}</h2>
        {importError ? <>
          <p className="error-copy">{importError}</p>
          <div className="contract-strip">Expected: {TECHNICAL_BASELINE_COLUMNS.length} columns · exact names · exact order</div>
          <footer><button className="primary-button" onClick={() => setImportError("")}>Return to baseline</button></footer>
        </> : draft && <>
          <p><strong>{draft.fileName}</strong> · {draft.sheetName}</p>
          <div className="import-stats four">
            <div><strong>{reconciliation?.added ?? 0}</strong><span>Added</span></div>
            <div><strong>{reconciliation?.changed ?? 0}</strong><span>Changed</span></div>
            <div><strong>{reconciliation?.unchanged ?? 0}</strong><span>Unchanged</span></div>
            <div><strong>{reconciliation?.removedFromWorkingProjection ?? 0}</strong><span>Absent from new projection</span></div>
          </div>
          {reconciliation?.conflicts ? <p className="error-copy"><strong>{reconciliation.conflicts} duplicate identity conflict{reconciliation.conflicts === 1 ? "" : "s"}.</strong> Resolve repeated ReleaseName + # identities (or semantic fallback identities) before import.</p> : null}
          <div className="release-list"><span>ReleaseName values</span>{Array.from(new Set(draft.rows.map(releaseOf))).map((release) => <b key={release}>{release} · {draft.rows.filter((row) => releaseOf(row) === release).length} rows</b>)}</div>
          <p className="modal-note">Each baseline record retains ReleaseName. Records absent from the incoming A2O exchange file leave the active baseline. Each import is retained as an immutable intake package for history and rollback.</p>
          <footer><button className="ghost-button" onClick={() => setDraft(null)}>Cancel</button><button className="primary-button" disabled={Boolean(reconciliation?.conflicts)} onClick={acceptImport}>Import and reconcile</button></footer>
        </>}
      </section>
    </div>}

    {showStewardMenu && <div className="modal-backdrop steward-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !demoLoading) setShowStewardMenu(false);
    }}>
      <section className="import-modal steward-menu" id="steward-menu" role="dialog" aria-modal="true" aria-labelledby="steward-title">
        <button className="modal-close" type="button" aria-label="Close workspace menu" disabled={demoLoading} onClick={() => setShowStewardMenu(false)}>×</button>
        <span className="eyebrow">WORKSPACE</span>
        <h2 id="steward-title">{demoEnabled ? "Demo workspace" : "Operational workspace"}</h2>
        <p>{demoEnabled ? "Load demonstration data to test release comparisons, topology, data quality, and traceability. Demonstration data is not program data." : "Demonstration data is disabled in this environment. Use Import A2O XLSX to establish or replace the active baseline."}</p>
        <div className="import-stats three">
          <div><strong>{DEMONSTRATION_ROWS.length}</strong><span>Baseline records</span></div>
          <div><strong>3</strong><span>Releases</span></div>
          <div><strong>8</strong><span>Products</span></div>
        </div>
        <p className="modal-note">{demoEnabled ? <>This replaces the active baseline with demonstration records. It also adds Platform, topology, Change Request, dependency, and decision detail for testing. Prior A2O exchange packages remain available and can be restored from Import &amp; Data Quality.</> : <>Demonstration data is disabled. A2O exchange restore, void/restore, audit history, and exact XLSX export remain available.</>}</p>
        {demoError ? <p className="error-copy" role="alert">{demoError}</p> : null}
        <footer><button className="ghost-button" type="button" disabled={demoLoading} onClick={() => setShowStewardMenu(false)}>Close</button>{demoEnabled ? <button className="primary-button" type="button" disabled={demoLoading} onClick={loadDemonstrationWorkspace}>{demoLoading ? "Loading demonstration data…" : "Load demonstration dataset"}</button> : null}</footer>
      </section>
    </div>}

    {notice && <div className="toast" role="status">✓ {notice}</div>}
  </main>;
}
