import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { TECHNICAL_BASELINE_COLUMNS, exactContractValues, sourceRow24 } from "../lib/technical-baseline-contract.js";
import { allContractValues } from "./technical-baseline-fixtures.js";

test("XLSX export and re-import preserves the exact 24 headers and retained values", () => {
  const source = sourceRow24(allContractValues as Record<string, string>, 2);
  const sheet = XLSX.utils.aoa_to_sheet([[...TECHNICAL_BASELINE_COLUMNS], [...exactContractValues(source)]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Technical Baseline");
  const bytes = XLSX.write(workbook, { type:"buffer", bookType:"xlsx" });
  const roundTrip = XLSX.read(bytes, { type:"buffer", raw:true });
  const cells = XLSX.utils.sheet_to_json(roundTrip.Sheets[roundTrip.SheetNames[0]], { header:1, defval:"", raw:true }) as unknown[][];
  assert.deepEqual(cells[0], [...TECHNICAL_BASELINE_COLUMNS]);
  assert.equal(cells[0].length, 24);
  assert.deepEqual(cells[1], [...exactContractValues(source)]);
});
