import type { TechnicalBaselineRow } from "./technical-baseline-contract.js";

const label = (value: unknown) => String(value ?? "").trim() || "Unassigned";

export const releaseOf = (row: TechnicalBaselineRow) => label(row.ReleaseName);
export const tierOf = (row: TechnicalBaselineRow) => label(row.Tier);

export function matchesSourceScope(row: TechnicalBaselineRow, release: string, tier: string) {
  return (release === "All releases" || releaseOf(row) === release)
    && (tier === "All records" || tierOf(row) === tier);
}
