import assert from "node:assert/strict";
import test from "node:test";
import { dependencyStatement } from "../lib/change-model.js";
import { CONFLUENCE_CHANGE_SOURCE_SYSTEM, inferChangeRequestImportMapping, mapChangeRequestSourceRows, reconcileChangeRequestImport, type ChangeRequestImportRow } from "../lib/change-import.js";

const base: ChangeRequestImportRow = { Type: "MCP", ExternalSystem: "LM Change System", ExternalIdentifier: "MCP-100", Title: "Modernize runtime", ExternalStatus: "Open", ExternalOwner: "Mission Apps", SourceLocator: "LM://MCP-100", SourceAsOf: "2026-08-20", RequestedRelease: "Release 7" };

test("Change Request import refreshes external fields without requiring Government decision fields", () => {
  const preview = reconcileChangeRequestImport([{ ...base, ExternalStatus: "In Work" }], [{ id: "change-1", typeId: "type-mcp", typeCode: "MCP", externalSystem: base.ExternalSystem, externalIdentifier: base.ExternalIdentifier, title: base.Title, externalStatus: "Open", externalOwner: base.ExternalOwner, sourceLocator: base.SourceLocator, sourceAsOf: base.SourceAsOf, requestedReleaseId: "release-7", requestedReleaseName: "Release 7" }], [{ id: "type-mcp", code: "MCP" }], [{ id: "release-7", name: "Release 7" }]);
  assert.equal(preview.canApply, true);
  assert.equal(preview.changed, 1);
  assert.deepEqual(preview.rows[0].changedFields, ["ExternalStatus"]);
});

test("Change Request import blocks unknown types, releases, duplicates, and invalid source dates", () => {
  const invalid = { ...base, Type: "UNKNOWN", RequestedRelease: "Release 99", SourceAsOf: "08/20/2026" };
  const preview = reconcileChangeRequestImport([invalid, invalid], [], [{ id: "type-mcp", code: "MCP" }], [{ id: "release-7", name: "Release 7" }]);
  assert.equal(preview.canApply, false);
  assert.equal(preview.blocked, 2);
  assert.ok(preview.rows[0].issues.length >= 4);
});

test("dependency statements state direction without ambiguous arrows", () => {
  assert.equal(dependencyStatement({ dependencyType: "requires" }, "MCP-1", "MCP-2"), "MCP-2 requires MCP-1.");
  assert.equal(dependencyStatement({ dependencyType: "enables" }, "MCP-1", "MCP-2"), "MCP-1 enables MCP-2.");
  assert.equal(dependencyStatement({ dependencyType: "blocks" }, "MCP-1", "MCP-2"), "MCP-1 blocks MCP-2.");
});

test("Confluence CSV headers map to canonical Change Request fields without discarding source attributes", () => {
  const raw = { Title: "MCP-014 — PS-OBPHM Interface", "jpo code": "MCP-014", "Governance Phase": "OBJ BACKLOG", "Request Type": "NEW CAPABILITY", "MxS/PMO Lead": "A&S JSF", "Title url": "https://confluence.example/MCP-014", MOSCoW: "SHOULD", "MxS Impact Score": "44" };
  const mapping = inferChangeRequestImportMapping(Object.keys(raw));
  const [record] = mapChangeRequestSourceRows([raw], mapping, { sourceAsOf: "2026-08-21" });
  assert.equal(record.canonical.Type, "MCP");
  assert.equal(record.canonical.ExternalSystem, CONFLUENCE_CHANGE_SOURCE_SYSTEM);
  assert.equal(record.canonical.ExternalIdentifier, "MCP-014");
  assert.equal(record.canonical.ExternalStatus, "OBJ BACKLOG");
  assert.equal(record.canonical.ExternalOwner, "A&S JSF");
  assert.equal(record.raw.MOSCoW, "SHOULD");
  assert.equal(record.raw["MxS Impact Score"], "44");
});
