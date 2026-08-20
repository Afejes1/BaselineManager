import { env } from "cloudflare:workers";
import { TECHNICAL_BASELINE_COLUMNS, reconcileRows, sourceRow24 } from "../../../../lib/technical-baseline-contract";
import { intakeIdentity } from "../../../../lib/import-reconciliation";
import { BASELINE_PROGRAM_ID, BASELINE_WORKSPACE_ID, asA2ORow, readAssembledBaselineRecords, type A2ORow } from "../../../../lib/a2o-baseline-server";
import { createBaselineResolver, materializeBaselineRecord, type CurrentBaselineRecord } from "../route";

type IncomingRow = Record<string, string | number | boolean | null | undefined>;
const nowIso = () => new Date().toISOString();
async function sha256(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

function exactRow(value: IncomingRow): A2ORow | null {
  const keys = Object.keys(value);
  if (keys.length !== TECHNICAL_BASELINE_COLUMNS.length || TECHNICAL_BASELINE_COLUMNS.some((column, index) => keys[index] !== column)) return null;
  return asA2ORow(value);
}

export async function GET() {
  try { const rows = await readAssembledBaselineRecords(env.DB, { includeVoided: true }); return Response.json({ rows: rows.map((item) => item.row) }); }
  catch (error) { return Response.json({ rows: [], error: error instanceof Error ? error.message : "Baseline storage is unavailable." }, { status: 500 }); }
}

/**
 * Reconcile, never replace.  An intake workbook is evidence, not a command to
 * delete governed links, reviews, Platforms, Change Requests, or work plans.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as { fileName?: string; sheetName?: string; rows?: IncomingRow[] };
    if (!body.fileName || !Array.isArray(body.rows)) return Response.json({ error: "fileName and rows are required." }, { status: 400 });
    const rows = body.rows.map(exactRow);
    if (rows.some((row) => !row)) return Response.json({ error: "Every imported row must preserve the exact A2O Tech Stack 24-column contract." }, { status: 400 });
    const incoming = rows as A2ORow[]; const existing = await readAssembledBaselineRecords(env.DB, { includeVoided: false });
    const reconciliation = reconcileRows(existing.map((record, index) => sourceRow24(record.row, index + 2)), incoming.map((row, index) => sourceRow24(row, index + 2)));
    if (reconciliation.conflicts.length) return Response.json({ error: "Import contains ambiguous A2O identities. Resolve duplicate # values or deployment identities before materializing.", conflicts: reconciliation.conflicts }, { status: 422 });

    const existingByIdentity = new Map(existing.map((record) => [intakeIdentity(record.row), record]));
    // Preload and update an in-memory identity map so every row in the single
    // D1 batch reuses the same canonical IDs, including a first-time import.
    const resolver = await createBaselineResolver(env.DB);
    const now = nowIso(); const packageId = crypto.randomUUID(); const hash = await sha256(JSON.stringify(incoming));
    const duplicate = await env.DB.prepare("SELECT id,row_count FROM source_package WHERE program_id=? AND content_hash=?").bind(BASELINE_PROGRAM_ID, hash).first<{ id: string; row_count: number }>();
    if (duplicate) return Response.json({ packageId: duplicate.id, rows: duplicate.row_count, duplicate: true, preservedLinks: true });
    const statements: D1PreparedStatement[] = [
      env.DB.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(BASELINE_PROGRAM_ID, "Joint Strike Fighter", "F-35 technical baseline program", "America/New_York", now, now),
      env.DB.prepare("INSERT INTO source_package (id,program_id,source_system,file_name,sheet_name,content_hash,received_at,status,row_count,accepted_count,exception_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(packageId, BASELINE_PROGRAM_ID, "a2o-xlsx", body.fileName, body.sheetName || null, hash, now, "materialized", incoming.length, incoming.length, 0, now, now),
      env.DB.prepare("INSERT INTO baseline_workspace (id,program_id,label,active_import_package_id,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active_import_package_id=excluded.active_import_package_id,updated_at=excluded.updated_at").bind(BASELINE_WORKSPACE_ID, BASELINE_PROGRAM_ID, "Working Technical Baseline", packageId, now, now),
    ];
    let added = 0; let updated = 0;
    for (let index = 0; index < incoming.length; index += 1) {
      const row = incoming[index]; const sourceRowId = crypto.randomUUID(); const existingRecord = existingByIdentity.get(intakeIdentity(row));
      const occurrenceId = existingRecord?.occurrenceId || crypto.randomUUID();
      statements.push(env.DB.prepare("INSERT INTO source_row_24 (id,source_package_id,source_key,row_number,row_hash,raw_payload,release_name,tier,resource,tech_stack_type,short_name,hw_host,hw_storage_type,hw_storage_gb,hw_cpu_cores,hw_ram_gb,sw_language,software_type,oem,containerized,container_technology,container_type,long_name,notes,capability_notes,notes_1,notes_2,notes_3,notes_4,materialization_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(sourceRowId, packageId, row["#"] == null ? null : String(row["#"]), index + 2, await sha256(JSON.stringify(row)), JSON.stringify(row), row.ReleaseName ?? null, row.Tier ?? null, row.Resource ?? null, row.TechStackType ?? null, row.ShortName ?? null, row.HW_Host ?? null, row.HW_Storage_Type ?? null, row["HW_Storage (GB)"] ?? null, row.HW_CPU_CORES ?? null, row["HW_RAM (GB)"] ?? null, row["SW Language"] ?? null, row["Software Type"] ?? null, row.OEM ?? null, row.Containerized ?? null, row["Container Technology"] ?? null, row["Container Type"] ?? null, row.LongName ?? null, row.Notes ?? null, row["Technical Capability Satisfied by this SW/Tech - Notes"] ?? null, row["Notes.1"] ?? null, row["Notes.2"] ?? null, row["Notes.3"] ?? null, row["Notes.4"] ?? null, "reported", now, now));
      if (!existingRecord) {
        added += 1;
        statements.push(env.DB.prepare("INSERT INTO baseline_occurrence (id,program_id,workspace_id,source_row_id,projection_payload,materialization_status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(occurrenceId, BASELINE_PROGRAM_ID, BASELINE_WORKSPACE_ID, sourceRowId, JSON.stringify(row), "reported", 0, now, now));
        const materialized = await materializeBaselineRecord(env.DB, occurrenceId, row, 0, null, sourceRowId, resolver);
        statements.push(...materialized.statements);
      } else {
        updated += 1;
        const current: CurrentBaselineRecord = { source_row_id: existingRecord.sourceRowId, release_id: existingRecord.releaseId, product_id: existingRecord.productId, configuration_node_id: existingRecord.configurationNodeId, deployment_id: existingRecord.deploymentId, revision: existingRecord.revision, projection_payload: JSON.stringify(existingRecord.row), lifecycle_status: existingRecord.lifecycleStatus };
        const materialized = await materializeBaselineRecord(env.DB, occurrenceId, row, current.revision, current.projection_payload, sourceRowId, resolver);
        statements.push(...materialized.statements);
      }
    }
    const currentKeys = new Set(incoming.map(intakeIdentity)); const absent = existing.filter((record) => !currentKeys.has(intakeIdentity(record.row)));
    // Absent rows are retained and reported; they are not silently deleted or voided.
    statements.push(env.DB.prepare("INSERT INTO audit_event (id,program_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), BASELINE_PROGRAM_ID, "a2o_intake_reconciled", "source_package", packageId, JSON.stringify({ rows: incoming.length, added, updated, unchanged: reconciliation.unchanged.length, absent: absent.map((record) => record.occurrenceId) }), now));
    await env.DB.batch(statements);
    return Response.json({ packageId, rows: incoming.length, added, updated, unchanged: reconciliation.unchanged.length, absent: absent.length, preservedLinks: true }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Import failed without changing the baseline." }, { status: 500 }); }
}
