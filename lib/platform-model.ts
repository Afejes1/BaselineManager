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
  directOccurrenceCount: number;
  directProductCount: number;
  directReleaseCount: number;
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
  relationships: PlatformOrganization[];
  releaseProfiles: ReleaseProfile[];
  organizations: Array<{ id: string; name: string }>;
  releases: Array<{ id: string; name: string }>;
};

