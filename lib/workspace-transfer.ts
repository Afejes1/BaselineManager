import JSZip from "jszip";
import { env } from "cloudflare:workers";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { schema } from "../db/schema";
import type { DocumentBucket } from "./governance-server";
import { evidenceHashFromAuditPayload, readBoundedObjectBytes, validateEvidenceBytes } from "./evidence-validation";
import { PROGRAM_HANDLING_MARKING, SYNTHETIC_HANDLING_MARKING, workspaceClassificationFromSourceLineage as classifyImportedSourceLineage, type OutputHandlingMarking } from "./output-handling";
import { signWorkspaceManifest, verifyWorkspaceManifestSignature, type WorkspaceSigningConfig } from "./workspace-signing";
import { BRIEF_RENDERER_VERSION, briefPublicationType, briefSourceHash, type BriefPublicationFormat } from "./brief-publication";
import type { BriefSnapshot } from "./governance-model";
import { evidenceDocumentReferences } from "./evidence-references";
import { acceptanceCompatibilityAdjustmentCount, enforceAcceptanceTransferInvariants, type AcceptanceCompatibilitySummary } from "./acceptance-transfer";
import { cleanupEvidenceObjectsForWorkspaceOperation, completeEvidenceObjectCleanupOperationStatement, enqueueEvidenceObjectCleanup, enqueueReplacedEvidenceCleanupStatement, evidenceObjectCleanupNotBefore, pendingEvidenceObjectCleanupCount, resolveEvidenceObjectCleanupObligations, type EvidenceObjectCleanupQueueItem, type QueuedCleanupItem } from "./evidence-cleanup";
import { validateSolutionDecisionHistory } from "./solution-decision-history";

export const WORKSPACE_PACKAGE_TYPE = "a2o.workspace-transfer";
export const WORKSPACE_PACKAGE_VERSION = "7.0.0";
const PRIOR_WORKSPACE_PACKAGE_VERSION = "6.0.0";
const OPTION_PLANNING_PACKAGE_VERSION = "5.0.0";
const LEGACY_FULL_CASE_PACKAGE_VERSION = "4.0.0";
const FULL_SCHEMA_UNSIGNED_VERSION = "3.0.0";
const PREVIOUS_WORKSPACE_PACKAGE_VERSION = "2.0.0";
const LEGACY_WORKSPACE_PACKAGE_VERSION = "1.0.0";
export const MAX_WORKSPACE_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_WORKSPACE_EXPANDED_BYTES = 300 * 1024 * 1024;
const MAX_WORKSPACE_TABLE_BYTES = 50 * 1024 * 1024;
// Restore currently materializes one governed insert per row in a single D1
// transaction. Keep the signed package envelope within the capacity we can
// exercise end to end on the local/offline runtime (the current working set is
// ~9,600 rows, with its largest table below 1,800 rows).
const MAX_WORKSPACE_TABLE_ROWS = 5_000;
const MAX_WORKSPACE_TOTAL_ROWS = 20_000;
const MAX_WORKSPACE_DOCUMENTS = 5_000;
// New uploads are bounded by MAX_EVIDENCE_DOCUMENT_BYTES. Transfer packages
// may also carry older, previously accepted files so an upgrade cannot make a
// workspace impossible to back up. Those bytes restore as download-only,
// application/octet-stream quarantine when they fail the current validator.
const MAX_WORKSPACE_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_WORKSPACE_FIELD_BYTES = 2 * 1024 * 1024;
const MAX_WORKSPACE_COMPRESSION_RATIO = 200;

type Database = typeof env.DB;

type TransferTableName = keyof typeof schema;
type TransferRow = Record<string, unknown>;

export type WorkspacePackageManifest = {
  packageType: typeof WORKSPACE_PACKAGE_TYPE;
  packageVersion: string;
  applicationVersion: string;
  exportedAt: string;
  program: { id: string; name: string; description: string | null; timezone: string };
  workspace: { id: string; label: string } | null;
  classification: "SYNTHETIC DEMONSTRATION DATA" | "PROGRAM WORKING DATA";
  tables: Array<{ name: string; file: string; rows: number; sha256: string }>;
  documents: Array<{ id: string; fileName: string; file: string; bytes: number; sha256: string }>;
  totals: { tables: number; rows: number; documents: number; documentBytes: number };
};

export type WorkspacePackagePreview = {
  manifest: WorkspacePackageManifest;
  warnings: string[];
  signature: { keyId: string; manifestSha256: string };
};

type ParsedPackage = WorkspacePackagePreview & {
  rowsByTable: Map<string, TransferRow[]>;
  documentBytes: Map<string, Uint8Array>;
  documentContentTypes: Map<string, string>;
  acceptanceCompatibility: AcceptanceCompatibilitySummary;
};

// Parent tables precede their children. Roles are deliberately excluded: a
// portable data package must not grant access in the destination environment.
const tableOrder: TransferTableName[] = [
  "appUsers",
  "sourcePackages",
  "releases",
  "releaseMilestones",
  "organizations",
  "configurationNodes",
  "products",
  "canonicalAliases",
  "canonicalMergeEvents",
  "productSuppliers",
  "capabilities",
  "productCapabilities",
  "deployments",
  "configurationBaselines",
  "sourceRows24",
  "baselineWorkspaces",
  "baselineNodeStates",
  "baselineDeploymentStates",
  "baselineOccurrences",
  "baselineRecordExtensions",
  "baselineRecordSources",
  "baselineRecordReviews",
  "sourceOccurrenceReviews",
  "sourceOccurrenceReviewsV2",
  "managedHostProfiles",
  "managedDeploymentProfiles",
  "platforms",
  "platformOrganizations",
  "platformBaselineAssignments",
  "infrastructureNodes",
  "infrastructureReferenceValues",
  "releaseInfrastructureNodes",
  "infrastructureProductInstallations",
  "infrastructureConnections",
  "releaseProfiles",
  "changeRequestTypes",
  "changeRequests",
  "changeEffects",
  "changeDependencies",
  "initiatives",
  "incumbentObjectives",
  "solutionOptions",
  "solutionOptionSteps",
  "solutionStepReferences",
  "solutionStepDependencies",
  "solutionOptionChangeRequests",
  "solutionOptionObjectives",
  "solutionOptionKnockOns",
  "solutionOptionAssessments",
  "initiativeSolutionDecisions",
  "initiativeSolutionDecisionRevisions",
  "assistantSolutionGenerations",
  "objectiveChangeRequestLinks",
  "changeRequestObjectiveDependencies",
  "objectiveEffectAttributions",
  "objectiveSourcePackages",
  "objectiveSourceRows",
  // Daily LM GitLab feed history is application data and must travel with
  // the workspace. The feed subject can exist without a governed Objective;
  // snapshots precede their item/state/link/dependency/delta rows.
  "lmObjectiveFeedSnapshots",
  "lmObjectiveFeedSubjects",
  "lmObjectiveFeedItems",
  "lmObjectiveFeedStates",
  "lmObjectiveFeedJpoLinks",
  "lmObjectiveFeedDependencies",
  "lmObjectiveFeedDeltas",
  "objectiveEstimates",
  "requirementTraces",
  "requirements",
  "objectiveRequirements",
  "acceptanceCriteria",
  "acceptanceSignoffs",
  "governanceRecords",
  "governanceRecordLinks",
  "evidenceDocuments",
  "ingestionRuns",
  "ingestionItems",
  "externalChangeSourceStates",
  "externalSourceSubjects",
  "externalSourceObservations",
  "externalSourceDeltas",
  "externalSourceRelations",
  "auditEvents",
];

const selfParentColumns: Partial<Record<TransferTableName, string>> = {
  releases: "predecessor_release_id",
  configurationNodes: "parent_id",
  capabilities: "parent_id",
  platforms: "parent_id",
  releaseInfrastructureNodes: "parent_state_id",
  solutionOptionSteps: "parent_step_id",
};

const tableSpecs = tableOrder.map((logicalName) => {
  const table = schema[logicalName] as AnySQLiteTable;
  return {
    logicalName,
    table,
    name: getTableName(table),
    columns: Object.values(getTableColumns(table)).map((column) => column.name),
    selfParentColumn: selfParentColumns[logicalName],
  };
});

const q = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const jsonText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const safeFileName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "evidence-file";
const forbiddenPortableText = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;

function validatedSnapshotText(value: unknown, fallback: string, field: string, maximum = 2_000) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string" || value.length > maximum || forbiddenPortableText.test(value)) throw new Error(`An imported report contains an invalid ${field}.`);
  return value;
}

function validatedSnapshotCount(value: unknown, allowLegacyDefault = false) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    if (allowLegacyDefault && (value === null || value === undefined)) return 0;
    throw new Error("An imported report contains an invalid snapshot count.");
  }
  return Number(value);
}

function validateImportedBriefSnapshot(value: unknown, allowLegacyDefaults = false) {
  if (typeof value !== "string") throw new Error("An imported report snapshot is missing.");
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("An imported report snapshot is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("An imported report snapshot is invalid.");
  const candidate = parsed as Record<string, unknown>;
  const allowedKeys = new Set(["asOf", "handlingMarking", "releaseName", "sourceRows", "products", "releases", "reviewRows", "productNames", "linkedRecords"]);
  if (!allowLegacyDefaults && Object.keys(candidate).some((key) => !allowedKeys.has(key))) throw new Error("An imported report snapshot contains unsupported fields.");
  const handlingMarking = candidate.handlingMarking === SYNTHETIC_HANDLING_MARKING || candidate.handlingMarking === PROGRAM_HANDLING_MARKING
    ? candidate.handlingMarking
    : allowLegacyDefaults ? PROGRAM_HANDLING_MARKING : null;
  if (!handlingMarking) throw new Error("An imported report snapshot has an invalid handling marking.");
  const productNameInput = Array.isArray(candidate.productNames) ? candidate.productNames : allowLegacyDefaults && candidate.productNames == null ? [] : null;
  if (!productNameInput || productNameInput.length > 100) throw new Error("An imported report contains an invalid product-name snapshot.");
  const productNames = productNameInput.map((item) => validatedSnapshotText(item, "", "snapshot product name", 500)).filter(Boolean);
  const linkedRecordInput = Array.isArray(candidate.linkedRecords) ? candidate.linkedRecords : allowLegacyDefaults && candidate.linkedRecords == null ? [] : null;
  if (!linkedRecordInput || linkedRecordInput.length > 200) throw new Error("An imported report contains an invalid linked-record snapshot.");
  const linkedRecords = linkedRecordInput.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("An imported report contains an invalid linked record snapshot.");
      const record = item as Record<string, unknown>;
      return {
        type: validatedSnapshotText(record.type, "record", "linked record type", 100),
        title: validatedSnapshotText(record.title, "Untitled record", "linked record title", 1_000),
        status: validatedSnapshotText(record.status, "unknown", "linked record status", 100),
      };
    });
  const snapshot: BriefSnapshot = {
    asOf: validatedSnapshotText(candidate.asOf, "", "snapshot date", 100),
    handlingMarking,
    releaseName: validatedSnapshotText(candidate.releaseName, "All releases", "snapshot release", 500),
    sourceRows: validatedSnapshotCount(candidate.sourceRows, allowLegacyDefaults),
    products: validatedSnapshotCount(candidate.products, allowLegacyDefaults),
    releases: validatedSnapshotCount(candidate.releases, allowLegacyDefaults),
    reviewRows: validatedSnapshotCount(candidate.reviewRows, allowLegacyDefaults),
    productNames,
    linkedRecords,
  };
  return { sourceText: value, handlingMarking, snapshot: allowLegacyDefaults ? snapshot : candidate as unknown as BriefSnapshot };
}

function validateImportedBriefMarkdown(value: unknown, handlingMarking: OutputHandlingMarking, allowLegacyMarkingConflict = false) {
  if (typeof value !== "string" || forbiddenPortableText.test(value)) throw new Error("An imported report contains unsafe control characters.");
  if (/(^|[^\\])<\s*\/?\s*[a-z][^>\r\n]*>/im.test(value)) throw new Error("Imported report Markdown cannot contain raw HTML.");
  if (/(^|[^\\])!\[[^\]\r\n]*\]\s*\([^\r\n)]*\)/m.test(value)) throw new Error("Imported report Markdown cannot contain embedded images.");
  if (/\[[^\]\r\n]+\]\(\s*(?:https?:|data:|javascript:|\/\/)/i.test(value)) throw new Error("Imported report Markdown cannot contain external or executable links.");
  const conflictingMarking = handlingMarking === PROGRAM_HANDLING_MARKING ? SYNTHETIC_HANDLING_MARKING : PROGRAM_HANDLING_MARKING;
  if (!allowLegacyMarkingConflict && value.includes(conflictingMarking)) throw new Error("An imported report body conflicts with its frozen snapshot handling marking.");
  return value;
}

type TransferDocumentDescriptor = WorkspacePackageManifest["documents"][number];

function applyAcceptanceTransferPolicy(
  rowsByTable: Map<string, TransferRow[]>,
  descriptors: readonly TransferDocumentDescriptor[],
  validatedContentTypes: ReadonlyMap<string, string>,
  packageVersion: string,
  warnings?: string[],
) {
  const descriptorIds = new Set(descriptors.map((descriptor) => descriptor.id));
  const evidenceRows = rowsByTable.get("evidence_document") ?? [];
  const evidenceDocumentIds = new Set(evidenceRows
    .map((row) => String(row.id || ""))
    .filter((documentId) => documentId && descriptorIds.has(documentId)));
  const quarantinedDocumentIds = new Set([...validatedContentTypes.entries()]
    .filter(([, contentType]) => contentType === "application/octet-stream")
    .map(([documentId]) => documentId));
  for (const row of evidenceRows) {
    if (row.content_type === "application/octet-stream" && String(row.description || "").startsWith("[QUARANTINED LEGACY EVIDENCE")) {
      quarantinedDocumentIds.add(String(row.id || ""));
    }
  }
  const summary = enforceAcceptanceTransferInvariants({
    criteria: rowsByTable.get("acceptance_criterion") ?? [],
    signoffs: rowsByTable.get("acceptance_signoff") ?? [],
    evidenceDocumentIds,
    quarantinedDocumentIds,
    currentPackage: packageVersion === WORKSPACE_PACKAGE_VERSION,
  });
  if (acceptanceCompatibilityAdjustmentCount(summary)) {
    warnings?.push(`Legacy acceptance compatibility applied: ${summary.detachedEvidenceSignoffs} dangling evidence reference(s) detached, ${summary.demotedCompletedSignoffs} completed sign-off(s) returned to pending, and ${summary.demotedPassedCriteria} unsupported passed criterion/criteria returned to in verification.`);
  }
  return summary;
}

async function validateFrozenReportProvenance(rowsByTable: Map<string, TransferRow[]>, descriptors: readonly TransferDocumentDescriptor[], validatedContentTypes?: ReadonlyMap<string, string>, warnings?: string[]) {
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const evidenceById = new Map((rowsByTable.get("evidence_document") ?? []).map((row) => [String(row.id || ""), row]));
  const briefsById = new Map((rowsByTable.get("executive_brief") ?? []).map((row) => [String(row.id || ""), row]));

  for (const [briefId, brief] of briefsById) {
    // Legacy report bytes remain portable forever. Missing historical snapshot
    // fields are interpreted fail-closed in memory and are never rewritten.
    const parsed = validateImportedBriefSnapshot(brief.snapshot_payload, true);
    validateImportedBriefMarkdown(brief.body_markdown, parsed.handlingMarking, true);
    for (const documentId of evidenceDocumentReferences(String(brief.body_markdown || ""), MAX_WORKSPACE_DOCUMENTS)) {
      if (!evidenceById.has(documentId) || !descriptorById.has(documentId)) throw new Error(`Report ${briefId} references evidence that is not present in the package.`);
    }
  }

  for (const publication of rowsByTable.get("brief_publication") ?? []) {
    const publicationId = String(publication.id || "");
    const brief = briefsById.get(String(publication.brief_id || ""));
    if (!brief) throw new Error(`Publication ${publicationId} references a missing frozen report.`);
    const legacy = publication.artifact_document_id == null && Number(publication.byte_size) === 0 && publication.source_hash === "legacy-unverified" && publication.renderer_version === "legacy";
    if (legacy) { warnings?.push(`Legacy publication ${publicationId} has no durable artifact and is retained as unverified history.`); continue; }
    const format = String(publication.format || "") as BriefPublicationFormat;
    if (!(format in briefPublicationType) || publication.renderer_version !== BRIEF_RENDERER_VERSION) throw new Error(`Publication ${publicationId} has unsupported renderer provenance.`);
    const artifactId = String(publication.artifact_document_id || "");
    const descriptor = descriptorById.get(artifactId);
    const evidence = evidenceById.get(artifactId);
    if (!artifactId || !descriptor || !evidence) throw new Error(`Publication ${publicationId} is missing its durable artifact.`);
    const expectedType = briefPublicationType[format];
    if (publication.content_hash !== `sha256:${descriptor.sha256}` || Number(publication.byte_size) !== descriptor.bytes || String(evidence.file_name || "") !== descriptor.fileName
      || String(evidence.content_type || "") !== expectedType.contentType || validatedContentTypes?.get(artifactId) !== expectedType.contentType || !descriptor.fileName.toLowerCase().endsWith(`.${expectedType.extension}`)) {
      throw new Error(`Publication ${publicationId} does not match its packaged artifact bytes and format.`);
    }
    // A durable publication was created under the current frozen-source
    // contract, so both of its snapshots must satisfy the strict shape.
    const briefSnapshot = validateImportedBriefSnapshot(brief.snapshot_payload, false).snapshot;
    const publicationSnapshot = validateImportedBriefSnapshot(publication.snapshot_payload, false).snapshot;
    const sourceInput = { id: String(brief.id || ""), title: String(brief.title || ""), bodyMarkdown: String(brief.body_markdown || "") };
    const currentSourceHash = await briefSourceHash({ ...sourceInput, snapshot: briefSnapshot });
    const publicationSourceHash = await briefSourceHash({ ...sourceInput, snapshot: publicationSnapshot });
    if (publication.source_hash !== currentSourceHash || publication.source_hash !== publicationSourceHash) throw new Error(`Publication ${publicationId} does not match its frozen report source.`);
  }
}

async function sha256(value: string | ArrayBuffer | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function topologicalRows(rows: TransferRow[], parentColumn?: string) {
  if (!parentColumn || rows.length < 2) return rows;
  const remaining = [...rows];
  const result: TransferRow[] = [];
  const inserted = new Set<unknown>();
  while (remaining.length) {
    const before = remaining.length;
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const row = remaining[index];
      const parent = row[parentColumn];
      if (parent == null || inserted.has(parent) || !rows.some((candidate) => candidate.id === parent)) {
        result.push(row);
        inserted.add(row.id);
        remaining.splice(index, 1);
      }
    }
    if (remaining.length === before) throw new Error(`The ${parentColumn} hierarchy contains a cycle.`);
  }
  return result;
}

async function readRows(db: Database, tableName: string, columns: string[]) {
  const sql = `SELECT ${columns.map(q).join(",")} FROM ${q(tableName)}`;
  return (await db.prepare(sql).all<TransferRow>()).results;
}

export async function exportWorkspacePackage(db: Database, bucket: DocumentBucket | undefined, applicationVersion: string, signingConfig: WorkspaceSigningConfig) {
  const zip = new JSZip();
  const tableEntries: WorkspacePackageManifest["tables"] = [];
  const documents: WorkspacePackageManifest["documents"] = [];
  const rowsByPhysicalName = new Map<string, TransferRow[]>();
  const validatedDocumentContentTypes = new Map<string, string>();
  let totalRows = 0;
  let documentBytes = 0;
  let expandedBytes = 0;

  // D1 batch executes the complete table read as one transaction, preventing a
  // signed transfer package from combining rows observed before and after a
  // concurrent governance mutation.
  const tableSnapshots = await db.batch([
    ...tableSpecs.map((spec) => db.prepare(`SELECT ${spec.columns.map(q).join(",")} FROM ${q(spec.name)}`)),
    db.prepare("SELECT id,name,description,timezone FROM program WHERE id='program-jsf'"),
    db.prepare("SELECT id,label FROM baseline_workspace WHERE id='workspace-jsf-current'"),
  ]);
  for (const [index, spec] of tableSpecs.entries()) {
    const snapshot = tableSnapshots[index];
    if (!snapshot?.success) throw new Error(`The ${spec.name} dataset could not be captured in the workspace snapshot.`);
    const rows = (snapshot.results || []) as TransferRow[];
    if (rows.length > MAX_WORKSPACE_TABLE_ROWS || totalRows + rows.length > MAX_WORKSPACE_TOTAL_ROWS) throw new Error(`The ${spec.name} dataset exceeds workspace export limits.`);
    for (const row of rows) for (const field of Object.values(row)) if (typeof field === "string" && new TextEncoder().encode(field).byteLength > MAX_WORKSPACE_FIELD_BYTES) throw new Error(`The ${spec.name} dataset contains a field that exceeds workspace export limits.`);
    rowsByPhysicalName.set(spec.name, rows);
    const file = `data/${spec.name}.json`;
    const content = jsonText(rows);
    const contentBytes = new TextEncoder().encode(content).byteLength;
    if (contentBytes > MAX_WORKSPACE_TABLE_BYTES || expandedBytes + contentBytes > MAX_WORKSPACE_EXPANDED_BYTES) throw new Error(`The ${spec.name} dataset exceeds workspace export limits.`);
    zip.file(file, content);
    tableEntries.push({ name: spec.name, file, rows: rows.length, sha256: await sha256(content) });
    totalRows += rows.length;
    expandedBytes += contentBytes;
  }

  const programRow = (tableSnapshots[tableSpecs.length]?.results?.[0] || null) as TransferRow | null;
  if (!programRow) throw new Error("The application workspace is not initialized.");
  const workspaceRow = (tableSnapshots[tableSpecs.length + 1]?.results?.[0] || null) as TransferRow | null;

  const evidenceRows = rowsByPhysicalName.get("evidence_document") ?? [];
  const evidenceIntegrity = new Map<string, { at: string; contentHash: string }>();
  for (const row of rowsByPhysicalName.get("audit_event") ?? []) {
    if (row.entity_kind !== "evidence_document" || !["evidence_document_attached", "evidence_document_restored", "evidence_integrity_sealed"].includes(String(row.action))) continue;
    const contentHash = evidenceHashFromAuditPayload(row.after_payload);
    if (!contentHash) continue;
    const documentId = String(row.entity_id || "");
    const at = String(row.created_at || "");
    const previous = evidenceIntegrity.get(documentId);
    if (!previous || previous.at <= at) evidenceIntegrity.set(documentId, { at, contentHash });
  }
  if (evidenceRows.length > MAX_WORKSPACE_DOCUMENTS) throw new Error("The workspace contains too many evidence documents for a portable package.");
  if (evidenceRows.length && !bucket) throw new Error("Evidence metadata exists, but document storage is unavailable. The workspace package was not created.");
  for (const row of evidenceRows) {
    const id = String(row.id || "");
    const objectKey = String(row.r2_key || "");
    const fileName = String(row.file_name || "evidence-file");
    const declaredBytes = Number(row.byte_size);
    const remainingExpandedBytes = MAX_WORKSPACE_EXPANDED_BYTES - expandedBytes;
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > MAX_WORKSPACE_DOCUMENT_BYTES || declaredBytes > remainingExpandedBytes) throw new Error(`Evidence document ${fileName} exceeds workspace package limits.`);
    const object = bucket ? await bucket.get(objectKey) : null;
    if (!object) throw new Error(`Evidence document ${fileName} is missing from storage. The workspace package was not created.`);
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await readBoundedObjectBytes(object, { maxBytes: Math.min(MAX_WORKSPACE_DOCUMENT_BYTES, remainingExpandedBytes), expectedBytes: declaredBytes, label: `Evidence document ${fileName}` })); }
    catch { throw new Error(`Evidence document ${fileName} exceeds or conflicts with workspace package limits.`); }
    // Current-policy validation is repeated during restore. Failure here does
    // not make the backup impossible: legacy bytes travel intact and restore
    // in the quarantine path below.
    try { validatedDocumentContentTypes.set(id, (await validateEvidenceBytes(fileName, bytes)).contentType); }
    catch { validatedDocumentContentTypes.set(id, "application/octet-stream"); /* Preserve unrelated legacy evidence for recoverability. */ }
    const computedSha256 = await sha256(bytes);
    const computedContentHash = `sha256:${computedSha256}`;
    const auditHash = evidenceIntegrity.get(id)?.contentHash || null;
    const metadataHash = object.customMetadata?.sha256?.toLowerCase() || null;
    if ((auditHash && metadataHash && auditHash !== metadataHash) || (auditHash && auditHash !== computedContentHash) || (metadataHash && metadataHash !== computedContentHash)) {
      throw new Error(`Evidence document ${fileName} failed its stored SHA-256 integrity check. The workspace package was not created.`);
    }
    const file = `documents/${String(documents.length + 1).padStart(6, "0")}-${(await sha256(id)).slice(0, 24)}-${safeFileName(fileName)}`;
    zip.file(file, bytes);
    documents.push({ id, fileName, file, bytes: bytes.byteLength, sha256: computedSha256 });
    documentBytes += bytes.byteLength;
    expandedBytes += bytes.byteLength;
  }

  applyAcceptanceTransferPolicy(rowsByPhysicalName, documents, validatedDocumentContentTypes, WORKSPACE_PACKAGE_VERSION);
  await validateFrozenReportProvenance(rowsByPhysicalName, documents, validatedDocumentContentTypes);
  // A portable workspace contains governance records, users, evidence, audit
  // history, and mutable analyst decisions in addition to baseline sources.
  // It is therefore always program working data; only the baseline-only export
  // endpoint may emit the synthetic demonstration marking.
  const classification = "PROGRAM WORKING DATA" as const;
  const manifest: WorkspacePackageManifest = {
    packageType: WORKSPACE_PACKAGE_TYPE,
    packageVersion: WORKSPACE_PACKAGE_VERSION,
    applicationVersion,
    exportedAt: new Date().toISOString(),
    program: { id: String(programRow.id), name: String(programRow.name), description: programRow.description == null ? null : String(programRow.description), timezone: String(programRow.timezone) },
    workspace: workspaceRow ? { id: String(workspaceRow.id), label: String(workspaceRow.label) } : null,
    classification,
    tables: tableEntries,
    documents,
    totals: { tables: tableEntries.length, rows: totalRows, documents: documents.length, documentBytes },
  };
  const manifestText = jsonText(manifest);
  const signatureEnvelope = await signWorkspaceManifest(manifestText, manifest, signingConfig);
  zip.file("manifest.json", manifestText);
  zip.file("signature.json", jsonText(signatureEnvelope));
  zip.file("README.txt", `A2O WORKSPACE TRANSFER PACKAGE\r\n\r\nThis file contains application data, relationships, audit history, and attached evidence. It does not contain authentication credentials or destination access roles. Validate the package signature in the application before replacing a workspace.\r\n\r\nSigner key ID: ${signatureEnvelope.keyId}\r\n`);
  // Store entries without compression so an approved repetitive text artifact
  // cannot produce a package that our own bounded parser mistakes for a ZIP
  // bomb. Whole-package size remains capped below.
  const packageBytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  if (packageBytes.byteLength > MAX_WORKSPACE_PACKAGE_BYTES) throw new Error("The generated Workspace Transfer Package exceeds 100 MB and cannot be restored by this application.");
  const selfCheck = new Uint8Array(packageBytes.byteLength);
  selfCheck.set(packageBytes);
  await parseWorkspacePackage(selfCheck.buffer, signingConfig);
  return { manifest, signature: { keyId: signatureEnvelope.keyId, manifestSha256: signatureEnvelope.manifestSha256 }, bytes: packageBytes };
}

function isManifest(value: unknown): value is WorkspacePackageManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspacePackageManifest>;
  const totals = candidate.totals as Partial<WorkspacePackageManifest["totals"]> | undefined;
  return candidate.packageType === WORKSPACE_PACKAGE_TYPE
    && (candidate.packageVersion === WORKSPACE_PACKAGE_VERSION || candidate.packageVersion === PRIOR_WORKSPACE_PACKAGE_VERSION || candidate.packageVersion === OPTION_PLANNING_PACKAGE_VERSION || candidate.packageVersion === LEGACY_FULL_CASE_PACKAGE_VERSION || candidate.packageVersion === FULL_SCHEMA_UNSIGNED_VERSION || candidate.packageVersion === PREVIOUS_WORKSPACE_PACKAGE_VERSION || candidate.packageVersion === LEGACY_WORKSPACE_PACKAGE_VERSION)
    && (candidate.classification === "SYNTHETIC DEMONSTRATION DATA" || candidate.classification === "PROGRAM WORKING DATA")
    && Array.isArray(candidate.tables)
    && Array.isArray(candidate.documents)
    && Boolean(totals)
    && [totals?.tables, totals?.rows, totals?.documents, totals?.documentBytes].every((item) => Number.isSafeInteger(item) && Number(item) >= 0);
}

export async function parseWorkspacePackage(bytes: ArrayBuffer, signingConfig: WorkspaceSigningConfig): Promise<ParsedPackage> {
  if (bytes.byteLength > MAX_WORKSPACE_PACKAGE_BYTES) throw new Error("Workspace packages are limited to 100 MB.");
  let zip: JSZip;
  // Parse the central directory without inflating every member. Manifest SHA-256
  // checks below provide integrity after declared sizes and compression ratios
  // have passed this bounded preflight.
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: true }); }
  catch { throw new Error("The selected file is not a valid Workspace Transfer Package."); }
  const allArchiveEntries = Object.values(zip.files);
  if (allArchiveEntries.length > tableSpecs.length + MAX_WORKSPACE_DOCUMENTS + 11) throw new Error("The package contains too many archive entries.");
  let declaredExpandedBytes = 0;
  for (const entry of allArchiveEntries) {
    const metadata = entry as unknown as { name: string; unsafeOriginalName?: string; dir: boolean; _data?: { compressedSize?: number; uncompressedSize?: number } };
    const originalName = metadata.unsafeOriginalName || metadata.name;
    if (!originalName || originalName.length > 512 || originalName.includes("\\") || originalName.includes("\0") || originalName.startsWith("/") || /^[A-Za-z]:/.test(originalName) || originalName.split("/").some((part) => part === "..")) throw new Error("The package contains an unsafe archive path.");
    if (metadata.dir) continue;
    const compressedSize = Number(metadata._data?.compressedSize);
    const uncompressedSize = Number(metadata._data?.uncompressedSize);
    if (!Number.isSafeInteger(compressedSize) || compressedSize < 0 || !Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0) throw new Error("The package contains invalid archive size metadata.");
    if (uncompressedSize > 0 && (compressedSize === 0 || uncompressedSize / compressedSize > MAX_WORKSPACE_COMPRESSION_RATIO)) throw new Error("The package contains a suspiciously compressed archive entry.");
    declaredExpandedBytes += uncompressedSize;
    if (declaredExpandedBytes > MAX_WORKSPACE_EXPANDED_BYTES) throw new Error("The expanded package exceeds workspace import limits.");
  }
  const archiveEntries = allArchiveEntries.filter((entry) => !entry.dir);
  if (archiveEntries.length > tableSpecs.length + MAX_WORKSPACE_DOCUMENTS + 3) throw new Error("The package contains too many archive entries.");
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("The package manifest is missing.");
  const signatureFile = zip.file("signature.json");
  if (!signatureFile) throw new Error("The workspace package is unsigned and cannot be trusted.");
  let manifestValue: unknown;
  const manifestText = await manifestFile.async("string");
  if (new TextEncoder().encode(manifestText).byteLength > 4 * 1024 * 1024) throw new Error("The package manifest is too large.");
  try { manifestValue = JSON.parse(manifestText); }
  catch { throw new Error("The package manifest is not valid JSON."); }
  const signatureText = await signatureFile.async("string");
  if (new TextEncoder().encode(signatureText).byteLength > 16 * 1024) throw new Error("The workspace package signature is too large.");
  let signatureValue: unknown;
  try { signatureValue = JSON.parse(signatureText); }
  catch { throw new Error("The workspace package signature is not valid JSON."); }
  const verifiedSignature = await verifyWorkspaceManifestSignature(manifestText, manifestValue, signatureValue, signingConfig);
  if (!isManifest(manifestValue)) throw new Error("The package type or version is not supported by this application.");
  const manifest = manifestValue;
  if (manifest.packageVersion === WORKSPACE_PACKAGE_VERSION && manifest.classification !== "PROGRAM WORKING DATA") throw new Error("Current workspace packages must use the fail-closed PROGRAM WORKING DATA classification.");
  if (manifest.documents.length > MAX_WORKSPACE_DOCUMENTS || manifest.totals.rows > MAX_WORKSPACE_TOTAL_ROWS || manifest.totals.documentBytes > MAX_WORKSPACE_EXPANDED_BYTES) throw new Error("The package exceeds workspace import limits.");
  const legacyLogicalNames = new Set<TransferTableName>(["infrastructureNodes", "infrastructureReferenceValues", "releaseInfrastructureNodes", "infrastructureProductInstallations", "infrastructureConnections"]);
  const previousLogicalNames = new Set<TransferTableName>(["infrastructureReferenceValues"]);
  const solutionEngineeringLogicalNames = new Set<TransferTableName>(["solutionOptions", "solutionOptionSteps", "solutionStepReferences", "solutionStepDependencies", "solutionOptionChangeRequests", "solutionOptionObjectives", "solutionOptionKnockOns", "solutionOptionAssessments", "initiativeSolutionDecisions", "initiativeSolutionDecisionRevisions"]);
  const fullCaseOnlyLogicalNames = new Set<TransferTableName>(["solutionStepReferences", "solutionStepDependencies", "solutionOptionKnockOns"]);
  const aiLogicalNames = new Set<TransferTableName>(["assistantSolutionGenerations"]);
  const omittedLogicalNames = new Set<TransferTableName>(manifest.packageVersion === WORKSPACE_PACKAGE_VERSION ? [] : manifest.packageVersion === PRIOR_WORKSPACE_PACKAGE_VERSION ? aiLogicalNames : manifest.packageVersion === OPTION_PLANNING_PACKAGE_VERSION ? [...aiLogicalNames, ...fullCaseOnlyLogicalNames] : [...aiLogicalNames, ...solutionEngineeringLogicalNames]);
  if (manifest.packageVersion === LEGACY_WORKSPACE_PACKAGE_VERSION) for (const name of legacyLogicalNames) omittedLogicalNames.add(name);
  if (manifest.packageVersion === PREVIOUS_WORKSPACE_PACKAGE_VERSION) for (const name of previousLogicalNames) omittedLogicalNames.add(name);
  const packageSpecs = tableSpecs.filter((spec) => !omittedLogicalNames.has(spec.logicalName));
  const expectedNames = new Set(packageSpecs.map((spec) => spec.name));
  if (manifest.tables.length !== packageSpecs.length || manifest.tables.some((entry) => !expectedNames.has(entry.name))) throw new Error(`The package does not contain the complete version ${manifest.packageVersion} application dataset.`);
  const rowsByTable = new Map<string, TransferRow[]>();
  const warnings: string[] = [];
  const usedFiles = new Set(["manifest.json", "signature.json"]);
  let expandedBytes = new TextEncoder().encode(manifestText).byteLength;
  let totalRows = 0;

  for (const spec of packageSpecs) {
    const entry = manifest.tables.find((item) => item.name === spec.name);
    if (!entry) throw new Error(`The ${spec.name} dataset is missing.`);
    if (entry.file !== `data/${spec.name}.json` || usedFiles.has(entry.file)) throw new Error(`The ${spec.name} dataset path is invalid.`);
    if (!Number.isSafeInteger(entry.rows) || entry.rows < 0 || entry.rows > MAX_WORKSPACE_TABLE_ROWS) throw new Error(`The ${spec.name} row count exceeds workspace import limits.`);
    usedFiles.add(entry.file);
    const file = zip.file(entry.file);
    if (!file) throw new Error(`The ${entry.file} dataset file is missing.`);
    const content = await file.async("string");
    const contentBytes = new TextEncoder().encode(content).byteLength;
    if (contentBytes > MAX_WORKSPACE_TABLE_BYTES || expandedBytes + contentBytes > MAX_WORKSPACE_EXPANDED_BYTES) throw new Error(`The ${entry.name} dataset exceeds workspace import limits.`);
    expandedBytes += contentBytes;
    if (await sha256(content) !== entry.sha256) throw new Error(`The ${entry.name} dataset checksum is invalid.`);
    let rows: unknown;
    try { rows = JSON.parse(content); } catch { throw new Error(`The ${entry.name} dataset is not valid JSON.`); }
    if (!Array.isArray(rows) || rows.length !== entry.rows) throw new Error(`The ${entry.name} row count does not match its manifest.`);
    const allowed = new Set(spec.columns);
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`The ${entry.name} dataset contains an invalid row.`);
      if (spec.logicalName === "briefPublications" && manifest.packageVersion !== WORKSPACE_PACKAGE_VERSION) {
        row.byte_size ??= 0;
        row.source_hash ??= "legacy-unverified";
        row.renderer_version ??= "legacy";
        row.artifact_document_id ??= null;
      }
      if (spec.logicalName === "initiatives" && manifest.packageVersion !== WORKSPACE_PACKAGE_VERSION) {
        row.problem_statement ??= null;
        row.drivers_constraints ??= null;
        row.decision_question ??= row.decision_ask ?? null;
        row.closed_at ??= null;
      }
      if (spec.logicalName === "solutionOptionSteps" && manifest.packageVersion !== WORKSPACE_PACKAGE_VERSION) {
        row.parent_step_id ??= null;
        row.wbs_code ??= null;
        row.owner ??= null;
        row.planning_start ??= null;
        row.planning_finish ??= null;
        row.planning_effort_hours ??= null;
        row.planning_effort_basis ??= null;
      }
      if (spec.logicalName === "changeRequests" && manifest.packageVersion !== WORKSPACE_PACKAGE_VERSION) {
        row.source_description ??= row.summary ?? null;
        row.government_synopsis ??= null;
        row.description_authority ??= "migrated_unclassified";
      }
      if (spec.logicalName === "incumbentObjectives" && manifest.packageVersion !== WORKSPACE_PACKAGE_VERSION) {
        row.source_description ??= row.summary ?? null;
        row.government_synopsis ??= null;
        row.description_authority ??= "migrated_unclassified";
      }
      const keys = Object.keys(row);
      if (keys.length !== spec.columns.length || keys.some((key) => !allowed.has(key))) throw new Error(`The ${entry.name} dataset does not match the version 1 schema.`);
      for (const field of Object.values(row)) {
        if (field !== null && typeof field !== "string" && typeof field !== "number" && typeof field !== "boolean") throw new Error(`The ${entry.name} dataset contains an unsupported field value.`);
        if (typeof field === "string" && new TextEncoder().encode(field).byteLength > MAX_WORKSPACE_FIELD_BYTES) throw new Error(`The ${entry.name} dataset contains an oversized field.`);
      }
    }
    totalRows += rows.length;
    if (totalRows > MAX_WORKSPACE_TOTAL_ROWS) throw new Error("The package contains too many data rows.");
    rowsByTable.set(entry.name, rows as TransferRow[]);
  }
  if (omittedLogicalNames.size) {
    for (const spec of tableSpecs.filter((item) => omittedLogicalNames.has(item.logicalName))) rowsByTable.set(spec.name, []);
  }
  await validateSolutionDecisionHistory(rowsByTable);
  if (manifest.packageVersion === LEGACY_WORKSPACE_PACKAGE_VERSION) {
    warnings.push("This version 1 package predates governed infrastructure. Existing baseline data will load; infrastructure can be added after import.");
  } else if (manifest.packageVersion === PREVIOUS_WORKSPACE_PACKAGE_VERSION) {
    warnings.push("This version 2 package predates governed infrastructure vocabularies. Existing infrastructure will load; storage and file-system classifications can be reviewed after import.");
  } else if (manifest.packageVersion === OPTION_PLANNING_PACKAGE_VERSION) {
    warnings.push("This version 5 package predates option WBS references, event-level dependencies, and structured knock-ons. Existing Initiative alternatives are retained; the new planning overlays begin empty.");
  } else if (manifest.packageVersion === PRIOR_WORKSPACE_PACKAGE_VERSION) {
    warnings.push("This version 6 package predates separated source/Government descriptions and persisted AI solution drafts. Existing analysis is retained and labeled migrated-unclassified.");
  } else if (manifest.packageVersion !== WORKSPACE_PACKAGE_VERSION) {
    warnings.push("This package predates Solution Engineering options. Existing Initiative data will load; alternatives and adjudication can be added after import.");
  }

  const importedSourceNames = (rowsByTable.get("source_package") ?? []).map((row) => String(row.file_name || ""));
  const importedSourceKeys = (rowsByTable.get("source_row_24") ?? []).map((row) => String(row.source_key || ""));
  // The exporter computed rendered-row equality inside the same transactional
  // database snapshot. A signed package cannot reconstruct normalized overlay
  // assembly portably, so import independently rechecks the reserved source
  // filename/key namespace and trusts only a fail-closed PROGRAM downgrade.
  const strongestLineageClassification = classifyImportedSourceLineage(importedSourceNames, importedSourceKeys, true, true);
  if (manifest.classification === "SYNTHETIC DEMONSTRATION DATA" && strongestLineageClassification !== "SYNTHETIC DEMONSTRATION DATA") throw new Error("The package classification overstates its source-package lineage.");
  for (const row of rowsByTable.get("executive_brief") ?? []) {
    const snapshot = validateImportedBriefSnapshot(row.snapshot_payload, true);
    validateImportedBriefMarkdown(row.body_markdown, snapshot.handlingMarking, true);
  }
  for (const row of rowsByTable.get("brief_publication") ?? []) validateImportedBriefSnapshot(row.snapshot_payload, true);

  const documentBytes = new Map<string, Uint8Array>();
  const documentContentTypes = new Map<string, string>();
  const documentIds = new Set<string>();
  for (const entry of manifest.documents) {
    if (!entry.id || documentIds.has(entry.id) || !entry.file.startsWith("documents/") || entry.file.split("/").some((part) => part === "..") || usedFiles.has(entry.file)) throw new Error(`The evidence file path for ${entry.fileName || entry.id} is invalid.`);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_WORKSPACE_DOCUMENT_BYTES) throw new Error(`The evidence file ${entry.fileName} exceeds workspace import limits.`);
    documentIds.add(entry.id);
    usedFiles.add(entry.file);
    const file = zip.file(entry.file);
    if (!file) throw new Error(`The evidence file ${entry.fileName} is missing.`);
    const content = await file.async("uint8array");
    if (expandedBytes + content.byteLength > MAX_WORKSPACE_EXPANDED_BYTES) throw new Error("The expanded package exceeds workspace import limits.");
    expandedBytes += content.byteLength;
    if (content.byteLength !== entry.bytes || await sha256(content) !== entry.sha256) throw new Error(`The evidence file ${entry.fileName} failed integrity validation.`);
    let contentType: string;
    try { contentType = (await validateEvidenceBytes(entry.fileName, content)).contentType; }
    catch {
      contentType = "application/octet-stream";
      warnings.push(`Legacy evidence ${entry.fileName} does not meet the current upload policy and will restore in download-only quarantine.`);
    }
    documentBytes.set(entry.id, content);
    documentContentTypes.set(entry.id, contentType);
  }
  const evidenceRows = rowsByTable.get("evidence_document") ?? [];
  if (evidenceRows.length !== manifest.documents.length) throw new Error("Evidence metadata and file counts do not match.");
  if (manifest.totals.tables !== manifest.tables.length || manifest.totals.rows !== totalRows || manifest.totals.documents !== manifest.documents.length || manifest.totals.documentBytes !== [...documentBytes.values()].reduce((sum, content) => sum + content.byteLength, 0)) throw new Error("Workspace package totals do not match the manifest contents.");
  for (const row of evidenceRows) {
    const id = String(row.id);
    const descriptor = manifest.documents.find((entry) => entry.id === id);
    if (!documentBytes.has(id) || !descriptor) throw new Error(`Evidence content is missing for ${String(row.file_name || row.id)}.`);
    if (String(row.file_name || "") !== descriptor.fileName || Number(row.byte_size) !== descriptor.bytes) throw new Error(`Evidence metadata does not match the packaged file ${descriptor.fileName}.`);
  }
  const acceptanceCompatibility = applyAcceptanceTransferPolicy(rowsByTable, manifest.documents, documentContentTypes, manifest.packageVersion, warnings);
  await validateFrozenReportProvenance(rowsByTable, manifest.documents, documentContentTypes, warnings);
  const publicationsByBrief = new Map<string, TransferRow[]>();
  for (const publication of rowsByTable.get("brief_publication") ?? []) publicationsByBrief.set(String(publication.brief_id || ""), [...(publicationsByBrief.get(String(publication.brief_id || "")) || []), publication]);
  for (const brief of rowsByTable.get("executive_brief") ?? []) {
    if (brief.status !== "published") continue;
    const durable = (publicationsByBrief.get(String(brief.id || "")) || []).some((publication) => publication.artifact_document_id && publication.renderer_version === BRIEF_RENDERER_VERSION && Number(publication.byte_size) > 0);
    if (durable) continue;
    if (manifest.packageVersion === WORKSPACE_PACKAGE_VERSION) throw new Error("A published report in the package has no durable verified publication artifact.");
    brief.status = "reviewed";
    brief.published_at = null;
    warnings.push(`Legacy report ${String(brief.id || "")} was returned to reviewed status because its older package contained no durable publication artifact.`);
  }
  const allowedArchiveFiles = new Set([...usedFiles, "README.txt"]);
  if (archiveEntries.some((entry) => !allowedArchiveFiles.has(entry.name))) throw new Error("The package contains an unexpected archive entry.");
  if (manifest.classification === "SYNTHETIC DEMONSTRATION DATA") warnings.push("This package contains synthetic demonstration data, not program data.");
  return { manifest, warnings, signature: { keyId: verifiedSignature.keyId, manifestSha256: verifiedSignature.manifestSha256 }, rowsByTable, documentBytes, documentContentTypes, acceptanceCompatibility };
}

function insertStatement(db: Database, tableName: string, columns: string[], row: TransferRow, ignore = false) {
  const sql = `INSERT ${ignore ? "OR IGNORE " : ""}INTO ${q(tableName)} (${columns.map(q).join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
  return db.prepare(sql).bind(...columns.map((column) => row[column] === undefined ? null : row[column]));
}

export async function replaceWorkspaceFromPackage(db: Database, bucket: DocumentBucket | undefined, bytes: ArrayBuffer, actorId: string, signingConfig: WorkspaceSigningConfig) {
  const parsed = await parseWorkspacePackage(bytes, signingConfig);
  if (parsed.manifest.documents.length && !bucket) throw new Error("This package contains evidence documents, but document storage is unavailable.");
  const importId = crypto.randomUUID();
  const stagingOperationId = `workspace-import:${importId}:staging`;
  const replacedOperationId = `workspace-import:${importId}:replaced`;
  let stagingObligations: QueuedCleanupItem[] = [];
  const existingEvidence = await db.prepare("SELECT id,r2_key FROM evidence_document WHERE program_id='program-jsf'").all<{ id: string; r2_key: string }>();
  if (existingEvidence.results.length && !bucket) throw new Error("The current workspace has evidence objects, but document storage is unavailable. Replacement was not started because the current objects could not be durably cleaned up.");
  const evidenceRows = parsed.rowsByTable.get("evidence_document") ?? [];
  const restoredEvidenceDetails = new Map<string, { declaredContentType: string | null; declaredDescription: string | null; restoredContentType: string; quarantined: boolean }>();
  const deferredPassedCriterionIds = new Set((parsed.rowsByTable.get("acceptance_criterion") ?? [])
    .filter((row) => row.status === "passed" && !String(row.evidence_reference || "").trim())
    .map((row) => String(row.id)));
  const cleanupNotBefore = evidenceObjectCleanupNotBefore();
  const stagingUploads = evidenceRows.map((row) => {
    const id = String(row.id);
    const descriptor = parsed.manifest.documents.find((entry) => entry.id === id);
    const content = parsed.documentBytes.get(id);
    const contentType = parsed.documentContentTypes.get(id);
    if (!descriptor || !content || !contentType || !bucket) throw new Error(`Evidence content is unavailable for ${String(row.file_name || id)}.`);
    const key = `workspace-import/${importId}/${id}-${safeFileName(descriptor.fileName)}`;
    return {
      row, id, descriptor, content, contentType, key,
      cleanup: { entityId: `workspace-import:${importId}:${id}`, sourceDocumentId: id, r2Key: key, reason: "workspace_import_not_committed", notBefore: cleanupNotBefore } satisfies EvidenceObjectCleanupQueueItem,
    };
  });

  try {
    if (stagingUploads.length) {
      const enqueued = await enqueueEvidenceObjectCleanup(db, actorId, stagingOperationId, stagingUploads.map((item) => item.cleanup));
      stagingObligations = enqueued.queued;
      if (enqueued.failed.length || stagingObligations.length !== stagingUploads.length) throw new Error("Workspace replacement could not durably queue every staging-object cleanup obligation before storage writes.");
    }
    for (const { row, id, descriptor, content, contentType, key } of stagingUploads) {
      if (!bucket) throw new Error("Document storage became unavailable before a durably queued staging upload could begin.");
      const documentBytes = new Uint8Array(content.byteLength);
      documentBytes.set(content);
      await bucket.put(key, documentBytes.buffer, { httpMetadata: { contentType, contentDisposition: `attachment; filename="${safeFileName(descriptor.fileName)}"` }, customMetadata: { sha256: `sha256:${descriptor.sha256}` } });
      restoredEvidenceDetails.set(id, {
        declaredContentType: row.content_type == null ? null : String(row.content_type),
        declaredDescription: row.description == null ? null : String(row.description),
        restoredContentType: contentType,
        quarantined: contentType === "application/octet-stream",
      });
      row.r2_key = key;
      row.content_type = contentType;
      if (contentType === "application/octet-stream") {
        const priorDescription = String(row.description || "").trim();
        row.description = `[QUARANTINED LEGACY EVIDENCE — VERIFY BEFORE OPENING]${priorDescription ? ` ${priorDescription}` : ""}`;
      }
    }

    const statements: ReturnType<Database["prepare"]>[] = [];
    const at = new Date().toISOString();
    // Keep the destination program, users, and roles. Everything else is the
    // portable workspace and is replaced atomically in foreign-key order.
    // Temporarily demote only criteria governed by the trigger in migration
    // 0026. This lets the same atomic batch delete the old sign-offs and load
    // parent criteria before their child sign-offs, then restores the signed
    // status after every referenced evidence row is present.
    statements.push(db.prepare("UPDATE acceptance_criterion SET status='in_verification' WHERE status='passed' AND length(trim(coalesce(evidence_reference,'')))=0"));
    // Decision revisions are append-only during normal operation. The atomic
    // replacement batch establishes one short-lived maintenance lock, returns
    // completed decisions to Pending, removes child revisions before parents,
    // and clears the lock before commit. A failed batch leaves no lock behind.
    statements.push(db.prepare("INSERT INTO initiative_solution_decision_maintenance_lock (id,operation_id,created_at) VALUES (1,?,?)").bind(importId, at));
    statements.push(db.prepare("UPDATE initiative_solution_decision SET disposition='pending',selected_option_id=NULL,decision_authority=NULL,decision_date=NULL,rationale=NULL,accepted_residual_risk=NULL,basis_snapshot_json=NULL,basis_hash=NULL WHERE disposition<>'pending'"));
    // Queue every old object in the same atomic transaction that removes its
    // metadata. A committed replacement therefore cannot leave an object with
    // neither a live database reference nor a durable cleanup obligation.
    if (existingEvidence.results.length) statements.push(enqueueReplacedEvidenceCleanupStatement(db, actorId, replacedOperationId, at));
    // Sign-offs must be removed before evidence because migration 0026 gives
    // the historical document-id column database-level RESTRICT semantics.
    statements.push(db.prepare("DELETE FROM acceptance_signoff"));
    for (const spec of [...tableSpecs].reverse()) if (spec.logicalName !== "appUsers" && spec.logicalName !== "auditEvents" && spec.logicalName !== "acceptanceSignoffs") statements.push(db.prepare(`DELETE FROM ${q(spec.name)}`));
    const importedDecisionsById = new Map((parsed.rowsByTable.get("initiative_solution_decision") ?? []).map((row) => [String(row.id || ""), row]));
    for (const spec of tableSpecs) {
      // Evidence rows are historically ordered after sign-offs in the transfer
      // schema. Defer sign-off inserts until the document rows exist so the
      // migration-0026 RESTRICT/existence triggers can validate them.
      if (spec.logicalName === "acceptanceSignoffs") continue;
      // Preserve source audit history as explicitly namespaced provenance. It
      // cannot overwrite destination audit IDs or impersonate destination actors.
      if (spec.logicalName === "auditEvents") {
        for (const row of parsed.rowsByTable.get(spec.name) ?? []) {
          const sourceAuditId = String(row.id || crypto.randomUUID());
          const sourceAction = String(row.action || "unknown");
          const payload = JSON.stringify({ sourcePackageExportedAt: parsed.manifest.exportedAt, sourceAuditId, sourceActorId: row.actor_id ?? null, sourceBeforePayload: row.before_payload ?? null, sourceAfterPayload: row.after_payload ?? null });
          statements.push(db.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,before_payload,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`imported-${importId}-${sourceAuditId}`, "program-jsf", null, `imported:${sourceAction}`, String(row.entity_kind || "unknown"), String(row.entity_id || sourceAuditId), null, payload, String(row.created_at || at)));
        }
        continue;
      }
      const rows = topologicalRows(parsed.rowsByTable.get(spec.name) ?? [], spec.selfParentColumn);
      for (const row of rows) {
        // A completed current decision creates its validated latest revision
        // through the database trigger. Import only its earlier history; a
        // Pending decision has no current completed row, so import all history.
        if (spec.logicalName === "initiativeSolutionDecisionRevisions") {
          const current = importedDecisionsById.get(String(row.decision_id || ""));
          if (current?.disposition !== "pending" && Number(row.revision) === Number(current?.decision_revision)) continue;
        }
        const insertRow = spec.logicalName === "acceptanceCriteria" && deferredPassedCriterionIds.has(String(row.id))
          ? { ...row, status: "in_verification" }
          : row;
        statements.push(insertStatement(db, spec.name, spec.columns, insertRow, spec.logicalName === "appUsers"));
      }
    }
    const signoffSpec = tableSpecs.find((spec) => spec.logicalName === "acceptanceSignoffs");
    if (!signoffSpec) throw new Error("The acceptance sign-off transfer schema is unavailable.");
    for (const row of parsed.rowsByTable.get(signoffSpec.name) ?? []) statements.push(insertStatement(db, signoffSpec.name, signoffSpec.columns, row));
    for (const criterionId of deferredPassedCriterionIds) statements.push(db.prepare("UPDATE acceptance_criterion SET status='passed' WHERE id=?").bind(criterionId));
    for (const descriptor of parsed.manifest.documents) {
      const restoredEvidence = restoredEvidenceDetails.get(descriptor.id);
      if (!restoredEvidence) throw new Error(`Restored evidence metadata is unavailable for ${descriptor.fileName}.`);
      statements.push(db.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(`audit-${crypto.randomUUID()}`, "program-jsf", actorId, "evidence_document_restored", "evidence_document", descriptor.id, JSON.stringify({ fileName: descriptor.fileName, byteSize: descriptor.bytes, contentHash: `sha256:${descriptor.sha256}`, sourcePackageExportedAt: parsed.manifest.exportedAt, ...restoredEvidence }), at));
    }
    if (acceptanceCompatibilityAdjustmentCount(parsed.acceptanceCompatibility)) {
      statements.push(db.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(`audit-${crypto.randomUUID()}`, "program-jsf", actorId, "workspace_package_acceptance_compatibility_adjusted", "baseline_workspace", "workspace-jsf-current", JSON.stringify({ packageVersion: parsed.manifest.packageVersion, sourcePackageExportedAt: parsed.manifest.exportedAt, ...parsed.acceptanceCompatibility }), at));
    }
    statements.push(db.prepare("UPDATE program SET name=?,description=?,timezone=?,updated_at=? WHERE id='program-jsf'").bind(parsed.manifest.program.name, parsed.manifest.program.description, parsed.manifest.program.timezone, at));
    statements.push(db.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(`audit-${crypto.randomUUID()}`, "program-jsf", actorId, "workspace_package_imported", "baseline_workspace", "workspace-jsf-current", JSON.stringify({ packageVersion: parsed.manifest.packageVersion, exportedAt: parsed.manifest.exportedAt, classification: parsed.manifest.classification, totals: parsed.manifest.totals, signerKeyId: parsed.signature.keyId, manifestSha256: parsed.signature.manifestSha256 }), at));
    statements.push(db.prepare("DELETE FROM initiative_solution_decision_maintenance_lock WHERE id=1 AND operation_id=?").bind(importId));
    const stagingCompletionIndex = statements.length;
    if (stagingObligations.length) statements.push(completeEvidenceObjectCleanupOperationStatement(db, actorId, stagingOperationId, at));
    const replacementResults = await db.batch(statements);
    if (replacementResults.some((result) => !result.success)) throw new Error("The atomic workspace replacement did not commit every database statement.");
    if (stagingObligations.length && Number(replacementResults[stagingCompletionIndex]?.meta?.changes || 0) !== stagingObligations.length) throw new Error("The atomic workspace replacement did not resolve every staging-object cleanup obligation.");
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : "Workspace replacement failed.";
    if (!bucket || !stagingObligations.length) throw error;
    let cleanup = { completed: 0, failed: stagingObligations.length, malformed: 0 };
    try {
      cleanup = await resolveEvidenceObjectCleanupObligations(db, bucket, actorId, stagingObligations);
    } catch (cleanupError) {
      console.error("Failed workspace import left durably queued staging-object cleanup", { importId, queued: stagingObligations.length, cleanupError });
    }
    const remaining = await pendingEvidenceObjectCleanupCount(db, stagingOperationId).catch(() => stagingObligations.length - cleanup.completed);
    throw new Error(`${originalMessage} Staging cleanup resolved ${cleanup.completed}; ${remaining} exact obligation(s) remain durably queued.`);
  }

  const warnings = [...parsed.warnings];
  if (bucket && existingEvidence.results.length) {
    try {
      const cleanup = await cleanupEvidenceObjectsForWorkspaceOperation(db, bucket, actorId, replacedOperationId, existingEvidence.results.length);
      if (cleanup.remaining) warnings.push(`Workspace replacement completed, but ${cleanup.remaining} prior evidence object(s) remain durably queued for storage cleanup. Run the steward cleanup retry before media sanitization.`);
    } catch (cleanupError) {
      console.error("Workspace replacement completed with prior evidence cleanup still queued", { importId, cleanupError });
      warnings.push(`${existingEvidence.results.length} prior evidence object cleanup obligation(s) were durably queued, but the immediate cleanup pass could not complete. Run the steward cleanup retry before media sanitization.`);
    }
  }
  return { manifest: parsed.manifest, warnings, signature: parsed.signature };
}
