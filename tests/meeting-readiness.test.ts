import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import JSZip from "jszip";
import type { BriefSnapshot, EvidenceDocument, ExecutiveBrief } from "../lib/governance-model.js";
import type { InitiativeAssessment, InitiativeDecisionBundle } from "../lib/initiative-decision-model.js";
import { EvidenceValidationError, validateEvidenceBytes } from "../lib/evidence-validation.js";
import { parseBriefMarkdown, prepareBriefDocx, prepareBriefMarkdown, prepareBriefPdf } from "../lib/brief-export.js";
import { buildInitiativeReportMarkdown } from "../lib/initiative-report.js";
import { PROGRAM_HANDLING_MARKING, SYNTHETIC_HANDLING_MARKING, handlingMarkingFromSourceNames } from "../lib/output-handling.js";

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
  const documents: EvidenceDocument[] = [{ id: "document-1", governanceRecordId: null, initiativeId: "initiative-1", fileName: "synthetic-verification.pdf", contentType: "application/pdf", byteSize: 2048, description: "Tier 4 verification result", createdAt: "2026-08-20T18:00:00.000Z" }];
  const baseline: BriefSnapshot = { asOf: "2026-08-21T00:00:00.000Z", handlingMarking: "SYNTHETIC DEMONSTRATION DATA — NOT PROGRAM DATA", releaseName: "Release 1", sourceRows: 12, products: 3, releases: 1, reviewRows: 0, productNames: ["Synthetic Product"], linkedRecords: [{ type: "decision", title: "Synthetic authority decision", status: "approved" }] };
  return { bundle, assessment, documents, baseline };
}

test("saved leadership report contains the governed decision and evidence chain", () => {
  const fixture = reportFixture();
  const markdown = buildInitiativeReportMarkdown({ title: "Synthetic leadership report", generatedAt: "2026-08-21T00:00:00.000Z", dataLastChangedAt: "2026-08-20T18:00:00.000Z", ...fixture });
  for (const expected of ["SYNTHETIC DEMONSTRATION DATA", "## Leadership decision", "Authorize the bounded change", "## Decision readiness", "100% (Decision Ready)", "MCP-001", "OBJ-001", "REQ-001", "T4-001", "synthetic-verification.pdf", "document-1", "Dependency and affected-object analysis", "Linked calls, decisions, and risks", "Synthetic authority decision", "## Baseline scope snapshot"]) assert.match(markdown, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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

test("all outputs derive a fail-closed marking from source-package lineage", () => {
  assert.equal(handlingMarkingFromSourceNames(["JSF Synthetic Demonstration.xlsx", "demo-objectives.csv"]), SYNTHETIC_HANDLING_MARKING);
  assert.equal(handlingMarkingFromSourceNames(["demo.xlsx", "program-baseline.xlsx"]), PROGRAM_HANDLING_MARKING);
  assert.equal(handlingMarkingFromSourceNames([]), PROGRAM_HANDLING_MARKING);
  const server = read("lib/governance-server.ts");
  const onePager = read("app/initiatives/[initiative]/one-pager/page.tsx");
  const reports = read("app/reports/page.tsx");
  assert.match(server, /handlingMarkingFromSourceNames\(sourcePackageResult/);
  assert.doesNotMatch(server, /intake_package|bo\.source_package_id/);
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
    snapshot: { ...reportFixture().baseline, handlingMarking: SYNTHETIC_HANDLING_MARKING }, bodyMarkdown, publishedAt: null,
    createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z",
  };
  assert.equal(await prepareBriefMarkdown(brief).blob.text(), bodyMarkdown);
  const docx = await prepareBriefDocx(brief);
  const docxBytes = new Uint8Array(await docx.blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(docxBytes.slice(0, 2)), "PK");
  const zip = await JSZip.loadAsync(docxBytes);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  assert.ok(documentXml);
  assert.match(documentXml, /Dependency analysis/);
  assert.match(documentXml, /artifact \[final\]\.pdf/);
  assert.doesNotMatch(documentXml, /### Dependency|\\#1|\*\*Evidence|\]\(\/api/);
  const pdf = prepareBriefPdf(brief);
  assert.equal(new TextDecoder().decode(new Uint8Array(await pdf.blob.arrayBuffer()).slice(0, 5)), "%PDF-");
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

test("scope and workspace transfer controls fail closed", () => {
  const initiatives = read("lib/governance-server.ts");
  assert.match(initiatives, /explicitly use the entire release scope/);
  assert.match(initiatives, /active in the selected baseline release/);
  const transfer = read("lib/workspace-transfer.ts");
  assert.match(transfer, /workspaceClassificationFromSourceNames/);
  assert.match(transfer, /classification does not match its source-package lineage/);
  assert.match(transfer, /download-only quarantine/);
  assert.match(transfer, /Imported report Markdown cannot contain raw HTML/);
  assert.match(transfer, /spec\.logicalName === "auditEvents"/);
  assert.match(transfer, /validateEvidenceBytes/);
});

test("recorded report publication is confirmed before refresh and download", () => {
  const page = read("app/briefs/[id]/page.tsx");
  assert.match(page, /record_brief_publication[\s\S]*\{ refresh: false \}/);
  assert.match(page, /downloadPreparedBrief\(prepared\.blob, prepared\.fileName\);[\s\S]*void reload\(\)/);
});

test("the air-gapped runtime fails closed on stale builds and unbacked upgrades", () => {
  const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  const common = read("scripts/local/Common-A2OWorkspace.ps1");
  const start = read("scripts/local/Start-A2OWorkspace.ps1");
  const backup = read("scripts/local/Backup-A2OWorkspace.ps1");
  const restore = read("scripts/local/Restore-A2OWorkspace.ps1");
  const update = read("scripts/local/Update-A2OWorkspace.ps1");
  assert.match(packageJson.scripts.build, /build-a2o\.mjs/);
  assert.match(packageJson.scripts["local:update"], /Update-A2OWorkspace\.ps1/);
  assert.match(common, /Assert-A2OBuildManifest/);
  assert.match(common, /failed integrity validation/);
  assert.match(start, /Assert-A2OBuildManifest[\s\S]*Assert-A2ONoPendingMigrations/);
  assert.match(backup, /schemaVersion = 2/);
  assert.match(backup, /sha256 = Get-A2OFileSha256/);
  assert.match(restore, /Backup integrity validation failed/);
  assert.match(update, /Backup-A2OWorkspace\.ps1[\s\S]*d1 migrations apply[\s\S]*npm run build[\s\S]*Test-A2OWorkspace\.ps1/);
});
