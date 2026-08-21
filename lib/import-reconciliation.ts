import { TECHNICAL_BASELINE_COLUMNS, type TechnicalBaselineRow } from "./technical-baseline-contract.js";

export type ImportReconciliation = {
  added: number;
  changed: number;
  unchanged: number;
  removedFromWorkingProjection: number;
  conflicts: number;
  conflictKeys: string[];
  rows: ImportReconciliationRow[];
};

export type ImportReconciliationRow = {
  rowNumber: number;
  identity: string;
  row: TechnicalBaselineRow;
  disposition: "add" | "change" | "unchanged" | "blocked";
  issues: string[];
  changes: Array<{ field: string; before: string; after: string }>;
};

const clean = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

export function intakeIdentity(row: TechnicalBaselineRow) {
  const release = clean(row.ReleaseName) || "unassigned-release";
  const sourceKey = clean(row["#"]);
  if (sourceKey) return `${release}|source:${sourceKey}`;
  return `${release}|semantic:${[row.LongName || row.ShortName, row.Tier, row.Resource, row.HW_Host].map(clean).join("|")}`;
}

function signature(row: TechnicalBaselineRow) {
  return JSON.stringify(TECHNICAL_BASELINE_COLUMNS.map((column) => String(row[column] ?? "")));
}

function indexRows(rows: TechnicalBaselineRow[]) {
  const byKey = new Map<string, TechnicalBaselineRow[]>();
  for (const row of rows) { const key = intakeIdentity(row); byKey.set(key, [...(byKey.get(key) || []), row]); }
  return byKey;
}

export function reconcileIntake(current: TechnicalBaselineRow[], incoming: TechnicalBaselineRow[]): ImportReconciliation {
  const currentByKey = indexRows(current);
  const incomingByKey = indexRows(incoming);
  const conflictKeys = [...incomingByKey.entries()].filter(([, matches]) => matches.length > 1).map(([key]) => key);
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  const rows: ImportReconciliationRow[] = [];
  for (const [key, matches] of incomingByKey) {
    if (matches.length > 1) {
      for (const row of matches) rows.push({ rowNumber: incoming.indexOf(row) + 2, identity: key, row, disposition: "blocked", issues: [`${key} occurs more than once in this workbook.`], changes: [] });
      continue;
    }
    const row = matches[0];
    const currentMatch = currentByKey.get(key);
    if (!currentMatch?.length) { added += 1; rows.push({ rowNumber: incoming.indexOf(row) + 2, identity: key, row, disposition: "add", issues: [], changes: TECHNICAL_BASELINE_COLUMNS.filter((column) => String(row[column] ?? "")).map((column) => ({ field: column, before: "", after: String(row[column] ?? "") })) }); }
    else if (currentMatch.length > 1) rows.push({ rowNumber: incoming.indexOf(row) + 2, identity: key, row, disposition: "blocked", issues: [`${key} matches more than one current baseline record.`], changes: [] });
    else if (signature(currentMatch[0]) !== signature(row)) { changed += 1; rows.push({ rowNumber: incoming.indexOf(row) + 2, identity: key, row, disposition: "change", issues: [], changes: TECHNICAL_BASELINE_COLUMNS.filter((column) => String(currentMatch[0][column] ?? "") !== String(row[column] ?? "")).map((column) => ({ field: column, before: String(currentMatch[0][column] ?? ""), after: String(row[column] ?? "") })) }); }
    else { unchanged += 1; rows.push({ rowNumber: incoming.indexOf(row) + 2, identity: key, row, disposition: "unchanged", issues: [], changes: [] }); }
  }
  const removedFromWorkingProjection = [...currentByKey.keys()].filter((key) => !incomingByKey.has(key)).length;
  return { added, changed, unchanged, removedFromWorkingProjection, conflicts: conflictKeys.length, conflictKeys, rows: rows.sort((left, right) => left.rowNumber - right.rowNumber) };
}
