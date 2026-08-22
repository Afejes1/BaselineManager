import { env } from "cloudflare:workers";
import { audit, ensureActor, PROGRAM_ID, requireWriter } from "../../../../lib/governance-server";
import { normalizeObjectiveImportRow, reconcileObjectiveImport, type ObjectiveImportRow } from "../../../../lib/objective-import";
import type { ObjectiveStatus } from "../../../../lib/initiative-decision-model";
import { CanonicalImportMaterializer, splitReportedReferences } from "../../../../lib/canonical-import-materializer";

type ExistingRow = { id: string; change_request_id: string | null; external_system: string; external_identifier: string; external_item_type: string; title: string; summary: string | null; technical_owner: string | null; status: ObjectiveStatus; planned_start: string | null; planned_finish: string | null; actual_start: string | null; actual_finish: string | null; source_locator: string | null; source_as_of: string | null };
const now = () => new Date().toISOString();
async function contentHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function context() {
  const [current, requests] = await Promise.all([
    env.DB.prepare("SELECT id,change_request_id,external_system,external_identifier,external_item_type,title,summary,technical_owner,status,planned_start,planned_finish,actual_start,actual_finish,source_locator,source_as_of FROM incumbent_objective WHERE program_id=?").bind(PROGRAM_ID).all<ExistingRow>(),
    env.DB.prepare("SELECT id,external_identifier FROM change_request WHERE program_id=? ORDER BY external_identifier").bind(PROGRAM_ID).all<{ id: string; external_identifier: string }>(),
  ]);
  return {
    current: current.results.map((item) => ({ id: item.id, changeRequestId: item.change_request_id, externalSystem: item.external_system, externalIdentifier: item.external_identifier, externalItemType: item.external_item_type, title: item.title, summary: item.summary, technicalOwner: item.technical_owner, status: item.status, plannedStart: item.planned_start, plannedFinish: item.planned_finish, actualStart: item.actual_start, actualFinish: item.actual_finish, sourceLocator: item.source_locator, sourceAsOf: item.source_as_of })),
    requests: requests.results.map((item) => ({ id: item.id, externalIdentifier: item.external_identifier })),
  };
}

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const packages = await env.DB.prepare("SELECT id,external_system,file_name,sheet_name,received_at,status,row_count,added_count,changed_count,unchanged_count,blocked_count FROM objective_source_package WHERE program_id=? ORDER BY received_at DESC LIMIT 25").bind(PROGRAM_ID).all();
    return Response.json({ packages: packages.results });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "LM Objective import history is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as { mode?: string; fileName?: string; sheetName?: string; rows?: Partial<ObjectiveImportRow>[] };
    const rows = Array.isArray(body.rows) ? body.rows.map(normalizeObjectiveImportRow) : [];
    if (!rows.length || !body.fileName) return Response.json({ error: "A file name and at least one LM Objective row are required." }, { status: 400 });
    const { current, requests } = await context();
    const preview = reconcileObjectiveImport(rows, current, requests);
    if (body.mode !== "apply") return Response.json({ preview });
    requireWriter(actor);
    if (!preview.canApply) return Response.json({ error: "Resolve every blocking import issue before applying this package.", preview }, { status: 409 });

    const at = now();
    const content = JSON.stringify(rows);
    const packageHash = await contentHash(content);
    const packageId = `objective-package-${crypto.randomUUID()}`;
    const already = await env.DB.prepare("SELECT id,status FROM objective_source_package WHERE program_id=? AND external_system=? AND content_hash=?").bind(PROGRAM_ID, rows[0].ExternalSystem, packageHash).first<{ id: string; status: string }>();
    if (already) return Response.json({ error: `This exact source package was already ${already.status}.`, packageId: already.id }, { status: 409 });
    const materializer = await CanonicalImportMaterializer.load(env.DB, actor.id, at);
    const resolved = new Map<number, { objectiveId: string; reportedRequestIds: string[] }>();
    for (const item of preview.rows) {
      if (item.disposition === "blocked") continue;
      const source = item.row;
      const objective = materializer.ensureObjective({
        externalSystem: source.ExternalSystem,
        externalIdentifier: source.ExternalIdentifier,
        title: source.Title,
        summary: source.Summary,
        technicalOwner: source.TechnicalOwner,
        status: source.Status,
        plannedStart: source.PlannedStart,
        plannedFinish: source.PlannedFinish,
        actualStart: source.ActualStart,
        actualFinish: source.ActualFinish,
        sourceLocator: source.SourceLocator || null,
        sourceAsOf: source.SourceAsOf || null,
        primaryChangeRequestId: null,
      });
      if (!objective.id) continue;
      const reportedRequestIds: string[] = [];
      for (const identifier of splitReportedReferences(source.OwningChangeRequest)) {
        const change = materializer.ensureChangeRequest({ identifier, sourceSystem: source.ExternalSystem, sourceLocator: source.SourceLocator || null, sourceAsOf: source.SourceAsOf || null, updateSourceFields: false });
        if (!change.id) continue;
        reportedRequestIds.push(change.id);
        materializer.ensureObjectiveChangeRequestLink({ objectiveId: objective.id, changeRequestId: change.id, relationship: "reported", sourceSystem: source.ExternalSystem, sourceLocator: source.SourceLocator || null, sourceAsOf: source.SourceAsOf || null });
      }
      resolved.set(item.rowNumber, { objectiveId: objective.id, reportedRequestIds });
    }
    if (materializer.issues.length) return Response.json({ error: "One or more source identities match multiple canonical records. Review the exceptions before applying.", identityExceptions: materializer.issues, preview }, { status: 409 });
    const statements: D1PreparedStatement[] = [
      env.DB.prepare("INSERT INTO objective_source_package (id,program_id,external_system,file_name,sheet_name,content_hash,received_at,status,row_count,added_count,changed_count,unchanged_count,blocked_count,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(packageId, PROGRAM_ID, rows[0].ExternalSystem, body.fileName, body.sheetName || null, packageHash, at, "applied", rows.length, preview.added, preview.changed, preview.unchanged, preview.blocked, actor.id, at, at),
      ...materializer.statements,
    ];
    for (const item of preview.rows) {
      if (item.disposition === "blocked") continue;
      const materialized = resolved.get(item.rowNumber);
      if (!materialized) continue;
      const objectiveId = materialized.objectiveId;
      const source = item.row;
      statements.push(env.DB.prepare("INSERT INTO objective_source_row (id,source_package_id,row_number,external_system,external_identifier,raw_payload,disposition,objective_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`objective-source-row-${crypto.randomUUID()}`, packageId, item.rowNumber, source.ExternalSystem, source.ExternalIdentifier, JSON.stringify(source), item.disposition, objectiveId, at));
      statements.push(audit(env.DB, actor, item.disposition === "add" ? "incumbent_objective_imported" : item.disposition === "change" ? "incumbent_objective_source_refreshed" : "incumbent_objective_source_confirmed", "incumbent_objective", objectiveId, { packageId, rowNumber: item.rowNumber, changedFields: item.changedFields, sourceAsOf: source.SourceAsOf, reportedChangeRequestIds: materialized.reportedRequestIds }));
    }
    await env.DB.batch(statements);
    return Response.json({ ok: true, packageId, preview }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LM Objective import could not be applied.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
