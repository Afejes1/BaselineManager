export type GovernmentPriority = "unranked" | "low" | "medium" | "high" | "critical";
export type FundingDecision = "pending" | "fund" | "defer" | "decline";
export type ChangeRequestReferenceStatus = "active" | "closed" | "superseded";
export type ChangeSubjectKind = "product" | "platform" | "configuration_node" | "occurrence" | "release" | "organization";
export type ChangeAction = "add" | "remove" | "move" | "modify" | "assess";
export type DependencyType = "requires" | "enables" | "blocks" | "conflicts" | "overlaps";
export type NarrativeAuthority = "reported" | "analyst_transcribed" | "migrated_unclassified";

export type ChangeRequestType = { id: string; code: string; label: string; description: string | null; active: boolean; sortOrder: number };
export type ChangeRequest = {
  id: string;
  typeId: string;
  typeCode: string;
  typeLabel: string;
  externalSystem: string | null;
  externalIdentifier: string;
  title: string;
  externalStatus: string | null;
  externalOwner: string | null;
  sourceLocator: string | null;
  sourceAsOf: string | null;
  requestedReleaseId: string | null;
  requestedReleaseName: string | null;
  governmentPriority: GovernmentPriority;
  decisionStatus: FundingDecision;
  decisionAuthority: string | null;
  decisionAt: string | null;
  decisionRationale: string | null;
  referenceStatus: ChangeRequestReferenceStatus;
  lifecycleRationale: string | null;
  summary: string | null;
  sourceDescription: string | null;
  governmentSynopsis: string | null;
  descriptionAuthority: NarrativeAuthority;
  consequenceIfFunded: string | null;
  consequenceIfDeferred: string | null;
  impactSummary: string | null;
  knockOnEffects: string | null;
  updatedAt: string;
};
export type ChangeEffect = {
  id: string;
  changeRequestId: string;
  subjectKind: ChangeSubjectKind;
  subjectId: string;
  subjectLabel: string;
  action: ChangeAction;
  aspect: string;
  fromReleaseId: string | null;
  fromReleaseName: string | null;
  toReleaseId: string | null;
  toReleaseName: string | null;
  currentValue: string | null;
  targetValue: string | null;
  consequence: string | null;
  rationale: string | null;
  confidence: "reported" | "assessed" | "confirmed";
  sourceOccurrenceId: string | null;
};
export type ChangeDependency = {
  id: string;
  predecessorRequestId: string;
  successorRequestId: string;
  dependencyType: DependencyType;
  rationale: string | null;
  consequenceIfUnmet: string | null;
  owner: string | null;
  confidence: "reported" | "assessed" | "confirmed";
  sourceReference: string | null;
  sourceAsOf: string | null;
};

export function dependencyStatement(dependency: Pick<ChangeDependency, "dependencyType">, predecessor: string, successor: string) {
  if (dependency.dependencyType === "requires") return `${successor} requires ${predecessor}.`;
  if (dependency.dependencyType === "enables") return `${predecessor} enables ${successor}.`;
  if (dependency.dependencyType === "blocks") return `${predecessor} blocks ${successor}.`;
  if (dependency.dependencyType === "conflicts") return `${predecessor} conflicts with ${successor}.`;
  return `${predecessor} overlaps ${successor}.`;
}
export type ChangePortfolio = {
  types: ChangeRequestType[];
  requests: ChangeRequest[];
  effects: ChangeEffect[];
  dependencies: ChangeDependency[];
  releases: Array<{ id: string; name: string }>;
  subjects: Array<{ kind: ChangeSubjectKind; id: string; label: string }>;
};
