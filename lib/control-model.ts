export type ControlQueueItem = { id: string; severity: "blocker" | "warning" | "action" | "ready"; category: string; title: string; detail: string; href: string };
export type ControlSnapshot = {
  generatedAt: string;
  source: { fileName: string | null; receivedAt: string | null; status: string | null; rowCount: number; acceptedCount: number; exceptionCount: number };
  counts: { activeRecords: number; voidedRecords: number; unreviewedRecords: number; acceptedAliases: number; unmappedPlatforms: number; pendingDecisions: number; objectiveGaps: number; deliveryRisks: number; initiativeGaps: number };
  queues: ControlQueueItem[];
};
