import type { ObjectiveStatus } from "./initiative-decision-model.js";

export const OBJECTIVE_IMPORT_COLUMNS = [
  "ExternalSystem",
  "ExternalIdentifier",
  "ExternalItemType",
  "OwningChangeRequest",
  "Title",
  "Status",
  "TechnicalOwner",
  "PlannedStart",
  "PlannedFinish",
  "ActualStart",
  "ActualFinish",
  "SourceLocator",
  "SourceAsOf",
  "Summary",
] as const;

export type ObjectiveImportColumn = typeof OBJECTIVE_IMPORT_COLUMNS[number];
export type ObjectiveImportRow = Record<ObjectiveImportColumn, string>;
export type ObjectiveImportDisposition = "add" | "change" | "unchanged" | "blocked";

export type ObjectiveImportIssue = {
  code: "duplicate_key" | "missing_required" | "invalid_status" | "invalid_date" | "reported_reference";
  message: string;
  blocking: boolean;
};

export type ObjectiveImportPreviewRow = {
  rowNumber: number;
  key: string;
  disposition: ObjectiveImportDisposition;
  existingObjectiveId: string | null;
  owningChangeRequestId: string | null;
  changedFields: ObjectiveImportColumn[];
  issues: ObjectiveImportIssue[];
  row: ObjectiveImportRow;
};

export type ObjectiveImportPreview = {
  rows: ObjectiveImportPreviewRow[];
  added: number;
  changed: number;
  unchanged: number;
  blocked: number;
  canApply: boolean;
};

/** Default for the structured Lockheed workbook when that cosmetic column is blank. */
export const DEFAULT_OBJECTIVE_IMPORT_EXTERNAL_SYSTEM = "Lockheed Martin Jira";

type ExistingObjective = {
  id: string;
  changeRequestId: string | null;
  externalSystem: string;
  externalIdentifier: string;
  externalItemType?: string | null;
  title: string;
  summary: string | null;
  technicalOwner: string | null;
  status: ObjectiveStatus;
  plannedStart: string | null;
  plannedFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  sourceLocator: string | null;
  sourceAsOf: string | null;
};

type OwningRequest = { id: string; externalIdentifier: string };

const clean = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
const normalized = (value: unknown) => clean(value).toLocaleLowerCase("en-US");
const normalizedRequest = (value: unknown) => {
  const source = clean(value);
  const match = source.match(/\b(MCP|DSOR)\s*[-_ ]?\s*(\d+)\b/i);
  return normalized(match ? `${match[1].toUpperCase()}-${match[2]}` : source);
};
const validStatuses = new Set<ObjectiveStatus>(["proposed", "planned", "in_progress", "blocked", "verification", "complete", "cancelled"]);
const dateColumns: ObjectiveImportColumn[] = ["PlannedStart", "PlannedFinish", "ActualStart", "ActualFinish", "SourceAsOf"];
// A supplier can report an Objective before it has a title, a normalised
// status, a JPO/MCP, or a source date. Those values are retained as a source
// observation and can be completed later. A stable external identifier is the
// only fact required to safely create a canonical Objective.
const requiredColumns: ObjectiveImportColumn[] = ["ExternalIdentifier"];
const SOURCE_CONTROLLED_OBJECTIVE_FIELDS: ObjectiveImportColumn[] = ["OwningChangeRequest", "Title", "Status", "TechnicalOwner", "PlannedStart", "PlannedFinish", "ActualStart", "ActualFinish", "SourceLocator", "SourceAsOf", "Summary"];

export function objectiveImportKey(row: Pick<ObjectiveImportRow, "ExternalSystem" | "ExternalIdentifier">) {
  return `${normalized(row.ExternalSystem)}|${normalized(row.ExternalIdentifier)}`;
}

function objectiveExternalIdentity(value: unknown) { return normalized(value); }

function validDate(value: string) {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function rowFromExisting(item: ExistingObjective, ownerIdentifier: string | null): ObjectiveImportRow {
  return {
    ExternalSystem: clean(item.externalSystem),
    ExternalIdentifier: clean(item.externalIdentifier),
    ExternalItemType: clean(item.externalItemType || "Objective"),
    OwningChangeRequest: clean(ownerIdentifier),
    Title: clean(item.title),
    Status: clean(item.status),
    TechnicalOwner: clean(item.technicalOwner),
    PlannedStart: clean(item.plannedStart),
    PlannedFinish: clean(item.plannedFinish),
    ActualStart: clean(item.actualStart),
    ActualFinish: clean(item.actualFinish),
    SourceLocator: clean(item.sourceLocator),
    SourceAsOf: clean(item.sourceAsOf),
    Summary: clean(item.summary),
  };
}

export function normalizeObjectiveImportRow(input: Partial<Record<ObjectiveImportColumn, unknown>>): ObjectiveImportRow {
  return Object.fromEntries(OBJECTIVE_IMPORT_COLUMNS.map((column) => {
    if (column === "ExternalSystem") return [column, clean(input[column]) || DEFAULT_OBJECTIVE_IMPORT_EXTERNAL_SYSTEM];
    if (column === "ExternalItemType") return [column, clean(input[column]) || "Objective"];
    return [column, clean(input[column])];
  })) as ObjectiveImportRow;
}

export function reconcileObjectiveImport(incoming: ObjectiveImportRow[], existing: ExistingObjective[], requests: OwningRequest[]): ObjectiveImportPreview {
  const requestByIdentifier = new Map(requests.map((request) => [normalizedRequest(request.externalIdentifier), request]));
  const existingByKey = new Map(existing.map((item) => [objectiveImportKey({ ExternalSystem: item.externalSystem, ExternalIdentifier: item.externalIdentifier }), item]));
  const existingByExternalIdentity = new Map<string, ExistingObjective[]>();
  for (const item of existing) {
    const identity = objectiveExternalIdentity(item.externalIdentifier);
    existingByExternalIdentity.set(identity, [...(existingByExternalIdentity.get(identity) || []), item]);
  }
  const keyCounts = new Map<string, number>();
  for (const row of incoming) keyCounts.set(objectiveImportKey(row), (keyCounts.get(objectiveImportKey(row)) || 0) + 1);

  const rows = incoming.map((rawRow, index): ObjectiveImportPreviewRow => {
    const row = normalizeObjectiveImportRow(rawRow);
    const key = objectiveImportKey(row);
    const canonicalMatches = existingByExternalIdentity.get(objectiveExternalIdentity(row.ExternalIdentifier)) || [];
    // A Jira key is an external identity, not a value local to one delivery
    // feed. Prefer an exact system match but reuse one unambiguous canonical
    // Objective reported by another Lockheed source automatically.
    const current = existingByKey.get(key) || (canonicalMatches.length === 1 ? canonicalMatches[0] : undefined);
    const owner = requestByIdentifier.get(normalizedRequest(row.OwningChangeRequest));
    const issues: ObjectiveImportIssue[] = [];
    for (const column of requiredColumns) if (!row[column]) issues.push({ code: "missing_required", message: `${column} is required.`, blocking: true });
    if (row.Status && !validStatuses.has(row.Status as ObjectiveStatus)) issues.push({ code: "invalid_status", message: `Status '${row.Status}' is retained as reported text and is normalized to the closest supported state.`, blocking: false });
    for (const column of dateColumns) if (!validDate(row[column])) issues.push({ code: "invalid_date", message: `${column} is retained in the source receipt but cannot populate a canonical date until corrected.`, blocking: false });
    if ((keyCounts.get(key) || 0) > 1) issues.push({ code: "duplicate_key", message: "External system and identifier occur more than once in this import.", blocking: true });
    if (canonicalMatches.length > 1) issues.push({ code: "duplicate_key", message: `External identifier '${row.ExternalIdentifier}' matches ${canonicalMatches.length} canonical Objectives.`, blocking: true });
    if (row.OwningChangeRequest && !owner) issues.push({ code: "reported_reference", message: `Reported Change Request '${row.OwningChangeRequest}' is new and will be added as an external reference.`, blocking: false });

    const baseline = current ? rowFromExisting(current, current.changeRequestId ? requests.find((request) => request.id === current.changeRequestId)?.externalIdentifier || current.changeRequestId : null) : null;
    const changedFields = baseline ? SOURCE_CONTROLLED_OBJECTIVE_FIELDS.filter((column) => normalized(baseline[column]) !== normalized(row[column])) : [...OBJECTIVE_IMPORT_COLUMNS];
    const disposition: ObjectiveImportDisposition = issues.some((issue) => issue.blocking) ? "blocked" : !current ? "add" : changedFields.length ? "change" : "unchanged";
    return { rowNumber: index + 2, key, disposition, existingObjectiveId: current?.id || null, owningChangeRequestId: owner?.id || null, changedFields, issues, row };
  });

  return {
    rows,
    added: rows.filter((row) => row.disposition === "add").length,
    changed: rows.filter((row) => row.disposition === "change").length,
    unchanged: rows.filter((row) => row.disposition === "unchanged").length,
    blocked: rows.filter((row) => row.disposition === "blocked").length,
    canApply: rows.length > 0 && rows.every((row) => row.disposition !== "blocked"),
  };
}
