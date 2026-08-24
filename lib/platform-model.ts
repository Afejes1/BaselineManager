export type PlatformType = "alou" | "ock" | "obk" | "pma" | "other";
export type PlatformStatus = "active" | "planned" | "retired";
export type ReleaseStateRole = "historical" | "as_is" | "to_be" | "reported";

export type PlatformRecord = {
  id: string;
  parentId: string | null;
  configurationNodeId: string | null;
  platformType: PlatformType;
  code: string;
  name: string;
  status: PlatformStatus;
  description: string | null;
  installationLocation: string | null;
  countryCode: string | null;
  /** True when this Platform is materialized from A2O Resource. */
  isA2OResourcePlatform: boolean;
  /** True once this record is part of the Government-owned fielding hierarchy. */
  isGovernedPlatform: boolean;
  /** The source Tier that describes an A2O Resource Platform. */
  reportedTierName: string | null;
  directOccurrenceCount: number;
  directProductCount: number;
  directReleaseCount: number;
};

export type PlatformAssignment = {
  id: string;
  platformId: string;
  baselineOccurrenceId: string;
  releaseId: string;
  releaseName: string;
  productName: string;
  sourceKey: string;
  hostName: string;
  assignmentRole: "primary" | "supporting";
  confidence: "reported" | "assessed" | "confirmed";
  reviewStatus: "not_reviewed" | "reviewed" | "follow_up";
  sourceReference: string | null;
  sourceAsOf: string | null;
  reviewedAt: string | null;
};

export type PlatformOccurrenceOption = {
  id: string;
  releaseId: string;
  releaseName: string;
  productName: string;
  sourceKey: string;
  placement: string;
  primaryPlatformId: string | null;
};

export type PlatformOrganization = {
  id: string;
  platformId: string;
  organizationId: string;
  organizationName: string;
  relationshipType: "owner" | "operator" | "integrator" | "support" | "supplier";
  sourceReference: string | null;
};

export type ReleaseProfile = {
  id: string;
  releaseId: string;
  releaseName: string;
  stateRole: ReleaseStateRole;
  effectiveDate: string | null;
  description: string | null;
};

export type PlatformPortfolio = {
  platforms: PlatformRecord[];
  assignments: PlatformAssignment[];
  occurrenceOptions: PlatformOccurrenceOption[];
  relationships: PlatformOrganization[];
  releaseProfiles: ReleaseProfile[];
  organizations: Array<{ id: string; name: string }>;
  releases: Array<{ id: string; name: string }>;
};
