import assert from "node:assert/strict";
import test from "node:test";
import { dataQualityFor } from "../lib/baseline-quality.js";
import { hostOnlyRow } from "./technical-baseline-fixtures.js";

const complete = {
  "#":"000184", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"ALIS Core",
  ShortName:"ODIN", LongName:"Operational Data Integrated Network", HW_Host:"VM-APP-012",
  HW_Storage_Type:"SSD", "HW_Storage (GB)":850, HW_CPU_CORES:16, "HW_RAM (GB)":64,
  Containerized:"Yes", "Container Technology":"Kubernetes", Notes:"A source note is not a validation failure.",
};

test("notes do not change a complete row into review", () => {
  assert.deepEqual(dataQualityFor(complete), { level:"ready", label:"Complete", issues:[] });
});

test("missing hierarchy values produce field-specific review reasons", () => {
  const quality = dataQualityFor({ ...complete, Tier:"", Resource:"" });
  assert.equal(quality.label, "Review");
  assert.deepEqual(quality.issues.map((issue) => issue.field), ["Tier", "Resource"]);
});

test("missing ReleaseName blocks materialization", () => {
  const quality = dataQualityFor({ ...complete, ReleaseName:"" });
  assert.equal(quality.label, "Blocking");
  assert.ok(quality.issues.some((issue) => issue.field === "ReleaseName" && issue.severity === "blocking"));
});

test("a valid host-only source row can be complete", () => {
  assert.equal(dataQualityFor(hostOnlyRow).label, "Complete");
});

test("reported storage capacity without a type requires review", () => {
  const quality = dataQualityFor({ ...complete, HW_Storage_Type:"" });
  assert.ok(quality.issues.some((issue) => issue.field === "HW_Storage_Type"));
});

test("a containerized row without container technology requires review", () => {
  const quality = dataQualityFor({ ...complete, "Container Technology":"" });
  assert.ok(quality.issues.some((issue) => issue.field === "Container Technology"));
});
