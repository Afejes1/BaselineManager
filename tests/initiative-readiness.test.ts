import assert from "node:assert/strict";
import test from "node:test";
import type { InitiativeDecisionBundle } from "../lib/initiative-decision-model.js";
import { assessInitiative, estimateVariance } from "../lib/initiative-readiness.js";

function completeBundle(): InitiativeDecisionBundle {
  const request = { id: "cr-1", typeId: "mcp", typeCode: "MCP", typeLabel: "Maintenance Change Proposal", externalSystem: "External CR", externalIdentifier: "MCP-1", title: "Modernize runtime", externalStatus: "Review", externalOwner: "Incumbent", sourceLocator: "CR://MCP-1", sourceAsOf: "2026-08-18", requestedReleaseId: "r7", requestedReleaseName: "Release 7", governmentPriority: "critical" as const, decisionStatus: "fund" as const, decisionAuthority: "Colonel", decisionAt: "2026-08-18", decisionRationale: "Bounded decision", summary: "Change runtime", consequenceIfFunded: "Removes risk", consequenceIfDeferred: "Risk remains", impactSummary: "Modifies product runtime", knockOnEffects: "Regression", updatedAt: "2026-08-18" };
  const signoff = { id: "sign-1", criterionId: "c-t3", signoffRole: "Acceptance authority", signer: "Government", decision: "accepted" as const, decidedAt: "2026-08-18", rationale: "Evidence accepted", evidenceDocumentId: null, updatedAt: "2026-08-18" };
  return {
    initiative: { id: "initiative-1", title: "Remove Java 8", status: "decision_required", priority: "critical", owner: "Government", targetDate: "2027-06-30", consequence: "Risk remains", desiredOutcome: "Supported runtime", decisionAsk: "Fund MCP-1", asIsStatement: "Java 8 fielded", toBeStatement: "Supported LTS fielded", successMeasures: "Zero Java 8", briefingAudience: "Colonel", decisionNeededBy: "2026-09-15", primaryReleaseId: "r7", primaryReleaseName: "Release 7", updatedAt: "2026-08-18" },
    links: [{ id: "link-1", initiativeId: "initiative-1", changeRequestId: "cr-1", relationship: "delivers", contributionSummary: "Delivers supported runtime", sortOrder: 0 }],
    changeRequests: [request],
    objectives: [{ id: "obj-1", changeRequestId: "cr-1", externalSystem: "Objectives", externalIdentifier: "OBJ-1", title: "Upgrade runtime", summary: "Technical work", technicalOwner: "Incumbent", status: "planned", plannedStart: "2026-10-01", plannedFinish: "2027-02-01", actualStart: null, actualFinish: null, sourceLocator: "OBJ://1", sourceAsOf: "2026-08-18", updatedAt: "2026-08-18", estimates: [
      { id: "e-inc", objectiveId: "obj-1", estimateSource: "incumbent", hoursLow: 80, hoursLikely: 100, hoursHigh: 120, costLow: null, costLikely: 1000, costHigh: null, basis: "Work packages", assumptions: null, sourceReference: "EST://INC", asOf: "2026-08-10", confidence: "medium", createdAt: "2026-08-10" },
      { id: "e-gov", objectiveId: "obj-1", estimateSource: "government", hoursLow: 40, hoursLikely: 60, hoursHigh: 90, costLow: null, costLikely: 600, costHigh: null, basis: "Reference class", assumptions: null, sourceReference: "EST://GOV", asOf: "2026-08-12", confidence: "medium", createdAt: "2026-08-12" },
    ] }],
    requirements: [{ id: "req-1", objectiveId: "obj-1", externalIdentifier: "REQ-1", title: "Supported runtime", sourceSystem: "Requirements", sourceLocator: "REQ://1", sourceAsOf: "2026-08-18", changeAction: "modify", beforeText: "Approved runtime", afterText: "Supported LTS", rationale: "Verifiable", traceStatus: "verified", updatedAt: "2026-08-18" }],
    criteria: [
      { id: "c-t3", objectiveId: "obj-1", requirementTraceId: "req-1", tier: "tier_3", code: "T3-1", statement: "Mission thread succeeds", verificationMethod: "demonstration", status: "passed", plannedDate: "2026-08-17", actualDate: "2026-08-17", evidenceReference: "EVID://T3", signoffs: [signoff], updatedAt: "2026-08-18" },
      { id: "c-t4", objectiveId: "obj-1", requirementTraceId: "req-1", tier: "tier_4", code: "T4-1", statement: "No Java 8 found", verificationMethod: "test", status: "passed", plannedDate: "2026-08-17", actualDate: "2026-08-17", evidenceReference: "EVID://T4", signoffs: [{ ...signoff, id: "sign-2", criterionId: "c-t4" }], updatedAt: "2026-08-18" },
    ],
    milestones: [{ id: "m-1", initiativeId: "initiative-1", changeRequestId: "cr-1", objectiveId: "obj-1", title: "Fielding", milestoneType: "fielding", plannedDate: "2027-06-01", actualDate: null, status: "planned", consequenceIfMissed: "Delay", owner: "Fielding", sortOrder: 0, updatedAt: "2026-08-18" }],
    changes: { types: [], requests: [request], effects: [{ id: "effect-1", changeRequestId: "cr-1", subjectKind: "product", subjectId: "p-1", subjectLabel: "Product", action: "modify", aspect: "runtime", fromReleaseId: "r6", fromReleaseName: "Release 6", toReleaseId: "r7", toReleaseName: "Release 7", currentValue: "Java 8", targetValue: "Supported LTS", consequence: "Risk removed", rationale: "Modernize", confidence: "assessed", sourceOccurrenceId: null }], dependencies: [], releases: [], subjects: [] },
  };
}

test("a complete evidence chain is decision ready", () => {
  const result = assessInitiative(completeBundle(), new Date("2026-08-18T12:00:00Z"));
  assert.equal(result.stage, "decision_ready");
  assert.equal(result.blockers, 0);
  assert.equal(result.warnings, 0);
  assert.equal(result.score, 100);
});

test("missing requirement and acceptance trace blocks readiness", () => {
  const bundle = completeBundle();
  bundle.requirements = [];
  bundle.criteria = [];
  const result = assessInitiative(bundle, new Date("2026-08-18T12:00:00Z"));
  assert.equal(result.stage, "not_ready");
  assert.ok(result.findings.some((item) => item.title.includes("no requirement trace")));
  assert.ok(result.findings.some((item) => item.title.includes("no acceptance criteria")));
});

test("a single-source estimate is surfaced without inventing certainty", () => {
  const bundle = completeBundle();
  bundle.objectives[0].estimates = bundle.objectives[0].estimates.filter((item) => item.estimateSource === "incumbent");
  const result = assessInitiative(bundle, new Date("2026-08-18T12:00:00Z"));
  assert.equal(result.stage, "analysis_incomplete");
  assert.ok(result.findings.some((item) => item.category === "estimate" && item.title.includes("independent assessment")));
});

test("overdue acceptance and missed milestones preserve the consequence", () => {
  const bundle = completeBundle();
  bundle.criteria[0] = { ...bundle.criteria[0], status: "in_verification", evidenceReference: null, signoffs: [] };
  bundle.milestones[0] = { ...bundle.milestones[0], status: "missed", consequenceIfMissed: "Release 7 misses fielding" };
  const result = assessInitiative(bundle, new Date("2026-08-18T12:00:00Z"));
  assert.ok(result.findings.some((item) => item.title.includes("verification is overdue")));
  assert.ok(result.findings.some((item) => item.detail === "Release 7 misses fielding"));
});

test("latest sourced likely estimates roll up separately", () => {
  const variance = estimateVariance(completeBundle());
  assert.deepEqual(variance, { incumbentHours: 100, assessedHours: 60, incumbentCost: 1000, assessedCost: 600 });
});
