import assert from "node:assert/strict";
import test from "node:test";
import { normalizeObjectiveImportRow, reconcileObjectiveImport } from "../lib/objective-import.js";

const request = { id: "change-122", externalIdentifier: "MCP-122" };
const current = {
  id: "objective-1",
  changeRequestId: request.id,
  externalSystem: "LM Jira",
  externalIdentifier: "OBJ-1",
  externalItemType: "Objective",
  title: "Modernize runtime",
  summary: "Current scope",
  technicalOwner: "LM Runtime Team",
  status: "planned" as const,
  plannedStart: "2026-09-01",
  plannedFinish: "2027-02-28",
  actualStart: null,
  actualFinish: null,
  sourceLocator: "LMJIRA://OBJ-1",
  sourceAsOf: "2026-08-19",
};

function row(overrides: Record<string, string> = {}) {
  return normalizeObjectiveImportRow({
    ExternalSystem: "LM Jira",
    ExternalIdentifier: "OBJ-1",
    ExternalItemType: "Objective",
    OwningChangeRequest: "MCP-122",
    Title: "Modernize runtime",
    Status: "planned",
    TechnicalOwner: "LM Runtime Team",
    PlannedStart: "2026-09-01",
    PlannedFinish: "2027-02-28",
    SourceLocator: "LMJIRA://OBJ-1",
    SourceAsOf: "2026-08-19",
    Summary: "Current scope",
    ...overrides,
  });
}

test("objective reconciliation distinguishes unchanged and changed source rows", () => {
  const unchanged = reconcileObjectiveImport([row()], [current], [request]);
  assert.equal(unchanged.unchanged, 1);
  assert.equal(unchanged.canApply, true);

  const changed = reconcileObjectiveImport([row({ Status: "in_progress" })], [current], [request]);
  assert.equal(changed.changed, 1);
  assert.deepEqual(changed.rows[0].changedFields, ["Status"]);
});

test("objective reconciliation blocks duplicate identities but retains reported request references", () => {
  const duplicate = reconcileObjectiveImport([row(), row()], [current], [request]);
  assert.equal(duplicate.blocked, 2);
  assert.equal(duplicate.canApply, false);

  const missingOwner = reconcileObjectiveImport([row({ OwningChangeRequest: "MCP-404" })], [current], [request]);
  assert.equal(missingOwner.rows[0].issues.some((issue) => issue.code === "reported_reference"), true);
  assert.equal(missingOwner.rows[0].disposition, "change");
  assert.equal(missingOwner.canApply, true);

  const other = { id: "change-21", externalIdentifier: "MCP-21" };
  const reparent = reconcileObjectiveImport([row({ OwningChangeRequest: "MCP-21" })], [current], [request, other]);
  assert.equal(reparent.rows[0].issues.some((issue) => issue.blocking), false);
  assert.equal(reparent.canApply, true);
});

