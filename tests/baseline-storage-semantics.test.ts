import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("baseline edits do not overwrite immutable intake rows", () => {
  const route = readFileSync("app/api/baseline/route.ts", "utf8");

  assert.doesNotMatch(route, /UPDATE\s+source_row_24/i);
  assert.match(route, /UPDATE\s+baseline_occurrence\s+SET[\s\S]*projection_payload=/i);
  assert.match(route, /source_row_24 is an immutable intake snapshot/i);
});

test("A2O import materializes one working baseline without a parallel reported baseline", () => {
  const route = readFileSync("app/api/baseline/import/route.ts", "utf8");

  assert.doesNotMatch(route, /reportedBaselineId/);
  assert.doesNotMatch(route, /maturity[^\n]+"reported"/);
  assert.match(route, /source_row_24[\s\S]+ON CONFLICT\(id\) DO NOTHING/);
  assert.match(route, /Working Technical Baseline/);
});
