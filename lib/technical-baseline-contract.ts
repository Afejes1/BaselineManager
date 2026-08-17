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

export type SourceRow24 = {
  readonly rowNumber: number;
  /** Every contract column is present, including columns whose cell is blank. */
  readonly values: Readonly<Record<TechnicalBaselineColumn, CellValue>>;
  /** Non-contract staging fields are retained separately and never overwrite values. */
  readonly extensions: Readonly<Record<string, CellValue>>;
};

export type ContractIssueCode =
  | "HeaderMismatch" | "WrongColumnCount" | "MissingRowKey" | "DuplicateRowKey"
  | "DuplicateIdentity" | "ConflictingValue";
export type ContractIssue = { code: ContractIssueCode; rowNumber?: number; column?: string; message: string };

export type Reconciliation = {
  added: SourceRow24[];
  unchanged: SourceRow24[];
  changed: Array<{ before: SourceRow24; after: SourceRow24; changedColumns: TechnicalBaselineColumn[] }>;
  conflicts: ContractIssue[];
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

export function validateHeaders(headers: readonly string[]): ContractIssue[] {
  if (headers.length !== TECHNICAL_BASELINE_COLUMNS.length) return [{ code: "HeaderMismatch", message: `Expected exactly ${TECHNICAL_BASELINE_COLUMNS.length} headers.` }];
  const mismatch = headers.findIndex((header, index) => header !== TECHNICAL_BASELINE_COLUMNS[index]);
  return mismatch < 0 ? [] : [{ code: "HeaderMismatch", column: String(mismatch + 1), message: `Header ${mismatch + 1} must be ${TECHNICAL_BASELINE_COLUMNS[mismatch]}.` }];
}

export function validateRows(rows: readonly SourceRow24[]): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const keys = new Map<string, number>();
  const identities = new Map<string, number>();
  for (const row of rows) {
    const key = cleanCell(row.values["#"]);
    if (!key) issues.push({ code: "MissingRowKey", rowNumber: row.rowNumber, column: "#", message: "A retained source row must preserve its # value (blank is allowed only for a new, explicitly governed row)." });
    else if (keys.has(normalizeIdentity(key))) issues.push({ code: "DuplicateRowKey", rowNumber: row.rowNumber, column: "#", message: `Duplicate source row key ${key}.` });
    else keys.set(normalizeIdentity(key), row.rowNumber);
    const identity = deploymentIdentity(row.values);
    if (identity && identities.has(identity)) issues.push({ code: "DuplicateIdentity", rowNumber: row.rowNumber, message: "Rows share the same canonical deployment identity; retain both as source occurrences and review their values." });
    else if (identity) identities.set(identity, row.rowNumber);
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
  const byKey = new Map(existing.map((row) => [normalizeIdentity(cleanCell(row.values["#"])), row]));
  const byIdentity = new Map(existing.filter((row) => deploymentIdentity(row.values)).map((row) => [deploymentIdentity(row.values), row]));
  const used = new Set<SourceRow24>();
  const result: Reconciliation = { added: [], unchanged: [], changed: [], conflicts: [], unmatched: [] };
  for (const after of incoming) {
    const key = normalizeIdentity(cleanCell(after.values["#"]));
    const before = (key && byKey.get(key)) ?? byIdentity.get(deploymentIdentity(after.values));
    if (!before) { result.added.push(after); continue; }
    used.add(before);
    const columns = changedColumns(before, after);
    if (columns.length === 0) result.unchanged.push(after);
    else result.changed.push({ before, after, changedColumns: columns });
  }
  for (const row of existing) if (!used.has(row)) result.unmatched.push(row);
  result.conflicts = validateRows(incoming).filter((issue) => issue.code === "DuplicateRowKey" || issue.code === "DuplicateIdentity");
  return result;
}

export function exactContractValues(row: SourceRow24): readonly CellValue[] {
  return TECHNICAL_BASELINE_COLUMNS.map((column) => row.values[column]);
}
