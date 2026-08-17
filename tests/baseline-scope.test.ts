import assert from "node:assert/strict";
import test from "node:test";
import { matchesSourceScope, releaseOf, tierOf } from "../lib/baseline-scope.js";

const incompleteRow = { "#":"000277", ReleaseName:"30P05", Tier:"", Resource:"", ShortName:"zztest", LongName:"zztest" };

test("blank source hierarchy values remain selectable through Unassigned", () => {
  assert.equal(releaseOf(incompleteRow), "30P05");
  assert.equal(tierOf(incompleteRow), "Unassigned");
  assert.equal(matchesSourceScope(incompleteRow,"30P05","Unassigned"),true);
});

test("Unassigned ReleaseName selects rows whose retained value is blank", () => {
  const row = { ...incompleteRow, ReleaseName:"" };
  assert.equal(releaseOf(row),"Unassigned");
  assert.equal(matchesSourceScope(row,"Unassigned","Unassigned"),true);
});
