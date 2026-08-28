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
export type SolutionOptionType = "candidate" | "status_quo";
export type SolutionOptionStatus = "draft" | "under_review" | "recommended" | "not_selected" | "retired";
export type SolutionObjectiveRole = "required" | "enabling" | "optional";
export type SolutionAssessmentCriterion = "outcome_alignment" | "delivery_effort" | "schedule_feasibility" | "cyber_lifecycle" | "mission_operational_impact" | "stakeholder_impact" | "requirements_acceptance";
export type SolutionAssessmentRating = "favorable" | "mixed" | "unfavorable" | "unassessed";
export type SolutionDecisionDisposition = "pending" | "selected" | "deferred" | "no_action";
export type InitiativeLifecycle = "draft" | "in_analysis" | "decision_ready" | "decided" | "closed";
export type SolutionKnockOnClassification = "benefit" | "risk" | "constraint" | "dependency" | "second_order_effect";
export type SolutionStepReferenceKind = "change_request" | "objective" | "jira" | "confluence" | "other";
export type SolutionStepDependencyType = "FS" | "SS" | "FF" | "SF";

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
  decisionQuestion: string | null;
  /** Government-authored present condition; distinct from source claims. */
  problemStatement: string | null;
  /** Known boundaries or drivers, not uncertain risks. */
  driversConstraints: string | null;
  /** Government planning assumption; it does not alter the Lockheed source ROM. */
  romHoursPerPoint: number;
  romConversionRationale: string | null;
  closedAt: string | null;
  primaryReleaseId: string | null;
  primaryReleaseName: string | null;
  updatedAt: string;
};

/** Government-authored decision framing. Lifecycle is derived, never manually promoted. */
export type InitiativeCase = InitiativeDecisionProfile & {
  lifecycle: InitiativeLifecycle;
  analysisGapCount: number;
  optionCount: number;
  selectedOptionTitle: string | null;
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
  /** Retained source ROM points. Converted only in an Initiative decision frame. */
  romPointsLow?: number | null;
  romPointsLikely?: number | null;
  romPointsHigh?: number | null;
  basis: string;
  assumptions: string | null;
  sourceReference: string | null;
  asOf: string;
  confidence: EstimateConfidence;
  createdAt: string;
};

/** Immutable supplier-source identity retained independently of a derived ROM estimate. */
export type ObjectiveFeedSourceProvenance = {
  subjectId: string;
  objectiveId: string;
  snapshotId: string;
  feedKey: string;
  fileName: string;
  recordContentHash: string;
  sourceAsOf: string | null;
  observedAt: string;
  sourceLocator: string | null;
  relatedTo: string | null;
  roadmapParent: string | null;
  scope: string | null;
  domains: string[];
  itemNumber: number | null;
  targetStart: string | null;
  targetFinish: string | null;
  rom: string | null;
  percentComplete: number | null;
  funding: string | null;
  release: string | null;
  overview: string | null;
  background: string | null;
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
  evidenceIntegrityStatus: "not_attached" | "verified" | "unverified" | "not_checked";
  evidenceFingerprint?: {
    documentId: string;
    fileName: string | null;
    byteSize: number | null;
    sealedContentHash: string | null;
    quarantined: boolean;
    integrityStatus: "verified" | "unverified" | "not_checked";
  } | null;
  updatedAt: string;
};

/** Evidence explicitly scoped to an Initiative, including governance-record attachments. */
export type InitiativeEvidenceFingerprint = {
  initiativeId: string;
  documentId: string;
  governanceRecordId: string | null;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  description: string | null;
  sealedContentHash: string | null;
  quarantined: boolean;
  integrityStatus: "verified" | "unverified" | "not_checked";
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

export type SolutionOption = {
  id: string;
  initiativeId: string;
  title: string;
  optionType: SolutionOptionType;
  status: SolutionOptionStatus;
  summary: string | null;
  /** Expected result of this option, not the shared Initiative outcome. */
  projectedOutcome: string | null;
  expectedConsequences: string | null;
  residualRisks: string | null;
  assumptions: string | null;
  sortOrder: number;
  updatedAt: string;
};

export type SolutionOptionStep = {
  id: string;
  optionId: string;
  title: string;
  description: string | null;
  expectedResult: string | null;
  parentStepId: string | null;
  wbsCode: string | null;
  owner: string | null;
  planningStart: string | null;
  planningFinish: string | null;
  planningEffortHours: number | null;
  planningEffortBasis: string | null;
  sortOrder: number;
  updatedAt: string;
};

export type SolutionStepReference = {
  id: string;
  optionId: string;
  stepId: string;
  referenceKind: SolutionStepReferenceKind;
  sourceId: string | null;
  reference: string | null;
  label: string;
  rationale: string | null;
  updatedAt: string;
};

export type SolutionStepDependency = {
  id: string;
  optionId: string;
  predecessorStepId: string;
  successorStepId: string;
  relationship: SolutionStepDependencyType;
  lagDays: number;
  rationale: string;
  updatedAt: string;
};

export type SolutionKnockOn = {
  id: string;
  optionId: string;
  origin: "government" | "derived";
  classification: SolutionKnockOnClassification;
  affectedKind: string | null;
  affectedId: string | null;
  affectedReference: string | null;
  timing: string | null;
  likelihood: EstimateConfidence;
  impact: EstimateConfidence;
  confidence: EstimateConfidence;
  narrative: string;
  mitigation: string | null;
  sourceAuthority: string;
  sourceReference: string | null;
  updatedAt: string;
};

export type SolutionOptionChangeRequestLink = {
  id: string;
  optionId: string;
  changeRequestId: string;
  relationship: InitiativeChangeRelationship;
  rationale: string | null;
  updatedAt: string;
};

export type SolutionOptionObjectiveLink = {
  id: string;
  optionId: string;
  objectiveId: string;
  role: SolutionObjectiveRole;
  rationale: string | null;
  updatedAt: string;
};

export type SolutionOptionAssessment = {
  id: string;
  optionId: string;
  criterion: SolutionAssessmentCriterion;
  rating: SolutionAssessmentRating;
  narrative: string | null;
  sourceReference: string | null;
  confidence: EstimateConfidence;
  updatedAt: string;
};

export type InitiativeSolutionDecision = {
  id: string;
  initiativeId: string;
  selectedOptionId: string | null;
  disposition: SolutionDecisionDisposition;
  decisionAuthority: string | null;
  decisionDate: string | null;
  rationale: string | null;
  acceptedResidualRisk: string | null;
  basisHash: string | null;
  currentBasisHash: string | null;
  basisIntegrityValid: boolean | null;
  basisStale: boolean;
  decisionRevision: number;
  updatedAt: string;
};

export type InitiativeSolutionDecisionRevision = {
  id: string;
  decisionId: string;
  initiativeId: string;
  revision: number;
  selectedOptionId: string | null;
  disposition: Exclude<SolutionDecisionDisposition, "pending"> | "legacy_unverified";
  decisionAuthority: string;
  decisionDate: string;
  rationale: string;
  acceptedResidualRisk: string | null;
  basisSnapshotJson: string | null;
  basisHash: string | null;
  basisIntegrityValid: boolean | null;
  createdByUserId: string | null;
  createdAt: string;
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
  /** Current explicit Lockheed feed provenance, including subjects without ROM. */
  objectiveFeedSources?: ObjectiveFeedSourceProvenance[];
  /** Current document/seal/integrity state for evidence scoped to each Initiative. */
  initiativeEvidenceFingerprints?: InitiativeEvidenceFingerprint[];
  /** Reported and analyst-confirmed Objective ↔ Change Request references. */
  objectiveChangeRequestLinks?: ObjectiveChangeRequestLink[];
  /** Optional for backwards-compatible consumers of the decision bundle. */
  objectiveDependencies?: ChangeRequestObjectiveDependency[];
  objectiveEffectAttributions?: ObjectiveEffectAttributionRecord[];
  requirements: RequirementTrace[];
  criteria: AcceptanceCriterion[];
  milestones: InitiativeMilestone[];
  solutionOptions: SolutionOption[];
  solutionSteps: SolutionOptionStep[];
  solutionStepReferences: SolutionStepReference[];
  solutionStepDependencies: SolutionStepDependency[];
  solutionChangeRequestLinks: SolutionOptionChangeRequestLink[];
  solutionObjectiveLinks: SolutionOptionObjectiveLink[];
  solutionAssessments: SolutionOptionAssessment[];
  solutionKnockOns: SolutionKnockOn[];
  solutionDecisions: InitiativeSolutionDecision[];
  solutionDecisionRevisions: InitiativeSolutionDecisionRevision[];
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
  solutionOptions: SolutionOption[];
  solutionSteps: SolutionOptionStep[];
  solutionStepReferences: SolutionStepReference[];
  solutionStepDependencies: SolutionStepDependency[];
  solutionChangeRequestLinks: SolutionOptionChangeRequestLink[];
  solutionObjectiveLinks: SolutionOptionObjectiveLink[];
  solutionAssessments: SolutionOptionAssessment[];
  solutionKnockOns: SolutionKnockOn[];
  solutionDecision: InitiativeSolutionDecision | null;
  solutionDecisionRevisions: InitiativeSolutionDecisionRevision[];
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
  const solutionOptions = workspace.solutionOptions.filter((item) => item.initiativeId === initiativeId);
  const solutionOptionIds = new Set(solutionOptions.map((item) => item.id));
  const scopedChangeLinks = workspace.solutionChangeRequestLinks.filter((item) => solutionOptionIds.has(item.optionId));
  const scopedObjectiveLinks = workspace.solutionObjectiveLinks.filter((item) => solutionOptionIds.has(item.optionId));
  const requestIds = new Set(scopedChangeLinks.map((item) => item.changeRequestId));
  const objectiveChangeRequestLinks = workspace.objectiveChangeRequestLinks ?? [];
  const objectives = workspace.objectives.filter((item) => objectiveRelatedChangeRequestIds(item, objectiveChangeRequestLinks).some((requestId) => requestIds.has(requestId)));
  const objectiveIds = new Set(objectives.map((item) => item.id));
  return { initiative, links, changeRequests: workspace.changes.requests.filter((item) => requestIds.has(item.id)), objectives, objectiveChangeRequestLinks: objectiveChangeRequestLinks.filter((link) => objectiveIds.has(link.objectiveId)), objectiveDependencies: (workspace.objectiveDependencies ?? []).filter((item) => requestIds.has(item.dependentChangeRequestId) || objectiveIds.has(item.prerequisiteObjectiveId)), objectiveEffectAttributions: (workspace.objectiveEffectAttributions ?? []).filter((item) => objectiveIds.has(item.objectiveId)), requirements: workspace.requirements.filter((item) => objectiveIds.has(item.objectiveId)), criteria: workspace.criteria.filter((item) => objectiveIds.has(item.objectiveId)), milestones: [], solutionOptions, solutionSteps: (workspace.solutionSteps ?? []).filter((item) => solutionOptionIds.has(item.optionId)), solutionStepReferences: (workspace.solutionStepReferences ?? []).filter((item) => solutionOptionIds.has(item.optionId)), solutionStepDependencies: (workspace.solutionStepDependencies ?? []).filter((item) => solutionOptionIds.has(item.optionId)), solutionChangeRequestLinks: scopedChangeLinks, solutionObjectiveLinks: scopedObjectiveLinks, solutionAssessments: (workspace.solutionAssessments ?? []).filter((item) => solutionOptionIds.has(item.optionId)), solutionKnockOns: (workspace.solutionKnockOns ?? []).filter((item) => solutionOptionIds.has(item.optionId)), solutionDecision: workspace.solutionDecisions.find((item) => item.initiativeId === initiativeId) || null, solutionDecisionRevisions: workspace.solutionDecisionRevisions.filter((item) => item.initiativeId === initiativeId), changes: workspace.changes };
}
