export type ImportDisposition = "add" | "change" | "unchanged" | "blocked";
export type ImportDecision = "approve" | "skip";

export type ImportFieldChange = {
  field: string;
  before: string;
  after: string;
};

export type ImportTargetOption = {
  id: string;
  label: string;
  detail?: string;
  kind?: string;
};

export type GovernedImportItem = {
  id: string;
  rowNumber: number;
  sourceKey: string;
  title: string;
  detail?: string;
  disposition: ImportDisposition;
  issues: string[];
  changes: ImportFieldChange[];
  proposedTargetId?: string | null;
  proposedTargetLabel?: string | null;
  targetKind?: string | null;
  targetRequired?: boolean;
  defaultDecision: ImportDecision;
};

export type ImportResolution = {
  rowNumber: number;
  sourceKey?: string;
  decision: ImportDecision;
  targetId?: string | null;
};

export type ImportReviewSummary = {
  add: number;
  change: number;
  unchanged: number;
  blocked: number;
  approved: number;
  skipped: number;
};

export function importDecision(item: GovernedImportItem, decisions: Record<string, ImportDecision>) {
  return decisions[item.id] || item.defaultDecision;
}

export function summarizeImportReview(items: GovernedImportItem[], decisions: Record<string, ImportDecision>): ImportReviewSummary {
  return {
    add: items.filter((item) => item.disposition === "add").length,
    change: items.filter((item) => item.disposition === "change").length,
    unchanged: items.filter((item) => item.disposition === "unchanged").length,
    blocked: items.filter((item) => item.disposition === "blocked").length,
    approved: items.filter((item) => item.disposition !== "blocked" && importDecision(item, decisions) === "approve").length,
    skipped: items.filter((item) => item.disposition === "blocked" || importDecision(item, decisions) === "skip").length,
  };
}

export function importResolutions(items: GovernedImportItem[], decisions: Record<string, ImportDecision>, targets: Record<string, string>): ImportResolution[] {
  return items.map((item) => ({
    rowNumber: item.rowNumber,
    sourceKey: item.sourceKey,
    decision: item.disposition === "blocked" ? "skip" : importDecision(item, decisions),
    targetId: Object.prototype.hasOwnProperty.call(targets, item.id) ? targets[item.id] || null : item.proposedTargetId || null,
  }));
}
