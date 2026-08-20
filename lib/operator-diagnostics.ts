export type OperatorDiagnostic = { id: string; label: string; status: "pass" | "warning" | "fail"; detail: string };
export type OperatorDiagnostics = {
  generatedAt: string;
  overall: "ready" | "attention" | "blocked";
  applicationVersion: string;
  latestMigration: string | null;
  lastWorkspaceExportAt: string | null;
  counts: { baselineRecords: number; changeRequests: number; objectives: number; initiatives: number; evidenceDocuments: number };
  checks: OperatorDiagnostic[];
};

