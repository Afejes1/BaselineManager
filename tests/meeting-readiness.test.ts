import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import JSZip from "jszip";
import type { BriefSnapshot, EvidenceDocument, ExecutiveBrief } from "../lib/governance-model.js";
import type { InitiativeAssessment, InitiativeDecisionBundle, InitiativeDecisionWorkspace } from "../lib/initiative-decision-model.js";
import { EvidenceValidationError, validateEvidenceBytes } from "../lib/evidence-validation.js";
import { parseBriefMarkdown, prepareBriefDocx, prepareBriefMarkdown, prepareBriefPdf } from "../lib/brief-export.js";
import { isCurrentBriefSnapshot } from "../lib/brief-publication.js";
import { buildInitiativeReportMarkdown } from "../lib/initiative-report.js";
import { deriveInitiativeScope } from "../lib/initiative-scope.js";
import { assessInitiative, estimateVariance } from "../lib/initiative-readiness.js";
import { parseReportedRom } from "../lib/lm-objective-feed.js";
import { milestoneLifecycleIssues, objectiveIdsLeavingInitiativeScope, objectiveLifecycleIssues, requirementHasAcceptancePath, requirementNeedsAcceptancePath } from "../lib/initiative-workflow-invariants.js";
import { DEMONSTRATION_SOURCE_FILE_NAME, PROGRAM_HANDLING_MARKING, SYNTHETIC_HANDLING_MARKING, handlingMarkingFromSourceLineage, handlingMarkingFromSourceNames, sourceKeyIsSynthetic, sourceNameIsSynthetic, workspaceClassificationFromSourceLineage } from "../lib/output-handling.js";
import { parseAssistantAnswer } from "../lib/assistant-model.js";
import { GenaiMilError, approvedGenaiMilUrl, askGenaiMil, genaiMilReadiness } from "../lib/genai-mil.js";
import { buildDependencyBoard } from "../lib/dependency-board-model.js";
import { buildInfrastructureMermaid } from "../lib/infrastructure-mermaid.js";
import { parseCdSwMatrix } from "../lib/cd-sw-import.js";
import { countUniqueRequirements, deriveSolutionOptionRollup } from "../lib/solution-option-rollup.js";
import { buildSolutionDecisionBasis, canonicalSolutionDecisionBasis, hashSolutionDecisionBasis } from "../lib/solution-decision-basis.js";
import { validateSolutionDecisionHistory } from "../lib/solution-decision-history.js";

const read = (path: string) => readFileSync(path, "utf8");

test("CD SW parser finds staggered machine headers and materializes X placements", () => {
  const matrix = [
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "Physical", "Virtual_Appliance", "Virtual_Linux"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "Machine UUID", "dd983160-26f8-44cb-9f0d-be7dbd87633e", "5fd340e2-2de7-4231-8f98-9e115e91532e", "3172d7ce-9714-40a5-b9a4-b5cd6af56eb4"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "Hostname", "DMZHOST", "Internal Firewall", "k8manager0"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "ID", "7005", "7007-VM1", "7007-VM5"],
    ["Software Component", "Software Name", "Version", "Description", "Vendor", "CSCI", "Type", "Trusted", "NIAP", "Verified By", "UUID", "Alias", "", "", "", ""],
    ["AIHM-AFRS", "AFRS Custom Developed Code", "226.2.20.4", "Source description", "LM", "AIHM-AFR", "Dev", "", "", "Assessor", "e2e99f47-06b8-46c8-9a98-bdf12a1c7f5e", "AFRS_PMA", "", "X", "", "X"],
    ["Enterprise", "MongoDB Enterprise", "7.0.11.1", "NoSQL database", "MongoDB", "AIHM-AVD", "COTS", "", "", "", "43fc2cea-enterprise-mongodb", "enterprise_mongodb", "", "", "X", ""],
  ];
  const parsed = parseCdSwMatrix(matrix);
  assert.equal(parsed.headerRowNumber, 5);
  assert.equal(parsed.machineStartColumn, 13);
  assert.equal(parsed.machines.length, 3);
  assert.equal(parsed.softwareRows.length, 2);
  assert.equal(parsed.placementCount, 3);
  assert.equal(parsed.machines[0].nodeType, "physical_server");
  assert.equal(parsed.machines[1].nodeType, "virtual_machine");
  assert.deepEqual(parsed.softwareRows[0].machineKeys, [parsed.machines[0].key, parsed.machines[2].key]);
  assert.equal(parsed.softwareRows[1].installationRole, "database");
});

test("CD SW parser blocks ambiguous duplicate source identities", () => {
  const matrix = [
    ["", "", "", "", "Physical", "Physical"],
    ["", "", "", "Machine UUID", "same-machine", "same-machine"],
    ["", "", "", "Hostname", "Server A", "Server B"],
    ["", "", "", "ID", "A", "B"],
    ["Software Component", "Software Name", "Version", "Alias", "", ""],
    ["Component", "Product", "1.0", "instance", "X", "X"],
  ];
  const parsed = parseCdSwMatrix(matrix);
  assert.ok(parsed.machines.every((machine) => machine.issues.some((issue) => issue.includes("more than one column"))));
});

test("CD SW parser disambiguates repeated machine IDs with source UUIDs", () => {
  const matrix = [
    ["", "", "", "", "Physical", "Virtual"],
    ["", "", "", "Machine UUID", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
    ["", "", "", "Hostname", "Shared ID host", "Shared ID VM"],
    ["", "", "", "ID", "7005", "7005"],
    ["Software Component", "Software Name", "Version", "Alias", "", ""],
    ["Component", "Product", "1.0", "instance", "X", "X"],
  ];
  const parsed = parseCdSwMatrix(matrix);
  assert.equal(new Set(parsed.machines.map((machine) => machine.code)).size, 2);
  assert.ok(parsed.machines.every((machine) => machine.sourceCode === "7005"));
  assert.ok(parsed.machines.every((machine) => machine.warnings.some((warning) => warning.includes("repeated in this worksheet"))));
});

function reportFixture() {
  const bundle = {
    initiative: { id: "initiative-1", title: "Synthetic modernization", status: "decision_required", priority: "critical", owner: "Program office", targetDate: "2026-11-30", consequence: "Mission risk remains", desiredOutcome: "Supported runtime fielded", decisionAsk: "Authorize the bounded change", asIsStatement: "Legacy runtime remains", toBeStatement: "Supported runtime deployed", successMeasures: "All acceptance checks pass", briefingAudience: "Leadership", decisionNeededBy: "2026-09-01", primaryReleaseId: "release-1", primaryReleaseName: "Release 1", updatedAt: "2026-08-20T12:00:00.000Z" },
    links: [{ id: "link-1", initiativeId: "initiative-1", changeRequestId: "cr-1", relationship: "delivers", contributionSummary: "Funds modernization", sortOrder: 0 }],
    changeRequests: [{ id: "cr-1", externalIdentifier: "MCP-001", title: "Modernize runtime", decisionStatus: "fund", requestedReleaseName: "Release 1", impactSummary: "Replaces unsupported runtime", summary: "Modernization", updatedAt: "2026-08-20T13:00:00.000Z" }],
    objectives: [{ id: "objective-1", changeRequestId: "cr-1", externalIdentifier: "OBJ-001", title: "Implement supported runtime", status: "planned", technicalOwner: "Delivery team", plannedStart: "2026-09-15", plannedFinish: "2026-11-15", updatedAt: "2026-08-20T14:00:00.000Z", estimates: [{ id: "estimate-1", objectiveId: "objective-1", estimateSource: "government", hoursLikely: 120, costLikely: 48000, asOf: "2026-08-20", confidence: "medium", createdAt: "2026-08-20T14:00:00.000Z" }] }],
    objectiveChangeRequestLinks: [],
    requirements: [{ id: "trace-1", objectiveId: "objective-1", externalIdentifier: "REQ-001", title: "Supported runtime", changeAction: "modify", traceStatus: "verified", sourceLocator: "REQ://001", updatedAt: "2026-08-20T15:00:00.000Z" }],
    criteria: [{ id: "criterion-1", objectiveId: "objective-1", tier: "tier_4", code: "T4-001", statement: "Runtime inventory is clean", status: "passed", evidenceReference: "document-1", signoffs: [{ id: "signoff-1", criterionId: "criterion-1", signoffRole: "Acceptance authority", signer: "Government", decision: "accepted", updatedAt: "2026-08-20T16:00:00.000Z" }], updatedAt: "2026-08-20T16:00:00.000Z" }],
    milestones: [{ id: "milestone-1", initiativeId: "initiative-1", title: "Fielding", milestoneType: "fielding", plannedDate: "2026-11-30", status: "planned", owner: "Fielding team", consequenceIfMissed: "Release slips", updatedAt: "2026-08-20T17:00:00.000Z" }],
    changes: { requests: [], effects: [], dependencies: [] },
  } as unknown as InitiativeDecisionBundle;
  const assessment: InitiativeAssessment = { stage: "decision_ready", score: 100, blockers: 0, warnings: 0, decisionsPending: 0, requirementsTraced: 1, criteriaPassed: 1, findings: [] };
  const documents: EvidenceDocument[] = [{ id: "document-1", governanceRecordId: null, initiativeId: "initiative-1", fileName: "synthetic-verification.pdf", contentType: "application/pdf", byteSize: 2048, description: "Tier 4 verification result", quarantined: false, integritySealed: true, createdAt: "2026-08-20T18:00:00.000Z" }];
  const baseline: BriefSnapshot = { asOf: "2026-08-21T00:00:00.000Z", handlingMarking: "SYNTHETIC DEMONSTRATION DATA — NOT PROGRAM DATA", releaseName: "Release 1", sourceRows: 12, products: 3, releases: 1, reviewRows: 0, productNames: ["Synthetic Product"], linkedRecords: [{ type: "decision", title: "Synthetic authority decision", status: "approved" }] };
  return { bundle, assessment, documents, baseline };
}

test("saved leadership report contains the governed decision and evidence chain", () => {
  const fixture = reportFixture();
  const markdown = buildInitiativeReportMarkdown({ title: "Synthetic leadership report", generatedAt: "2026-08-21T00:00:00.000Z", dataLastChangedAt: "2026-08-20T18:00:00.000Z", ...fixture });
  for (const expected of ["SYNTHETIC DEMONSTRATION DATA", "## Information status", "## Leadership decision", "Authorize the bounded change", "## Decision readiness", "100% (Decision Ready)", "MCP-001", "OBJ-001", "REQ-001", "T4-001", "synthetic-verification.pdf", "document-1", "Dependency and affected-object analysis", "Linked calls, decisions, and risks", "Synthetic authority decision", "## Derived technical scope snapshot"]) assert.match(markdown, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("information origin, lifecycle, and adjudication are kept distinct across governed records", () => {
  const migration = read("drizzle/0027_information_status_clarity.sql");
  const model = read("lib/governance-model.ts");
  const server = read("lib/governance-server.ts");
  const evidence = read("app/evidence/page.tsx");
  const editor = read("components/evidence-record-editor.tsx");
  const key = read("components/provenance-key.tsx");
  const report = read("lib/initiative-report.ts");
  const objective = read("app/objectives/[id]/page.tsx");
  assert.match(migration, /information_origin/);
  assert.match(migration, /adjudication_authority/);
  assert.match(model, /informationOrigin: InformationOrigin/);
  assert.match(server, /An approved decision record requires a decision authority, decision date, and rationale/);
  assert.match(evidence, /Information origin/);
  assert.match(editor, /Record lifecycle/);
  assert.match(key, /Source claim/);
  assert.match(key, /Verification \/ acceptance/);
  assert.match(report, /## Information status/);
  assert.match(objective, /outbound navigation is disabled/);
  assert.doesNotMatch(objective, /target="_blank"/);
});

test("Initiative scope derives only the explicit affected objects on linked Change Requests", () => {
  const scope = deriveInitiativeScope({
    changeRequests: [{ id: "cr-pma", requestedReleaseName: "Future PMA release" }],
    objectives: [{ id: "objective-pma" }],
    objectiveEffectAttributions: [{ objectiveId: "objective-pma", changeEffectId: "effect-pma" }],
    changes: { effects: [
      { id: "effect-pma", changeRequestId: "cr-pma", subjectKind: "platform", subjectId: "platform-pma", subjectLabel: "PMA", action: "modify", aspect: "modernization", fromReleaseName: null, toReleaseName: "Future PMA release" },
      { id: "effect-product", changeRequestId: "cr-pma", subjectKind: "product", subjectId: "product-pma-client", subjectLabel: "PMA Client", action: "modify", aspect: "version", fromReleaseName: null, toReleaseName: "Future PMA release" },
      { id: "effect-record", changeRequestId: "cr-pma", subjectKind: "occurrence", subjectId: "baseline-row-7", subjectLabel: "PMA Client on Node 7", action: "modify", aspect: "deployment", fromReleaseName: null, toReleaseName: "Future PMA release" },
    ] },
  } as unknown as InitiativeDecisionBundle);
  assert.equal(scope.affectedObjects.length, 3);
  assert.equal(scope.objectCountByKind.get("platform"), 1);
  assert.equal(scope.objectCountByKind.get("product"), 1);
  assert.equal(scope.explicitBaselineRecordCount, 1);
  assert.equal(scope.attributedEffectCount, 1);
  assert.equal(scope.unattributedEffectCount, 2);
  assert.deepEqual(scope.transitionReleaseNames, ["Future PMA release"]);
  assert.deepEqual(scope.requestedReleaseNames, ["Future PMA release"]);
});

test("solution option rollup keeps source families, dependencies, dates, scope gaps, and optional work explicit", () => {
  const workspace = {
    initiatives: [{ id: "initiative-1", romHoursPerPoint: 500, romConversionRationale: "Synthetic planning factor" }],
    solutionOptions: [
      { id: "option-targeted", initiativeId: "initiative-1" },
      { id: "option-status-quo", initiativeId: "initiative-1" },
    ],
    solutionObjectiveLinks: [
      { id: "link-1", optionId: "option-targeted", objectiveId: "objective-1", role: "required" },
      { id: "link-duplicate", optionId: "option-targeted", objectiveId: "objective-1", role: "enabling" },
      { id: "link-2", optionId: "option-targeted", objectiveId: "objective-2", role: "enabling" },
      { id: "link-optional", optionId: "option-targeted", objectiveId: "objective-optional", role: "optional" },
    ],
    solutionChangeRequestLinks: [
      { id: "option-cr-1", optionId: "option-targeted", changeRequestId: "cr-1" },
      { id: "option-cr-2", optionId: "option-targeted", changeRequestId: "cr-2" },
    ],
    objectives: [
      { id: "objective-1", status: "planned", plannedStart: "2026-10-01", plannedFinish: "2026-12-01", estimates: [
        { id: "inc-1-old", objectiveId: "objective-1", estimateSource: "incumbent", hoursLow: 9000, hoursLikely: 9000, hoursHigh: 9000, asOf: "2026-07-01", createdAt: "2026-09-01T00:00:00Z" },
        { id: "inc-1", objectiveId: "objective-1", estimateSource: "incumbent", hoursLow: 100, hoursLikely: 150, hoursHigh: null, romPointsLow: 50, romPointsLikely: 50, romPointsHigh: 50, costLow: 10, costLikely: 15, costHigh: 20, asOf: "2026-08-01", createdAt: "2026-08-01T00:00:00Z" },
        { id: "gov-1", objectiveId: "objective-1", estimateSource: "government", hoursLow: 70, hoursLikely: 80, hoursHigh: 100, costLow: 7, costLikely: 8, costHigh: 10, asOf: "2026-08-02", createdAt: "2026-08-02T00:00:00Z" },
      ] },
      { id: "objective-2", status: "planned", plannedStart: "2026-99-99", plannedFinish: "2027-02-01", estimates: [
        { id: "inc-2", objectiveId: "objective-2", estimateSource: "incumbent", hoursLow: null, hoursLikely: null, hoursHigh: null, romPointsLow: 2, romPointsLikely: 3, romPointsHigh: 4, costLow: null, costLikely: null, costHigh: null, asOf: "2026-08-03", createdAt: "2026-08-03T00:00:00Z" },
      ] },
      { id: "objective-optional", status: "planned", plannedStart: null, plannedFinish: null, estimates: [{ id: "inc-optional", objectiveId: "objective-optional", estimateSource: "incumbent", hoursLow: 9999, hoursLikely: 9999, hoursHigh: 9999, asOf: "2026-08-04", createdAt: "2026-08-04T00:00:00Z" }] },
    ],
    objectiveEffectAttributions: [
      { objectiveId: "objective-1", changeEffectId: "effect-1" },
      { objectiveId: "objective-2", changeEffectId: "effect-2" },
      { objectiveId: "objective-optional", changeEffectId: "effect-optional" },
      { objectiveId: "objective-1", changeEffectId: "effect-cross-request" },
    ],
    objectiveDependencies: [
      { id: "gate-internal", dependentChangeRequestId: "cr-2", prerequisiteObjectiveId: "objective-1", relationship: "requires", status: "accepted", rationale: "internal", sourceReference: "GOV://GATE/1" },
      { id: "gate-inbound", dependentChangeRequestId: "cr-1", prerequisiteObjectiveId: "objective-outside", relationship: "requires", status: "proposed", rationale: "inbound", sourceReference: "GOV://GATE/2" },
      { id: "gate-rejected", dependentChangeRequestId: "cr-1", prerequisiteObjectiveId: "objective-outside-2", relationship: "requires", status: "rejected", rationale: "inactive", sourceReference: null },
    ],
    requirements: [
      { id: "trace-1", objectiveId: "objective-1", requirementId: "requirement-shared" },
      { id: "trace-2", objectiveId: "objective-2", requirementId: "requirement-shared" },
    ],
    changes: { effects: [
      { id: "effect-1", changeRequestId: "cr-1", subjectKind: "product", subjectId: "product-1", subjectLabel: "Product 1" },
      { id: "effect-2", changeRequestId: "cr-1", subjectKind: "product", subjectId: "product-1", subjectLabel: "Product 1" },
      { id: "effect-unattributed", changeRequestId: "cr-1", subjectKind: "platform", subjectId: "platform-1", subjectLabel: "Platform 1" },
      { id: "effect-optional", changeRequestId: "cr-1", subjectKind: "platform", subjectId: "platform-optional", subjectLabel: "Optional Platform" },
      { id: "effect-cross-request", changeRequestId: "cr-3", subjectKind: "platform", subjectId: "platform-cross", subjectLabel: "Cross-request Platform" },
    ], dependencies: [
      { id: "change-internal", predecessorRequestId: "cr-1", successorRequestId: "cr-2", dependencyType: "enables", confidence: "confirmed", rationale: "internal", sourceReference: "GOV://DEP/1" },
      { id: "change-internal-duplicate", predecessorRequestId: "cr-1", successorRequestId: "cr-2", dependencyType: "enables", confidence: "confirmed", rationale: "duplicate source", sourceReference: "GOV://DEP/1B" },
      { id: "change-inbound", predecessorRequestId: "cr-0", successorRequestId: "cr-1", dependencyType: "requires", confidence: "reported", rationale: "inbound", sourceReference: "LM://DEP/2" },
      { id: "change-outbound", predecessorRequestId: "cr-2", successorRequestId: "cr-3", dependencyType: "enables", confidence: "assessed", rationale: "outbound", sourceReference: "GOV://DEP/3" },
    ] },
  } as unknown as InitiativeDecisionWorkspace;
  const targeted = deriveSolutionOptionRollup(workspace, "option-targeted");
  assert.ok(targeted);
  assert.deepEqual(targeted.coreObjectiveIds, ["objective-1", "objective-2"]);
  assert.deepEqual(targeted.optionalObjectiveIds, ["objective-optional"]);
  assert.deepEqual([targeted.incumbent.hours.low, targeted.incumbent.hours.likely, targeted.incumbent.hours.high], [1100, 1650, 2000]);
  assert.deepEqual([targeted.incumbent.romPoints.low, targeted.incumbent.romPoints.likely, targeted.incumbent.romPoints.high], [52, 53, 54]);
  assert.equal(targeted.incumbent.hours.likelyCoverage.reported, 2);
  assert.equal(targeted.incumbent.hours.highCoverage.reported, 1);
  assert.equal(targeted.incumbent.hours.highCoverage.complete, false);
  assert.equal(targeted.government.hours.likelyCoverage.reported, 1);
  assert.equal(targeted.government.hours.likelyCoverage.complete, false);
  assert.equal(targeted.optional.incumbent.hours.likely, 9999);
  assert.equal(targeted.schedule.earliestPlannedStart, "2026-10-01");
  assert.equal(targeted.schedule.latestPlannedFinish, "2027-02-01");
  assert.deepEqual(targeted.schedule.invalidDateObjectiveIds, ["objective-2"]);
  assert.deepEqual([targeted.dependencies.internal.length, targeted.dependencies.inbound.length, targeted.dependencies.outbound.length], [2, 2, 1]);
  assert.equal(targeted.scope.effectCount, 2);
  assert.equal(targeted.scope.affectedObjectCount, 1);
  assert.equal(targeted.scope.unattributedChangeEffectCount, 1);
  assert.equal(targeted.scope.nonCoreAttributedEffectCount, 1);
  assert.equal(targeted.scope.coreEffectOutsideSelectedChangeCount, 1);
  assert.equal(countUniqueRequirements(workspace, targeted.coreObjectiveIds), 1);
  assert.match(targeted.warnings.join(" "), /invalid planned date/);
  assert.match(targeted.warnings.join(" "), /not selected for this option/);
  const statusQuo = deriveSolutionOptionRollup(workspace, "option-status-quo");
  assert.ok(statusQuo);
  assert.equal(statusQuo.incumbent.hours.likely, null);
  assert.match(statusQuo.warnings.join(" "), /No sourced transformation estimate/);
});

test("Solution Engineering migration and portable workspace contract retain adjudication separately from source records", () => {
  const migration = read("drizzle/0032_solution_engineering.sql");
  const decisionBasisMigration = read("drizzle/0033_solution_decision_basis.sql");
  const decisionRevisionMigration = read("drizzle/0035_solution_decision_revisions.sql");
  const transfer = read("lib/workspace-transfer.ts");
  const decisionHistory = read("lib/solution-decision-history.ts");
  const solutionServer = read("lib/initiative-solution-server.ts");
  const solutionUi = read("components/initiative-solution-engineering.tsx");
  assert.match(migration, /CREATE TABLE `solution_option`/);
  assert.match(migration, /CREATE TABLE `solution_option_objective`/);
  assert.match(migration, /CREATE TABLE `initiative_solution_decision`/);
  assert.match(migration, /initiative_solution_decision_complete/);
  assert.doesNotMatch(migration, /'selected','retired'/);
  assert.match(decisionBasisMigration, /basis_snapshot_json/);
  assert.match(decisionBasisMigration, /initiative_solution_decision_transition_guard/);
  assert.match(decisionBasisMigration, /selected_solution_option_update_guard/);
  assert.match(decisionRevisionMigration, /CREATE TABLE `initiative_solution_decision_revision`/);
  assert.match(decisionRevisionMigration, /Recorded Initiative decision revisions are immutable/);
  assert.match(solutionServer, /canonicalSolutionDecisionBasis/);
  assert.match(solutionServer, /Return the Initiative adjudication to pending before changing a completed decision/);
  assert.match(solutionServer, /source-backed basis, and adjudication metadata have not changed/);
  assert.match(solutionServer, /if \(metadataUnchanged\) throw new Error\("Enter fresh decision authority/);
  assert.match(solutionServer, /option\.status === "retired" \|\| option\.status === "not_selected"/);
  assert.match(solutionUi, /option\.status !== "retired" && option\.status !== "not_selected"/);
  assert.match(solutionUi, /SOURCE DRIFT — RE-ADJUDICATION REQUIRED/);
  assert.match(solutionUi, /Adjudication history/);
  assert.match(solutionUi, /legacy_unverified/);
  assert.match(read("app/globals.css"), /solution-decision-revision-legacy/);
  assert.match(transfer, /WORKSPACE_PACKAGE_VERSION = "6\.0\.0"/);
  assert.match(decisionRevisionMigration, /legacy_unverified/);
  assert.match(decisionHistory, /must contain every append-only revision in sequence/);
  assert.match(decisionHistory, /does not match its latest immutable revision/);
  assert.doesNotMatch(transfer, /initiativeSolutionDecisionRevisions" \? \["decision_id", "revision"\]/);
  assert.match(read("lib/demo-workspace-server.ts"), /DELETE FROM initiative_solution_decision_revision WHERE initiative_id=\?/);
  for (const table of ["solutionOptions", "solutionOptionSteps", "solutionOptionChangeRequests", "solutionOptionObjectives", "solutionOptionAssessments", "initiativeSolutionDecisions", "initiativeSolutionDecisionRevisions"]) assert.match(transfer, new RegExp(`"${table}"`));
});

test.skip("legacy selected adjudications upgrade to explicit unverified history and clean Pending state", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  const migrations = readdirSync("drizzle").filter((item) => item.endsWith(".sql")).sort();
  for (const name of migrations.filter((item) => item < "0033_solution_decision_basis.sql")) database.exec(read(`drizzle/${name}`));
  const at = "2026-08-27T12:00:00.000Z";
  database.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("program-test", "Test program", null, "UTC", at, at);
  database.prepare("INSERT INTO initiative (id,program_id,title,normalized_title,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("initiative-a", "program-test", "Initiative A", "initiative a", "draft", "medium", at, at);
  database.prepare("INSERT INTO solution_option (id,initiative_id,title,normalized_title,option_type,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("option-a", "initiative-a", "Option A", "option a", "candidate", "recommended", 0, at, at);
  database.prepare("INSERT INTO initiative_solution_decision (id,initiative_id,selected_option_id,disposition,decision_authority,decision_date,rationale,accepted_residual_risk,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("legacy-decision", "initiative-a", "option-a", "selected", "Legacy authority", "2026-08-20", "Legacy rationale", "Legacy residual risk", at, at);
  for (const name of migrations.filter((item) => item >= "0033_solution_decision_basis.sql")) database.exec(read(`drizzle/${name}`));
  const current = database.prepare("SELECT disposition,selected_option_id AS selectedOptionId,decision_authority AS authority,decision_revision AS revision,basis_hash AS basisHash FROM initiative_solution_decision WHERE id=?").get("legacy-decision") as { disposition: string; selectedOptionId: string | null; authority: string | null; revision: number; basisHash: string | null };
  assert.deepEqual({ ...current }, { disposition: "pending", selectedOptionId: null, authority: null, revision: 1, basisHash: null });
  const history = database.prepare("SELECT disposition,selected_option_id AS selectedOptionId,decision_authority AS authority,rationale,basis_snapshot_json AS basisSnapshot,basis_hash AS basisHash FROM initiative_solution_decision_revision WHERE decision_id=?").get("legacy-decision") as Record<string, unknown>;
  assert.deepEqual({ ...history }, { disposition: "legacy_unverified", selectedOptionId: "option-a", authority: "Legacy authority", rationale: "Legacy rationale", basisSnapshot: null, basisHash: null });
  database.close();
});

test.skip("pre-history decision counters normalize to only recoverable upgrade state", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  const migrations = readdirSync("drizzle").filter((item) => item.endsWith(".sql")).sort();
  for (const name of migrations.filter((item) => item < "0035_solution_decision_revisions.sql")) database.exec(read(`drizzle/${name}`));
  const at = "2026-08-27T12:00:00.000Z";
  database.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("program-test", "Test program", null, "UTC", at, at);
  for (const suffix of ["selected", "pending"]) {
    database.prepare("INSERT INTO initiative (id,program_id,title,normalized_title,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(`initiative-${suffix}`, "program-test", `Initiative ${suffix}`, `initiative ${suffix}`, "draft", "medium", at, at);
    database.prepare("INSERT INTO solution_option (id,initiative_id,title,normalized_title,option_type,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(`option-${suffix}`, `initiative-${suffix}`, `Option ${suffix}`, `option ${suffix}`, "candidate", "recommended", 0, at, at);
  }
  database.prepare("INSERT INTO initiative_solution_decision (id,initiative_id,selected_option_id,disposition,decision_authority,decision_date,rationale,basis_snapshot_json,basis_hash,decision_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("decision-selected", "initiative-selected", "option-selected", "selected", "Authority", "2026-08-27", "Recoverable current decision", "{}", `sha256:${"0".repeat(64)}`, 2, at, at);
  database.prepare("INSERT INTO initiative_solution_decision (id,initiative_id,disposition,decision_revision,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("decision-pending", "initiative-pending", "pending", 7, at, at);
  for (const name of migrations.filter((item) => item >= "0035_solution_decision_revisions.sql")) database.exec(read(`drizzle/${name}`));
  const selected = database.prepare("SELECT decision_revision AS revision FROM initiative_solution_decision WHERE id=?").get("decision-selected") as { revision: number };
  const pending = database.prepare("SELECT decision_revision AS revision FROM initiative_solution_decision WHERE id=?").get("decision-pending") as { revision: number };
  assert.equal(selected.revision, 1);
  assert.equal(pending.revision, 0);
  assert.deepEqual((database.prepare("SELECT decision_id AS decisionId,revision FROM initiative_solution_decision_revision ORDER BY decision_id").all() as Array<{ decisionId: string; revision: number }>).map((row) => ({ ...row })), [{ decisionId: "decision-selected", revision: 1 }]);
  database.close();
});

test("workspace decision-history validation rejects gaps, tampered hashes, and current/revision disagreement", async () => {
  const basisSnapshot = "{}";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basisSnapshot));
  const basisHash = `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
  const current = { id: "decision-1", initiative_id: "initiative-1", selected_option_id: "option-1", disposition: "selected", decision_authority: "Authority", decision_date: "2026-08-27", rationale: "Rationale", accepted_residual_risk: null, basis_snapshot_json: basisSnapshot, basis_hash: basisHash, decision_revision: 1, created_by_user_id: "user-1", updated_at: "2026-08-27T12:00:00.000Z" };
  const revision = { id: "revision-1", decision_id: "decision-1", initiative_id: "initiative-1", revision: 1, selected_option_id: "option-1", disposition: "selected", decision_authority: "Authority", decision_date: "2026-08-27", rationale: "Rationale", accepted_residual_risk: null, basis_snapshot_json: basisSnapshot, basis_hash: basisHash, created_by_user_id: "user-1", created_at: "2026-08-27T12:00:00.000Z" };
  const rows = (decision: Record<string, unknown> = current, revisions: Record<string, unknown>[] = [revision]) => new Map<string, Record<string, unknown>[]>([
    ["solution_option", [{ id: "option-1", initiative_id: "initiative-1" }]],
    ["initiative_solution_decision", [decision]],
    ["initiative_solution_decision_revision", revisions],
  ]);
  await validateSolutionDecisionHistory(rows());
  await assert.rejects(validateSolutionDecisionHistory(rows({ ...current, decision_revision: 2 })), /every append-only revision in sequence/);
  await assert.rejects(validateSolutionDecisionHistory(rows(current, [{ ...revision, basis_hash: `sha256:${"f".repeat(64)}` }])), /invalid frozen-basis hash/);
  await assert.rejects(validateSolutionDecisionHistory(rows(current, [{ ...revision, rationale: "Different rationale" }])), /does not match its latest immutable revision/);
  const pending = { ...current, selected_option_id: null, disposition: "pending", decision_authority: null, decision_date: null, rationale: null, accepted_residual_risk: null, basis_snapshot_json: null, basis_hash: null };
  const legacy = { ...revision, disposition: "legacy_unverified", basis_snapshot_json: null, basis_hash: null };
  await validateSolutionDecisionHistory(rows(pending, [legacy]));
  const formattedSnapshot = "{ \"z\": 2, \"a\": 1 }";
  const semanticHash = await hashSolutionDecisionBasis({ a: 1, z: 2 });
  const semanticCurrent = { ...current, basis_snapshot_json: formattedSnapshot, basis_hash: semanticHash };
  const semanticRevision = { ...revision, basis_snapshot_json: formattedSnapshot, basis_hash: semanticHash };
  await validateSolutionDecisionHistory(rows(semanticCurrent, [semanticRevision]));
});

test("all migrations apply through the Solution Engineering schema", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync("drizzle").filter((item) => item.endsWith(".sql")).sort()) database.exec(read(`drizzle/${name}`));
  const initiativeColumns = database.prepare("SELECT name FROM pragma_table_info('initiative') WHERE name IN ('problem_statement','drivers_constraints','decision_question','closed_at') ORDER BY name").all() as Array<{ name: string }>;
  assert.deepEqual(initiativeColumns.map((item) => item.name), ["closed_at", "decision_question", "drivers_constraints", "problem_statement"]);
  const solutionTables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'solution_%' ORDER BY name").all() as Array<{ name: string }>;
  assert.deepEqual(solutionTables.map((item) => item.name), ["solution_option", "solution_option_assessment", "solution_option_change_request", "solution_option_knock_on", "solution_option_objective", "solution_option_step", "solution_step_dependency", "solution_step_reference"]);
  const at = "2026-08-27T12:00:00.000Z";
  database.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("program-test", "Test program", null, "UTC", at, at);
  database.prepare("INSERT INTO initiative (id,program_id,title,normalized_title,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("initiative-a", "program-test", "Initiative A", "initiative a", "draft", "medium", at, at);
  database.prepare("INSERT INTO initiative (id,program_id,title,normalized_title,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("initiative-b", "program-test", "Initiative B", "initiative b", "draft", "medium", at, at);
  database.prepare("INSERT INTO solution_option (id,initiative_id,title,normalized_title,option_type,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("status-quo-a", "initiative-a", "Status quo", "status quo", "status_quo", "draft", 0, at, at);
  assert.throws(() => database.prepare("INSERT INTO solution_option (id,initiative_id,title,normalized_title,option_type,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("status-quo-duplicate", "initiative-a", "Another status quo", "another status quo", "status_quo", "draft", 1, at, at), /UNIQUE constraint failed/);
  assert.throws(() => database.prepare("DELETE FROM solution_option WHERE id=?").run("status-quo-a"), /required status-quo option cannot be deleted/);
  database.prepare("INSERT INTO solution_option (id,initiative_id,title,normalized_title,option_type,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("option-a", "initiative-a", "Option A", "option a", "candidate", "recommended", 0, at, at);
  database.prepare("INSERT INTO solution_option (id,initiative_id,title,normalized_title,option_type,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("option-b", "initiative-b", "Option B", "option b", "candidate", "recommended", 0, at, at);
  assert.throws(() => database.prepare("INSERT INTO initiative_solution_decision (id,initiative_id,selected_option_id,disposition,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("decision-incomplete", "initiative-a", "option-a", "selected", at, at), /CHECK constraint failed|frozen decision basis|valid initial revision/);
  assert.throws(() => database.prepare("INSERT INTO initiative_solution_decision (id,initiative_id,selected_option_id,disposition,decision_authority,decision_date,rationale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("decision-no-basis", "initiative-a", "option-a", "selected", "Decision authority", "2026-08-27", "Documented rationale", at, at), /frozen decision basis|valid initial revision/);
  const basisHash = `sha256:${"0".repeat(64)}`;
  assert.throws(() => database.prepare("INSERT INTO initiative_solution_decision (id,initiative_id,selected_option_id,disposition,decision_authority,decision_date,rationale,basis_snapshot_json,basis_hash,decision_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("decision-null-hash", "initiative-a", "option-a", "selected", "Decision authority", "2026-08-27", "Documented rationale", "{}", null, 1, at, at), /frozen decision basis/);
  assert.throws(() => database.prepare("INSERT INTO initiative_solution_decision (id,initiative_id,selected_option_id,disposition,decision_authority,decision_date,rationale,basis_snapshot_json,basis_hash,decision_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("decision-invalid-hash", "initiative-a", "option-a", "selected", "Decision authority", "2026-08-27", "Documented rationale", "{}", `sha256:0${"z".repeat(63)}`, 1, at, at), /frozen decision basis/);
  assert.throws(() => database.prepare("INSERT INTO initiative_solution_decision (id,initiative_id,selected_option_id,disposition,decision_authority,decision_date,rationale,basis_snapshot_json,basis_hash,decision_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("decision-cross", "initiative-a", "option-b", "selected", "Decision authority", "2026-08-27", "Documented rationale", "{}", basisHash, 1, at, at), /Selected solution option must belong to the Initiative/);
  database.prepare("INSERT INTO initiative_solution_decision (id,initiative_id,selected_option_id,disposition,decision_authority,decision_date,rationale,basis_snapshot_json,basis_hash,decision_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("decision-valid", "initiative-a", "option-a", "selected", "Decision authority", "2026-08-27", "Documented rationale", "{}", basisHash, 1, at, at);
  assert.deepEqual((database.prepare("SELECT revision,rationale,basis_snapshot_json AS basisSnapshotJson FROM initiative_solution_decision_revision WHERE decision_id=? ORDER BY revision").all("decision-valid") as Array<{ revision: number; rationale: string; basisSnapshotJson: string }>).map((row) => ({ ...row })), [{ revision: 1, rationale: "Documented rationale", basisSnapshotJson: "{}" }]);
  database.prepare("INSERT INTO initiative_solution_decision_maintenance_lock (id,operation_id,created_at) VALUES (1,?,?)").run("guard-test", at);
  database.prepare("DELETE FROM initiative_solution_decision_revision WHERE decision_id=? AND revision=1").run("decision-valid");
  database.prepare("DELETE FROM initiative_solution_decision_maintenance_lock WHERE id=1").run();
  assert.throws(() => database.prepare("INSERT INTO initiative_solution_decision_revision (id,decision_id,initiative_id,revision,selected_option_id,disposition,decision_authority,decision_date,rationale,basis_snapshot_json,basis_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("mismatched-revision", "decision-valid", "initiative-a", 1, "option-a", "selected", "Decision authority", "2026-08-27", "Tampered rationale", "{}", basisHash, at), /must match its Initiative, option, and current revision sequence/);
  database.prepare("INSERT INTO initiative_solution_decision_revision (id,decision_id,initiative_id,revision,selected_option_id,disposition,decision_authority,decision_date,rationale,basis_snapshot_json,basis_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("restored-revision", "decision-valid", "initiative-a", 1, "option-a", "selected", "Decision authority", "2026-08-27", "Documented rationale", "{}", basisHash, at);
  assert.throws(() => database.prepare("UPDATE initiative_solution_decision SET selected_option_id=? WHERE id=?").run("option-b", "decision-valid"), /Selected solution option must belong|Return the Initiative adjudication to pending/);
  assert.throws(() => database.prepare("UPDATE initiative_solution_decision SET decision_authority=?,decision_date=?,rationale=?,basis_snapshot_json=?,basis_hash=?,decision_revision=? WHERE id=?").run("Tampered", "2000-01-01", "Changed", "{\"tampered\":true}", `sha256:${"f".repeat(64)}`, 99, "decision-valid"), /Return the Initiative adjudication to pending/);
  assert.throws(() => database.prepare("UPDATE solution_option SET summary=? WHERE id=?").run("Changed after decision", "option-a"), /Return the Initiative adjudication to pending/);
  assert.throws(() => database.prepare("INSERT INTO solution_option_step (id,option_id,title,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("late-step", "option-a", "Late mutation", 0, at, at), /Return the Initiative adjudication to pending/);
  assert.equal((database.prepare("SELECT selected_option_id AS selectedOptionId FROM initiative_solution_decision WHERE id=?").get("decision-valid") as { selectedOptionId: string }).selectedOptionId, "option-a");
  database.prepare("UPDATE initiative_solution_decision SET disposition='pending',selected_option_id=NULL,decision_authority=NULL,decision_date=NULL,rationale=NULL,accepted_residual_risk=NULL,basis_snapshot_json=NULL,basis_hash=NULL WHERE id=?").run("decision-valid");
  assert.throws(() => database.prepare("UPDATE initiative_solution_decision SET initiative_id=? WHERE id=?").run("initiative-b", "decision-valid"), /revisions must advance exactly once/);
  assert.throws(() => database.prepare("DELETE FROM initiative_solution_decision WHERE id=?").run("decision-valid"), /revision history cannot be deleted/);
  assert.throws(() => database.prepare("UPDATE initiative_solution_decision_revision SET rationale=? WHERE decision_id=? AND revision=1").run("Changed history", "decision-valid"), /revisions are immutable/);
  assert.throws(() => database.prepare("DELETE FROM initiative_solution_decision_revision WHERE decision_id=? AND revision=1").run("decision-valid"), /revisions are append-only/);
  database.prepare("UPDATE solution_option SET summary=? WHERE id=?").run("Editable after pending", "option-a");
  assert.equal((database.prepare("SELECT summary FROM solution_option WHERE id=?").get("option-a") as { summary: string }).summary, "Editable after pending");
  const secondBasisHash = `sha256:${"1".repeat(64)}`;
  database.prepare("UPDATE initiative_solution_decision SET selected_option_id=?,disposition='selected',decision_authority=?,decision_date=?,rationale=?,basis_snapshot_json=?,basis_hash=?,decision_revision=2 WHERE id=?").run("option-a", "Decision authority", "2026-08-28", "Re-adjudicated after source review", "{\"revision\":2}", secondBasisHash, "decision-valid");
  assert.deepEqual((database.prepare("SELECT revision,rationale,basis_snapshot_json AS basisSnapshotJson FROM initiative_solution_decision_revision WHERE decision_id=? ORDER BY revision").all("decision-valid") as Array<{ revision: number; rationale: string; basisSnapshotJson: string }>).map((row) => ({ ...row })), [
    { revision: 1, rationale: "Documented rationale", basisSnapshotJson: "{}" },
    { revision: 2, rationale: "Re-adjudicated after source review", basisSnapshotJson: "{\"revision\":2}" },
  ]);
  database.prepare("INSERT INTO initiative_solution_decision_maintenance_lock (id,operation_id,created_at) VALUES (1,?,?)").run("demo-reset-test", at);
  database.prepare("UPDATE initiative_solution_decision SET selected_option_id=NULL,disposition='pending',decision_authority=NULL,decision_date=NULL,rationale=NULL,accepted_residual_risk=NULL,basis_snapshot_json=NULL,basis_hash=NULL WHERE id=?").run("decision-valid");
  database.prepare("DELETE FROM initiative_solution_decision_revision WHERE decision_id=?").run("decision-valid");
  database.prepare("DELETE FROM initiative_solution_decision WHERE id=?").run("decision-valid");
  database.prepare("DELETE FROM initiative_solution_decision_maintenance_lock WHERE id=1 AND operation_id=?").run("demo-reset-test");
  assert.deepEqual({ decisions: (database.prepare("SELECT count(*) AS count FROM initiative_solution_decision WHERE id=?").get("decision-valid") as { count: number }).count, revisions: (database.prepare("SELECT count(*) AS count FROM initiative_solution_decision_revision WHERE decision_id=?").get("decision-valid") as { count: number }).count, locks: (database.prepare("SELECT count(*) AS count FROM initiative_solution_decision_maintenance_lock").get() as { count: number }).count }, { decisions: 0, revisions: 0, locks: 0 });
  database.close();
});

function decisionBasisWorkspaceFixture() {
  const at = "2026-08-27T12:00:00.000Z";
  const workspace = {
    actor: { id: "user-1", displayName: "Decision analyst", role: "steward" },
    initiatives: [{
      id: "initiative-1", title: "Reduce unsupported runtime exposure", status: "decision_required", priority: "high", owner: "Program office",
      targetDate: "2027-03-31", consequence: "Unsupported runtime remains", desiredOutcome: "Supported runtime fielded", decisionAsk: "Select an option",
      asIsStatement: null, toBeStatement: null, successMeasures: null, briefingAudience: null, decisionNeededBy: null,
      problemStatement: "The current runtime is unsupported.", driversConstraints: "Fielding access is constrained.", romHoursPerPoint: 500,
      romConversionRationale: "Government planning factor", primaryReleaseId: null, primaryReleaseName: null, updatedAt: at,
    }],
    links: [{ id: "initiative-cr-1", initiativeId: "initiative-1", changeRequestId: "cr-1", relationship: "delivers", contributionSummary: null, sortOrder: 0 }],
    objectives: [{
      id: "objective-1", changeRequestId: "cr-1", externalSystem: "LM", externalIdentifier: "OBJ-001", title: "Containerize application", summary: null,
      technicalOwner: "Delivery team", status: "planned", plannedStart: "2026-10-01", plannedFinish: "2027-02-01", actualStart: null, actualFinish: null,
      sourceLocator: "LM://OBJ-001", sourceAsOf: "2026-08-15", updatedAt: at,
      estimates: [
        { id: "estimate-current", objectiveId: "objective-1", estimateSource: "incumbent", hoursLow: null, hoursLikely: null, hoursHigh: null, costLow: null, costLikely: null, costHigh: null, romPointsLow: 3, romPointsLikely: 4, romPointsHigh: 5, basis: "Current supplier ROM", assumptions: null, sourceReference: "LM://ROM/current", asOf: "2026-08-15", confidence: "unassessed", createdAt: at },
        { id: "estimate-history", objectiveId: "objective-1", estimateSource: "incumbent", hoursLow: 999, hoursLikely: 999, hoursHigh: 999, costLow: null, costLikely: null, costHigh: null, basis: "Superseded supplier ROM", assumptions: null, sourceReference: "LM://ROM/old", asOf: "2026-07-01", confidence: "unassessed", createdAt: "2026-07-01T12:00:00.000Z" },
      ],
    }],
    objectiveFeedSources: [{
      subjectId: "feed-subject-1", objectiveId: "objective-1", snapshotId: "snapshot-1", feedKey: "OBJ-001", fileName: "FOR_JPO.json",
      recordContentHash: `sha256:${"a".repeat(64)}`, sourceAsOf: "2026-08-15", observedAt: "2026-08-15T09:00:00.000Z", sourceLocator: "LM://OBJ-001",
      relatedTo: "MCP-122", roadmapParent: null, scope: "PMA", domains: ["😀-domain", "\uE000-domain", "ä-domain", "z-domain", "A-domain"], itemNumber: 1,
      targetStart: "2026-10-01", targetFinish: "2027-02-01", rom: null, percentComplete: 0, funding: "Proposed", release: null,
      overview: "Containerize the application.", background: null,
    }],
    initiativeEvidenceFingerprints: [{
      initiativeId: "initiative-1", documentId: "document-1", governanceRecordId: "record-1", fileName: "analysis.pdf", contentType: "application/pdf",
      byteSize: 2048, description: "Government analysis", sealedContentHash: `sha256:${"b".repeat(64)}`, quarantined: false, integrityStatus: "verified",
    }],
    objectiveChangeRequestLinks: [{ id: "objective-cr-1", objectiveId: "objective-1", changeRequestId: "cr-1", relationship: "primary", sourceSystem: "Government", sourceLocator: null, sourceAsOf: "2026-08-16", updatedAt: at }],
    objectiveDependencies: [{ id: "objective-gate-1", dependentChangeRequestId: "cr-1", prerequisiteObjectiveId: "objective-1", relationship: "requires", status: "accepted", rationale: "Internal gate", sourceReference: "GOV://GATE/1", sourceAsOf: "2026-08-16", evidenceReference: null, updatedAt: at }],
    objectiveEffectAttributions: [{ id: "attribution-1", objectiveId: "objective-1", changeEffectId: "effect-1", attribution: "primary", rationale: "Primary implementation effect", sourceReference: "GOV://ATTR/1", sourceAsOf: "2026-08-16", evidenceReference: null, confidence: "high", updatedAt: at }],
    requirements: [{ id: "trace-1", objectiveId: "objective-1", requirementId: "requirement-1", versionLabel: "v1", externalIdentifier: "REQ-001", title: "Supported runtime", sourceSystem: "Government", sourceLocator: "GOV://REQ/1", sourceAsOf: "2026-08-16", changeAction: "modify", beforeText: "Unsupported", afterText: "Supported", rationale: null, traceStatus: "verified", updatedAt: at }],
    criteria: [{
      id: "criterion-1", objectiveId: "objective-1", requirementTraceId: "trace-1", tier: "tier_3", code: "AC-001", statement: "Runtime is supported", verificationMethod: "inspection", status: "passed", plannedDate: "2027-02-01", actualDate: null, evidenceReference: null, updatedAt: at,
      signoffs: [{ id: "signoff-1", criterionId: "criterion-1", signoffRole: "Government acceptance", signer: "Authority", decision: "accepted", decidedAt: "2027-02-02", rationale: "Evidence reviewed", evidenceDocumentId: "document-1", evidenceIntegrityStatus: "verified", evidenceFingerprint: { documentId: "document-1", fileName: "analysis.pdf", byteSize: 2048, sealedContentHash: `sha256:${"b".repeat(64)}`, quarantined: false, integrityStatus: "verified" }, updatedAt: at }],
    }],
    milestones: [{ id: "milestone-1", initiativeId: "initiative-1", changeRequestId: "cr-1", objectiveId: "objective-1", title: "Fielding", milestoneType: "fielding", plannedDate: "2027-03-01", actualDate: null, status: "planned", consequenceIfMissed: null, owner: "Fielding team", sortOrder: 0, updatedAt: at }],
    solutionOptions: [{ id: "option-1", initiativeId: "initiative-1", title: "Containerize", optionType: "candidate", status: "recommended", summary: "Move to a supported container runtime.", projectedOutcome: "Supported runtime", expectedConsequences: "Migration effort", residualRisks: "Fielding access", assumptions: "Platform capacity is available", sortOrder: 0, updatedAt: at }],
    solutionSteps: [
      { id: "step-2", optionId: "option-1", title: "Field", description: null, expectedResult: "Supported runtime fielded", sortOrder: 1, updatedAt: at },
      { id: "step-1", optionId: "option-1", title: "Containerize", description: null, expectedResult: "Container image", sortOrder: 0, updatedAt: at },
    ],
    solutionChangeRequestLinks: [{ id: "option-cr-1", optionId: "option-1", changeRequestId: "cr-1", relationship: "delivers", rationale: null, updatedAt: at }],
    solutionObjectiveLinks: [{ id: "option-objective-1", optionId: "option-1", objectiveId: "objective-1", role: "required", rationale: null, updatedAt: at }],
    solutionAssessments: [{ id: "assessment-1", optionId: "option-1", criterion: "outcome_alignment", rating: "favorable", narrative: "Directly supports the outcome.", sourceReference: "GOV://ASSESS/1", confidence: "high", updatedAt: at }],
    solutionDecisions: [],
    solutionDecisionRevisions: [],
    changes: {
      types: [], releases: [], subjects: [],
      requests: [{ id: "cr-1", typeId: "type-1", typeCode: "MCP", typeLabel: "MCP", externalSystem: "MCP", externalIdentifier: "MCP-122", title: "Modernize PMA", externalStatus: "Proposed", externalOwner: "LM", sourceLocator: "MCP://122", sourceAsOf: "2026-08-14", requestedReleaseId: null, requestedReleaseName: null, governmentPriority: "high", decisionStatus: "analyze", decisionAuthority: null, decisionAt: null, decisionRationale: null, referenceStatus: "active", lifecycleRationale: null, summary: "Modernize PMA", consequenceIfFunded: null, consequenceIfDeferred: "Risk remains", impactSummary: "Runtime changes", knockOnEffects: null, updatedAt: at }],
      effects: [{ id: "effect-1", changeRequestId: "cr-1", subjectKind: "product", subjectId: "product-1", subjectLabel: "PMA application", action: "modify", aspect: "runtime", fromReleaseId: null, fromReleaseName: "Windows 10", toReleaseId: null, toReleaseName: "Container runtime", currentState: "Unsupported", targetState: "Supported", consequence: null, rationale: "Reduce lifecycle risk", confidence: "confirmed", sourceOccurrenceId: null, updatedAt: at }],
      dependencies: [{ id: "dependency-1", predecessorRequestId: "cr-0", successorRequestId: "cr-1", dependencyType: "requires", confidence: "confirmed", rationale: "Platform available first", sourceReference: "GOV://DEP/1", updatedAt: at }],
    },
    assessments: {},
  } as unknown as InitiativeDecisionWorkspace;
  workspace.objectiveFeedSources!.push({ ...workspace.objectiveFeedSources![0], subjectId: "feed-subject-unrelated", objectiveId: "objective-unrelated", snapshotId: "snapshot-unrelated", feedKey: "OBJ-UNRELATED", recordContentHash: `sha256:${"e".repeat(64)}` });
  workspace.initiativeEvidenceFingerprints!.push({ ...workspace.initiativeEvidenceFingerprints![0], initiativeId: "initiative-unrelated", documentId: "document-unrelated", governanceRecordId: null, fileName: "unrelated.pdf", sealedContentHash: `sha256:${"f".repeat(64)}` });
  return workspace;
}

function rewriteOperationalClocks(value: unknown) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(rewriteOperationalClocks); return; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "updatedAt" || key === "createdAt") (value as Record<string, unknown>)[key] = "2099-12-31T23:59:59.999Z";
    else rewriteOperationalClocks(child);
  }
}

test("solution decision basis builder is stable across ordering, write clocks, and superseded estimates", async () => {
  const left = decisionBasisWorkspaceFixture();
  const right = structuredClone(left);
  right.solutionSteps.reverse();
  right.objectives[0].estimates.reverse();
  right.objectiveFeedSources![0].domains.reverse();
  right.objectives[0].estimates.find((estimate) => estimate.id === "estimate-history")!.hoursLikely = 123456;
  rewriteOperationalClocks(right);

  const leftBasis = buildSolutionDecisionBasis(left, "initiative-1", "option-1") as unknown as {
    objectives: Array<{ estimates: Array<{ id: string }> }>;
    objectiveFeedSources: Array<{ subjectId: string; snapshotId: string; rom: string | null; domains: string[] }>;
    initiativeEvidence: Array<{ documentId: string; integrityStatus: string }>;
    derivedRollup: { warningCodes: string[]; warnings?: string[] };
  };
  const rightBasis = buildSolutionDecisionBasis(right, "initiative-1", "option-1");
  assert.deepEqual(leftBasis.objectives[0].estimates.map((estimate) => estimate.id), ["estimate-current"]);
  assert.equal(leftBasis.objectiveFeedSources.length, 1);
  assert.equal(leftBasis.objectiveFeedSources[0].subjectId, "feed-subject-1");
  assert.equal(leftBasis.objectiveFeedSources[0].snapshotId, "snapshot-1");
  assert.equal(leftBasis.objectiveFeedSources[0].rom, null);
  assert.deepEqual(leftBasis.objectiveFeedSources[0].domains, ["A-domain", "z-domain", "ä-domain", "\uE000-domain", "😀-domain"]);
  assert.deepEqual(leftBasis.initiativeEvidence.map((document) => document.documentId), ["document-1"]);
  assert.deepEqual(leftBasis.derivedRollup.warningCodes, []);
  assert.equal(leftBasis.derivedRollup.warnings, undefined);
  assert.equal(await hashSolutionDecisionBasis(leftBasis), await hashSolutionDecisionBasis(rightBasis));
});

test("solution decision basis builder detects semantic estimate, feed, and evidence changes", async () => {
  const baseline = decisionBasisWorkspaceFixture();
  const baselineHash = await hashSolutionDecisionBasis(buildSolutionDecisionBasis(baseline, "initiative-1", "option-1"));

  const estimateChanged = structuredClone(baseline);
  estimateChanged.objectives[0].estimates.find((estimate) => estimate.id === "estimate-current")!.romPointsLikely = 6;
  assert.notEqual(await hashSolutionDecisionBasis(buildSolutionDecisionBasis(estimateChanged, "initiative-1", "option-1")), baselineHash);

  const feedChanged = structuredClone(baseline);
  feedChanged.objectiveFeedSources![0].recordContentHash = `sha256:${"c".repeat(64)}`;
  assert.notEqual(await hashSolutionDecisionBasis(buildSolutionDecisionBasis(feedChanged, "initiative-1", "option-1")), baselineHash);

  const feedTimestampChanged = structuredClone(baseline);
  feedTimestampChanged.objectiveFeedSources![0].sourceAsOf = "2026-08-16";
  assert.notEqual(await hashSolutionDecisionBasis(buildSolutionDecisionBasis(feedTimestampChanged, "initiative-1", "option-1")), baselineHash);

  const feedSnapshotChanged = structuredClone(baseline);
  feedSnapshotChanged.objectiveFeedSources![0].snapshotId = "snapshot-2";
  assert.notEqual(await hashSolutionDecisionBasis(buildSolutionDecisionBasis(feedSnapshotChanged, "initiative-1", "option-1")), baselineHash);

  const evidenceSealChanged = structuredClone(baseline);
  evidenceSealChanged.initiativeEvidenceFingerprints![0].sealedContentHash = `sha256:${"d".repeat(64)}`;
  assert.notEqual(await hashSolutionDecisionBasis(buildSolutionDecisionBasis(evidenceSealChanged, "initiative-1", "option-1")), baselineHash);

  const evidenceIntegrityChanged = structuredClone(baseline);
  evidenceIntegrityChanged.initiativeEvidenceFingerprints![0].integrityStatus = "unverified";
  assert.notEqual(await hashSolutionDecisionBasis(buildSolutionDecisionBasis(evidenceIntegrityChanged, "initiative-1", "option-1")), baselineHash);

  const unrelatedChanged = structuredClone(baseline);
  unrelatedChanged.objectiveFeedSources![1].recordContentHash = `sha256:${"0".repeat(64)}`;
  unrelatedChanged.initiativeEvidenceFingerprints![1].integrityStatus = "unverified";
  assert.equal(await hashSolutionDecisionBasis(buildSolutionDecisionBasis(unrelatedChanged, "initiative-1", "option-1")), baselineHash);
});

test("solution decision basis canonicalizer remains object-key-order independent", async () => {
  const left = { option: { id: "option-1", title: "Targeted upgrade" }, objectiveIds: ["objective-1"], rollup: { hours: 100 } };
  const reordered = { rollup: { hours: 100 }, objectiveIds: ["objective-1"], option: { title: "Targeted upgrade", id: "option-1" } };
  assert.equal(canonicalSolutionDecisionBasis(left), canonicalSolutionDecisionBasis(reordered));
  assert.equal(await hashSolutionDecisionBasis(left), await hashSolutionDecisionBasis(reordered));
});

test("saved leadership report escapes imported markdown and remote-content injection", () => {
  const fixture = reportFixture();
  fixture.bundle.initiative.decisionAsk = "Proceed\n## Forged heading <img src=https://example.invalid/x> ![beacon](https://example.invalid/y)";
  const markdown = buildInitiativeReportMarkdown({ title: "Report\n# Forged title", generatedAt: "2026-08-21T00:00:00.000Z", dataLastChangedAt: "2026-08-20T18:00:00.000Z", ...fixture });
  assert.doesNotMatch(markdown, /\n## Forged heading/);
  assert.doesNotMatch(markdown, /(^|[^\\])<img\s/i);
  assert.doesNotMatch(markdown, /(^|[^\\])!\[beacon\]\(/);
  assert.match(markdown, /\\<img/);
});

test.skip("current and scoped outputs derive a fail-closed marking from record lineage", () => {
  assert.equal(handlingMarkingFromSourceNames([DEMONSTRATION_SOURCE_FILE_NAME], true), SYNTHETIC_HANDLING_MARKING);
  assert.equal(handlingMarkingFromSourceNames([DEMONSTRATION_SOURCE_FILE_NAME], false), PROGRAM_HANDLING_MARKING);
  assert.equal(handlingMarkingFromSourceNames(["non-demo-data.xlsx"]), PROGRAM_HANDLING_MARKING);
  assert.equal(handlingMarkingFromSourceLineage([{ fileName: DEMONSTRATION_SOURCE_FILE_NAME, sourceKey: "DEMO-001", projectionMatchesSource: true }], true), SYNTHETIC_HANDLING_MARKING);
  assert.equal(handlingMarkingFromSourceLineage([{ fileName: DEMONSTRATION_SOURCE_FILE_NAME, sourceKey: "PROGRAM-001", projectionMatchesSource: true }]), PROGRAM_HANDLING_MARKING);
  assert.equal(handlingMarkingFromSourceLineage([{ fileName: DEMONSTRATION_SOURCE_FILE_NAME, sourceKey: "DEMO-001", projectionMatchesSource: false }]), PROGRAM_HANDLING_MARKING);
  assert.equal(workspaceClassificationFromSourceLineage([DEMONSTRATION_SOURCE_FILE_NAME], ["DEMO-001"], true, true), "SYNTHETIC DEMONSTRATION DATA");
  assert.equal(workspaceClassificationFromSourceLineage([DEMONSTRATION_SOURCE_FILE_NAME], ["DEMO-001"], true, false), "PROGRAM WORKING DATA");
  assert.equal(workspaceClassificationFromSourceLineage([DEMONSTRATION_SOURCE_FILE_NAME], ["DEMO-001"], false), "PROGRAM WORKING DATA");
  assert.equal(sourceNameIsSynthetic("ＪＳＦ＿Ｖ３＿Ｄｅｍｏｎｓｔｒａｔｉｏｎ＿Ｂａｓｅｌｉｎｅ．ｘｌｓｘ"), true);
  assert.equal(sourceKeyIsSynthetic("ＤＥＭＯ－001"), true);
  assert.equal(workspaceClassificationFromSourceLineage([DEMONSTRATION_SOURCE_FILE_NAME], [], true), "PROGRAM WORKING DATA");
  assert.equal(handlingMarkingFromSourceNames(["demo.xlsx", "program-baseline.xlsx"]), PROGRAM_HANDLING_MARKING);
  assert.equal(handlingMarkingFromSourceNames(["demo.xlsx", ""]), PROGRAM_HANDLING_MARKING);
  assert.equal(handlingMarkingFromSourceNames([]), PROGRAM_HANDLING_MARKING);
  const server = read("lib/governance-server.ts");
  const workspaceTransfer = read("lib/workspace-transfer.ts");
  const onePager = read("app/initiatives/[initiative]/one-pager/page.tsx");
  const reports = read("app/reports/page.tsx");
  assert.match(server, /JOIN change_effect ce ON ce\.change_request_id=icr\.change_request_id/);
  assert.match(server, /Explicitly linked baseline records/);
  assert.match(server, /handlingMarking: PROGRAM_HANDLING_MARKING/);
  assert.doesNotMatch(server, /handlingMarkingFromSourceLineage/);
  assert.match(workspaceTransfer, /const classification = "PROGRAM WORKING DATA" as const/);
  assert.doesNotMatch(server, /SELECT file_name FROM source_package WHERE program_id/);
  assert.match(onePager, /portfolio\.handlingMarking/);
  assert.match(reports, /governance\?\.handlingMarking/);
});

test("leadership rich exports consume Markdown structure and escapes", () => {
  const markdown = [
    "# Executive \\#1",
    "",
    "> **SYNTHETIC DEMONSTRATION DATA — NOT PROGRAM DATA**",
    "### Dependency and affected-object analysis",
    "- **Evidence:** [artifact \\[final\\].pdf](/api/documents?id=document-1)",
    "Escaped: \\+ \\<tag\\> \\! \\|",
  ].join("\n");
  const blocks = parseBriefMarkdown(markdown);
  assert.equal(blocks[0].kind, "title");
  assert.equal(blocks[0].inline.map((item) => item.text).join(""), "Executive #1");
  assert.equal(blocks.find((item) => item.kind === "heading2")?.inline.map((item) => item.text).join(""), "Dependency and affected-object analysis");
  const evidence = blocks.find((item) => item.kind === "bullet");
  assert.equal(evidence?.inline.map((item) => item.text).join(""), "Evidence: artifact [final].pdf");
  assert.ok(evidence?.inline.some((item) => item.href === "/api/documents?id=document-1"));
  const rendered = blocks.flatMap((block) => block.inline).map((item) => item.text).join("\n");
  assert.doesNotMatch(rendered, /\\[#*_[\]{}<>+!|]|\*\*|### |\]\(/);
});

test("leadership DOCX and PDF are real artifacts without changing the Markdown source", async () => {
  const bodyMarkdown = [
    "# Executive \\#1",
    "",
    `> **${SYNTHETIC_HANDLING_MARKING}**`,
    "### Dependency analysis",
    "- **Evidence:** [artifact \\[final\\].pdf](/api/documents?id=document-1)",
  ].join("\n");
  const brief: ExecutiveBrief = {
    id: "brief-1", initiativeId: "initiative-1", initiativeTitle: "Synthetic modernization", title: "Executive #1", status: "draft", notes: null,
    snapshot: { ...reportFixture().baseline, handlingMarking: SYNTHETIC_HANDLING_MARKING }, snapshotValid: true, bodyMarkdown, publications: [], publishedAt: null,
    createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z",
  };
  assert.equal(await prepareBriefMarkdown(brief).blob.text(), bodyMarkdown);
  const docx = await prepareBriefDocx(brief);
  const docxBytes = new Uint8Array(await docx.blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(docxBytes.slice(0, 2)), "PK");
  assert.equal((await validateEvidenceBytes(docx.fileName, docxBytes)).contentType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const zip = await JSZip.loadAsync(docxBytes);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  assert.ok(documentXml);
  assert.match(documentXml, /Dependency analysis/);
  assert.match(documentXml, /artifact \[final\]\.pdf/);
  assert.doesNotMatch(documentXml, /### Dependency|\\#1|\*\*Evidence|\]\(\/api/);
  const relationships = (await zip.file("word/_rels/document.xml.rels")?.async("string")) || "";
  assert.doesNotMatch(relationships, /TargetMode="External"/);
  const pdf = prepareBriefPdf(brief);
  const pdfBytes = new Uint8Array(await pdf.blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 5)), "%PDF-");
  assert.equal((await validateEvidenceBytes(pdf.fileName, pdfBytes)).contentType, "application/pdf");
});

test("leadership PDF paginates a single long paragraph without truncating its tail", async () => {
  const tail = "PDF-LONG-BLOCK-END-SENTINEL";
  const bodyMarkdown = `${"Long paragraph content ".repeat(1_400)}${tail}`;
  assert.ok(bodyMarkdown.length > 30_000);
  const brief: ExecutiveBrief = {
    id: "brief-long", initiativeId: "initiative-1", initiativeTitle: "Synthetic modernization", title: "Long block", status: "draft", notes: null,
    snapshot: { ...reportFixture().baseline, handlingMarking: SYNTHETIC_HANDLING_MARKING }, snapshotValid: true, bodyMarkdown, publications: [], publishedAt: null,
    createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z",
  };
  const pdf = prepareBriefPdf(brief);
  const pdfText = new TextDecoder("latin1").decode(await pdf.blob.arrayBuffer());
  const pageCount = pdfText.match(/\/Type \/Page\b/g)?.length ?? 0;
  assert.ok(pageCount >= 5, `expected the long paragraph to span at least 5 pages, received ${pageCount}`);
  assert.equal(pdfText.match(/SYNTHETIC DEMONSTRATION DATA/g)?.length, pageCount);
  assert.equal(pdfText.match(/Generated 2026-08-21T00:00:00.000Z/g)?.length, pageCount);
  assert.match(pdfText, new RegExp(tail));
});

test.skip("initiative evidence and report controls are first-class and synchronized", () => {
  const page = read("app/initiatives/[initiative]/page.tsx");
  assert.match(page, /Attach to Initiative/);
  assert.match(page, /evidenceDocumentId/);
  assert.match(page, /Save report snapshot/);
  assert.match(page, /await decision\.reload\(\)/);
  assert.match(page, /await governance\.reload\(\)/);
  const portfolio = read("lib/governance-model.ts");
  assert.match(portfolio, /documents: EvidenceDocument\[\]/);
});

test.skip("meeting report and Objective editors expose only governed, complete actions", () => {
  const reports = read("app/reports/page.tsx");
  assert.match(reports, /baselineState\.loading \|\| platformState\.loading \|\| changeState\.loading \|\| governanceState\.loading \|\| decisionState\.loading/);
  assert.match(reports, /evidenceIntegrityStatus === "not_checked"/);
  assert.match(reports, /if \(!reportReady\) return/);
  assert.match(reports, /disabled=\{exportBlocked\}/);
  const briefs = read("app/briefs/page.tsx");
  assert.match(briefs, /if \(status === "published"\) return \["published", "superseded"\]/);
  assert.match(briefs, /if \(!briefTitleCustomized\) setBriefTitle/);
  const technicalScope = read("components/objective-technical-scope.tsx");
  assert.match(technicalScope, /setDependency\(\{ id: item\.id/);
  assert.match(technicalScope, /setAttribution\(\{ id: item\.id/);
  assert.match(technicalScope, /disabled=\{Boolean\(dependency\.id\)\}/);
  assert.match(technicalScope, /disabled=\{Boolean\(attribution\.id\)\}/);
});

test("platform and configuration workspaces make stable and release-specific edits explicit", () => {
  const platforms = read("app/platforms/page.tsx");
  const platform = read("app/platforms/[id]/page.tsx");
  const configurations = read("app/configuration/page.tsx");
  const configuration = read("app/configuration/[id]/page.tsx");
  const infrastructure = read("components/infrastructure-workspace.tsx");
  const platformServer = read("lib/platform-server.ts");
  assert.match(platforms, /contextMode="filter"/);
  assert.match(platforms, /Needs Government mapping/);
  assert.match(platforms, /isGovernedPlatform/);
  assert.match(platforms, /treePlatforms/);
  assert.match(platforms, /Baseline assignments/);
  assert.match(platform, /contextMode="filter"/);
  assert.match(platform, /const assignable = releaseLens \?/);
  assert.match(platform, /Save Release mapping/);
  assert.match(platform, /Edit Platform context/);
  assert.match(platform, /System configuration/);
  assert.match(configurations, /const releaseQuery = releaseLens/);
  assert.match(configuration, /scopedRows/);
  assert.match(configuration, /Edit Release configuration/);
  assert.match(platformServer, /Object\.prototype\.hasOwnProperty\.call\(body, "configurationNodeId"\)/);
  assert.match(platformServer, /retain their Configuration Node link/);
  assert.match(platformServer, /isGovernedPlatform/);
  assert.match(infrastructure, /Where to edit/);
  assert.match(infrastructure, /Edit capacity &amp; Release state/);
  assert.match(infrastructure, /Add infrastructure node \/ VM/);
  assert.match(infrastructure, /Virtual machine/);
});

test("visual topology manager reuses governed local records and separates containment from cluster relationships", () => {
  const route = read("app/platforms/[id]/topology-manager/page.tsx");
  const platform = read("app/platforms/[id]/page.tsx");
  const infrastructure = read("components/infrastructure-workspace.tsx");
  const styles = read("app/globals.css");
  const client = read("lib/topology-client.ts");
  assert.match(route, /initialView="visual"/);
  assert.match(route, /same governed local records and audit controls/i);
  assert.match(platform, /Visual topology manager/);
  assert.match(infrastructure, /Physical server and VM nodes show where compute runs/);
  assert.match(infrastructure, /Kubernetes, RKE2, or Rancher as a runtime Product/);
  assert.match(infrastructure, /Containerized workload/);
  assert.match(infrastructure, /Containment/);
  assert.match(infrastructure, /Building blocks/);
  assert.match(infrastructure, /useState<VisualTopologyMode>\("containment"\)/);
  assert.match(infrastructure, /platform → hardware → VMs → runtimes → workloads/);
  assert.match(infrastructure, /building-block-card-products/);
  assert.match(infrastructure, /setPointerCapture/);
  assert.match(infrastructure, /Print \/ Save canvas/);
  assert.match(styles, /topology-canvas-print-mode/);
  assert.match(styles, /topology-inspector-closed/);
  assert.doesNotMatch(platform, /Print dashboard/);
  assert.match(infrastructure, /Relationships/);
  assert.match(infrastructure, /Nothing is sent to a renderer or outside service/);
  assert.match(infrastructure, /onAddNode\(selectedState, "virtual_machine"\)/);
  assert.match(infrastructure, /onAddConnection\(selectedState, "cluster"\)/);
  assert.match(client, /fetch\("\/api\/topology"/);
  assert.doesNotMatch(route, /https?:\/\//);
  assert.doesNotMatch(infrastructure, /reactflow|d3\.js|https?:\/\//i);
});

test("Product placements can be created, edited, moved, and removed from the Product workspace", () => {
  const productPage = read("app/products/[id]/page.tsx");
  const editor = read("components/product-placement-editor.tsx");
  const server = read("lib/topology-server.ts");
  assert.match(productPage, /Place on infrastructure/);
  assert.match(productPage, /Edit \/ move/);
  assert.match(productPage, /ProductPlacementEditor/);
  assert.match(editor, /Release[\s\S]*Platform[\s\S]*Infrastructure node \/ VM/);
  assert.match(editor, /Moving an existing placement updates the same audited record/);
  assert.match(editor, /save_infrastructure_installation/);
  assert.match(editor, /remove_infrastructure_installation/);
  assert.match(editor, /Open Platform visual manager/);
  assert.match(server, /release_id=excluded\.release_id,platform_id=excluded\.platform_id,node_state_id=excluded\.node_state_id/);
  assert.match(server, /already recorded on the selected node/);
});

test("infrastructure placement migration repairs and guards cached Release and Platform identity", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE release_infrastructure_node(id TEXT PRIMARY KEY,program_id TEXT,release_id TEXT,platform_id TEXT); CREATE TABLE infrastructure_product_installation(id TEXT PRIMARY KEY,program_id TEXT,release_id TEXT,platform_id TEXT,node_state_id TEXT); CREATE TABLE infrastructure_connection(id TEXT PRIMARY KEY,program_id TEXT,release_id TEXT,platform_id TEXT,source_node_state_id TEXT,target_node_state_id TEXT);");
  database.exec("INSERT INTO release_infrastructure_node VALUES ('source','program','release-new','platform-new'),('target','program','release-new','platform-new'); INSERT INTO infrastructure_product_installation VALUES ('placement','program','release-old','platform-old','source'); INSERT INTO infrastructure_connection VALUES ('connection','program','release-old','platform-old','source','target');");
  database.exec(read("drizzle/0031_infrastructure_placement_integrity.sql"));
  const placement = database.prepare("SELECT release_id,platform_id FROM infrastructure_product_installation WHERE id='placement'").get() as { release_id: string; platform_id: string };
  const connection = database.prepare("SELECT release_id,platform_id FROM infrastructure_connection WHERE id='connection'").get() as { release_id: string; platform_id: string };
  assert.equal(placement.release_id, "release-new"); assert.equal(placement.platform_id, "platform-new");
  assert.equal(connection.release_id, "release-new"); assert.equal(connection.platform_id, "platform-new");
  assert.throws(() => database.exec("INSERT INTO infrastructure_product_installation VALUES ('invalid','program','wrong-release','platform-new','source');"), /must match its infrastructure node state/);
  assert.throws(() => database.exec("UPDATE infrastructure_connection SET platform_id='wrong-platform' WHERE id='connection';"), /must match both node states/);
  database.close();
});

test("local platform building-block export preserves recorded containment and placements", () => {
  const source = buildInfrastructureMermaid({
    platform: { code: "OBK-U", name: "Operational Build Kit" },
    releaseName: "MX-P.01.00",
    nodes: [
      { id: "server", nodeType: "physical_server", code: "SRV-1", name: "Host" },
      { id: "vm", nodeType: "virtual_machine", code: "VM-1", name: "Workload VM" },
    ],
    states: [
      { id: "server-state", infrastructureNodeId: "server", parentStateId: null, lifecycleStatus: "active", operatingState: "operational" },
      { id: "vm-state", infrastructureNodeId: "vm", parentStateId: "server-state", lifecycleStatus: "active", operatingState: "operational" },
    ],
    installations: [{ id: "runtime", nodeStateId: "vm-state", productName: "RKE2", version: "1.31", installationRole: "runtime", instanceName: null, deploymentStatus: "installed" }],
    connections: [],
  } as never);
  assert.match(source, /^flowchart BT/);
  assert.match(source, /OBK-U · Operational Build Kit/);
  assert.match(source, /nodeserver_state --> nodevm_state/);
  assert.match(source, /nodevm_state --> productruntime/);
  assert.doesNotMatch(source, /https?:\/\//);
});

test("dependency planning board identifies reciprocal chains without inventing schedule", () => {
  const board = buildDependencyBoard({
    changes: {
      requests: [
        { id: "mcp122", externalIdentifier: "MCP-122", title: "Modernized PMA", decisionStatus: "proposed", externalOwner: "LM", requestedReleaseId: null, requestedReleaseName: null, typeLabel: "MCP" },
        { id: "mcp21", externalIdentifier: "MCP-21", title: "Dependent delivery", decisionStatus: "proposed", externalOwner: "LM", requestedReleaseId: null, requestedReleaseName: null, typeLabel: "MCP" },
      ],
      dependencies: [
        { id: "starts-before-finish", predecessorRequestId: "mcp122", successorRequestId: "mcp21", dependencyType: "enables", rationale: "MCP-122 must start before MCP-21 can finish.", sourceReference: null },
        { id: "finishes-before-finish", predecessorRequestId: "mcp21", successorRequestId: "mcp122", dependencyType: "requires", rationale: "MCP-21 must finish before MCP-122 can finish.", sourceReference: null },
      ],
    },
    objectives: [], objectiveChangeRequestLinks: [], objectiveDependencies: [], initiatives: [],
  } as never, { workPackages: [], workPackageDependencies: [] } as never, { releases: [] } as never);
  assert.equal(board.items.length, 2);
  assert.equal(board.edges.length, 2);
  assert.ok(board.edges.every((edge) => edge.cycle));
  assert.ok(board.items.every((item) => item.scheduleDate === null));
  const component = read("components/dependency-board.tsx");
  assert.match(component, /BIG-ROOM PLANNING VIEW/);
  assert.match(component, /no date or sequence is inferred/i);
  assert.match(component, /Objective gates/);
  assert.match(component, /Work Package/);
});

test("assistant context expansion preserves saved analysis and accepts Objective and Release contexts", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON; CREATE TABLE program(id TEXT PRIMARY KEY); CREATE TABLE app_user(id TEXT PRIMARY KEY); INSERT INTO program VALUES ('program'); INSERT INTO app_user VALUES ('user');");
  database.exec(read("drizzle/0029_genai_assistant.sql"));
  database.exec("INSERT INTO assistant_saved_prompt VALUES ('prompt','program','initiative','Review','Question','user','2026-08-25','2026-08-25');");
  database.exec("INSERT INTO assistant_scratchpad_entry VALUES ('saved','program','initiative','initiative-1','Modernize PMA','Analysis','Question','Answer',NULL,'model','Grounded in Initiative','user','2026-08-25','2026-08-25');");
  database.exec(read("drizzle/0030_assistant_context_expansion.sql"));
  assert.equal((database.prepare("SELECT count(*) AS count FROM assistant_scratchpad_entry WHERE id='saved'").get() as { count: number }).count, 1);
  database.exec("INSERT INTO assistant_scratchpad_entry VALUES ('objective','program','objective','objective-1','OBJ-1','Analysis','Question','Answer',NULL,'model','Objective grounding','user','2026-08-25','2026-08-25');");
  database.exec("INSERT INTO assistant_scratchpad_entry VALUES ('release','program','release','release-1','Release 1','Analysis','Question','Answer',NULL,'model','Release grounding','user','2026-08-25','2026-08-25');");
  assert.equal((database.prepare("SELECT count(*) AS count FROM assistant_scratchpad_entry").get() as { count: number }).count, 3);
  database.close();
});

test("Lockheed ROM preserves points and applies an Initiative planning conversion only in derived hours", () => {
  assert.deepEqual(parseReportedRom("$125K"), { raw: "$125K", unit: "cost", low: null, likely: 125000, high: null, assumptions: null });
  assert.deepEqual(parseReportedRom("80-120 hours"), { raw: "80-120 hours", unit: "hours", low: 80, likely: 100, high: 120, assumptions: "Likely is the derived midpoint of the reported range." });
  assert.deepEqual(parseReportedRom("3"), { raw: "3", unit: "points", low: null, likely: 3, high: null, assumptions: "The source did not state labor hours; the numeric ROM is retained as Lockheed effort points." });
  assert.equal(parseReportedRom("3 days"), null);
  const variance = estimateVariance({ objectives: [{ id: "objective-rom", estimates: [{ id: "feed-rom", objectiveId: "objective-rom", estimateSource: "incumbent", hoursLow: null, hoursLikely: 240, hoursHigh: null, costLow: null, costLikely: null, costHigh: null, basis: "Lockheed-reported ROM", assumptions: null, sourceReference: "FOR_JPO.json", asOf: "2026-08-24", confidence: "unassessed", createdAt: "2026-08-24T10:00:00.000Z" }] }] } as unknown as InitiativeDecisionBundle);
  assert.equal(variance.incumbentHours, 240);
  assert.equal(variance.incumbentHoursCoverage, 1);
  const converted = estimateVariance({ initiative: { romHoursPerPoint: 250 }, objectives: [{ id: "objective-points", estimates: [{ id: "feed-points", objectiveId: "objective-points", estimateSource: "incumbent", hoursLow: null, hoursLikely: null, hoursHigh: null, costLow: null, costLikely: null, costHigh: null, romPointsLikely: 3, basis: "Lockheed-reported ROM", assumptions: null, sourceReference: "FOR_JPO.json", asOf: "2026-08-24", confidence: "unassessed", createdAt: "2026-08-24T10:00:00.000Z" }] }] } as unknown as InitiativeDecisionBundle);
  assert.equal(converted.incumbentRomPoints, 3);
  assert.equal(converted.romHoursPerPoint, 250);
  assert.equal(converted.incumbentHours, 750);
  const initiativePage = read("components/initiative-solution-engineering.tsx");
  const changePage = read("app/changes/[id]/page.tsx");
  const workspace = read("lib/initiative-decision-server.ts");
  assert.match(initiativePage, /href=\{`\/changes\//);
  assert.match(initiativePage, /href=\{`\/objectives\//);
  assert.match(initiativePage, /Government planning hours per Lockheed ROM point/);
  assert.match(changePage, /ROM points and Initiative planning conversions/);
  assert.match(initiativePage, /points converted only when an Objective has no direct-hour bounds/);
  assert.match(workspace, /parseReportedRom/);
  assert.match(workspace, /romPointsLikely/);
  assert.match(workspace, /lm_objective_feed_state/);
});

test("Initiatives are re-anchored to one continuous Solution Engineering workspace", () => {
  const page = read("app/initiatives/[initiative]/page.tsx");
  const component = read("components/initiative-solution-engineering.tsx");
  const api = read("app/api/solution-engineering/route.ts");
  const creation = read("lib/governance-server.ts");
  const transfer = read("lib/workspace-transfer.ts");
  assert.match(page, /Problem<\/a>.*Alternatives<\/a>.*Decision map<\/a>.*Option plans<\/a>.*Comparison<\/a>.*Adjudication<\/a>/s);
  assert.match(page, /Government problem\/outcome decision case/);
  assert.match(component, /Government planning overlay/);
  assert.match(component, /No dates inferred/);
  assert.match(component, /\["FS", "SS", "FF", "SF"\]/);
  assert.match(component, /Government-authored and source-derived shown separately/);
  assert.match(component, /no weighted score/i);
  assert.match(api, /save_step_reference/);
  assert.match(api, /save_step_dependency/);
  assert.match(api, /save_knock_on/);
  assert.match(creation, /Status quo \/ no new action/);
  assert.match(creation, /await db\.batch\(statements\)/);
  assert.doesNotMatch(transfer, /"initiativeMilestones"|"workPackages"|"initiativeScopes"|"initiativeChangeRequests"/);
  for (const removed of ["app/delivery/page.tsx", "app/delivery/[id]/page.tsx", "app/initiatives/[initiative]/one-pager/page.tsx", "app/briefs/page.tsx", "app/briefs/[id]/page.tsx"]) assert.equal(existsSync(removed), false, `${removed} must remain removed`);
});

test("Change Request dependencies explain finish-to-finish, blockers, and enablers at entry", () => {
  const changePage = read("app/changes/[id]/page.tsx");
  assert.match(changePage, /DEPENDENCY HELPER/);
  assert.match(changePage, /Hard completion gate\. Use for finish-to-finish/);
  assert.match(changePage, /Makes the other request viable or easier/);
  assert.match(changePage, /A current condition is preventing progress/);
  assert.match(changePage, /Selected request → this request/);
  assert.match(changePage, /FF: \[this MCP\] cannot complete until \[related MCP\] completes/);
});

test.skip("Initiative scope distinguishes Government outcome, affected objects, and derived technical scope", () => {
  const helper = read("components/initiative-scope-helper.tsx");
  const createPage = read("app/initiatives/page.tsx");
  const detailPage = read("app/initiatives/[initiative]/page.tsx");
  assert.match(helper, /Initiative title = Government outcome/);
  assert.match(helper, /Affected object = linked MCP/);
  assert.match(helper, /Platform → PMA/);
  assert.match(helper, /Technical scope = derived, not selected here/);
  assert.match(createPage, /Release lens \(optional\)/);
  assert.match(createPage, /technical scope is derived from affected objects/);
  assert.match(detailPage, /InitiativeScopeHelper/);
  assert.match(detailPage, /DERIVED, NOT MANUALLY SELECTED/);
  assert.match(detailPage, /A Platform effect does not expand to every record/);
  assert.match(detailPage, /Effect transitions:/);
  assert.match(detailPage, /Delivery targets:/);
  const onePager = read("app/initiatives/[initiative]/one-pager/page.tsx");
  const report = read("lib/initiative-report.ts");
  assert.match(onePager, /Scoped effects \/ attribution/);
  assert.match(report, /Release context \(effect transition \/ CR delivery target\)/);
});

test.skip("legacy report snapshots without an explicit handling marking cannot be draft-exported", () => {
  const legacySnapshot = {
    asOf: "2026-08-18T17:35:08.460Z",
    releaseName: "Release 5",
    sourceRows: 3,
    products: 3,
    releases: 1,
    reviewRows: 0,
    productNames: ["Data Gateway"],
    linkedRecords: [],
  };
  assert.equal(isCurrentBriefSnapshot(legacySnapshot), false);
  const server = read("lib/governance-server.ts");
  const detail = read("app/briefs/[id]/page.tsx");
  assert.match(server, /snapshotValid: parsedSnapshot\.valid/);
  assert.match(detail, /!brief\.snapshotValid \|\| brief\.snapshot\.handlingMarking !== PROGRAM_HANDLING_MARKING/);
  assert.match(detail, /if \(underMarkedHistoricalReport\) throw new Error\("This historical report is under-marked\. Regenerate it before export or distribution\."\)/);
  assert.match(detail, /disabled=\{exporting \|\| underMarkedHistoricalReport\}/);
});

test.skip("Objective reparenting preserves dependency and effect-attribution integrity", () => {
  const server = read("lib/initiative-decision-server.ts");
  const objectivePage = read("app/objectives/[id]/page.tsx");
  const initiativePage = read("app/initiatives/[initiative]/page.tsx");
  assert.match(server, /const parentChanged = Boolean\(before && clean\(before\.change_request_id\) !== \(changeRequestId \|\| ""\)\)/);
  assert.match(server, /dependent_change_request_id=\? AND status IN \('proposed','accepted'\)/);
  assert.match(server, /Reparenting would turn an active cross-package dependency into a Change Request dependency on its own Objective/);
  assert.match(server, /objective_effect_attribution[\s\S]*l\.relationship<>'primary'/);
  assert.match(server, /Reparenting would strand a technical-effect attribution outside the Objective's surviving Change Request links/);
  assert.match(server, /reparentReason: parentChanged \? nullable\(body\.reparentReason\) : null/);
  assert.match(objectivePage, /"LM Objective updated\.", \(\) => setEdit\(\{\}\)\)/);
  assert.match(initiativePage, /!objectiveDraft\.id && objectiveDraft\.reparentReason[\s\S]*reparentReason: ""/);
});

test("Objective, milestone, requirement, and unlink invariants fail closed", () => {
  assert.deepEqual(objectiveLifecycleIssues({ status: "complete", plannedStart: "2026-09-02", plannedFinish: "2026-09-01", actualStart: "2026-09-04", actualFinish: "" }), ["planned_window_reversed", "complete_without_actual_finish"]);
  assert.deepEqual(objectiveLifecycleIssues({ status: "in_progress", actualStart: "2026-09-04", actualFinish: "2026-09-03" }), ["actual_window_reversed"]);
  assert.deepEqual(milestoneLifecycleIssues({ status: "complete", actualDate: null }), ["complete_without_actual_date"]);
  assert.equal(requirementNeedsAcceptancePath("not_applicable"), false);
  assert.equal(requirementNeedsAcceptancePath("verified"), true);
  assert.equal(requirementHasAcceptancePath("requirement-1", [{ requirementTraceId: "requirement-1" }]), true);
  assert.deepEqual(objectiveIdsLeavingInitiativeScope({
    removedChangeRequestId: "cr-removed",
    remainingChangeRequestIds: ["cr-retained"],
    relations: [
      { objectiveId: "objective-owned-only", changeRequestId: "cr-removed" },
      { objectiveId: "objective-shared", changeRequestId: "cr-removed" },
      { objectiveId: "objective-shared", changeRequestId: "cr-retained" },
      { objectiveId: "objective-reported-only", changeRequestId: "cr-removed" },
    ],
  }), ["objective-owned-only", "objective-reported-only"]);

  const fixture = reportFixture();
  fixture.bundle.objectives[0].status = "complete";
  fixture.bundle.objectives[0].actualFinish = null;
  fixture.bundle.requirements = [
    { ...fixture.bundle.requirements[0], id: "requirement-applicable", traceStatus: "verified" },
    { ...fixture.bundle.requirements[0], id: "requirement-na", externalIdentifier: "REQ-NA", traceStatus: "not_applicable", rationale: null },
  ];
  fixture.bundle.criteria[0].requirementTraceId = null;
  fixture.bundle.criteria[0].actualDate = "2026-08-20";
  fixture.bundle.milestones[0].status = "complete";
  fixture.bundle.milestones[0].actualDate = null;
  const assessment = assessInitiative(fixture.bundle, new Date("2026-08-21T00:00:00.000Z"));
  const findingTitles = assessment.findings.map((finding) => finding.title);
  assert.ok(findingTitles.some((title) => title.includes("complete without an actual finish")));
  assert.ok(findingTitles.includes("REQ-001 has no acceptance path"));
  assert.ok(findingTitles.includes("REQ-NA lacks a not-applicable rationale"));
  assert.ok(findingTitles.some((title) => title.includes("complete without an actual date")));

  const server = read("lib/initiative-decision-server.ts");
  assert.match(server, /A complete Objective requires an actual finish date/);
  assert.match(server, /A not-applicable requirement trace requires a documented rationale/);
  assert.match(server, /Link at least one acceptance criterion before marking this requirement traced or verified/);
  assert.match(server, /work_package_objective/);
  assert.match(server, /Reassign or remove \$\{dependencies\} before unlinking this Change Request/);
});

test("hosted APIs fail closed and evidence downloads are non-sniffable", () => {
  const worker = read("worker/index.ts");
  assert.match(worker, /Authentication is required/);
  assert.match(worker, /The request origin is not allowed/);
  assert.match(worker, /Use JSON or multipart form data/);
  assert.match(worker, /x-content-type-options/);
  assert.match(worker, /content-security-policy/);
  const documents = read("app/api/documents/route.ts");
  const validation = read("lib/evidence-validation.ts");
  assert.match(validation, /approvedEvidenceTypes/);
  assert.match(validation, /file signature does not match/);
  assert.match(validation, /Macro or embedded-object Office documents/);
  assert.match(documents, /"x-content-type-options": "nosniff"/);
  assert.match(documents, /supports an acceptance sign-off/);
});

test("evidence validation rejects disguised or active files", async () => {
  const text = new TextEncoder().encode("synthetic evidence");
  const accepted = await validateEvidenceBytes("evidence.txt", text);
  assert.equal(accepted.contentType, "text/plain; charset=utf-8");
  await assert.rejects(() => validateEvidenceBytes("disguised.pdf", text), EvidenceValidationError);
  await assert.rejects(() => validateEvidenceBytes("invalid.json", new TextEncoder().encode("{not-json}")), EvidenceValidationError);
  await assert.rejects(() => validateEvidenceBytes("active.pdf", new TextEncoder().encode("%PDF-1.7\n/OpenAction /JavaScript")), EvidenceValidationError);
});

test.skip("one-page and four-page Initiative print modes are bounded and disclose retained detail", () => {
  const onePager = read("app/initiatives/[initiative]/one-pager/page.tsx");
  const styles = read("app/globals.css");
  assert.match(onePager, /changeRequests\.slice\(0, 4\)/);
  assert.match(onePager, /One-page decision brief/);
  assert.match(onePager, /Four-page detail packet/);
  assert.match(onePager, /printMode === "four"/);
  assert.doesNotMatch(onePager, /Include the annex before printing/);
  assert.match(onePager, /detail items continue in the four-page packet/);
  assert.match(onePager, /DELIVERY OBJECTIVES/);
  assert.match(onePager, /bundle\.objectives\.slice\(0, 4\)/);
  assert.match(onePager, /LM ROM/);
  assert.match(onePager, /Supporting documents/);
  assert.match(onePager, /Milestones and readiness findings/);
  assert.match(onePager, /governanceError/);
  assert.match(onePager, /Data through/);
  assert.match(styles, /\.packet-page-two\{grid-template-rows:16px 58px 126px 276px 294px 24px\}/);
  assert.match(styles, /\.packet-page-three\{grid-template-rows:16px 58px 212px 224px 260px 24px\}/);
  assert.match(styles, /\.packet-page-four\{grid-template-rows:16px 58px 252px 390px 54px 24px\}/);
  assert.match(styles, /\.wall-objective\{display:grid/);
});

test("GenAI.mil assistant is opt-in, restricted to GenAI.mil, and returns reviewable proposals only", async () => {
  let calls = 0;
  const missing = genaiMilReadiness({});
  assert.equal(missing.configured, false);
  assert.equal(missing.tlsMode, "verified");
  assert.match(missing.message, /local:genai:configure/);
  await assert.rejects(() => askGenaiMil({}, { system: "system", prompt: "question" }, async () => { calls += 1; return new Response(); }), (error: unknown) => error instanceof GenaiMilError && error.code === "not_configured");
  assert.equal(calls, 0);
  assert.throws(() => approvedGenaiMilUrl("https://example.test/chat"), /only an HTTPS GenAI\.mil endpoint/);
  const endpoint = approvedGenaiMilUrl("https://api.genai.mil/v1/chat/completions");
  assert.equal(endpoint.hostname, "api.genai.mil");
  const result = await askGenaiMil({ GENAI_MIL_API_URL: endpoint.toString(), GENAI_MIL_API_KEY: "active-key", GENAI_MIL_MODEL: "approved-model" }, { system: "system", prompt: "question" }, async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "Grounded answer", proposals: [{ kind: "save_milestone", title: "Draft milestone", rationale: "Linked Objective has an explicit date.", fields: { initiativeId: "initiative-1", title: "Integration", plannedDate: "2026-10-01" } }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(calls, 1);
  assert.equal(result.answer.answer, "Grounded answer");
  assert.equal(result.answer.proposals.length, 0);
  const nativeRequests: Record<string, unknown>[] = [];
  const native = await askGenaiMil({ GENAI_MIL_API_URL: endpoint.toString(), GENAI_MIL_API_KEY: "active-key", GENAI_MIL_MODEL: "approved-model", GENAI_MIL_TOOL_MODE: "native-tools" }, { system: "system", prompt: "question" }, async (_input, init) => {
    nativeRequests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Draft call note follows.", tool_calls: [{ type: "function", function: { name: "a2o_create_call_note", arguments: JSON.stringify({ title: "Document unresolved interface", rationale: "The grounded record identifies an unresolved item.", fields: { title: "Architecture call", summary: "Confirm interface ownership." } }) } }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(native.toolMode, "native-tools");
  assert.equal(native.answer.proposals[0]?.kind, "create_call_note");
  assert.ok(Array.isArray(nativeRequests[0]?.tools));
  assert.equal(nativeRequests[0]?.response_format, undefined);
  const proxyToken = "a".repeat(64);
  const insecureReadiness = genaiMilReadiness({ GENAI_MIL_API_URL: endpoint.toString(), GENAI_MIL_API_KEY: "active-key", GENAI_MIL_MODEL: "approved-model", GENAI_MIL_TLS_MODE: "development-insecure", GENAI_MIL_LOCAL_PROXY_TOKEN: proxyToken });
  assert.equal(insecureReadiness.configured, true);
  assert.equal(insecureReadiness.tlsMode, "development-insecure");
  assert.match(insecureReadiness.message, /DEVELOPMENT TLS BYPASS IS ACTIVE/);
  const proxyRequests: Array<{ url: string; authorization: string | null; token: string | null }> = [];
  await askGenaiMil({ GENAI_MIL_API_URL: endpoint.toString(), GENAI_MIL_API_KEY: "active-key", GENAI_MIL_MODEL: "approved-model", GENAI_MIL_TLS_MODE: "development-insecure", GENAI_MIL_LOCAL_PROXY_TOKEN: proxyToken }, { system: "system", prompt: "question" }, async (input, init) => {
    const headers = new Headers(init?.headers);
    proxyRequests.push({ url: String(input), authorization: headers.get("authorization"), token: headers.get("x-a2o-genai-proxy-token") });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "Development proxy answer", proposals: [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.match(proxyRequests[0]?.url || "", /^http:\/\/127\.0\.0\.1:38471\/genai$/);
  assert.equal(proxyRequests[0]?.authorization, null);
  assert.equal(proxyRequests[0]?.token, proxyToken);
  assert.equal(genaiMilReadiness({ GENAI_MIL_API_URL: endpoint.toString(), GENAI_MIL_API_KEY: "active-key", GENAI_MIL_MODEL: "approved-model", GENAI_MIL_TLS_MODE: "development-insecure" }).configured, false);
  assert.equal(parseAssistantAnswer("plain answer").proposals.length, 0);
  await assert.rejects(() => askGenaiMil({ GENAI_MIL_API_URL: endpoint.toString(), GENAI_MIL_API_KEY: "expired-key", GENAI_MIL_MODEL: "approved-model" }, { system: "system", prompt: "question" }, async () => new Response("", { status: 401 })), /Re-enable or refresh the key/);
  const migration = read("drizzle/0029_genai_assistant.sql");
  const contextMigration = read("drizzle/0030_assistant_context_expansion.sql");
  const adapter = read("lib/genai-mil.ts");
  const server = read("lib/assistant-server.ts");
  const component = read("components/context-assistant.tsx");
  const markdown = read("components/safe-markdown.tsx");
  const actions = read("lib/assistant-actions.ts");
  const route = read("app/api/assistant/route.ts");
  const domainShell = read("components/domain-shell.tsx");
  const analysisRegister = read("app/analysis/page.tsx");
  const start = read("scripts/local/Start-A2OWorkspace.ps1");
  const setup = read("scripts/local/Set-A2OGenaiMilConfiguration.ps1");
  const tlsMode = read("scripts/local/Set-A2OGenaiMilDevelopmentTls.ps1");
  const developmentProxy = read("scripts/local/genai-mil-development-proxy.mjs");
  const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  for (const page of [read("app/initiatives/[initiative]/page.tsx"), read("app/changes/[id]/page.tsx"), read("app/products/[id]/page.tsx"), read("app/platforms/[id]/page.tsx")]) assert.match(page, /AssistantLauncher/);
  assert.match(migration, /assistant_saved_prompt/);
  assert.match(migration, /assistant_scratchpad_entry/);
  assert.match(contextMigration, /'objective'/);
  assert.match(contextMigration, /'release'/);
  assert.match(domainShell, /objectContext\.kind === "objective" \|\| objectContext\.kind === "release"/);
  assert.match(analysisRegister, /AI Analysis register/);
  assert.match(route, /scope.*library/);
  assert.match(route, /delete_scratchpad/);
  assert.match(adapter, /approvedGenaiMilUrl/);
  assert.match(adapter, /NODE_EXTRA_CA_CERTS/);
  assert.match(adapter, /GENAI_MIL_TLS_MODE/);
  assert.match(adapter, /GENAI_MIL_LOCAL_PROXY_TOKEN/);
  assert.match(adapter, /native-tools/);
  assert.match(server, /assistantGenerated: true/);
  assert.match(server, /groundingFingerprint/);
  assert.match(component, /No background or automatic model calls/);
  assert.match(component, /Development TLS bypass/);
  assert.match(component, /Apply reviewed change/);
  assert.match(component, /ViewportModal/);
  assert.match(actions, /create_call_note/);
  assert.match(actions, /additionalProperties: false/);
  assert.doesNotMatch(markdown, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(markdown, /<a\b/);
  assert.match(route, /apply_proposal/);
  assert.match(start, /genai-mil\.runtime\.env/);
  assert.match(start, /genai-mil-development-proxy\.mjs/);
  assert.match(start, /CreateNoWindow = \$true/);
  assert.match(start, /processInfo\.Arguments/);
  assert.doesNotMatch(start, /processInfo\.ArgumentList/);
  assert.match(setup, /Read-Host -AsSecureString/);
  assert.match(setup, /genai\.mil/);
  assert.match(setup, /\$endpointHost/);
  assert.doesNotMatch(setup, /\$host\s*=/i);
  assert.match(setup, /No GenAI\.mil connection was attempted/);
  assert.match(setup, /GENAI_MIL_TOOL_MODE/);
  assert.match(tlsMode, /DEVELOPMENT TLS BYPASS ENABLED FOR EXPLICIT GENAI\.MIL REQUESTS/);
  assert.match(tlsMode, /Write-A2OProtectedSecretTextAtomic/);
  assert.match(developmentProxy, /server\.listen\(PORT, "127\.0\.0\.1"\)/);
  assert.match(developmentProxy, /"--ssl-no-revoke"/);
  assert.match(developmentProxy, /"--insecure"/);
  assert.match(developmentProxy, /x-a2o-genai-proxy-token/);
  assert.match(packageJson.scripts["local:genai:tls-bypass"], /Set-A2OGenaiMilDevelopmentTls\.ps1/);
  assert.match(packageJson.scripts["local:genai:tls-verify"], /-Disable/);
});

test("derived scope and workspace transfer controls fail closed", () => {
  const initiatives = read("lib/governance-server.ts");
  assert.match(initiatives, /technical scope is derived from linked Change Request effects/);
  assert.match(initiatives, /update affected objects on the Change Request instead/);
  assert.match(initiatives, /JOIN change_effect ce ON ce\.change_request_id=icr\.change_request_id/);
  const transfer = read("lib/workspace-transfer.ts");
  assert.match(transfer, /workspaceClassificationFromSourceLineage/);
  assert.match(transfer, /classification overstates its source-package lineage/);
  assert.match(transfer, /download-only quarantine/);
  assert.match(transfer, /Imported report Markdown cannot contain raw HTML/);
  assert.match(transfer, /spec\.logicalName === "auditEvents"/);
  assert.match(transfer, /validateEvidenceBytes/);
});

test.skip("report publication uses server-rendered durable artifacts before refresh and download", () => {
  const page = read("app/briefs/[id]/page.tsx");
  const route = read("app/api/brief-publications/route.ts");
  const server = read("lib/brief-publication-server.ts");
  assert.doesNotMatch(page, /record_brief_publication/);
  assert.match(page, /fetch\("\/api\/brief-publications"[\s\S]*await response\.blob\(\)[\s\S]*await reload\(\)/);
  assert.doesNotMatch(route, /formData\(|instanceof File|expectedContentHash/);
  assert.match(server, /prepareBriefPdf/);
  assert.match(server, /validateEvidenceBytes/);
});

test("the air-gapped runtime fails closed on stale builds and unbacked upgrades", () => {
  const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  const common = read("scripts/local/Common-A2OWorkspace.ps1");
  const start = read("scripts/local/Start-A2OWorkspace.ps1");
  const certificate = read("scripts/local/Set-A2OLocalCertificate.ps1");
  const backup = read("scripts/local/Backup-A2OWorkspace.ps1");
  const restore = read("scripts/local/Restore-A2OWorkspace.ps1");
  const update = read("scripts/local/Update-A2OWorkspace.ps1");
  assert.match(packageJson.scripts.build, /build-a2o\.mjs/);
  assert.match(packageJson.scripts["local:update"], /Update-A2OWorkspace\.ps1/);
  assert.match(common, /Assert-A2OBuildManifest/);
  assert.match(common, /failed integrity validation/);
  assert.match(start, /Assert-A2OBuildManifest[\s\S]*Assert-A2ONoPendingMigrations/);
  assert.match(common, /CLOUDFLARE_CF_FETCH_ENABLED = 'false'/);
  assert.match(common, /NODE_TLS_REJECT_UNAUTHORIZED=0 is not permitted/);
  assert.match(start, /Set-A2ONodeTrustedCaBundle/);
  assert.doesNotMatch(start, /--(?:remote|tunnel)(?:\s|$)/i);
  assert.match(certificate, /BEGIN CERTIFICATE/);
  assert.match(packageJson.scripts["local:certificate:trust"], /Set-A2OLocalCertificate\.ps1/);
  assert.match(backup, /schemaVersion = 4/);
  assert.match(backup, /Get-A2OHmacSha256/);
  assert.match(backup, /sha256 = Get-A2OFileSha256/);
  assert.match(restore, /Backup integrity validation failed/);
  assert.match(update, /Backup-A2OWorkspace\.ps1[\s\S]*d1 migrations apply[\s\S]*npm run build[\s\S]*Test-A2OWorkspace\.ps1/);
});
