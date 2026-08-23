import JSZip from "jszip";
import { env } from "cloudflare:workers";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { schema } from "../db/schema";
import type { DocumentBucket } from "./governance-server";
import { validateEvidenceBytes } from "./evidence-validation";
import { PROGRAM_HANDLING_MARKING, SYNTHETIC_HANDLING_MARKING, workspaceClassificationFromSourceNames, type OutputHandlingMarking } from "./output-handling";

export const WORKSPACE_PACKAGE_TYPE = "a2o.workspace-transfer";
export const WORKSPACE_PACKAGE_VERSION = "3.0.0";
const PREVIOUS_WORKSPACE_PACKAGE_VERSION = "2.0.0";
const LEGACY_WORKSPACE_PACKAGE_VERSION = "1.0.0";
export const MAX_WORKSPACE_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_WORKSPACE_EXPANDED_BYTES = 300 * 1024 * 1024;
const MAX_WORKSPACE_TABLE_BYTES = 50 * 1024 * 1024;
const MAX_WORKSPACE_TABLE_ROWS = 250_000;
const MAX_WORKSPACE_TOTAL_ROWS = 750_000;
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
};

type ParsedPackage = WorkspacePackagePreview & {
  rowsByTable: Map<string, TransferRow[]>;
  documentBytes: Map<string, Uint8Array>;
  documentContentTypes: Map<string, string>;
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
  "initiativeScopes",
  "initiativeChangeRequests",
  "incumbentObjectives",
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
  "initiativeMilestones",
  "workPackages",
  "workPackageObjectives",
  "workPackageDependencies",
  "governanceRecords",
  "governanceRecordLinks",
  "evidenceDocuments",
  "executiveBriefs",
  "briefPublications",
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
  workPackages: "parent_id",
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

function validatedSnapshotCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function normalizeImportedBriefSnapshot(value: unknown, packageMarking: OutputHandlingMarking) {
  if (typeof value !== "string") throw new Error("An imported report snapshot is missing.");
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("An imported report snapshot is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("An imported report snapshot is invalid.");
  const candidate = parsed as Record<string, unknown>;
  // Never upgrade an older program-data artifact to synthetic. A synthetic
  // marker is accepted only when the package's verified lineage is synthetic.
  const handlingMarking = candidate.handlingMarking === SYNTHETIC_HANDLING_MARKING && packageMarking === SYNTHETIC_HANDLING_MARKING
    ? SYNTHETIC_HANDLING_MARKING
    : PROGRAM_HANDLING_MARKING;
  const productNames = Array.isArray(candidate.productNames)
    ? candidate.productNames.slice(0, 100).map((item) => validatedSnapshotText(item, "", "snapshot product name", 500)).filter(Boolean)
    : [];
  const linkedRecords = Array.isArray(candidate.linkedRecords)
    ? candidate.linkedRecords.slice(0, 200).map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("An imported report contains an invalid linked record snapshot.");
      const record = item as Record<string, unknown>;
      return {
        type: validatedSnapshotText(record.type, "record", "linked record type", 100),
        title: validatedSnapshotText(record.title, "Untitled record", "linked record title", 1_000),
        status: validatedSnapshotText(record.status, "unknown", "linked record status", 100),
      };
    })
    : [];
  return JSON.stringify({
    asOf: validatedSnapshotText(candidate.asOf, "", "snapshot date", 100),
    handlingMarking,
    releaseName: validatedSnapshotText(candidate.releaseName, "All releases", "snapshot release", 500),
    sourceRows: validatedSnapshotCount(candidate.sourceRows),
    products: validatedSnapshotCount(candidate.products),
    releases: validatedSnapshotCount(candidate.releases),
    reviewRows: validatedSnapshotCount(candidate.reviewRows),
    productNames,
    linkedRecords,
  });
}

function validateImportedBriefMarkdown(value: unknown, handlingMarking: OutputHandlingMarking) {
  if (typeof value !== "string" || forbiddenPortableText.test(value)) throw new Error("An imported report contains unsafe control characters.");
  if (/(^|[^\\])<\s*\/?\s*[a-z][^>\r\n]*>/im.test(value)) throw new Error("Imported report Markdown cannot contain raw HTML.");
  if (/(^|[^\\])!\[[^\]\r\n]*\]\s*\([^\r\n)]*\)/m.test(value)) throw new Error("Imported report Markdown cannot contain embedded images.");
  if (/\[[^\]\r\n]+\]\(\s*(?:https?:|data:|javascript:|\/\/)/i.test(value)) throw new Error("Imported report Markdown cannot contain external or executable links.");
  return handlingMarking === PROGRAM_HANDLING_MARKING ? value.replaceAll(SYNTHETIC_HANDLING_MARKING, PROGRAM_HANDLING_MARKING) : value;
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

export async function exportWorkspacePackage(db: Database, bucket: DocumentBucket | undefined, applicationVersion: string) {
  const program = await db.prepare("SELECT id,name,description,timezone FROM program WHERE id='program-jsf'").all<{ id: string; name: string; description: string | null; timezone: string }>();
  if (!program.results[0]) throw new Error("The application workspace is not initialized.");
  const workspace = await db.prepare("SELECT id,label FROM baseline_workspace WHERE id='workspace-jsf-current'").all<{ id: string; label: string }>();
  const zip = new JSZip();
  const tableEntries: WorkspacePackageManifest["tables"] = [];
  const documents: WorkspacePackageManifest["documents"] = [];
  const rowsByPhysicalName = new Map<string, TransferRow[]>();
  let totalRows = 0;
  let documentBytes = 0;
  let expandedBytes = 0;

  for (const spec of tableSpecs) {
    const rows = await readRows(db, spec.name, spec.columns);
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

  const evidenceRows = rowsByPhysicalName.get("evidence_document") ?? [];
  if (evidenceRows.length > MAX_WORKSPACE_DOCUMENTS) throw new Error("The workspace contains too many evidence documents for a portable package.");
  if (evidenceRows.length && !bucket) throw new Error("Evidence metadata exists, but document storage is unavailable. The workspace package was not created.");
  for (const row of evidenceRows) {
    const id = String(row.id || "");
    const objectKey = String(row.r2_key || "");
    const fileName = String(row.file_name || "evidence-file");
    const object = bucket ? await bucket.get(objectKey) : null;
    if (!object) throw new Error(`Evidence document ${fileName} is missing from storage. The workspace package was not created.`);
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    if (bytes.byteLength > MAX_WORKSPACE_DOCUMENT_BYTES || expandedBytes + bytes.byteLength > MAX_WORKSPACE_EXPANDED_BYTES) throw new Error(`Evidence document ${fileName} exceeds workspace package limits.`);
    // Current-policy validation is repeated during restore. Failure here does
    // not make the backup impossible: legacy bytes travel intact and restore
    // in the quarantine path below.
    try { await validateEvidenceBytes(fileName, bytes); }
    catch { /* Preserve previously accepted evidence for recoverability. */ }
    const file = `documents/${id}-${safeFileName(fileName)}`;
    zip.file(file, bytes);
    documents.push({ id, fileName, file, bytes: bytes.byteLength, sha256: await sha256(bytes) });
    documentBytes += bytes.byteLength;
    expandedBytes += bytes.byteLength;
  }

  const sourceNames = (rowsByPhysicalName.get("source_package") ?? []).map((row) => String(row.file_name || ""));
  // The same source-package lineage drives every UI and exported-artifact
  // marking. Mixed, absent, or unlabeled provenance fails closed as program data.
  const classification = workspaceClassificationFromSourceNames(sourceNames);
  const manifest: WorkspacePackageManifest = {
    packageType: WORKSPACE_PACKAGE_TYPE,
    packageVersion: WORKSPACE_PACKAGE_VERSION,
    applicationVersion,
    exportedAt: new Date().toISOString(),
    program: program.results[0],
    workspace: workspace.results[0] ?? null,
    classification,
    tables: tableEntries,
    documents,
    totals: { tables: tableEntries.length, rows: totalRows, documents: documents.length, documentBytes },
  };
  zip.file("manifest.json", jsonText(manifest));
  zip.file("README.txt", "A2O WORKSPACE TRANSFER PACKAGE\r\n\r\nThis file contains application data, relationships, audit history, and attached evidence. It does not contain authentication credentials or destination access roles. Validate the package in the application before replacing a workspace.\r\n");
  const packageBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (packageBytes.byteLength > MAX_WORKSPACE_PACKAGE_BYTES) throw new Error("The generated Workspace Transfer Package exceeds 100 MB and cannot be restored by this application.");
  return { manifest, bytes: packageBytes };
}

function isManifest(value: unknown): value is WorkspacePackageManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspacePackageManifest>;
  const totals = candidate.totals as Partial<WorkspacePackageManifest["totals"]> | undefined;
  return candidate.packageType === WORKSPACE_PACKAGE_TYPE
    && (candidate.packageVersion === WORKSPACE_PACKAGE_VERSION || candidate.packageVersion === PREVIOUS_WORKSPACE_PACKAGE_VERSION || candidate.packageVersion === LEGACY_WORKSPACE_PACKAGE_VERSION)
    && (candidate.classification === "SYNTHETIC DEMONSTRATION DATA" || candidate.classification === "PROGRAM WORKING DATA")
    && Array.isArray(candidate.tables)
    && Array.isArray(candidate.documents)
    && Boolean(totals)
    && [totals?.tables, totals?.rows, totals?.documents, totals?.documentBytes].every((item) => Number.isSafeInteger(item) && Number(item) >= 0);
}

export async function parseWorkspacePackage(bytes: ArrayBuffer): Promise<ParsedPackage> {
  if (bytes.byteLength > MAX_WORKSPACE_PACKAGE_BYTES) throw new Error("Workspace packages are limited to 100 MB.");
  let zip: JSZip;
  // Parse the central directory without inflating every member. Manifest SHA-256
  // checks below provide integrity after declared sizes and compression ratios
  // have passed this bounded preflight.
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: true }); }
  catch { throw new Error("The selected file is not a valid Workspace Transfer Package."); }
  const allArchiveEntries = Object.values(zip.files);
  if (allArchiveEntries.length > tableSpecs.length + MAX_WORKSPACE_DOCUMENTS + 10) throw new Error("The package contains too many archive entries.");
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
  if (archiveEntries.length > tableSpecs.length + MAX_WORKSPACE_DOCUMENTS + 2) throw new Error("The package contains too many archive entries.");
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("The package manifest is missing.");
  let manifestValue: unknown;
  const manifestText = await manifestFile.async("string");
  if (new TextEncoder().encode(manifestText).byteLength > 1024 * 1024) throw new Error("The package manifest is too large.");
  try { manifestValue = JSON.parse(manifestText); }
  catch { throw new Error("The package manifest is not valid JSON."); }
  if (!isManifest(manifestValue)) throw new Error("The package type or version is not supported by this application.");
  const manifest = manifestValue;
  if (manifest.documents.length > MAX_WORKSPACE_DOCUMENTS || manifest.totals.rows > MAX_WORKSPACE_TOTAL_ROWS || manifest.totals.documentBytes > MAX_WORKSPACE_EXPANDED_BYTES) throw new Error("The package exceeds workspace import limits.");
  const legacyLogicalNames = new Set<TransferTableName>(["infrastructureNodes", "infrastructureReferenceValues", "releaseInfrastructureNodes", "infrastructureProductInstallations", "infrastructureConnections"]);
  const previousLogicalNames = new Set<TransferTableName>(["infrastructureReferenceValues"]);
  const omittedLogicalNames = manifest.packageVersion === LEGACY_WORKSPACE_PACKAGE_VERSION ? legacyLogicalNames : manifest.packageVersion === PREVIOUS_WORKSPACE_PACKAGE_VERSION ? previousLogicalNames : new Set<TransferTableName>();
  const packageSpecs = tableSpecs.filter((spec) => !omittedLogicalNames.has(spec.logicalName));
  const expectedNames = new Set(packageSpecs.map((spec) => spec.name));
  if (manifest.tables.length !== packageSpecs.length || manifest.tables.some((entry) => !expectedNames.has(entry.name))) throw new Error(`The package does not contain the complete version ${manifest.packageVersion} application dataset.`);
  const rowsByTable = new Map<string, TransferRow[]>();
  const warnings: string[] = [];
  const usedFiles = new Set(["manifest.json"]);
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
  if (manifest.packageVersion === LEGACY_WORKSPACE_PACKAGE_VERSION) {
    warnings.push("This version 1 package predates governed infrastructure. Existing baseline data will load; infrastructure can be added after import.");
  } else if (manifest.packageVersion === PREVIOUS_WORKSPACE_PACKAGE_VERSION) {
    warnings.push("This version 2 package predates governed infrastructure vocabularies. Existing infrastructure will load; storage and file-system classifications can be reviewed after import.");
  }

  const importedSourceNames = (rowsByTable.get("source_package") ?? []).map((row) => String(row.file_name || ""));
  const derivedClassification = workspaceClassificationFromSourceNames(importedSourceNames);
  if (manifest.classification !== derivedClassification) throw new Error("The package classification does not match its source-package lineage.");
  const packageMarking = derivedClassification === "SYNTHETIC DEMONSTRATION DATA" ? SYNTHETIC_HANDLING_MARKING : PROGRAM_HANDLING_MARKING;
  for (const row of rowsByTable.get("executive_brief") ?? []) {
    row.snapshot_payload = normalizeImportedBriefSnapshot(row.snapshot_payload, packageMarking);
    const snapshot = JSON.parse(String(row.snapshot_payload)) as { handlingMarking: OutputHandlingMarking };
    row.body_markdown = validateImportedBriefMarkdown(row.body_markdown, snapshot.handlingMarking);
  }
  for (const row of rowsByTable.get("brief_publication") ?? []) row.snapshot_payload = normalizeImportedBriefSnapshot(row.snapshot_payload, packageMarking);

  const documentBytes = new Map<string, Uint8Array>();
  const documentContentTypes = new Map<string, string>();
  const documentIds = new Set<string>();
  for (const entry of manifest.documents) {
    if (!entry.id || documentIds.has(entry.id) || !entry.file.startsWith("documents/") || entry.file.includes("..") || usedFiles.has(entry.file)) throw new Error(`The evidence file path for ${entry.fileName || entry.id} is invalid.`);
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
  for (const signoff of rowsByTable.get("acceptance_signoff") ?? []) {
    const evidenceDocumentId = String(signoff.evidence_document_id || "");
    if (evidenceDocumentId && !documentIds.has(evidenceDocumentId)) throw new Error("An acceptance sign-off references evidence that is not present in the package.");
  }
  const allowedArchiveFiles = new Set([...usedFiles, "README.txt"]);
  if (archiveEntries.some((entry) => !allowedArchiveFiles.has(entry.name))) throw new Error("The package contains an unexpected archive entry.");
  if (manifest.classification === "SYNTHETIC DEMONSTRATION DATA") warnings.push("This package contains synthetic demonstration data, not program data.");
  return { manifest, warnings, rowsByTable, documentBytes, documentContentTypes };
}

function insertStatement(db: Database, tableName: string, columns: string[], row: TransferRow, ignore = false) {
  const sql = `INSERT ${ignore ? "OR IGNORE " : ""}INTO ${q(tableName)} (${columns.map(q).join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
  return db.prepare(sql).bind(...columns.map((column) => row[column] === undefined ? null : row[column]));
}

export async function replaceWorkspaceFromPackage(db: Database, bucket: DocumentBucket | undefined, bytes: ArrayBuffer, actorId: string) {
  const parsed = await parseWorkspacePackage(bytes);
  if (parsed.manifest.documents.length && !bucket) throw new Error("This package contains evidence documents, but document storage is unavailable.");
  const importId = crypto.randomUUID();
  const uploadedKeys: string[] = [];
  const existingEvidence = await db.prepare("SELECT r2_key FROM evidence_document").all<{ r2_key: string }>();
  const evidenceRows = parsed.rowsByTable.get("evidence_document") ?? [];

  try {
    for (const row of evidenceRows) {
      const id = String(row.id);
      const descriptor = parsed.manifest.documents.find((entry) => entry.id === id);
      const content = parsed.documentBytes.get(id);
      const contentType = parsed.documentContentTypes.get(id);
      if (!descriptor || !content || !contentType || !bucket) throw new Error(`Evidence content is unavailable for ${String(row.file_name || id)}.`);
      const key = `workspace-import/${importId}/${id}-${safeFileName(descriptor.fileName)}`;
      const documentBytes = new Uint8Array(content.byteLength);
      documentBytes.set(content);
      await bucket.put(key, documentBytes.buffer, { httpMetadata: { contentType, contentDisposition: `attachment; filename="${safeFileName(descriptor.fileName)}"` } });
      row.r2_key = key;
      row.content_type = contentType;
      if (contentType === "application/octet-stream") {
        const priorDescription = String(row.description || "").trim();
        row.description = `[QUARANTINED LEGACY EVIDENCE — VERIFY BEFORE OPENING]${priorDescription ? ` ${priorDescription}` : ""}`;
      }
      uploadedKeys.push(key);
    }

    const statements: ReturnType<Database["prepare"]>[] = [];
    const at = new Date().toISOString();
    // Keep the destination program, users, and roles. Everything else is the
    // portable workspace and is replaced atomically in foreign-key order.
    for (const spec of [...tableSpecs].reverse()) if (spec.logicalName !== "appUsers" && spec.logicalName !== "auditEvents") statements.push(db.prepare(`DELETE FROM ${q(spec.name)}`));
    for (const spec of tableSpecs) {
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
      for (const row of rows) statements.push(insertStatement(db, spec.name, spec.columns, row, spec.logicalName === "appUsers"));
    }
    statements.push(db.prepare("UPDATE program SET name=?,description=?,timezone=?,updated_at=? WHERE id='program-jsf'").bind(parsed.manifest.program.name, parsed.manifest.program.description, parsed.manifest.program.timezone, at));
    statements.push(db.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(`audit-${crypto.randomUUID()}`, "program-jsf", actorId, "workspace_package_imported", "baseline_workspace", "workspace-jsf-current", JSON.stringify({ packageVersion: parsed.manifest.packageVersion, exportedAt: parsed.manifest.exportedAt, classification: parsed.manifest.classification, totals: parsed.manifest.totals }), at));
    await db.batch(statements);
  } catch (error) {
    if (bucket) await Promise.all(uploadedKeys.map((key) => bucket.delete(key).catch(() => undefined)));
    throw error;
  }

  if (bucket) await Promise.all(existingEvidence.results.map((item) => bucket.delete(item.r2_key).catch(() => undefined)));
  return { manifest: parsed.manifest, warnings: parsed.warnings };
}
