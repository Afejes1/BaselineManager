import { env } from "cloudflare:workers";
import { TECHNICAL_BASELINE_COLUMNS, describeTechnicalBaselineHeaderIssue, reconcileRows, sourceRow24 } from "../../../../lib/technical-baseline-contract";
import { intakeIdentity, reconcileIntake } from "../../../../lib/import-reconciliation";
import { BASELINE_PROGRAM_ID, BASELINE_WORKSPACE_ID, asA2ORow, readAssembledBaselineRecords, type A2ORow } from "../../../../lib/a2o-baseline-server";
import { createBaselineResolver, materializeBaselineRecord, type CurrentBaselineRecord } from "../route";
import { audit, ensureActor, requireWriter } from "../../../../lib/governance-server";
import type { GovernedImportItem, ImportResolution } from "../../../../lib/governed-import";
import { importIdentity, importRunStatements } from "../../../../lib/import-run-server";

type IncomingRow = Record<string, string | number | boolean | null | undefined>;
const nowIso = () => new Date().toISOString();
const DEMONSTRATION_SOURCE_KEY_PREFIX = "DEMO-";
function demoEnabled() {
  const value = (env as unknown as { DEMO_ENABLED?: string }).DEMO_ENABLED;
  return String(value ?? "true").toLowerCase() !== "false";
}
async function sha256(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

function exactRow(value: IncomingRow): { row: A2ORow | null; error?: string } {
  const keys = Object.keys(value);
  const error = describeTechnicalBaselineHeaderIssue(keys);
  if (error) return { row: null, error };
  return { row: asA2ORow(value) };
}

export async function GET() {
  try { const rows = await readAssembledBaselineRecords(env.DB, { includeVoided: true }); return Response.json({ rows: rows.map((item) => item.row) }); }
  catch (error) { return Response.json({ rows: [], error: error instanceof Error ? error.message : "Baseline storage is unavailable." }, { status: 500 }); }
}

/**
 * Reconcile, never replace. An intake workbook is evidence, not a command to
 * delete governed links, reviews, Platforms, Change Requests, or work plans.
 * The one exception is an explicitly confirmed demonstration reset: it voids
 * active records for later restoration, then materializes a synthetic workspace.
 */
export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request); requireWriter(actor);
    const body = await request.json() as { fileName?: string; sheetName?: string; rows?: IncomingRow[]; resolutions?: ImportResolution[]; replaceActiveBaseline?: boolean };
    if (!body.fileName || !Array.isArray(body.rows)) return Response.json({ error: "fileName and rows are required." }, { status: 400 });
    const parsedRows = body.rows.map(exactRow);
    const invalidRow = parsedRows.find((item) => !item.row);
    if (invalidRow) return Response.json({ error: invalidRow.error || "Every imported row must preserve the exact A2O Tech Stack 24-column contract." }, { status: 400 });
    const incoming = parsedRows.map((item) => item.row) as A2ORow[]; const replaceActiveBaseline = body.replaceActiveBaseline === true;
    const resolutionByRow = new Map((body.resolutions || []).map((item) => [item.rowNumber, item]));
    const approvedIndexes = new Set(incoming.map((_, index) => index).filter((index) => replaceActiveBaseline || (resolutionByRow.get(index + 2)?.decision || "approve") === "approve"));
    const approvedIncoming = incoming.filter((_, index) => approvedIndexes.has(index));
    if (!approvedIncoming.length) return Response.json({ error: "Approve at least one valid baseline record before applying the workbook." }, { status: 409 });
    if (replaceActiveBaseline && incoming.some((row) => !String(row["#"] || "").startsWith(DEMONSTRATION_SOURCE_KEY_PREFIX))) {
      return Response.json({ error: "Only the synthetic demonstration dataset may replace the active working baseline." }, { status: 400 });
    }
    if (replaceActiveBaseline && !demoEnabled()) return Response.json({ error: "Demonstration data is disabled in this operational environment." }, { status: 403 });
    const existing = await readAssembledBaselineRecords(env.DB, { includeVoided: false });
    const historical = replaceActiveBaseline ? await readAssembledBaselineRecords(env.DB, { includeVoided: true }) : existing;
    const reconciliation = reconcileRows(existing.map((record, index) => sourceRow24(record.row, index + 2)), approvedIncoming.map((row, index) => sourceRow24(row, index + 2)));
    if (reconciliation.conflicts.length) return Response.json({ error: "Import contains ambiguous A2O identities. Resolve duplicate # values or deployment identities before materializing.", conflicts: reconciliation.conflicts }, { status: 422 });

    // A demo reset is repeatable: it reactivates its original immutable source
    // rows rather than attempting to insert a duplicate source package.
    const existingByIdentity = new Map((replaceActiveBaseline
      ? historical.filter((record) => String(record.row["#"] || "").startsWith(DEMONSTRATION_SOURCE_KEY_PREFIX))
      : existing).map((record) => [intakeIdentity(record.row), record]));
    const activeOccurrenceIds = new Set(existing.map((record) => record.occurrenceId));
    // Preload and update an in-memory identity map so every row in the single
    // D1 batch reuses the same canonical IDs, including a first-time import.
    const resolver = await createBaselineResolver(env.DB);
    const now = nowIso(); const serializedIncoming = JSON.stringify(incoming); const hash = await sha256(serializedIncoming);
    const duplicate = await env.DB.prepare("SELECT id,row_count FROM source_package WHERE program_id=? AND content_hash=?").bind(BASELINE_PROGRAM_ID, hash).first<{ id: string; row_count: number }>();
    if (duplicate && !replaceActiveBaseline) return Response.json({ packageId: duplicate.id, rows: duplicate.row_count, duplicate: true, preservedLinks: true });
    // Source-package hashes are unique. A deliberate demo reset can reuse its
    // immutable package while creating a fresh governed working baseline.
    const packageId = duplicate?.id || crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      env.DB.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(BASELINE_PROGRAM_ID, "Joint Strike Fighter", "F-35 technical baseline program", "America/New_York", now, now),
      env.DB.prepare("INSERT INTO baseline_workspace (id,program_id,label,active_import_package_id,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active_import_package_id=excluded.active_import_package_id,updated_at=excluded.updated_at").bind(BASELINE_WORKSPACE_ID, BASELINE_PROGRAM_ID, "Working Technical Baseline", packageId, now, now),
    ];
    if (!duplicate) statements.push(env.DB.prepare("INSERT INTO source_package (id,program_id,source_system,file_name,sheet_name,content_hash,received_at,status,row_count,accepted_count,exception_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(packageId, BASELINE_PROGRAM_ID, "a2o-xlsx", body.fileName, body.sheetName || null, hash, now, "materialized", incoming.length, approvedIncoming.length, incoming.length - approvedIncoming.length, now, now));
    if (replaceActiveBaseline && existing.length) statements.push(env.DB.prepare("UPDATE baseline_occurrence SET lifecycle_status='voided',lifecycle_reason=?,voided_at=?,voided_by_user_id=?,revision=revision+1,updated_at=? WHERE workspace_id=? AND lifecycle_status='active'").bind("Archived by confirmed demonstration dataset load", now, actor.id, now, BASELINE_WORKSPACE_ID));
    let added = 0; let updated = 0;
    for (let index = 0; index < incoming.length; index += 1) {
      const row = incoming[index]; const existingRecord = existingByIdentity.get(intakeIdentity(row));
      // Every applied intake package owns a new immutable source snapshot. A
      // repeat demonstration reset is the only case that deliberately reuses
      // the already-retained synthetic row from its duplicate package.
      const reuseSourceRow = Boolean(replaceActiveBaseline && duplicate && existingRecord?.sourceRowId);
      const sourceRowId = reuseSourceRow ? existingRecord!.sourceRowId : crypto.randomUUID();
      const occurrenceId = existingRecord?.occurrenceId || crypto.randomUUID();
      if (!reuseSourceRow) statements.push(env.DB.prepare("INSERT INTO source_row_24 (id,source_package_id,source_key,row_number,row_hash,raw_payload,release_name,tier,resource,tech_stack_type,short_name,hw_host,hw_storage_type,hw_storage_gb,hw_cpu_cores,hw_ram_gb,sw_language,software_type,oem,containerized,container_technology,container_type,long_name,notes,capability_notes,notes_1,notes_2,notes_3,notes_4,materialization_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(sourceRowId, packageId, row["#"] == null ? null : String(row["#"]), index + 2, await sha256(JSON.stringify(row)), JSON.stringify(row), row.ReleaseName ?? null, row.Tier ?? null, row.Resource ?? null, row.TechStackType ?? null, row.ShortName ?? null, row.HW_Host ?? null, row.HW_Storage_Type ?? null, row["HW_Storage (GB)"] ?? null, row.HW_CPU_CORES ?? null, row["HW_RAM (GB)"] ?? null, row["SW Language"] ?? null, row["Software Type"] ?? null, row.OEM ?? null, row["Containerized"] ?? null, row["Container Technology"] ?? null, row["Container Type"] ?? null, row.LongName ?? null, row.Notes ?? null, row["Technical Capability Satisfied by this SW/Tech - Notes"] ?? null, row["Notes.1"] ?? null, row["Notes.2"] ?? null, row["Notes.3"] ?? null, row["Notes.4"] ?? null, "reported", now, now));
      if (!approvedIndexes.has(index)) continue;
      if (!existingRecord) {
        added += 1;
        statements.push(env.DB.prepare("INSERT INTO baseline_occurrence (id,program_id,workspace_id,source_row_id,projection_payload,materialization_status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(occurrenceId, BASELINE_PROGRAM_ID, BASELINE_WORKSPACE_ID, sourceRowId, JSON.stringify(row), "reported", 0, now, now));
        const materialized = await materializeBaselineRecord(env.DB, occurrenceId, row, 0, null, sourceRowId, resolver, actor.id);
        statements.push(...materialized.statements);
      } else {
        updated += 1;
        const current: CurrentBaselineRecord = { source_row_id: existingRecord.sourceRowId, release_id: existingRecord.releaseId, product_id: existingRecord.productId, configuration_node_id: existingRecord.configurationNodeId, deployment_id: existingRecord.deploymentId, revision: replaceActiveBaseline && activeOccurrenceIds.has(existingRecord.occurrenceId) ? existingRecord.revision + 1 : existingRecord.revision, projection_payload: JSON.stringify(existingRecord.row), lifecycle_status: existingRecord.lifecycleStatus };
        const materialized = await materializeBaselineRecord(env.DB, occurrenceId, row, current.revision, current.projection_payload, sourceRowId, resolver, actor.id);
        statements.push(...materialized.statements);
        if (replaceActiveBaseline) statements.push(env.DB.prepare("UPDATE baseline_occurrence SET lifecycle_status='active',lifecycle_reason=NULL,voided_at=NULL,voided_by_user_id=NULL,updated_at=? WHERE id=?").bind(now, occurrenceId));
      }
    }
    const currentKeys = new Set(incoming.map(intakeIdentity)); const absent = existing.filter((record) => !currentKeys.has(intakeIdentity(record.row)));
    // Absent rows are retained and reported; they are not silently deleted or voided.
    if (!replaceActiveBaseline) {
      const reviewed = reconcileIntake(existing.map((record) => record.row), incoming);
      const governedItems: GovernedImportItem[] = reviewed.rows.map((item) => ({ id: `a2o-${item.rowNumber}-${item.identity}`, rowNumber: item.rowNumber, sourceKey: String(item.row["#"] || item.identity), title: String(item.row.LongName || item.row.ShortName || item.row.HW_Host || "Unnamed baseline record"), disposition: item.disposition, issues: item.issues, changes: item.changes, defaultDecision: item.disposition === "blocked" ? "skip" : "approve" }));
      const identity = await importIdentity("a2o_tech_stack_xlsx", null, serializedIncoming);
      statements.push(...importRunStatements(env.DB, { runId: `ingestion-run-${crypto.randomUUID()}`, adapterKey: "a2o_tech_stack_xlsx", sourceSystem: "A2O Tech Stack exchange", fileName: body.fileName, sheetName: body.sheetName || null, contentHash: identity.contentHash, idempotencyKey: identity.idempotencyKey, items: governedItems, resolutions: body.resolutions || governedItems.map((item) => ({ rowNumber: item.rowNumber, sourceKey: item.sourceKey, decision: item.defaultDecision })), rawRows: incoming, normalizedRows: incoming, targetSnapshotKind: "source_package", targetSnapshotId: packageId, actorId: actor.id, at: now }));
    }
    statements.push(audit(env.DB, actor, replaceActiveBaseline ? "demonstration_baseline_loaded" : "a2o_intake_reconciled", "source_package", packageId, { rows: incoming.length, approved: approvedIncoming.length, skipped: incoming.length - approvedIncoming.length, added, updated, unchanged: reconciliation.unchanged.length, archivedActiveRecords: replaceActiveBaseline ? existing.map((record) => record.occurrenceId) : [], absent: absent.map((record) => record.occurrenceId) }));
    await env.DB.batch(statements);
    return Response.json({ packageId, rows: incoming.length, added, updated, unchanged: reconciliation.unchanged.length, absent: absent.length, archived: replaceActiveBaseline ? existing.length : 0, preservedLinks: true }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Import failed without changing the baseline." }, { status: 500 }); }
}
