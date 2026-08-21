import assert from "node:assert/strict";
import test from "node:test";
import { diffLmObjective, normalizeLmObjective, parseLmObjectiveFeed, reconcileLmObjectiveFeed, reconcileLmObjectiveFeedSnapshot, feedJson } from "../lib/lm-objective-feed.js";

const raw = {
  "9": {
    url: "https://mxsys.pages.gitlab.us.lmco.com/eng/non-eci/objective/9",
    jpo: "MCP-122, MCP-123",
    jira: "A2O-401838",
    "cel-to": "NON-ECI",
    title: "Modernized PMA/Tablet Platform",
    roadmap_parent: "",
    scope: "",
    domains: ["Architecture", "Continuous Integration", "Infrastructure"],
    blocks: ["13", "arch_plan_44", "120"],
    blocked_by: ["arch_plan_154"],
    target_start: "2026-Q1",
    target_finish: "2026-Q3",
    rom: "38.73",
    percent_complete: 13,
    funding: "RDT&E",
    release: "",
    overview: "Reduce product maintenance.",
    background: "Current program context.",
    owner_only_feed_field: { retained: true },
  },
};

test("parses object-keyed GitLab feed and preserves multi-valued JPO and relationships", () => {
  const result = parseLmObjectiveFeed(JSON.stringify(raw));
  assert.equal(result.sourceRecordCount, 1);
  assert.deepEqual(result.issues, []);
  const record = result.records[0];
  assert.equal(record.sourceKey, "9");
  assert.deepEqual(record.jpoIds, ["MCP-122", "MCP-123"]);
  assert.deepEqual(record.blocks, ["120", "13", "arch_plan_44"]);
  assert.deepEqual(record.blockedBy, ["arch_plan_154"]);
  assert.equal(record.rom, 38.73);
  assert.equal(record.percentComplete, 13);
  assert.equal(record.relTo, "NON-ECI");
  assert.deepEqual(record.extra, { owner_only_feed_field: { retained: true } });
});

test("accepts the current rel-to and 1-n spellings used by daily exports", () => {
  const result = parseLmObjectiveFeed({ "42": { jira: "A2O-42", "rel-to": "ECI", "1-n": 42, title: "Current spelling" } });
  assert.equal(result.records[0].relTo, "ECI");
  assert.equal(result.records[0].itemNumber, 42);
});

test("accepts array exports, rejects malformed JSON, and flags invalid percent values", () => {
  assert.equal(parseLmObjectiveFeed("not-json").issues[0], "The Lockheed objective file is not valid JSON.");
  const result = parseLmObjectiveFeed([{ jira: "A2O-1", title: "Bad", percent_complete: 101 }]);
  assert.equal(result.records[0].sourceKey, "0");
  assert.match(result.issues[0], /between 0 and 100/);
});

test("reconciliation records numeric, scalar, and relationship changes without treating array order as a change", () => {
  const before = normalizeLmObjective({ ...raw["9"], domains: ["Infrastructure", "Architecture"], rom: "38.73", percent_complete: 13 }, "9");
  const after = normalizeLmObjective({ ...raw["9"], domains: ["Architecture", "Infrastructure"], rom: "48.00", percent_complete: 48, blocks: ["13", "arch_plan_44", "120", "119"] }, "9");
  const changes = diffLmObjective(before, after);
  assert.deepEqual(changes.map((item) => item.field), ["blocks", "rom", "percentComplete"]);
  assert.equal(changes[1].before, 38.73);
  assert.equal(changes[1].after, 48);

  const reconciled = reconcileLmObjectiveFeed([before], [after]);
  assert.equal(reconciled.changed.length, 1);
  assert.deepEqual(reconciled.changed[0].changes, changes);
  assert.equal(reconciled.added.length, 0);
  assert.equal(reconciled.removed.length, 0);
});

test("multi-valued JPO does not become the objective identity; Jira remains stable", () => {
  const first = normalizeLmObjective({ jira: "A2O-401838", jpo: "MCP-122", title: "Objective" }, "9");
  const second = normalizeLmObjective({ jira: "A2O-401838", jpo: "MCP-122, MCP-124", title: "Objective" }, "9");
  const reconciled = reconcileLmObjectiveFeed([first], [second]);
  assert.equal(reconciled.changed.length, 1);
  assert.deepEqual(reconciled.changed[0].changes.map((item) => item.field), ["jpoRaw", "jpoIds"]);
});

test("a renamed root key retains the prior feed subject when its Jira identity is unambiguous", () => {
  const previous = normalizeLmObjective({ jira: "A2O-401838", title: "Objective" }, "9");
  const incoming = normalizeLmObjective({ jira: "A2O-401838", title: "Objective" }, "renumbered-9");
  const preview = reconcileLmObjectiveFeedSnapshot([incoming], [{ sourceKey: previous.sourceKey, objectiveId: "subject-9", normalizedPayload: feedJson(previous) }]);
  assert.equal(preview.added, 0);
  assert.equal(preview.changed, 1);
  assert.equal(preview.removed.length, 0);
  assert.equal(preview.items[0].objectiveId, "subject-9");
  assert.ok(preview.items[0].changedFields.includes("sourceKey"));
});
