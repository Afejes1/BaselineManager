import { booleanCell, numericCell, type TechnicalBaselineColumn, type TechnicalBaselineRow } from "./technical-baseline-contract.js";

export type QualityLevel = "ready" | "review" | "issue";
export type QualityLabel = "Pass" | "Warning" | "Blocking";
export type QualityIssue = {
  severity: "review" | "blocking";
  field: TechnicalBaselineColumn;
  message: string;
};
export type DataQuality = { level: QualityLevel; label: QualityLabel; issues: QualityIssue[] };

const present = (value: unknown) => String(value ?? "").trim().length > 0;

export function dataQualityFor(row: TechnicalBaselineRow): DataQuality {
  const issues: QualityIssue[] = [];
  const add = (severity: QualityIssue["severity"], field: TechnicalBaselineColumn, message: string) => issues.push({ severity, field, message });
  const hasProduct = present(row.LongName) || present(row.ShortName);
  const hasHost = present(row.HW_Host);

  if (!present(row["#"])) add("blocking", "#", "A source-record key is required.");
  if (!present(row.ReleaseName)) add("blocking", "ReleaseName", "Choose the release baseline for this source occurrence.");
  if (!hasProduct && !hasHost) add("blocking", "LongName", "Provide a product name or HW_Host so the row can be materialized.");

  if (hasProduct && !present(row.LongName)) add("review", "LongName", "Add the canonical product name; ShortName is treated as an alias.");
  if ((hasProduct || hasHost) && !present(row.Tier)) add("review", "Tier", "Assign the configuration tier.");
  if ((hasProduct || hasHost) && !present(row.Resource)) add("review", "Resource", "Assign the platform or resource beneath the tier.");
  if (present(row["HW_Storage (GB)"]) && !present(row.HW_Storage_Type)) add("review", "HW_Storage_Type", `Storage capacity is ${String(row["HW_Storage (GB)"]).trim()} GB, but Storage type is blank.`);
  if (booleanCell(row.Containerized) === true && !present(row["Container Technology"])) add("review", "Container Technology", "Identify the technology used by this containerized deployment.");

  for (const field of ["HW_Storage (GB)", "HW_CPU_CORES", "HW_RAM (GB)"] as const) {
    if (present(row[field]) && numericCell(row[field]) === undefined) add("review", field, "Use a numeric value or leave this field blank.");
  }

  const level: QualityLevel = issues.some((issue) => issue.severity === "blocking") ? "issue" : issues.length ? "review" : "ready";
  const label: QualityLabel = level === "ready" ? "Pass" : level === "review" ? "Warning" : "Blocking";
  return { level, label, issues };
}
