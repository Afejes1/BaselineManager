import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import JSZip from "jszip";
import type { BriefSnapshot, EvidenceDocument, ExecutiveBrief } from "../lib/governance-model.js";
import type { InitiativeAssessment, InitiativeDecisionBundle } from "../lib/initiative-decision-model.js";
import { EvidenceValidationError, validateEvidenceBytes } from "../lib/evidence-validation.js";
import { parseBriefMarkdown, prepareBriefDocx, prepareBriefMarkdown, prepareBriefPdf } from "../lib/brief-export.js";
import { isCurrentBriefSnapshot } from "../lib/brief-publication.js";
import { buildInitiativeReportMarkdown } from "../lib/initiative-report.js";
import { deriveInitiativeScope } from "../lib/initiative-scope.js";
import { assessInitiative } from "../lib/initiative-readiness.js";
import { milestoneLifecycleIssues, objectiveIdsLeavingInitiativeScope, objectiveLifecycleIssues, requirementHasAcceptancePath, requirementNeedsAcceptancePath } from "../lib/initiative-workflow-invariants.js";
import { DEMONSTRATION_SOURCE_FILE_NAME, PROGRAM_HANDLING_MARKING, SYNTHETIC_HANDLING_MARKING, handlingMarkingFromSourceLineage, handlingMarkingFromSourceNames, sourceKeyIsSynthetic, sourceNameIsSynthetic, workspaceClassificationFromSourceLineage } from "../lib/output-handling.js";

const read = (path: string) => readFileSync(path, "utf8");

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
  for (const expected of ["SYNTHETIC DEMONSTRATION DATA", "## Leadership decision", "Authorize the bounded change", "## Decision readiness", "100% (Decision Ready)", "MCP-001", "OBJ-001", "REQ-001", "T4-001", "synthetic-verification.pdf", "document-1", "Dependency and affected-object analysis", "Linked calls, decisions, and risks", "Synthetic authority decision", "## Derived technical scope snapshot"]) assert.match(markdown, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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

test("saved leadership report escapes imported markdown and remote-content injection", () => {
  const fixture = reportFixture();
  fixture.bundle.initiative.decisionAsk = "Proceed\n## Forged heading <img src=https://example.invalid/x> ![beacon](https://example.invalid/y)";
  const markdown = buildInitiativeReportMarkdown({ title: "Report\n# Forged title", generatedAt: "2026-08-21T00:00:00.000Z", dataLastChangedAt: "2026-08-20T18:00:00.000Z", ...fixture });
  assert.doesNotMatch(markdown, /\n## Forged heading/);
  assert.doesNotMatch(markdown, /(^|[^\\])<img\s/i);
  assert.doesNotMatch(markdown, /(^|[^\\])!\[beacon\]\(/);
  assert.match(markdown, /\\<img/);
});

test("current and scoped outputs derive a fail-closed marking from record lineage", () => {
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

test("initiative evidence and report controls are first-class and synchronized", () => {
  const page = read("app/initiatives/[initiative]/page.tsx");
  assert.match(page, /Attach to Initiative/);
  assert.match(page, /evidenceDocumentId/);
  assert.match(page, /Save report snapshot/);
  assert.match(page, /await decision\.reload\(\)/);
  assert.match(page, /await governance\.reload\(\)/);
  const portfolio = read("lib/governance-model.ts");
  assert.match(portfolio, /documents: EvidenceDocument\[\]/);
});

test("meeting report and Objective editors expose only governed, complete actions", () => {
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
  assert.match(infrastructure, /Where to edit/);
  assert.match(infrastructure, /Edit capacity &amp; Release state/);
  assert.match(infrastructure, /Add infrastructure node \/ VM/);
  assert.match(infrastructure, /Virtual machine/);
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

test("Initiative scope distinguishes Government outcome, affected objects, and derived technical scope", () => {
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

test("legacy report snapshots without an explicit handling marking cannot be draft-exported", () => {
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

test("Objective reparenting preserves dependency and effect-attribution integrity", () => {
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

test("page-one truncation is disclosed and full detail remains available in the annex", () => {
  const onePager = read("app/initiatives/[initiative]/one-pager/page.tsx");
  assert.match(onePager, /changeRequests\.slice\(0, 4\)/);
  assert.match(onePager, /detail items continue in annex/);
  assert.match(onePager, /Supporting documents/);
  assert.match(onePager, /Milestones and readiness findings/);
  assert.match(onePager, /governanceError/);
  assert.match(onePager, /Data through/);
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

test("report publication uses server-rendered durable artifacts before refresh and download", () => {
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
