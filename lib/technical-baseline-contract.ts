/**
 * Phase 1, workbook-library-neutral contract for the retained Technical
 * Baseline sheet.  This module deliberately deals in cells and row-level
 * facts; XLSX parsing/writing belongs at the application boundary.
 */

export const TECHNICAL_BASELINE_COLUMNS = [
  "#", "ReleaseName", "Tier", "Resource", "TechStackType", "ShortName",
  "HW_Host", "HW_Storage_Type", "HW_Storage (GB)", "HW_CPU_CORES",
  "HW_RAM (GB)", "SW Language", "Software Type", "OEM", "Containerized",
  "Container Technology", "Container Type", "LongName", "Notes",
  "Technical Capability Satisfied by this SW/Tech - Notes", "Notes.1",
  "Notes.2", "Notes.3", "Notes.4",
] as const;

export type TechnicalBaselineColumn = typeof TECHNICAL_BASELINE_COLUMNS[number];
export type CellValue = string | number | boolean | null | undefined;
export type TechnicalBaselineRow = Partial<Record<TechnicalBaselineColumn, CellValue>>;

export type TechnicalBaselineHeaderDiagnostic = {
  valid: boolean;
  expectedColumnCount: number;
  actualColumnCount: number;
  missing: Array<{ name: TechnicalBaselineColumn; expectedPosition: number }>;
  unexpected: Array<{ name: string; actualPosition: number }>;
  mismatches: Array<{ expected: TechnicalBaselineColumn; actual: string; position: number }>;
};

export type SourceRow24 = {
  readonly rowNumber: number;
  /** Every contract column is present, including columns whose cell is blank. */
  readonly values: Readonly<Record<TechnicalBaselineColumn, CellValue>>;
  /** Non-contract staging fields are retained separately and never overwrite values. */
  readonly extensions: Readonly<Record<string, CellValue>>;
};

export type ContractIssueCode =
  | "HeaderMismatch" | "WrongColumnCount" | "MissingRowKey" | "DuplicateRowKey"
  | "DuplicateIdentity" | "ParallelDeployment" | "ConflictingValue";
export type ContractIssue = { code: ContractIssueCode; rowNumber?: number; column?: string; message: string };

export type Reconciliation = {
  added: SourceRow24[];
  unchanged: SourceRow24[];
  changed: Array<{ before: SourceRow24; after: SourceRow24; changedColumns: TechnicalBaselineColumn[] }>;
  conflicts: ContractIssue[];
  /** Valid source occurrences that share a normalized placement. They require review, not rejection. */
  warnings: ContractIssue[];
  unmatched: SourceRow24[];
};

/** Stable, locale-independent display normalization for governed identities. */
export function normalizeIdentity(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function cleanCell(value: unknown): string | undefined {
  const result = String(value ?? "").trim().replace(/\s+/g, " ");
  return result || undefined;
}

/**
 * The retained `#` field identifies a source occurrence, not a global product
 * key. The same application is legitimately represented once in each release,
 * so `Release 5 / #42` and `Release 6 / #42` are distinct baseline facts.
 *
 * Keep this rule next to the 24-column contract so preview reconciliation and
 * server-side materialization cannot disagree about what is a duplicate.
 */
export function sourceOccurrenceKey(row: TechnicalBaselineRow): string | undefined {
  const sourceKey = cleanCell(row["#"]);
  if (!sourceKey) return undefined;
  const release = normalizeIdentity(cleanCell(row.ReleaseName)) || "unassigned-release";
  return `${release}|source:${normalizeIdentity(sourceKey)}`;
}

/** Numeric conversion intentionally preserves the distinction between blank and zero. */
export function numericCell(value: CellValue): number | undefined {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return undefined;
  const result = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(result) ? result : undefined;
}

export function booleanCell(value: CellValue): boolean | undefined {
  const key = normalizeIdentity(value);
  if (["yes", "true", "1", "y"].includes(key)) return true;
  if (["no", "false", "0", "n"].includes(key)) return false;
  return undefined;
}

export function sourceRow24(row: TechnicalBaselineRow & Record<string, CellValue>, rowNumber: number): SourceRow24 {
  const values = Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, row[column]])) as Record<TechnicalBaselineColumn, CellValue>;
  const extensions = Object.fromEntries(Object.entries(row).filter(([key]) => !(TECHNICAL_BASELINE_COLUMNS as readonly string[]).includes(key)));
  return { rowNumber, values, extensions };
}

export function rowFromCells(cells: readonly CellValue[], rowNumber: number): SourceRow24 {
  const values = Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column, index) => [column, cells[index]])) as Record<TechnicalBaselineColumn, CellValue>;
  return { rowNumber, values, extensions: {} };
}

/**
 * The exchange must retain its exact 24-column shape, but an operator needs a
 * useful explanation when an upstream export adds a field such as CSCI.  Keep
 * the comparison intentionally exact: aliases and reordered columns are not
 * silently accepted into a controlled baseline.
 */
export function diagnoseTechnicalBaselineHeaders(headers: readonly unknown[]): TechnicalBaselineHeaderDiagnostic {
  const actual = headers.map((header) => String(header ?? "").trim());
  const expected = TECHNICAL_BASELINE_COLUMNS as readonly string[];
  const missing = TECHNICAL_BASELINE_COLUMNS
    .map((name, index) => ({ name, expectedPosition: index + 1 }))
    .filter((item) => !actual.includes(item.name));
  const unexpected = actual
    .map((name, index) => ({ name, actualPosition: index + 1 }))
    .filter((item) => !expected.includes(item.name));
  const mismatches = TECHNICAL_BASELINE_COLUMNS
    .map((expectedName, index) => ({ expected: expectedName, actual: actual[index] ?? "", position: index + 1 }))
    .filter((item) => item.actual !== item.expected);
  return {
    valid: actual.length === TECHNICAL_BASELINE_COLUMNS.length && mismatches.length === 0,
    expectedColumnCount: TECHNICAL_BASELINE_COLUMNS.length,
    actualColumnCount: actual.length,
    missing,
    unexpected,
    mismatches,
  };
}

export function describeTechnicalBaselineHeaderIssue(headers: readonly unknown[]): string {
  const diagnostic = diagnoseTechnicalBaselineHeaders(headers);
  if (diagnostic.valid) return "";
  const details: string[] = [];
  if (diagnostic.actualColumnCount !== diagnostic.expectedColumnCount) {
    details.push(`Found ${diagnostic.actualColumnCount} columns; the A2O Tech Stack exchange requires ${diagnostic.expectedColumnCount}.`);
  }
  if (diagnostic.unexpected.length) {
    details.push(`Unexpected column${diagnostic.unexpected.length === 1 ? "" : "s"}: ${diagnostic.unexpected.map((item) => `${item.name || "(blank)"} (column ${item.actualPosition})`).join(", ")}.`);
  }
  if (diagnostic.missing.length) {
    details.push(`Missing required column${diagnostic.missing.length === 1 ? "" : "s"}: ${diagnostic.missing.map((item) => `${item.name} (column ${item.expectedPosition})`).join(", ")}.`);
  }
  const firstOrderMismatch = diagnostic.mismatches.find((item) => item.actual && !diagnostic.unexpected.some((unexpected) => unexpected.actualPosition === item.position));
  if (firstOrderMismatch) {
    details.push(`Column ${firstOrderMismatch.position} is ${firstOrderMismatch.actual}, but must be ${firstOrderMismatch.expected}.`);
  }
  return `${details.join(" ")} No data was imported. Use a working copy to restore the exact 24-column exchange order; retain the original supplier or contractor file unchanged.`;
}

export function validateHeaders(headers: readonly string[]): ContractIssue[] {
  const diagnostic = diagnoseTechnicalBaselineHeaders(headers);
  if (diagnostic.valid) return [];
  const mismatch = diagnostic.mismatches[0];
  return [{ code: "HeaderMismatch", column: mismatch ? String(mismatch.position) : undefined, message: describeTechnicalBaselineHeaderIssue(headers) }];
}

export function validateRows(rows: readonly SourceRow24[]): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const keys = new Map<string, number>();
  const identities = new Map<string, { rowNumber: number; occurrenceKey: string | undefined }>();
  for (const row of rows) {
    const key = cleanCell(row.values["#"]);
    const occurrenceKey = sourceOccurrenceKey(row.values);
    // A blank # is permitted by the exchange. In that case, the placement
    // identity below is the available duplicate check. A populated # is only
    // unique within a ReleaseName, not across the whole workbook.
    if (key && occurrenceKey && keys.has(occurrenceKey)) {
      const release = cleanCell(row.values.ReleaseName) || "unassigned release";
      issues.push({ code: "DuplicateRowKey", rowNumber: row.rowNumber, column: "#", message: `Duplicate A2O # value ${key} in ${release}; it first appears on row ${keys.get(occurrenceKey)}.` });
    } else if (occurrenceKey) keys.set(occurrenceKey, row.rowNumber);
    const identity = deploymentIdentity(row.values);
    const firstIdentity = identity ? identities.get(identity) : undefined;
    if (identity && firstIdentity) {
      // A2O is a denormalized exchange. Multiple source rows can legitimately
      // describe the same Product/host placement when their source keys differ.
      // Keep those facts independently traceable. Only an indistinguishable
      // placement with no source key remains unsafe to apply automatically.
      if (occurrenceKey && firstIdentity.occurrenceKey && occurrenceKey !== firstIdentity.occurrenceKey) {
        issues.push({ code: "ParallelDeployment", rowNumber: row.rowNumber, message: `Shares a normalized deployment placement with row ${firstIdentity.rowNumber}, but has a distinct A2O source key. Both rows will be retained for review.` });
      } else if (!occurrenceKey || !firstIdentity.occurrenceKey || occurrenceKey !== firstIdentity.occurrenceKey) {
        issues.push({ code: "DuplicateIdentity", rowNumber: row.rowNumber, message: `Shares a normalized deployment placement with row ${firstIdentity.rowNumber} and has no distinct A2O source key.` });
      }
    } else if (identity) identities.set(identity, { rowNumber: row.rowNumber, occurrenceKey });
  }
  return issues;
}

export type RowIdentities = { release: string; tier: string; resource: string; host: string; product: string; environment: string; site: string; deployment: string };

export function rowIdentities(row: TechnicalBaselineRow): RowIdentities {
  const release = normalizeIdentity(row.ReleaseName);
  const tier = normalizeIdentity(row.Tier);
  const resource = normalizeIdentity(row.Resource);
  const host = normalizeIdentity(row.HW_Host);
  const product = normalizeIdentity(cleanCell(row.LongName) ?? cleanCell(row.ShortName));
  // Environment and Site are optional staging extensions used by V2 sources;
  // including them avoids merging two legitimate placements at one host.
  const extensions = row as TechnicalBaselineRow & Record<string, CellValue>;
  const environment = normalizeIdentity(extensions.Environment);
  const site = normalizeIdentity(extensions.Site);
  return { release, tier, resource, host, product, environment, site, deployment: [release, tier, resource, host, environment, site, product].join("|") };
}

export function deploymentIdentity(row: TechnicalBaselineRow): string {
  const identity = rowIdentities(row);
  return identity.product ? identity.deployment : "";
}

function sameCell(left: CellValue, right: CellValue): boolean {
  // Do not coerce blank, zero, false, or the string "0" into one another.
  return left === right;
}

function changedColumns(before: SourceRow24, after: SourceRow24): TechnicalBaselineColumn[] {
  return TECHNICAL_BASELINE_COLUMNS.filter((column) => !sameCell(before.values[column], after.values[column]));
}

/** Deterministically reconcile source occurrences by #, then canonical identity. */
export function reconcileRows(existing: readonly SourceRow24[], incoming: readonly SourceRow24[]): Reconciliation {
  const byKey = new Map(existing.flatMap((row) => {
    const key = sourceOccurrenceKey(row.values);
    return key ? [[key, row] as const] : [];
  }));
  const byIdentity = new Map(existing.filter((row) => deploymentIdentity(row.values)).map((row) => [deploymentIdentity(row.values), row]));
  const used = new Set<SourceRow24>();
  const result: Reconciliation = { added: [], unchanged: [], changed: [], conflicts: [], warnings: [], unmatched: [] };
  for (const after of incoming) {
    const key = sourceOccurrenceKey(after.values);
    // A populated A2O source key is the occurrence identity. Do not silently
    // collapse a new source fact into an existing record merely because both
    // rows normalize to the same Product/host placement.
    const before = key ? byKey.get(key) : byIdentity.get(deploymentIdentity(after.values));
    if (!before) { result.added.push(after); continue; }
    used.add(before);
    const columns = changedColumns(before, after);
    if (columns.length === 0) result.unchanged.push(after);
    else result.changed.push({ before, after, changedColumns: columns });
  }
  for (const row of existing) if (!used.has(row)) result.unmatched.push(row);
  const issues = validateRows(incoming);
  result.conflicts = issues.filter((issue) => issue.code === "DuplicateRowKey" || issue.code === "DuplicateIdentity");
  result.warnings = issues.filter((issue) => issue.code === "ParallelDeployment");
  return result;
}

export function exactContractValues(row: SourceRow24): readonly CellValue[] {
  return TECHNICAL_BASELINE_COLUMNS.map((column) => row.values[column]);
}
