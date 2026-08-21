import { env } from "cloudflare:workers";
import { audit, ensureActor, PROGRAM_ID, requireWriter } from "../../../../lib/governance-server";
import {
  CHANGE_REQUEST_IMPORT_COLUMNS,
  CONFLUENCE_CHANGE_SOURCE_SYSTEM,
  existingChangeRequestImportRow,
  mapChangeRequestSourceRows,
  normalizeChangeRequestImportRow,
  normalizedChangeImportValue,
  reconcileChangeRequestImport,
  type ChangeRequestImportMapping,
  type ChangeRequestImportRow,
  type ExistingChangeRequestReference,
} from "../../../../lib/change-import";
import { importIdentity, importRunStatements, priorImportRun } from "../../../../lib/import-run-server";
import type { GovernedImportItem, ImportFieldChange, ImportResolution } from "../../../../lib/governed-import";

type IncomingBody = {
  mode?: "preview" | "apply";
  adapterKey?: string;
  fileName?: string;
  sheetName?: string;
  sourceSystem?: string;
  sourceLocator?: string;
  sourceAsOf?: string;
  mapping?: ChangeRequestImportMapping;
  rawRows?: Record<string, unknown>[];
  rows?: ChangeRequestImportRow[];
  resolutions?: ImportResolution[];
};

type RequestRow = { id: string; type_id: string; type_code: string; external_system: string | null; external_identifier: string; title: string; external_status: string | null; external_owner: string | null; source_locator: string | null; source_as_of: string | null; requested_release_id: string | null; requested_release_name: string | null };
type SourceState = { change_request_id: string; normalized_payload: string; source_as_of: string | null };

const clean = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const sourceJson = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((key) => [key, clean(value[key])])));

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}

function objectDiff(before: Record<string, unknown>, after: Record<string, unknown>): ImportFieldChange[] {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return fields.filter((field) => clean(before[field]) !== clean(after[field])).map((field) => ({ field, before: clean(before[field]), after: clean(after[field]) }));
}

async function context() {
  const [existing, types, releases, states] = await Promise.all([
    env.DB.prepare("SELECT cr.id,cr.type_id,crt.code AS type_code,cr.external_system,cr.external_identifier,cr.title,cr.external_status,cr.external_owner,cr.source_locator,cr.source_as_of,cr.requested_release_id,r.name AS requested_release_name FROM change_request cr JOIN change_request_type crt ON crt.id=cr.type_id LEFT JOIN release r ON r.id=cr.requested_release_id WHERE cr.program_id=?").bind(PROGRAM_ID).all<RequestRow>(),
    env.DB.prepare("SELECT id,code FROM change_request_type WHERE program_id=? AND active=1").bind(PROGRAM_ID).all<{ id: string; code: string }>(),
    env.DB.prepare("SELECT id,name,code FROM release WHERE program_id=?").bind(PROGRAM_ID).all<{ id: string; name: string; code: string | null }>(),
    env.DB.prepare("SELECT s.change_request_id,s.normalized_payload,s.source_as_of FROM external_change_source_state s JOIN change_request cr ON cr.id=s.change_request_id WHERE cr.program_id=?").bind(PROGRAM_ID).all<SourceState>(),
  ]);
  const existingRows: ExistingChangeRequestReference[] = existing.results.map((row) => ({ id: row.id, typeId: row.type_id, typeCode: row.type_code, externalSystem: row.external_system, externalIdentifier: row.external_identifier, title: row.title, externalStatus: row.external_status, externalOwner: row.external_owner, sourceLocator: row.source_locator, sourceAsOf: row.source_as_of, requestedReleaseId: row.requested_release_id, requestedReleaseName: row.requested_release_name }));
  return { existingRows, types: types.results, releases: releases.results, sourceStateByRequest: new Map(states.results.map((item) => [item.change_request_id, item])) };
}

function makeIncoming(body: IncomingBody) {
  if (Array.isArray(body.rawRows) && body.mapping) return mapChangeRequestSourceRows(body.rawRows, body.mapping, { externalSystem: body.sourceSystem || CONFLUENCE_CHANGE_SOURCE_SYSTEM, sourceAsOf: body.sourceAsOf });
  return (Array.isArray(body.rows) ? body.rows : []).map((row, index) => ({ rowNumber: index + 2, raw: row as Record<string, unknown>, canonical: normalizeChangeRequestImportRow(row) }));
}

function review(body: IncomingBody, incoming: ReturnType<typeof makeIncoming>, data: Awaited<ReturnType<typeof context>>) {
  const preview = reconcileChangeRequestImport(incoming.map((item) => item.canonical), data.existingRows, data.types, data.releases);
  const resolutions = new Map((body.resolutions || []).map((item) => [item.rowNumber, item]));
  const existingById = new Map(data.existingRows.map((item) => [item.id, item]));
  const rawByRow = new Map(incoming.map((item) => [item.rowNumber, item.raw]));
  const items: GovernedImportItem[] = preview.rows.map((item) => {
    const resolution = resolutions.get(item.rowNumber);
    const selected = resolution?.targetId ? existingById.get(resolution.targetId) : item.existingId ? existingById.get(item.existingId) : null;
    const canonicalBefore = selected ? existingChangeRequestImportRow(selected) : null;
    const canonicalChanges = canonicalBefore
      ? CHANGE_REQUEST_IMPORT_COLUMNS.filter((field) => normalizedChangeImportValue(canonicalBefore[field]) !== normalizedChangeImportValue(item.row[field])).map((field) => ({ field, before: canonicalBefore[field], after: item.row[field] }))
      : CHANGE_REQUEST_IMPORT_COLUMNS.filter((field) => item.row[field]).map((field) => ({ field, before: "", after: item.row[field] }));
    const sourceState = selected ? data.sourceStateByRequest.get(selected.id) : null;
    const sourceChanges = objectDiff(parseJsonRecord(sourceState?.normalized_payload), parseJsonRecord(sourceJson(rawByRow.get(item.rowNumber) || {}))).filter((change) => !canonicalChanges.some((candidate) => candidate.field === change.field));
    const issues = [...item.issues];
    if (resolution?.targetId && !selected) issues.push("The selected canonical Change Request does not exist in this program.");
    if (selected?.sourceAsOf && item.row.SourceAsOf && selected.sourceAsOf > item.row.SourceAsOf) issues.push(`Source date ${item.row.SourceAsOf} is older than the current ${selected.sourceAsOf} observation.`);
    const disposition = issues.length ? "blocked" as const : !selected ? "add" as const : canonicalChanges.length || sourceChanges.length ? "change" as const : "unchanged" as const;
    return { id: `change-import-row-${item.rowNumber}`, rowNumber: item.rowNumber, sourceKey: item.row.ExternalIdentifier, title: item.row.Title || "Untitled Change Request", detail: `${item.row.ExternalSystem} · ${item.row.SourceAsOf || "source date not supplied"}`, disposition, issues, changes: [...canonicalChanges, ...sourceChanges], proposedTargetId: selected?.id || null, proposedTargetLabel: selected ? `${selected.externalIdentifier} · ${selected.title}` : null, defaultDecision: disposition === "blocked" ? "skip" as const : "approve" as const };
  });
  const approved = items.filter((item) => item.disposition !== "blocked" && (resolutions.get(item.rowNumber)?.decision || item.defaultDecision) === "approve");
  const selectedTargets = approved.map((item) => resolutions.get(item.rowNumber)?.targetId || item.proposedTargetId).filter((item): item is string => Boolean(item));
  const duplicateTargets = selectedTargets.filter((target, index) => selectedTargets.indexOf(target) !== index);
  if (duplicateTargets.length) for (const item of items) if (duplicateTargets.includes(resolutions.get(item.rowNumber)?.targetId || item.proposedTargetId || "")) { item.disposition = "blocked"; item.issues.push("More than one source row maps to this canonical Change Request."); item.defaultDecision = "skip"; }
  return { preview, items, targets: data.existingRows.map((item) => ({ id: item.id, label: `${item.externalIdentifier} · ${item.title}`, detail: item.externalSystem || undefined })) };
}

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const runId = new URL(request.url).searchParams.get("runId");
    const history = await env.DB.prepare("SELECT id,adapter_key,source_system,file_name,sheet_name,source_as_of,status,record_count,added_count,changed_count,unchanged_count,skipped_count,blocked_count,applied_at FROM ingestion_run WHERE program_id=? AND adapter_key IN ('confluence_change_csv','change_request_reference') ORDER BY created_at DESC LIMIT 40").bind(PROGRAM_ID).all();
    const items = runId ? await env.DB.prepare("SELECT row_number,source_key,target_id,match_method,decision,disposition,changes_payload,issues_payload FROM ingestion_item WHERE run_id=? ORDER BY row_number").bind(runId).all() : { results: [] };
    return Response.json({ history: history.results, items: items.results });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Import history is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as IncomingBody;
    const incoming = makeIncoming(body);
    if (!body.fileName || !incoming.length) return Response.json({ error: "A source file with at least one Change Request row is required." }, { status: 400 });
    if (!body.sourceAsOf || !validDate(body.sourceAsOf)) return Response.json({ error: "Source snapshot date is required and must use YYYY-MM-DD." }, { status: 400 });
    const data = await context();
    const result = review(body, incoming, data);
    const responsePreview = { ...result.preview, rows: result.preview.rows, items: result.items, targets: result.targets, canApply: result.items.some((item) => item.disposition !== "blocked" && (body.resolutions?.find((entry) => entry.rowNumber === item.rowNumber)?.decision || item.defaultDecision) === "approve") };
    if (body.mode !== "apply") return Response.json({ preview: responsePreview });
    requireWriter(actor);

    const resolutionByRow = new Map((body.resolutions || []).map((item) => [item.rowNumber, item]));
    const approvedBlocked = result.items.filter((item) => item.disposition === "blocked" && resolutionByRow.get(item.rowNumber)?.decision === "approve");
    if (approvedBlocked.length) return Response.json({ error: "The reviewed mapping created a blocking conflict. Review the updated preview before applying.", preview: responsePreview }, { status: 409 });
    const approved = result.items.filter((item) => item.disposition !== "blocked" && (resolutionByRow.get(item.rowNumber)?.decision || item.defaultDecision) === "approve");
    if (!approved.length) return Response.json({ error: "Approve at least one valid source row before applying the import.", preview: responsePreview }, { status: 409 });
    const content = JSON.stringify({ mapping: body.mapping || null, rows: incoming.map((item) => item.raw) });
    const adapterKey = body.adapterKey || "confluence_change_csv";
    const identity = await importIdentity(adapterKey, body.sourceAsOf, content);
    const prior = await priorImportRun(env.DB, identity.idempotencyKey);
    if (prior?.status === "applied") return Response.json({ ok: true, duplicate: true, runId: prior.id, message: "This exact source snapshot was already applied. No records were changed.", preview: responsePreview });

    const at = new Date().toISOString();
    const runId = `ingestion-${crypto.randomUUID()}`;
    const existingById = new Map(data.existingRows.map((item) => [item.id, item]));
    const canonicalByRow = new Map(incoming.map((item) => [item.rowNumber, item]));
    const finalResolutions: ImportResolution[] = result.items.map((item) => {
      const resolution = resolutionByRow.get(item.rowNumber);
      return { rowNumber: item.rowNumber, decision: item.disposition === "blocked" ? "skip" : resolution?.decision || item.defaultDecision, targetId: resolution?.targetId || item.proposedTargetId || null };
    });
    for (const item of approved) {
      const resolution = finalResolutions.find((entry) => entry.rowNumber === item.rowNumber)!;
      if (!resolution.targetId) resolution.targetId = `change-${crypto.randomUUID()}`;
    }
    const statements = importRunStatements(env.DB, { runId, adapterKey, sourceSystem: body.sourceSystem || CONFLUENCE_CHANGE_SOURCE_SYSTEM, fileName: body.fileName, sheetName: body.sheetName, sourceLocator: body.sourceLocator, sourceAsOf: body.sourceAsOf, ...identity, items: result.items, resolutions: finalResolutions, rawRows: incoming.map((item) => item.raw), normalizedRows: incoming.map((item) => item.canonical), targetSnapshotKind: "change_request_source", targetSnapshotId: runId, actorId: actor.id, at });

    for (const item of approved) {
      const incomingItem = canonicalByRow.get(item.rowNumber)!;
      const row = incomingItem.canonical;
      const resolution = finalResolutions.find((entry) => entry.rowNumber === item.rowNumber)!;
      const existing = resolution.targetId ? existingById.get(resolution.targetId) : null;
      const changeRequestId = existing?.id || resolution.targetId!;
      const previewRow = result.preview.rows.find((candidate) => candidate.rowNumber === item.rowNumber)!;
      if (existing) statements.push(env.DB.prepare("UPDATE change_request SET type_id=?,external_system=?,external_identifier=?,title=?,external_status=?,external_owner=?,source_locator=?,source_as_of=?,requested_release_id=?,updated_at=? WHERE id=? AND program_id=?")
        .bind(previewRow.typeId, row.ExternalSystem, row.ExternalIdentifier, row.Title, row.ExternalStatus || null, row.ExternalOwner || null, row.SourceLocator || null, row.SourceAsOf, previewRow.releaseId, at, existing.id, PROGRAM_ID));
      else statements.push(env.DB.prepare("INSERT INTO change_request (id,program_id,type_id,external_system,external_identifier,title,external_status,external_owner,source_locator,source_as_of,requested_release_id,government_priority,decision_status,reference_status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(changeRequestId, PROGRAM_ID, previewRow.typeId, row.ExternalSystem, row.ExternalIdentifier, row.Title, row.ExternalStatus || null, row.ExternalOwner || null, row.SourceLocator || null, row.SourceAsOf, previewRow.releaseId, "unranked", "pending", "active", actor.id, at, at));
      const normalizedPayload = sourceJson(incomingItem.raw);
      statements.push(env.DB.prepare("INSERT INTO external_change_source_state (change_request_id,latest_run_id,external_system,raw_payload,normalized_payload,source_as_of,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(change_request_id) DO UPDATE SET latest_run_id=excluded.latest_run_id,external_system=excluded.external_system,raw_payload=excluded.raw_payload,normalized_payload=excluded.normalized_payload,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at")
        .bind(changeRequestId, runId, row.ExternalSystem, JSON.stringify(incomingItem.raw), normalizedPayload, row.SourceAsOf, at));
      statements.push(audit(env.DB, actor, existing ? "change_request_source_refreshed" : "change_request_source_imported", "change_request", changeRequestId, { ingestionRunId: runId, sourceFile: body.fileName, rowNumber: item.rowNumber, changedFields: item.changes.map((change) => change.field) }, existing || undefined));
    }
    statements.push(audit(env.DB, actor, "governed_import_applied", "ingestion_run", runId, { adapterKey, fileName: body.fileName, sourceAsOf: body.sourceAsOf, approved: approved.length, skipped: result.items.length - approved.length }));
    await env.DB.batch(statements);
    return Response.json({ ok: true, runId, duplicate: false, preview: responsePreview, applied: approved.length, skipped: result.items.length - approved.length }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Change Request source import failed.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
