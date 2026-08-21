import assert from "node:assert/strict";
import test from "node:test";
import {
  TECHNICAL_BASELINE_COLUMNS, booleanCell, describeTechnicalBaselineHeaderIssue, diagnoseTechnicalBaselineHeaders, exactContractValues, normalizeIdentity,
  numericCell, reconcileRows, rowFromCells, rowIdentities, sourceRow24, validateHeaders, validateRows,
} from "../lib/technical-baseline-contract.js";
import { allContractValues, hostOnlyRow, productAcrossTwoReleases, productOnTwoPlatforms } from "./technical-baseline-fixtures.js";

test("retains the exact 24-column contract, including # and every Notes column", () => {
  const row = sourceRow24(allContractValues as Record<string, string>, 2);
  assert.equal(TECHNICAL_BASELINE_COLUMNS.length, 24);
  assert.deepEqual(exactContractValues(row), TECHNICAL_BASELINE_COLUMNS.map((column) => allContractValues[column]));
  assert.equal(row.values["#"], "42");
  assert.equal(row.values["Notes.4"], "v-23");
});

test("row-array ingestion is workbook-library neutral and preserves blanks", () => {
  const row = rowFromCells(["1", "R", "T", "P", "SW", "S", "H", "SSD", 0, 0, "", "", "", "", "No", "", "", "", "", "", "", "", "", ""], 2);
  assert.equal(row.values["HW_Storage (GB)"], 0);
  assert.equal(row.values["HW_RAM (GB)"], "");
  assert.equal(row.values["Notes.4"], "");
});

test("normalizes identities without conflating distinct deployments", () => {
  const first = rowIdentities(productOnTwoPlatforms[0]);
  const second = rowIdentities(productOnTwoPlatforms[1]);
  assert.equal(normalizeIdentity("  MXP   1 "), "mxp 1");
  assert.equal(first.release, second.release);
  assert.equal(first.product, second.product);
  assert.notEqual(first.deployment, second.deployment);
});

test("retains one canonical product identity while distinguishing its release occurrences", () => {
  const prior = rowIdentities(productAcrossTwoReleases[0]);
  const current = rowIdentities(productAcrossTwoReleases[1]);
  assert.equal(prior.product, current.product);
  assert.notEqual(prior.release, current.release);
  assert.notEqual(prior.deployment, current.deployment);
});

test("host-only rows remain valid source occurrences", () => {
  const row = sourceRow24(hostOnlyRow as Record<string, string | number | null>, 8);
  assert.equal(row.values.HW_Host, "host-a");
  assert.equal(row.values["HW_CPU_CORES"], 0);
  assert.equal(row.values.LongName, undefined);
});

test("blank, zero, and boolean values remain distinguishable", () => {
  assert.equal(numericCell(""), undefined);
  assert.equal(numericCell(0), 0);
  assert.equal(numericCell("0"), 0);
  assert.equal(booleanCell("No"), false);
  assert.equal(booleanCell(""), undefined);
});

test("reconciliation is deterministic and reports exact changed columns", () => {
  const before = productOnTwoPlatforms.map((row, index) => sourceRow24(row, index + 2));
  const changed = sourceRow24({ ...productOnTwoPlatforms[0], Notes: "revised" }, 99);
  const result = reconcileRows(before, [changed, before[1]]);
  assert.equal(result.changed.length, 1);
  assert.deepEqual(result.changed[0].changedColumns, ["Notes"]);
  assert.equal(result.unchanged.length, 1);
  assert.equal(result.added.length, 0);
});

test("reconciliation permits a repeated # across releases and matches it within the correct release", () => {
  const release5 = sourceRow24({ ...productAcrossTwoReleases[0], "#": "42" }, 2);
  const release6 = sourceRow24({ ...productAcrossTwoReleases[1], "#": "42" }, 3);
  const changedRelease6 = sourceRow24({ ...release6.values, Notes: "Release 6 correction" }, 4);
  const result = reconcileRows([release5, release6], [release5, changedRelease6]);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.unchanged.length, 1);
  assert.equal(result.changed.length, 1);
  assert.equal(result.changed[0].before.rowNumber, 3);
  assert.deepEqual(result.changed[0].changedColumns, ["Notes"]);
});

test("validation blocks a duplicate # only when it repeats within the same release", () => {
  const release5 = sourceRow24({ ...productAcrossTwoReleases[0], "#": "42" }, 2);
  const release6 = sourceRow24({ ...productAcrossTwoReleases[1], "#": "42" }, 3);
  const duplicateRelease5 = sourceRow24({ ...productAcrossTwoReleases[0], "#": "42", HW_Host: "host-b" }, 4);
  assert.equal(validateRows([release5, release6]).filter((issue) => issue.code === "DuplicateRowKey").length, 0);
  const conflicts = validateRows([release5, duplicateRelease5]);
  assert.equal(conflicts.filter((issue) => issue.code === "DuplicateRowKey").length, 1);
  assert.match(conflicts[0].message, /30P05/);
  assert.match(conflicts[0].message, /row 2/);
});

test("headers require exact order and spelling", () => {
  assert.deepEqual(validateHeaders(TECHNICAL_BASELINE_COLUMNS), []);
  assert.equal(validateHeaders([...TECHNICAL_BASELINE_COLUMNS].reverse())[0].code, "HeaderMismatch");
});

test("header diagnostics identify a non-contract CSCI column without accepting it silently", () => {
  const headers = [...TECHNICAL_BASELINE_COLUMNS, "CSCI"];
  const diagnostic = diagnoseTechnicalBaselineHeaders(headers);
  assert.equal(diagnostic.valid, false);
  assert.equal(diagnostic.actualColumnCount, 25);
  assert.deepEqual(diagnostic.unexpected, [{ name: "CSCI", actualPosition: 25 }]);
  assert.match(describeTechnicalBaselineHeaderIssue(headers), /Unexpected column: CSCI \(column 25\)/);
});
