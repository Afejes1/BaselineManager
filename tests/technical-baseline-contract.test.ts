import assert from "node:assert/strict";
import test from "node:test";
import {
  TECHNICAL_BASELINE_COLUMNS, booleanCell, exactContractValues, normalizeIdentity,
  numericCell, reconcileRows, rowFromCells, rowIdentities, sourceRow24, validateHeaders,
} from "../lib/technical-baseline-contract.js";
import { allContractValues, hostOnlyRow, productOnTwoPlatforms } from "./technical-baseline-fixtures.js";

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

test("headers require exact order and spelling", () => {
  assert.deepEqual(validateHeaders(TECHNICAL_BASELINE_COLUMNS), []);
  assert.equal(validateHeaders([...TECHNICAL_BASELINE_COLUMNS].reverse())[0].code, "HeaderMismatch");
});
