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
  code: "duplicate_key" | "missing_required" | "invalid_status" | "invalid_date" | "owner_not_found" | "owner_change";
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

type ExistingObjective = {
  id: string;
  changeRequestId: string;
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
const validStatuses = new Set<ObjectiveStatus>(["proposed", "planned", "in_progress", "blocked", "verification", "complete", "cancelled"]);
const dateColumns: ObjectiveImportColumn[] = ["PlannedStart", "PlannedFinish", "ActualStart", "ActualFinish", "SourceAsOf"];
const requiredColumns: ObjectiveImportColumn[] = ["ExternalSystem", "ExternalIdentifier", "ExternalItemType", "OwningChangeRequest", "Title", "Status", "SourceAsOf"];

export function objectiveImportKey(row: Pick<ObjectiveImportRow, "ExternalSystem" | "ExternalIdentifier">) {
  return `${normalized(row.ExternalSystem)}|${normalized(row.ExternalIdentifier)}`;
}

function validDate(value: string) {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function rowFromExisting(item: ExistingObjective, ownerIdentifier: string): ObjectiveImportRow {
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
  return Object.fromEntries(OBJECTIVE_IMPORT_COLUMNS.map((column) => [column, clean(input[column])])) as ObjectiveImportRow;
}

export function reconcileObjectiveImport(incoming: ObjectiveImportRow[], existing: ExistingObjective[], requests: OwningRequest[]): ObjectiveImportPreview {
  const requestByIdentifier = new Map(requests.map((request) => [normalized(request.externalIdentifier), request]));
  const requestIdentifierById = new Map(requests.map((request) => [request.id, request.externalIdentifier]));
  const existingByKey = new Map(existing.map((item) => [objectiveImportKey({ ExternalSystem: item.externalSystem, ExternalIdentifier: item.externalIdentifier }), item]));
  const keyCounts = new Map<string, number>();
  for (const row of incoming) keyCounts.set(objectiveImportKey(row), (keyCounts.get(objectiveImportKey(row)) || 0) + 1);

  const rows = incoming.map((rawRow, index): ObjectiveImportPreviewRow => {
    const row = normalizeObjectiveImportRow(rawRow);
    const key = objectiveImportKey(row);
    const current = existingByKey.get(key);
    const owner = requestByIdentifier.get(normalized(row.OwningChangeRequest));
    const issues: ObjectiveImportIssue[] = [];
    for (const column of requiredColumns) if (!row[column]) issues.push({ code: "missing_required", message: `${column} is required.`, blocking: true });
    if (row.Status && !validStatuses.has(row.Status as ObjectiveStatus)) issues.push({ code: "invalid_status", message: `Status '${row.Status}' is not supported.`, blocking: true });
    for (const column of dateColumns) if (!validDate(row[column])) issues.push({ code: "invalid_date", message: `${column} must use YYYY-MM-DD.`, blocking: true });
    if ((keyCounts.get(key) || 0) > 1) issues.push({ code: "duplicate_key", message: "External system and identifier occur more than once in this import.", blocking: true });
    if (row.OwningChangeRequest && !owner) issues.push({ code: "owner_not_found", message: `Owning Change Request '${row.OwningChangeRequest}' was not found.`, blocking: true });
    if (current && owner && current.changeRequestId !== owner.id) issues.push({ code: "owner_change", message: `This would move the Objective from ${requestIdentifierById.get(current.changeRequestId) || current.changeRequestId} to ${owner.externalIdentifier}. Reparenting requires an explicit governed action.`, blocking: true });

    const baseline = current ? rowFromExisting(current, requestIdentifierById.get(current.changeRequestId) || current.changeRequestId) : null;
    const changedFields = baseline ? OBJECTIVE_IMPORT_COLUMNS.filter((column) => normalized(baseline[column]) !== normalized(row[column])) : [...OBJECTIVE_IMPORT_COLUMNS];
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
