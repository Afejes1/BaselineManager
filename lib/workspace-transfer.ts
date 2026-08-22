import JSZip from "jszip";
import { env } from "cloudflare:workers";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { schema } from "../db/schema";
import type { DocumentBucket } from "./governance-server";

export const WORKSPACE_PACKAGE_TYPE = "a2o.workspace-transfer";
export const WORKSPACE_PACKAGE_VERSION = "2.0.0";
const LEGACY_WORKSPACE_PACKAGE_VERSION = "1.0.0";
export const MAX_WORKSPACE_PACKAGE_BYTES = 100 * 1024 * 1024;

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

async function sha256(value: string | ArrayBuffer | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
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

  for (const spec of tableSpecs) {
    const rows = await readRows(db, spec.name, spec.columns);
    rowsByPhysicalName.set(spec.name, rows);
    const file = `data/${spec.name}.json`;
    const content = jsonText(rows);
    zip.file(file, content);
    tableEntries.push({ name: spec.name, file, rows: rows.length, sha256: await sha256(content) });
    totalRows += rows.length;
  }

  const evidenceRows = rowsByPhysicalName.get("evidence_document") ?? [];
  if (evidenceRows.length && !bucket) throw new Error("Evidence metadata exists, but document storage is unavailable. The workspace package was not created.");
  for (const row of evidenceRows) {
    const id = String(row.id || "");
    const objectKey = String(row.r2_key || "");
    const fileName = String(row.file_name || "evidence-file");
    const object = bucket ? await bucket.get(objectKey) : null;
    if (!object) throw new Error(`Evidence document ${fileName} is missing from storage. The workspace package was not created.`);
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    const file = `documents/${id}-${safeFileName(fileName)}`;
    zip.file(file, bytes);
    documents.push({ id, fileName, file, bytes: bytes.byteLength, sha256: await sha256(bytes) });
    documentBytes += bytes.byteLength;
  }

  const sourceNames = (rowsByPhysicalName.get("source_package") ?? []).map((row) => String(row.file_name || ""));
  const classification = sourceNames.some((name) => /demonstration|synthetic|demo/i.test(name)) ? "SYNTHETIC DEMONSTRATION DATA" : "PROGRAM WORKING DATA";
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
  return { manifest, bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } }) };
}

function isManifest(value: unknown): value is WorkspacePackageManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspacePackageManifest>;
  return candidate.packageType === WORKSPACE_PACKAGE_TYPE && (candidate.packageVersion === WORKSPACE_PACKAGE_VERSION || candidate.packageVersion === LEGACY_WORKSPACE_PACKAGE_VERSION) && Array.isArray(candidate.tables) && Array.isArray(candidate.documents);
}

export async function parseWorkspacePackage(bytes: ArrayBuffer): Promise<ParsedPackage> {
  if (bytes.byteLength > MAX_WORKSPACE_PACKAGE_BYTES) throw new Error("Workspace packages are limited to 100 MB.");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true }); }
  catch { throw new Error("The selected file is not a valid Workspace Transfer Package."); }
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("The package manifest is missing.");
  let manifestValue: unknown;
  try { manifestValue = JSON.parse(await manifestFile.async("string")); }
  catch { throw new Error("The package manifest is not valid JSON."); }
  if (!isManifest(manifestValue)) throw new Error("The package type or version is not supported by this application.");
  const manifest = manifestValue;
  const legacyLogicalNames = new Set<TransferTableName>(["infrastructureNodes", "releaseInfrastructureNodes", "infrastructureProductInstallations", "infrastructureConnections"]);
  const packageSpecs = manifest.packageVersion === LEGACY_WORKSPACE_PACKAGE_VERSION ? tableSpecs.filter((spec) => !legacyLogicalNames.has(spec.logicalName)) : tableSpecs;
  const expectedNames = new Set(packageSpecs.map((spec) => spec.name));
  if (manifest.tables.length !== packageSpecs.length || manifest.tables.some((entry) => !expectedNames.has(entry.name))) throw new Error(`The package does not contain the complete version ${manifest.packageVersion} application dataset.`);
  const rowsByTable = new Map<string, TransferRow[]>();
  const warnings: string[] = [];

  for (const spec of packageSpecs) {
    const entry = manifest.tables.find((item) => item.name === spec.name);
    if (!entry) throw new Error(`The ${spec.name} dataset is missing.`);
    const file = zip.file(entry.file);
    if (!file) throw new Error(`The ${entry.file} dataset file is missing.`);
    const content = await file.async("string");
    if (await sha256(content) !== entry.sha256) throw new Error(`The ${entry.name} dataset checksum is invalid.`);
    let rows: unknown;
    try { rows = JSON.parse(content); } catch { throw new Error(`The ${entry.name} dataset is not valid JSON.`); }
    if (!Array.isArray(rows) || rows.length !== entry.rows) throw new Error(`The ${entry.name} row count does not match its manifest.`);
    const allowed = new Set(spec.columns);
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`The ${entry.name} dataset contains an invalid row.`);
      const keys = Object.keys(row);
      if (keys.length !== spec.columns.length || keys.some((key) => !allowed.has(key))) throw new Error(`The ${entry.name} dataset does not match the version 1 schema.`);
    }
    rowsByTable.set(entry.name, rows as TransferRow[]);
  }
  if (manifest.packageVersion === LEGACY_WORKSPACE_PACKAGE_VERSION) {
    for (const spec of tableSpecs.filter((item) => legacyLogicalNames.has(item.logicalName))) rowsByTable.set(spec.name, []);
    warnings.push("This version 1 package predates governed infrastructure. Existing baseline data will load; infrastructure can be added after import.");
  }

  const documentBytes = new Map<string, Uint8Array>();
  for (const entry of manifest.documents) {
    const file = zip.file(entry.file);
    if (!file) throw new Error(`The evidence file ${entry.fileName} is missing.`);
    const content = await file.async("uint8array");
    if (content.byteLength !== entry.bytes || await sha256(content) !== entry.sha256) throw new Error(`The evidence file ${entry.fileName} failed integrity validation.`);
    documentBytes.set(entry.id, content);
  }
  const evidenceRows = rowsByTable.get("evidence_document") ?? [];
  if (evidenceRows.length !== manifest.documents.length) throw new Error("Evidence metadata and file counts do not match.");
  for (const row of evidenceRows) if (!documentBytes.has(String(row.id))) throw new Error(`Evidence content is missing for ${String(row.file_name || row.id)}.`);
  if (manifest.classification === "SYNTHETIC DEMONSTRATION DATA") warnings.push("This package contains synthetic demonstration data, not program data.");
  return { manifest, warnings, rowsByTable, documentBytes };
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
      if (!descriptor || !content || !bucket) throw new Error(`Evidence content is unavailable for ${String(row.file_name || id)}.`);
      const key = `workspace-import/${importId}/${id}-${safeFileName(descriptor.fileName)}`;
      await bucket.put(key, content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength), { httpMetadata: { contentType: typeof row.content_type === "string" ? row.content_type : "application/octet-stream", contentDisposition: `attachment; filename="${safeFileName(descriptor.fileName)}"` } });
      row.r2_key = key;
      uploadedKeys.push(key);
    }

    const statements: ReturnType<Database["prepare"]>[] = [];
    // Keep the destination program, users, and roles. Everything else is the
    // portable workspace and is replaced atomically in foreign-key order.
    for (const spec of [...tableSpecs].reverse()) if (spec.logicalName !== "appUsers") statements.push(db.prepare(`DELETE FROM ${q(spec.name)}`));
    for (const spec of tableSpecs) {
      const rows = topologicalRows(parsed.rowsByTable.get(spec.name) ?? [], spec.selfParentColumn);
      for (const row of rows) statements.push(insertStatement(db, spec.name, spec.columns, row, spec.logicalName === "appUsers"));
    }
    const at = new Date().toISOString();
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
