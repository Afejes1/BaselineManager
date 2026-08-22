export type ManagedHostProfile = {
  id: string;
  releaseId: string;
  configurationNodeId: string;
  installationLocation: string | null;
  facilityOrEnclave: string | null;
  equipmentRack: string | null;
  hardwareBlade: string | null;
  virtualizationPlatform: string | null;
  sourceReference: string | null;
  notes: string | null;
  updatedAt: string;
};

export type ManagedDeploymentProfile = {
  id: string;
  baselineOccurrenceId: string;
  releaseId: string;
  configurationNodeId: string | null;
  productId: string | null;
  virtualMachine: string | null;
  containerInstance: string | null;
  applicationVersion: string | null;
  installationIdentifier: string | null;
  deploymentRole: string | null;
  sourceReference: string | null;
  notes: string | null;
  updatedAt: string;
};

export type TopologyExtensions = {
  hostProfiles: ManagedHostProfile[];
  deploymentProfiles: ManagedDeploymentProfile[];
  infrastructure: InfrastructurePortfolio;
};

export type InfrastructureNodeType = "ups" | "network_switch" | "chassis" | "blade" | "physical_server" | "storage_array" | "logical_drive" | "virtual_machine" | "appliance" | "other";
export type InfrastructureLifecycle = "active" | "planned" | "retired";
export type ReleaseNodeLifecycle = "planned" | "active" | "retired" | "absent";
export type InfrastructureOperatingState = "unknown" | "operational" | "degraded" | "offline" | "not_installed";
export type InstallationRole = "operating_system" | "hypervisor" | "application" | "middleware" | "database" | "runtime" | "firmware" | "agent" | "other";
export type InstallationStatus = "planned" | "installed" | "retired" | "absent";
export type ConnectionType = "network" | "power" | "storage" | "cluster" | "management" | "other";
export type InfrastructureReferenceCategory = "storage_medium" | "file_system";

export type InfrastructureReferenceValue = {
  id: string;
  category: InfrastructureReferenceCategory;
  code: string;
  name: string;
  description: string | null;
};

export type InfrastructureNode = {
  id: string;
  platformId: string;
  nodeType: InfrastructureNodeType;
  code: string;
  name: string;
  manufacturerOrganizationId: string | null;
  manufacturerName: string | null;
  hardwareProductId: string | null;
  hardwareProductName: string | null;
  assetTag: string | null;
  serialNumber: string | null;
  lifecycleStatus: InfrastructureLifecycle;
  description: string | null;
  updatedAt: string;
};

export type ReleaseInfrastructureNode = {
  id: string;
  releaseId: string;
  releaseName: string;
  platformId: string;
  infrastructureNodeId: string;
  parentStateId: string | null;
  lifecycleStatus: ReleaseNodeLifecycle;
  operatingState: InfrastructureOperatingState;
  cpuCores: number | null;
  memoryGb: number | null;
  storageGb: number | null;
  storageMediumId: string | null;
  storageType: string | null;
  driveLetter: string | null;
  fileSystemValueId: string | null;
  fileSystem: string | null;
  sourceReference: string | null;
  sourceAsOf: string | null;
  notes: string | null;
  updatedAt: string;
};

export type InfrastructureProductInstallation = {
  id: string;
  releaseId: string;
  platformId: string;
  nodeStateId: string;
  productId: string;
  productName: string;
  productType: string | null;
  baselineOccurrenceId: string | null;
  sourceKey: string | null;
  installationRole: InstallationRole;
  instanceName: string | null;
  version: string | null;
  deploymentStatus: InstallationStatus;
  sourceReference: string | null;
  sourceAsOf: string | null;
  notes: string | null;
  updatedAt: string;
};

export type InfrastructureConnection = {
  id: string;
  releaseId: string;
  platformId: string;
  sourceNodeStateId: string;
  targetNodeStateId: string;
  connectionType: ConnectionType;
  label: string | null;
  status: InfrastructureLifecycle;
  capacityMbps: number | null;
  sourceReference: string | null;
  sourceAsOf: string | null;
  notes: string | null;
};

export type InfrastructurePortfolio = {
  nodes: InfrastructureNode[];
  states: ReleaseInfrastructureNode[];
  installations: InfrastructureProductInstallation[];
  connections: InfrastructureConnection[];
  referenceValues: InfrastructureReferenceValue[];
  platforms: Array<{ id: string; code: string; name: string; platformType: string; parentId: string | null }>;
  releases: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string; shortName: string | null; productType: string | null }>;
  organizations: Array<{ id: string; name: string }>;
  occurrenceOptions: Array<{ id: string; releaseId: string; releaseName: string; productId: string | null; productName: string; sourceKey: string }>;
};
