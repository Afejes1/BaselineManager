import { env } from "cloudflare:workers";
import { audit, ensureActor, PROGRAM_ID, requireWriter } from "../../../../lib/governance-server";
import { normalizeChangeRequestImportRow, reconcileChangeRequestImport, type ChangeRequestImportRow, type ExistingChangeRequestReference } from "../../../../lib/change-import";

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request); requireWriter(actor);
    const body = await request.json() as { mode?: string; fileName?: string; sheetName?: string; rows?: ChangeRequestImportRow[] };
    const incoming = Array.isArray(body.rows) ? body.rows.map(normalizeChangeRequestImportRow) : [];
    if (!incoming.length) return Response.json({ error: "The import contains no Change Request references." }, { status: 400 });
    const [existing, types, releases] = await Promise.all([
      env.DB.prepare("SELECT cr.id,cr.type_id,crt.code AS type_code,cr.external_system,cr.external_identifier,cr.title,cr.external_status,cr.external_owner,cr.source_locator,cr.source_as_of,cr.requested_release_id,r.name AS requested_release_name FROM change_request cr JOIN change_request_type crt ON crt.id=cr.type_id LEFT JOIN release r ON r.id=cr.requested_release_id WHERE cr.program_id=?").bind(PROGRAM_ID).all<{ id: string; type_id: string; type_code: string; external_system: string | null; external_identifier: string; title: string; external_status: string | null; external_owner: string | null; source_locator: string | null; source_as_of: string | null; requested_release_id: string | null; requested_release_name: string | null }>(),
      env.DB.prepare("SELECT id,code FROM change_request_type WHERE program_id=? AND active=1").bind(PROGRAM_ID).all<{ id: string; code: string }>(),
      env.DB.prepare("SELECT id,name,code FROM release WHERE program_id=?").bind(PROGRAM_ID).all<{ id: string; name: string; code: string | null }>(),
    ]);
    const existingRows: ExistingChangeRequestReference[] = existing.results.map((row) => ({ id: row.id, typeId: row.type_id, typeCode: row.type_code, externalSystem: row.external_system, externalIdentifier: row.external_identifier, title: row.title, externalStatus: row.external_status, externalOwner: row.external_owner, sourceLocator: row.source_locator, sourceAsOf: row.source_as_of, requestedReleaseId: row.requested_release_id, requestedReleaseName: row.requested_release_name }));
    const preview = reconcileChangeRequestImport(incoming, existingRows, types.results, releases.results);
    if (body.mode !== "apply") return Response.json({ preview });
    if (!preview.canApply) return Response.json({ error: "Resolve the blocking import issues before applying this file.", preview }, { status: 400 });
    const at = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (const item of preview.rows) {
      if (item.disposition === "unchanged") continue;
      if (item.disposition === "add") {
        const id = `change-${crypto.randomUUID()}`;
        statements.push(env.DB.prepare("INSERT INTO change_request (id,program_id,type_id,external_system,external_identifier,title,external_status,external_owner,source_locator,source_as_of,requested_release_id,government_priority,decision_status,reference_status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, PROGRAM_ID, item.typeId, item.row.ExternalSystem, item.row.ExternalIdentifier, item.row.Title, item.row.ExternalStatus || null, item.row.ExternalOwner || null, item.row.SourceLocator, item.row.SourceAsOf, item.releaseId, "unranked", "pending", "active", actor.id, at, at));
        statements.push(audit(env.DB, actor, "change_request_reference_imported", "change_request", id, { sourceFile: body.fileName || null, sheetName: body.sheetName || null, row: item.row }));
      } else if (item.existingId) {
        const before = existingRows.find((row) => row.id === item.existingId);
        statements.push(env.DB.prepare("UPDATE change_request SET type_id=?,external_system=?,external_identifier=?,title=?,external_status=?,external_owner=?,source_locator=?,source_as_of=?,requested_release_id=?,updated_at=? WHERE id=? AND program_id=?").bind(item.typeId, item.row.ExternalSystem, item.row.ExternalIdentifier, item.row.Title, item.row.ExternalStatus || null, item.row.ExternalOwner || null, item.row.SourceLocator, item.row.SourceAsOf, item.releaseId, at, item.existingId, PROGRAM_ID));
        statements.push(audit(env.DB, actor, "change_request_reference_refreshed", "change_request", item.existingId, { sourceFile: body.fileName || null, sheetName: body.sheetName || null, row: item.row, changedFields: item.changedFields }, before));
      }
    }
    statements.push(audit(env.DB, actor, "change_request_reference_package_applied", "program", PROGRAM_ID, { fileName: body.fileName || null, sheetName: body.sheetName || null, rows: incoming.length, added: preview.added, changed: preview.changed, unchanged: preview.unchanged }));
    await env.DB.batch(statements);
    return Response.json({ ok: true, preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Change Request reference import failed.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}

