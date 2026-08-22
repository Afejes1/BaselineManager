import type { ChangePortfolio, ChangeRequest } from "./change-model.js";

export type InitiativeChangeRelationship = "delivers" | "enables" | "constrains" | "supports";
export type ObjectiveStatus = "proposed" | "planned" | "in_progress" | "blocked" | "verification" | "complete" | "cancelled";
export type ObjectiveDependencyRelationship = "requires" | "enables" | "blocks" | "consumes";
export type ObjectiveDependencyStatus = "proposed" | "accepted" | "rejected" | "retired";
export type ObjectiveAttribution = "primary" | "contributing" | "uncertain";
export type ObjectiveAttributionConfidence = "unassessed" | "low" | "medium" | "high";
export type EstimateSource = "incumbent" | "government" | "independent";
export type EstimateConfidence = "unassessed" | "low" | "medium" | "high";
export type RequirementAction = "add" | "modify" | "retire" | "verify" | "none";
export type RequirementTraceStatus = "identified" | "analysis_needed" | "traced" | "verified" | "not_applicable";
export type AcceptanceTier = "tier_3" | "tier_4" | "other";
export type VerificationMethod = "analysis" | "demonstration" | "inspection" | "test" | "review";
export type AcceptanceStatus = "draft" | "ready" | "in_verification" | "passed" | "failed" | "waived";
export type SignoffDecision = "pending" | "accepted" | "rejected" | "waived";
export type MilestoneType = "decision" | "delivery" | "verification" | "fielding" | "dependency";
export type MilestoneStatus = "planned" | "at_risk" | "complete" | "missed";

export type InitiativeDecisionProfile = {
  id: string;
  title: string;
  status: string;
  priority: string;
  owner: string | null;
  targetDate: string | null;
  consequence: string | null;
  desiredOutcome: string | null;
  decisionAsk: string | null;
  asIsStatement: string | null;
  toBeStatement: string | null;
  successMeasures: string | null;
  briefingAudience: string | null;
  decisionNeededBy: string | null;
  primaryReleaseId: string | null;
  primaryReleaseName: string | null;
  updatedAt: string;
};

export type InitiativeChangeLink = {
  id: string;
  initiativeId: string;
  changeRequestId: string;
  relationship: InitiativeChangeRelationship;
  contributionSummary: string | null;
  sortOrder: number;
};

export type ObjectiveEstimate = {
  id: string;
  objectiveId: string;
  estimateSource: EstimateSource;
  hoursLow: number | null;
  hoursLikely: number | null;
  hoursHigh: number | null;
  costLow: number | null;
  costLikely: number | null;
  costHigh: number | null;
  basis: string;
  assumptions: string | null;
  sourceReference: string | null;
  asOf: string;
  confidence: EstimateConfidence;
  createdAt: string;
};

export type IncumbentObjective = {
  id: string;
  /**
   * Legacy/direct accountable Change Request.  Lockheed source items may be
   * reported before an analyst can establish a single accountable package.
   * Those references live in ObjectiveChangeRequestLink instead of forcing a
   * fabricated owner.
   */
  changeRequestId: string | null;
  externalSystem: string;
  externalIdentifier: string;
  externalItemType?: string;
  title: string;
  summary: string | null;
  technicalOwner: string | null;
  status: ObjectiveStatus;
  plannedStart: string | null;
  plannedFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  sourceLocator: string | null;
  sourceAsOf: string | null;
  estimates: ObjectiveEstimate[];
  updatedAt: string;
};

/** A hard, traceable Change Request reference on an Objective. */
export type ObjectiveChangeRequestLink = {
  id: string;
  objectiveId: string;
  changeRequestId: string;
  relationship: "primary" | "reported" | "related";
  sourceSystem: string | null;
  sourceLocator: string | null;
  sourceAsOf: string | null;
  updatedAt: string;
};

export type ChangeRequestObjectiveDependency = {
  id: string;
  dependentChangeRequestId: string;
  prerequisiteObjectiveId: string;
  relationship: ObjectiveDependencyRelationship;
  status: ObjectiveDependencyStatus;
  rationale: string;
  sourceReference: string | null;
  sourceAsOf: string | null;
  evidenceReference: string | null;
  updatedAt: string;
};

export type ObjectiveEffectAttributionRecord = {
  id: string;
  objectiveId: string;
  changeEffectId: string;
  attribution: ObjectiveAttribution;
  rationale: string;
  sourceReference: string | null;
  sourceAsOf: string | null;
  evidenceReference: string | null;
  confidence: ObjectiveAttributionConfidence;
  updatedAt: string;
};

export type RequirementTrace = {
  id: string;
  objectiveId: string;
  /** Canonical reusable requirement identity. */
  requirementId?: string;
  /** Version/change relationship, not a new requirement identity. */
  versionLabel?: string;
  externalIdentifier: string;
  title: string;
  sourceSystem: string;
  sourceLocator: string | null;
  sourceAsOf: string | null;
  changeAction: RequirementAction;
  beforeText: string | null;
  afterText: string | null;
  rationale: string | null;
  traceStatus: RequirementTraceStatus;
  updatedAt: string;
};

export type AcceptanceSignoff = {
  id: string;
  criterionId: string;
  signoffRole: string;
  signer: string | null;
  decision: SignoffDecision;
  decidedAt: string | null;
  rationale: string | null;
  evidenceDocumentId: string | null;
  updatedAt: string;
};

export type AcceptanceCriterion = {
  id: string;
  objectiveId: string;
  requirementTraceId: string | null;
  tier: AcceptanceTier;
  code: string;
  statement: string;
  verificationMethod: VerificationMethod;
  status: AcceptanceStatus;
  plannedDate: string | null;
  actualDate: string | null;
  evidenceReference: string | null;
  signoffs: AcceptanceSignoff[];
  updatedAt: string;
};

export type InitiativeMilestone = {
  id: string;
  initiativeId: string;
  changeRequestId: string | null;
  objectiveId: string | null;
  title: string;
  milestoneType: MilestoneType;
  plannedDate: string;
  actualDate: string | null;
  status: MilestoneStatus;
  consequenceIfMissed: string | null;
  owner: string | null;
  sortOrder: number;
  updatedAt: string;
};

export type ReadinessFinding = {
  id: string;
  severity: "blocker" | "warning" | "information";
  category: "decision" | "traceability" | "acceptance" | "estimate" | "schedule" | "evidence";
  title: string;
  detail: string;
  subjectKind: "initiative" | "change_request" | "objective" | "requirement" | "criterion" | "milestone";
  subjectId: string;
};

export type InitiativeAssessment = {
  stage: "not_ready" | "analysis_incomplete" | "decision_ready";
  score: number;
  blockers: number;
  warnings: number;
  decisionsPending: number;
  requirementsTraced: number;
  criteriaPassed: number;
  findings: ReadinessFinding[];
};

export type InitiativeDecisionWorkspace = {
  actor: { id: string; displayName: string; role: "steward" | "editor" | "viewer" };
  initiatives: InitiativeDecisionProfile[];
  links: InitiativeChangeLink[];
  objectives: IncumbentObjective[];
  /** Reported and analyst-confirmed Objective ↔ Change Request references. */
  objectiveChangeRequestLinks?: ObjectiveChangeRequestLink[];
  /** Optional for backwards-compatible consumers of the decision bundle. */
  objectiveDependencies?: ChangeRequestObjectiveDependency[];
  objectiveEffectAttributions?: ObjectiveEffectAttributionRecord[];
  requirements: RequirementTrace[];
  criteria: AcceptanceCriterion[];
  milestones: InitiativeMilestone[];
  changes: ChangePortfolio;
  assessments: Record<string, InitiativeAssessment>;
};

export type InitiativeDecisionBundle = {
  initiative: InitiativeDecisionProfile;
  links: InitiativeChangeLink[];
  changeRequests: ChangeRequest[];
  objectives: IncumbentObjective[];
  objectiveChangeRequestLinks?: ObjectiveChangeRequestLink[];
  objectiveDependencies?: ChangeRequestObjectiveDependency[];
  objectiveEffectAttributions?: ObjectiveEffectAttributionRecord[];
  requirements: RequirementTrace[];
  criteria: AcceptanceCriterion[];
  milestones: InitiativeMilestone[];
  changes: ChangePortfolio;
};

export const tierLabel = (value: AcceptanceTier) => value === "tier_3" ? "Tier 3" : value === "tier_4" ? "Tier 4" : "Other";
export const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/**
 * Returns every governed Change Request relationship for an external Objective.
 * The direct field is retained for an explicitly established accountable owner;
 * source-reported JPO/MCP values are hard links and must participate in
 * traceability without silently becoming Government ownership.
 */
export function objectiveRelatedChangeRequestIds(
  objective: Pick<IncumbentObjective, "id" | "changeRequestId">,
  links: readonly Pick<ObjectiveChangeRequestLink, "objectiveId" | "changeRequestId">[] = [],
) {
  return [...new Set([objective.changeRequestId, ...links.filter((link) => link.objectiveId === objective.id).map((link) => link.changeRequestId)].filter((value): value is string => Boolean(value)))];
}

export function objectiveIsRelatedToChangeRequest(
  objective: Pick<IncumbentObjective, "id" | "changeRequestId">,
  changeRequestId: string,
  links: readonly Pick<ObjectiveChangeRequestLink, "objectiveId" | "changeRequestId">[] = [],
) {
  return objectiveRelatedChangeRequestIds(objective, links).includes(changeRequestId);
}

export function selectInitiativeBundle(workspace: InitiativeDecisionWorkspace, initiativeId: string): InitiativeDecisionBundle | null {
  const initiative = workspace.initiatives.find((item) => item.id === initiativeId);
  if (!initiative) return null;
  const links = workspace.links.filter((item) => item.initiativeId === initiativeId);
  const requestIds = new Set(links.map((item) => item.changeRequestId));
  const objectiveChangeRequestLinks = workspace.objectiveChangeRequestLinks ?? [];
  const objectives = workspace.objectives.filter((item) => objectiveRelatedChangeRequestIds(item, objectiveChangeRequestLinks).some((requestId) => requestIds.has(requestId)));
  const objectiveIds = new Set(objectives.map((item) => item.id));
  return { initiative, links, changeRequests: workspace.changes.requests.filter((item) => requestIds.has(item.id)), objectives, objectiveChangeRequestLinks: objectiveChangeRequestLinks.filter((link) => objectiveIds.has(link.objectiveId)), objectiveDependencies: (workspace.objectiveDependencies ?? []).filter((item) => requestIds.has(item.dependentChangeRequestId) || objectiveIds.has(item.prerequisiteObjectiveId)), objectiveEffectAttributions: (workspace.objectiveEffectAttributions ?? []).filter((item) => objectiveIds.has(item.objectiveId)), requirements: workspace.requirements.filter((item) => objectiveIds.has(item.objectiveId)), criteria: workspace.criteria.filter((item) => objectiveIds.has(item.objectiveId)), milestones: workspace.milestones.filter((item) => item.initiativeId === initiativeId), changes: workspace.changes };
}
