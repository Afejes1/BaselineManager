import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("baseline edits do not overwrite immutable intake rows", () => {
  const route = readFileSync("app/api/baseline/route.ts", "utf8");

  assert.doesNotMatch(route, /UPDATE\s+source_row_24/i);
  assert.match(route, /UPDATE\s+baseline_occurrence\s+SET[\s\S]*projection_payload=/i);
  assert.match(route, /baseline_record_extension/);
  assert.match(route, /Capability text stays staged/);
  assert.match(route, /OEM creates only a supplier relationship/);
});

test("A2O import reconciles records and never deletes working links", () => {
  const route = readFileSync("app/api/baseline/import/route.ts", "utf8");

  assert.match(route, /reconcileRows/);
  assert.match(route, /preservedLinks: true/);
  assert.doesNotMatch(route, /DELETE FROM baseline_occurrence/i);
  assert.doesNotMatch(route, /DELETE FROM managed_deployment_profile/i);
  assert.match(readFileSync("app/api/baseline/route.ts", "utf8"), /baseline_record_source/);
});

test("a deliberate demonstration load archives the active baseline before seeding", () => {
  const intake = readFileSync("app/api/baseline/import/route.ts", "utf8");
  const manager = readFileSync("app/baseline-manager.tsx", "utf8");
  const demo = readFileSync("lib/demo-workspace-server.ts", "utf8");

  assert.match(intake, /replaceActiveBaseline/);
  assert.match(intake, /Demonstration data is disabled in this operational environment/);
  assert.match(intake, /Archived by confirmed demonstration dataset load/);
  assert.doesNotMatch(intake, /DELETE FROM baseline_occurrence/i);
  assert.match(manager, /replaceActiveBaseline: true/);
  assert.match(demo, /bo\.lifecycle_status='active'/);
});

test("A2O export is assembled from governed tables, not the projection cache", () => {
  const helper = readFileSync("lib/a2o-baseline-server.ts", "utf8");
  const exportRoute = readFileSync("app/api/baseline/export/route.ts", "utf8");
  assert.match(helper, /assembleA2ORow/);
  assert.match(helper, /baseline_record_extension/);
  assert.match(exportRoute, /readAssembledBaselineRecords/);
  assert.doesNotMatch(exportRoute, /SELECT id, projection_payload FROM baseline_occurrence/);
});

test("first-time multi-row intake reuses canonical UUID identities in one batch", () => {
  const route = readFileSync("app/api/baseline/route.ts", "utf8");
  const intake = readFileSync("app/api/baseline/import/route.ts", "utf8");
  assert.match(route, /createBaselineResolver/);
  assert.match(intake, /const resolver = await createBaselineResolver/);
  assert.match(intake, /await sha256\(JSON\.stringify\(row\)\)/);
  assert.match(intake, /duplicate: true/);
  assert.doesNotMatch(intake, /stableId\(/);
});

test("A2O intake creates its source package before the workspace points to it", () => {
  const intake = readFileSync("app/api/baseline/import/route.ts", "utf8");
  const packageInsert = intake.indexOf('INSERT INTO source_package');
  const workspaceInsert = intake.indexOf('INSERT INTO baseline_workspace');

  assert.ok(packageInsert >= 0, "the immutable source package must be written");
  assert.ok(workspaceInsert >= 0, "the workspace must retain the active package pointer");
  assert.ok(packageInsert < workspaceInsert, "the workspace cannot reference a package before it exists");
});

test("Configuration Set review locks edits and approval creates revision history", () => {
  const baseline = readFileSync("app/api/baseline/route.ts", "utf8");
  const master = readFileSync("lib/master-data-server.ts", "utf8");
  assert.match(baseline, /has a Configuration Set under review/);
  assert.match(baseline, /parent_baseline_id/);
  assert.match(baseline, /INSERT OR IGNORE INTO baseline_node_state/);
  assert.match(master, /superseded_by_baseline_id/);
  assert.match(master, /Only the baseline steward may approve/);
});

test("manual review is governed by Baseline Record identity", () => {
  const reviews = readFileSync("app/api/baseline/reviews/route.ts", "utf8");
  assert.match(reviews, /baseline_record_review/);
  assert.match(reviews, /reviewed_by_user_id/);
  assert.match(reviews, /occurrenceId/);
  assert.doesNotMatch(reviews, /sourceRowId/);
});
