export type ReleaseStage = "proposed" | "planned" | "in_development" | "integration" | "test" | "fielding" | "operational" | "superseded" | "cancelled";
export type ReleaseStateRole = "historical" | "as_is" | "to_be" | "reported";
export type MilestoneStatus = "planned" | "at_risk" | "complete" | "cancelled";
export type CatalogLifecycle = "draft" | "active" | "inactive" | "retired";
export type MasterEntityKind = "product" | "organization" | "capability" | "configuration_node";

export type ReleaseRecord = {
  id: string;
  code: string | null;
  name: string;
  status: ReleaseStage;
  description: string | null;
  owner: string | null;
  predecessorReleaseId: string | null;
  targetDate: string | null;
  actualDate: string | null;
  sourceReference: string | null;
  sourceAsOf: string | null;
  stateRole: ReleaseStateRole;
  effectiveDate: string | null;
  profileDescription: string | null;
  baselineRecordCount: number;
  productCount: number;
  updatedAt: string;
};

export type ReleaseMilestone = {
  id: string;
  releaseId: string;
  milestoneType: string;
  title: string;
  status: MilestoneStatus;
  plannedDate: string | null;
  forecastDate: string | null;
  actualDate: string | null;
  owner: string | null;
  sourceReference: string | null;
  sourceAsOf: string | null;
  notes: string | null;
  updatedAt: string;
};

export type ConfigurationSetRecord = {
  id: string;
  releaseId: string;
  name: string;
  revisionNumber: number;
  approvalStatus: "working" | "under_review" | "approved" | "superseded";
  asOf: string;
  description: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  baselineRecordCount: number;
  updatedAt: string;
};

export type ProductMaster = {
  id: string; canonicalName: string; shortName: string | null; productType: string | null; softwareClassification: string | null;
  ownerOrganizationId: string | null; description: string | null; lifecycleStatus: "active" | "retired"; sourceReference: string | null; sourceAsOf: string | null; updatedAt: string;
};

export type OrganizationMaster = {
  id: string; name: string; organizationType: string | null; description: string | null; lifecycleStatus: "active" | "inactive" | "retired";
  sourceReference: string | null; sourceAsOf: string | null; updatedAt: string;
};

export type CapabilityMaster = {
  id: string; parentId: string | null; code: string | null; name: string; description: string | null; lifecycleStatus: "draft" | "active" | "retired";
  sourceReference: string | null; sourceAsOf: string | null; updatedAt: string;
};

export type ConfigurationNodeMaster = {
  id: string; parentId: string | null; nodeType: string; code: string | null; name: string; description: string | null; ownerOrganizationId: string | null;
  lifecycleStatus: "active" | "retired"; sourceReference: string | null; sourceAsOf: string | null; updatedAt: string;
};

export type AuditEntry = { id: string; action: string; actorId: string; beforePayload: string | null; afterPayload: string | null; createdAt: string };

export type MasterDataPortfolio = {
  releases: ReleaseRecord[];
  milestones: ReleaseMilestone[];
  configurationSets: ConfigurationSetRecord[];
  products: ProductMaster[];
  organizations: OrganizationMaster[];
  capabilities: CapabilityMaster[];
  configurationNodes: ConfigurationNodeMaster[];
};

export const releaseStages: ReleaseStage[] = ["proposed", "planned", "in_development", "integration", "test", "fielding", "operational", "superseded", "cancelled"];
export const releaseRoles: ReleaseStateRole[] = ["historical", "as_is", "to_be", "reported"];
export const milestoneStatuses: MilestoneStatus[] = ["planned", "at_risk", "complete", "cancelled"];
export const milestoneTypes = ["scope_baseline", "development_start", "code_complete", "integration_start", "test_start", "verification_complete", "fielding_decision", "fielding_start", "operational_date", "other"] as const;
