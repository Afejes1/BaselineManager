import { TECHNICAL_BASELINE_COLUMNS, type TechnicalBaselineRow } from "./technical-baseline-contract";

// This digest is generated from the built-in demonstration workbook rows in
// app/baseline-manager.tsx, preserving column order and primitive value types.
// The server compares the complete dataset before authorizing the only import
// operation that may replace the active baseline.
export const DEMONSTRATION_DATASET_SHA256 = "ace260f98b27fffaac3385d0250a6e672692cdf97e6d7b1f889155fce0e0401e";
export const DEMONSTRATION_DATASET_ROW_COUNT = 75;

export function canonicalDemonstrationRows(rows: readonly TechnicalBaselineRow[]) {
  const taggedCell = (value: TechnicalBaselineRow[keyof TechnicalBaselineRow]) => value === undefined
    ? ["undefined"]
    : value === null
      ? ["null"]
      : [typeof value, value];
  return JSON.stringify(rows.map((row) => TECHNICAL_BASELINE_COLUMNS.map((column) => taggedCell(row[column]))));
}

export async function demonstrationRowsAreAttested(rows: readonly TechnicalBaselineRow[]) {
  if (rows.length !== DEMONSTRATION_DATASET_ROW_COUNT) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalDemonstrationRows(rows)));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex === DEMONSTRATION_DATASET_SHA256;
}
