import assert from "node:assert/strict";
import test from "node:test";
import { intakeIdentity, reconcileIntake } from "../lib/import-reconciliation.js";
import type { TechnicalBaselineRow } from "../lib/technical-baseline-contract.js";

const fixture = (values: TechnicalBaselineRow) => values;

test("intake identity scopes a repeated source key by release", () => {
  const r5 = fixture({ "#": "42", ReleaseName: "Release 5", LongName: "Service" });
  const r6 = fixture({ "#": "42", ReleaseName: "Release 6", LongName: "Service" });
  assert.notEqual(intakeIdentity(r5), intakeIdentity(r6));
});

test("reconciliation distinguishes added, changed, unchanged, removed, and conflicting rows", () => {
  const retained = fixture({ "#": "1", ReleaseName: "Release 5", LongName: "Retained" });
  const changed = fixture({ "#": "2", ReleaseName: "Release 5", LongName: "Changed" });
  const removed = fixture({ "#": "3", ReleaseName: "Release 5", LongName: "Removed" });
  const nextChanged = { ...changed, "HW_RAM (GB)": 64 };
  const added = fixture({ "#": "4", ReleaseName: "Release 6", LongName: "Added" });
  const duplicate = fixture({ "#": "5", ReleaseName: "Release 6", LongName: "Duplicate" });
  assert.deepEqual(reconcileIntake([retained, changed, removed], [retained, nextChanged, added, duplicate, { ...duplicate }]), {
    added: 1, changed: 1, unchanged: 1, removedFromWorkingProjection: 1, conflicts: 1, conflictKeys: ["release 6|source:5"],
  });
});
