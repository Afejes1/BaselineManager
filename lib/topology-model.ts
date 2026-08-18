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
};
