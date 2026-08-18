import assert from "node:assert/strict";
import test from "node:test";
import { compareReleases, topologyForRelease, type BaselineAnalysisRecord } from "../lib/release-analysis.js";

function row(release: string, product: string, host: string, cpu = 8): BaselineAnalysisRecord {
  const record = { "#": `${release}-${product}-${host}`, ReleaseName: release, LongName: product, Tier: "Mission", Resource: "Core", HW_Host: host, HW_CPU_CORES: cpu, "HW_RAM (GB)": 32, HW_Storage_Type: "SSD", "HW_Storage (GB)": 200, Containerized: "Yes", "Container Technology": "Kubernetes", "Container Type": "Service", OEM: "Government" };
  return { ...record, __meta: { occurrenceId: `occ-${release}-${product}-${host}`, sourceRowId: `source-${release}-${product}-${host}`, revision: 0, materializationStatus: "working", baseline: { name: `${release} baseline`, maturity: "working", asOf: "2026-08-19" }, source: { fileName: "test.xlsx" }, releaseId: `release-${release}`, productId: `product-${product}`, configurationNodeId: `node-${release}-${host}`, deploymentId: `deployment-${release}-${product}-${host}` } } as BaselineAnalysisRecord;
}

test("release comparison distinguishes product additions, deployment moves, and field changes", () => {
  const rows = [row("R1", "Atlas", "HOST-1"), row("R1", "Beacon", "HOST-2", 8), row("R2", "Atlas", "HOST-9"), row("R2", "Beacon", "HOST-2", 16), row("R2", "Comet", "HOST-3")];
  const result = compareReleases(rows, "R1", "R2");
  assert.equal(result.filter((item) => item.kind === "deployment_moved" && item.productName === "Atlas").length, 1);
  assert.equal(result.filter((item) => item.kind === "configuration_changed" && item.productName === "Beacon" && item.changedFields.includes("CPU cores")).length, 1);
  assert.equal(result.filter((item) => item.kind === "product_added" && item.productName === "Comet").length, 1);
});

test("topology keeps source placement separate from managed extension profiles", () => {
  const source = row("R2", "Atlas", "HOST-9");
  const tree = topologyForRelease([source], "R2", [{ id: "host-profile-1", releaseId: "release-R2", configurationNodeId: "node-R2-HOST-9", installationLocation: "OBK Alpha", facilityOrEnclave: null, equipmentRack: "Rack 7", hardwareBlade: null, virtualizationPlatform: null, sourceReference: null, notes: null, updatedAt: "2026-08-19" }], [{ id: "deployment-profile-1", baselineOccurrenceId: source.__meta.occurrenceId, releaseId: "release-R2", configurationNodeId: source.__meta.configurationNodeId, productId: source.__meta.productId, virtualMachine: "VM-14", containerInstance: null, applicationVersion: "2.4.1", installationIdentifier: null, deploymentRole: null, sourceReference: null, notes: null, updatedAt: "2026-08-19" }]);
  assert.equal(tree[0].host, "HOST-9");
  assert.equal(tree[0].profile?.installationLocation, "OBK Alpha");
  assert.equal(tree[0].placements[0].profile?.applicationVersion, "2.4.1");
});
