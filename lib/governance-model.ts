export const initiativeStatuses = ["draft", "active", "decision_required", "closed"] as const;
export const initiativePriorities = ["low", "medium", "high", "critical"] as const;
export const workPackageStatuses = ["planned", "in_progress", "on_hold", "complete"] as const;
export const governanceRecordTypes = ["mcp", "technical_call", "decision", "risk", "question", "technical_note"] as const;
export const governanceRecordStatuses = ["open", "in_review", "approved", "closed", "superseded"] as const;
export const briefStatuses = ["draft", "reviewed", "published", "superseded"] as const;

export type InitiativeStatus = typeof initiativeStatuses[number];
export type InitiativePriority = typeof initiativePriorities[number];
export type WorkPackageStatus = typeof workPackageStatuses[number];
export type GovernanceRecordType = typeof governanceRecordTypes[number];
export type GovernanceRecordStatus = typeof governanceRecordStatuses[number];
export type BriefStatus = typeof briefStatuses[number];

export type ScopeLink = {
  id: string;
  scopeKind: "product" | "release" | "capability" | "occurrence" | "configuration_node";
  scopeId: string;
  displayLabel: string | null;
};

export type WorkPackage = {
  id: string;
  initiativeId: string | null;
  changeRequestId: string | null;
  objectiveId: string | null;
  parentId: string | null;
  wbsCode: string;
  title: string;
  owner: string | null;
  plannedStart: string | null;
  dueDate: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  status: WorkPackageStatus;
  definitionOfDone: string | null;
  progressBasis: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkPackageDependency = {
  id: string;
  predecessorWorkPackageId: string;
  successorWorkPackageId: string;
  relationship: "FS" | "SS" | "FF" | "SF";
  lagDays: number;
  status: "proposed" | "accepted" | "rejected" | "retired";
  rationale: string;
  sourceReference: string | null;
  updatedAt: string;
};

export type Initiative = {
  id: string;
  title: string;
  status: InitiativeStatus;
  priority: InitiativePriority;
  owner: string | null;
  targetDate: string | null;
  consequence: string | null;
  desiredOutcome: string | null;
  decisionAsk: string | null;
  primaryReleaseId: string | null;
  primaryReleaseName: string | null;
  scope: ScopeLink[];
  workPackages: WorkPackage[];
  linkedRecordCount: number;
  createdAt: string;
  updatedAt: string;
};

export type GovernanceLink = {
  id: string;
  entityKind: "initiative" | "work_package" | "release" | "product" | "capability" | "occurrence" | "configuration_node";
  entityId: string;
  relationship: string;
  displayLabel: string | null;
};

export type EvidenceDocument = {
  id: string;
  governanceRecordId: string | null;
  initiativeId: string | null;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  description: string | null;
  createdAt: string;
};

export type GovernanceRecord = {
  id: string;
  recordType: GovernanceRecordType;
  externalReference: string | null;
  title: string;
  status: GovernanceRecordStatus;
  owner: string | null;
  occurredAt: string | null;
  dueDate: string | null;
  summary: string | null;
  decisionAsk: string | null;
  impact: string | null;
  links: GovernanceLink[];
  documents: EvidenceDocument[];
  createdAt: string;
  updatedAt: string;
};

export type BriefSnapshot = {
  asOf: string;
  releaseName: string;
  sourceRows: number;
  products: number;
  releases: number;
  reviewRows: number;
  productNames: string[];
  linkedRecords: Array<{ type: string; title: string; status: string }>;
};

export type ExecutiveBrief = {
  id: string;
  initiativeId: string | null;
  initiativeTitle: string | null;
  title: string;
  status: BriefStatus;
  notes: string | null;
  snapshot: BriefSnapshot;
  bodyMarkdown: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivityEvent = {
  id: string;
  action: string;
  entityKind: string;
  entityId: string;
  actorName: string;
  createdAt: string;
};

export type IntakePackage = {
  id: string;
  fileName: string;
  sheetName: string | null;
  receivedAt: string;
  status: string;
  rowCount: number;
  acceptedCount: number;
  exceptionCount: number;
  releaseCount: number;
  active: boolean;
};

export type Portfolio = {
  actor: { id: string; displayName: string; role: "steward" | "editor" | "viewer" };
  initiatives: Initiative[];
  workPackages: WorkPackage[];
  workPackageDependencies: WorkPackageDependency[];
  records: GovernanceRecord[];
  briefs: ExecutiveBrief[];
  activity: ActivityEvent[];
};

export const displayStatus = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
