import type { TechnicalBaselineRow } from "./technical-baseline-contract.js";
import { dataQualityFor } from "./baseline-quality.js";
import type { ManagedDeploymentProfile, ManagedHostProfile } from "./topology-model.js";

export type BaselineAnalysisRecord = TechnicalBaselineRow & { __meta: { occurrenceId: string; releaseId: string | null; productId: string | null; configurationNodeId: string | null; deploymentId: string | null } };

export type Placement = {
  occurrenceId: string;
  releaseId: string | null;
  releaseName: string;
  productId: string | null;
  configurationNodeId: string | null;
  productKey: string;
  productName: string;
  sourceKey: string;
  tier: string;
  resource: string;
  host: string;
  storageType: string;
  storageGb: string;
  cpuCores: string;
  ramGb: string;
  containerized: string;
  containerTechnology: string;
  containerType: string;
  language: string;
  softwareType: string;
  techStackType: string;
  supplier: string;
  capability: string;
  quality: "healthy" | "review" | "issue";
  row: BaselineAnalysisRecord;
};

export type TopologyHost = {
  id: string;
  tier: string;
  resource: string;
  host: string;
  profile: ManagedHostProfile | null;
  placements: Array<Placement & { profile: ManagedDeploymentProfile | null }>;
};

export type ReleaseDeltaKind = "product_added" | "product_removed" | "deployment_added" | "deployment_removed" | "deployment_moved" | "configuration_changed";
export type ReleaseDelta = {
  id: string;
  kind: ReleaseDeltaKind;
  productKey: string;
  productName: string;
  before: Placement | null;
  after: Placement | null;
  beforePlacement: string | null;
  afterPlacement: string | null;
  changedFields: string[];
  anchorIds: Array<{ kind: "release" | "product" | "configuration_node" | "occurrence"; id: string }>;
};

const clean = (value: unknown) => String(value ?? "").trim();
const compareText = (value: unknown) => clean(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const naturalSort = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

export function releaseNames(rows: BaselineAnalysisRecord[]) {
  return Array.from(new Set(rows.map((row) => clean(row.ReleaseName)).filter(Boolean))).sort(naturalSort);
}

export function placementOf(row: BaselineAnalysisRecord): Placement {
  const qualityLevel = dataQualityFor(row).level;
  const quality = qualityLevel === "ready" ? "healthy" : qualityLevel;
  return {
    occurrenceId: row.__meta.occurrenceId, releaseId: row.__meta.releaseId, releaseName: clean(row.ReleaseName) || "Unassigned", productId: row.__meta.productId,
    configurationNodeId: row.__meta.configurationNodeId, productKey: row.__meta.productId || productKeyFor(row), productName: productNameFor(row), sourceKey: clean(row["#"]),
    tier: clean(row.Tier), resource: clean(row.Resource), host: clean(row.HW_Host), storageType: clean(row.HW_Storage_Type), storageGb: clean(row["HW_Storage (GB)"]), cpuCores: clean(row.HW_CPU_CORES), ramGb: clean(row["HW_RAM (GB)"]),
    containerized: clean(row.Containerized), containerTechnology: clean(row["Container Technology"]), containerType: clean(row["Container Type"]), language: clean(row["SW Language"]), softwareType: clean(row["Software Type"]), techStackType: clean(row.TechStackType), supplier: clean(row.OEM), capability: clean(row["Technical Capability Satisfied by this SW/Tech - Notes"]), quality,
    row,
  };
}

export const placementLabel = (placement: Pick<Placement, "tier" | "resource" | "host">) => [placement.tier, placement.resource, placement.host].map((part) => part || "Not reported").join(" / ");
const positionKey = (placement: Placement) => [placement.productKey, compareText(placement.tier), compareText(placement.resource), compareText(placement.host)].join("|");

function productNameFor(row: TechnicalBaselineRow) { return clean(row.LongName) || clean(row.ShortName) || "Unassigned product"; }
function productKeyFor(row: TechnicalBaselineRow) { return [clean(row.LongName) || clean(row.ShortName) || clean(row["#"]) || "unassigned"].map(compareText).join("|"); }

export function topologyForRelease(rows: BaselineAnalysisRecord[], releaseName: string, hostProfiles: ManagedHostProfile[], deploymentProfiles: ManagedDeploymentProfile[]) {
  const hostById = new Map(hostProfiles.map((profile) => [`${profile.releaseId}:${profile.configurationNodeId}`, profile]));
  const deploymentByOccurrence = new Map(deploymentProfiles.map((profile) => [profile.baselineOccurrenceId, profile]));
  const groups = new Map<string, TopologyHost>();
  for (const row of rows) {
    if (clean(row.ReleaseName) !== releaseName) continue;
    const placement = placementOf(row);
    const key = placement.configurationNodeId || [placement.tier, placement.resource, placement.host].map(compareText).join("|");
    const existing = groups.get(key) || { id: key, tier: placement.tier, resource: placement.resource, host: placement.host, profile: placement.releaseId && placement.configurationNodeId ? hostById.get(`${placement.releaseId}:${placement.configurationNodeId}`) || null : null, placements: [] };
    existing.placements.push({ ...placement, profile: deploymentByOccurrence.get(placement.occurrenceId) || null });
    groups.set(key, existing);
  }
  return [...groups.values()].sort((left, right) => naturalSort(placementLabel(left), placementLabel(right))).map((host) => ({ ...host, placements: host.placements.sort((left, right) => naturalSort(left.productName, right.productName)) }));
}

const comparisonFields: Array<[keyof Pick<Placement, "storageType" | "storageGb" | "cpuCores" | "ramGb" | "containerized" | "containerTechnology" | "containerType" | "language" | "softwareType" | "techStackType" | "supplier" | "capability">, string]> = [
  ["storageType", "Storage type"], ["storageGb", "Storage capacity"], ["cpuCores", "CPU cores"], ["ramGb", "RAM"], ["containerized", "Containerized"], ["containerTechnology", "Container technology"], ["containerType", "Container type"], ["language", "Software language"], ["softwareType", "Software classification"], ["techStackType", "Tech-stack role"], ["supplier", "Supplier"], ["capability", "Capability"],
];

function changedFields(before: Placement, after: Placement) {
  return comparisonFields.filter(([field]) => compareText(before[field]) !== compareText(after[field])).map(([, label]) => label);
}

function anchors(before: Placement | null, after: Placement | null): ReleaseDelta["anchorIds"] {
  const result = new Map<string, ReleaseDelta["anchorIds"][number]>();
  for (const placement of [before, after]) {
    if (!placement) continue;
    if (placement.releaseId) result.set(`release:${placement.releaseId}`, { kind: "release", id: placement.releaseId });
    if (placement.productId) result.set(`product:${placement.productId}`, { kind: "product", id: placement.productId });
    if (placement.configurationNodeId) result.set(`configuration_node:${placement.configurationNodeId}`, { kind: "configuration_node", id: placement.configurationNodeId });
    result.set(`occurrence:${placement.occurrenceId}`, { kind: "occurrence", id: placement.occurrenceId });
  }
  return [...result.values()];
}

function delta(kind: ReleaseDeltaKind, productKey: string, productName: string, before: Placement | null, after: Placement | null, fields: string[] = []): ReleaseDelta {
  return { id: `${kind}:${productKey}:${before?.occurrenceId || "none"}:${after?.occurrenceId || "none"}`, kind, productKey, productName, before, after, beforePlacement: before ? placementLabel(before) : null, afterPlacement: after ? placementLabel(after) : null, changedFields: fields, anchorIds: anchors(before, after) };
}

export function compareReleases(rows: BaselineAnalysisRecord[], previousRelease: string, currentRelease: string) {
  const previous = rows.filter((row) => clean(row.ReleaseName) === previousRelease).map(placementOf);
  const current = rows.filter((row) => clean(row.ReleaseName) === currentRelease).map(placementOf);
  const previousByProduct = new Map<string, Placement[]>();
  const currentByProduct = new Map<string, Placement[]>();
  for (const placement of previous) previousByProduct.set(placement.productKey, [...(previousByProduct.get(placement.productKey) || []), placement]);
  for (const placement of current) currentByProduct.set(placement.productKey, [...(currentByProduct.get(placement.productKey) || []), placement]);
  const deltas: ReleaseDelta[] = [];
  for (const productKey of new Set([...previousByProduct.keys(), ...currentByProduct.keys()])) {
    const before = previousByProduct.get(productKey) || [];
    const after = currentByProduct.get(productKey) || [];
    const productName = after[0]?.productName || before[0]?.productName || "Unassigned product";
    if (!before.length) { deltas.push(delta("product_added", productKey, productName, null, after[0] || null)); continue; }
    if (!after.length) { deltas.push(delta("product_removed", productKey, productName, before[0] || null, null)); continue; }
    const beforeByPosition = new Map(before.map((placement) => [positionKey(placement), placement]));
    const afterByPosition = new Map(after.map((placement) => [positionKey(placement), placement]));
    const departed = [...beforeByPosition.entries()].filter(([key]) => !afterByPosition.has(key)).map(([, placement]) => placement);
    const arrived = [...afterByPosition.entries()].filter(([key]) => !beforeByPosition.has(key)).map(([, placement]) => placement);
    if (departed.length === 1 && arrived.length === 1 && before.length === 1 && after.length === 1) {
      deltas.push(delta("deployment_moved", productKey, productName, departed[0], arrived[0]));
    } else {
      for (const placement of departed) deltas.push(delta("deployment_removed", productKey, productName, placement, null));
      for (const placement of arrived) deltas.push(delta("deployment_added", productKey, productName, null, placement));
    }
    for (const [key, prior] of beforeByPosition) {
      const next = afterByPosition.get(key);
      if (!next) continue;
      const fields = changedFields(prior, next);
      if (fields.length) deltas.push(delta("configuration_changed", productKey, productName, prior, next, fields));
    }
  }
  const order: Record<ReleaseDeltaKind, number> = { product_added: 0, product_removed: 1, deployment_moved: 2, deployment_added: 3, deployment_removed: 4, configuration_changed: 5 };
  return deltas.sort((left, right) => order[left.kind] - order[right.kind] || naturalSort(left.productName, right.productName));
}

export function releaseOverview(rows: BaselineAnalysisRecord[], releaseName: string) {
  const scoped = rows.filter((row) => clean(row.ReleaseName) === releaseName).map(placementOf);
  return { sourceRows: scoped.length, products: new Set(scoped.map((row) => row.productKey)).size, configurationNodes: new Set(scoped.map((row) => row.configurationNodeId || placementLabel(row))).size, suppliers: new Set(scoped.map((row) => row.supplier).filter(Boolean)).size, issues: scoped.filter((row) => row.quality === "issue").length, review: scoped.filter((row) => row.quality === "review").length, containerized: scoped.filter((row) => compareText(row.containerized) === "yes").length };
}
