import { TECHNICAL_BASELINE_COLUMNS, type TechnicalBaselineRow } from "./technical-baseline-contract.js";

export type ImportReconciliation = {
  added: number;
  changed: number;
  unchanged: number;
  removedFromWorkingProjection: number;
  conflicts: number;
  conflictKeys: string[];
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
  for (const [key, matches] of incomingByKey) {
    if (matches.length > 1) continue;
    const currentMatch = currentByKey.get(key);
    if (!currentMatch?.length) added += 1;
    else if (currentMatch.length > 1 || signature(currentMatch[0]) !== signature(matches[0])) changed += 1;
    else unchanged += 1;
  }
  const removedFromWorkingProjection = [...currentByKey.keys()].filter((key) => !incomingByKey.has(key)).length;
  return { added, changed, unchanged, removedFromWorkingProjection, conflicts: conflictKeys.length, conflictKeys };
}

