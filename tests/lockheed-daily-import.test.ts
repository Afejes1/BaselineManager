import assert from "node:assert/strict";
import test from "node:test";
import { classifyLockheedDailyFile, comparableLockheedDailyRecord, diffLockheedDailyRecords, normalizeLockheedDailyRow, parseLockheedDailyFiles } from "../lib/lockheed-daily-import.js";

test("classifies the four delivered datasets from names and headers", () => {
  assert.equal(classifyLockheedDailyFile("FOR_JPO_CAPES.CSV", ["Key", "Issue Type"]), "capes");
  assert.equal(classifyLockheedDailyFile("FOR_JPO_JIRA.CSV", ["Key", "Issue Type"]), "jira");
  assert.equal(classifyLockheedDailyFile("FOR_JPO_MCPS.CSV", ["MCP/DSOR", "Title"]), "mcps");
  assert.equal(classifyLockheedDailyFile("FOR_JPO_OBJS.CSV", ["Key", "LM Status", "% Complete"]), "objectives");
});

test("normalizes rendered MCP identifiers and retains reported relationships", () => {
  const record = normalizeLockheedDailyRow({ fileId: "mcp", fileName: "FOR_JPO_MCPS.CSV", dataset: "mcps" }, { "MCP/DSOR": "🏛 MCP-156", Title: "Barcode Scanner Replacement", Action: "OBJ BACKLOG", Objectives: "arch_plan_2365, arch_plan_56", Blocks: "MCP-048", "Blocked By": "MCP-100" }, 2);
  assert.equal(record.sourceKey, "MCP-156");
  assert.equal(record.status, "OBJ BACKLOG");
  assert.deepEqual(record.relations, [
    { relationType: "objective_reference", targetReference: "arch_plan_2365" },
    { relationType: "objective_reference", targetReference: "arch_plan_56" },
    { relationType: "blocks", targetReference: "MCP-048" },
    { relationType: "blocked_by", targetReference: "MCP-100" },
  ]);
});

test("objective observations preserve schedule, ROM, completion, and date-to-date deltas", () => {
  const file = { fileId: "obj", fileName: "FOR_JPO_OBJS.CSV", dataset: "objectives" as const };
  const before = normalizeLockheedDailyRow(file, { Key: "120", "JIRA ID": "A2O-369578", Summary: "Install SW", "LM Status": "In Progress", "Target Start": "2026-04", "Target Finish": "2026-09", ROM: "88", "% Complete": "2", Blocks: "arch_plan_352" }, 2);
  const after = normalizeLockheedDailyRow(file, { Key: "120", "JIRA ID": "A2O-369578", Summary: "Install SW", "LM Status": "In Progress", "Target Start": "2026-05", "Target Finish": "2026-10", ROM: "113", "% Complete": "17", Blocks: "arch_plan_352" }, 2);
  assert.equal(after.fields.JIRAID, "A2O-369578");
  assert.deepEqual(diffLockheedDailyRecords(comparableLockheedDailyRecord(before), comparableLockheedDailyRecord(after)).map((item) => item.field), ["PercentComplete", "ROM", "TargetFinish", "TargetStart"]);
});

test("duplicate identities in one dataset are blocked without treating absence as deletion", () => {
  const file = { fileId: "obj", fileName: "FOR_JPO_OBJS.CSV", dataset: "objectives" as const, rows: [{ Key: "120", Summary: "First" }, { Key: "120", Summary: "Second" }] };
  const records = parseLockheedDailyFiles([file]);
  assert.equal(records.length, 2);
  assert.ok(records.every((record) => record.issues.some((issue) => issue.includes("occurs more than once"))));
});
