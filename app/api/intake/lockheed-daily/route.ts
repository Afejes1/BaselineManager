import { env } from "cloudflare:workers";
import { audit, ensureActor, PROGRAM_ID, requireWriter } from "../../../../lib/governance-server";
import { importIdentity, importRunStatements, priorImportRun, sha256Import } from "../../../../lib/import-run-server";
import {
  LOCKHEED_DAILY_SOURCE_SYSTEM,
  comparableLockheedDailyRecord,
  diffLockheedDailyRecords,
  parseLockheedDailyFiles,
  type LockheedDailyFile,
  type LockheedDailyRecord,
} from "../../../../lib/lockheed-daily-import";
import type { GovernedImportItem, ImportResolution } from "../../../../lib/governed-import";
import { CanonicalImportMaterializer, LM_JIRA_SYSTEM, splitReportedReferences } from "../../../../lib/canonical-import-materializer";

type IncomingBody = {
  mode?: "preview" | "apply";
  sourceAsOf?: string;
  sourceSystem?: string;
  files?: LockheedDailyFile[];
  resolutions?: ImportResolution[];
};

type SubjectRow = {
  id: string; source_system: string; dataset_key: string; entity_kind: string; source_key: string; title: string;
  canonical_entity_kind: string | null; canonical_entity_id: string | null; first_seen_at: string; last_seen_at: string;
  normalized_payload: string | null; source_as_of: string | null; disposition: string | null;
};

const clean = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
const normalizedKey = (value: unknown) => clean(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const parsePayload = (value: string | null) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const datasetAdapter = (dataset: string) => `lockheed_daily_${dataset}`;
const subjectIdentity = (sourceSystem: string, record: LockheedDailyRecord) => `${sourceSystem}|${record.dataset}|${record.sourceKey.toLocaleLowerCase("en-US")}`;

async function loadContext(sourceSystem: string) {
  const subjects = await env.DB.prepare(`SELECT s.id,s.source_system,s.dataset_key,s.entity_kind,s.source_key,s.title,s.canonical_entity_kind,s.canonical_entity_id,s.first_seen_at,s.last_seen_at,
      o.normalized_payload,o.source_as_of,o.disposition
      FROM external_source_subject s
      LEFT JOIN external_source_observation o ON o.id=(SELECT lo.id FROM external_source_observation lo WHERE lo.subject_id=s.id ORDER BY lo.source_as_of DESC,lo.observed_at DESC LIMIT 1)
      WHERE s.program_id=? AND s.source_system=?`).bind(PROGRAM_ID, sourceSystem).all<SubjectRow>();
  return { subjects: subjects.results };
}

function buildReview(body: IncomingBody, records: LockheedDailyRecord[], context: Awaited<ReturnType<typeof loadContext>>) {
  const sourceSystem = clean(body.sourceSystem) || LOCKHEED_DAILY_SOURCE_SYSTEM;
  const subjects = new Map(context.subjects.map((row) => [`${row.source_system}|${row.dataset_key}|${row.source_key.toLocaleLowerCase("en-US")}`, row]));
  const items: GovernedImportItem[] = records.map((record) => {
    const subject = subjects.get(subjectIdentity(sourceSystem, record));
    const before = subject ? parsePayload(subject.normalized_payload) as ReturnType<typeof comparableLockheedDailyRecord> | null : null;
    const comparable = comparableLockheedDailyRecord(record);
    const changes = diffLockheedDailyRecords(before, comparable);
    const issues = [...record.issues, ...record.warnings];
    // A source row with an external identity is valuable even when its title
    // or MCP label is incomplete. Only a missing/duplicate identity blocks
    // materialization; the advisory findings remain on the import receipt.
    const disposition = record.issues.length ? "blocked" as const : !subject ? "add" as const : changes.length ? "change" as const : "unchanged" as const;
    return {
      id: `lockheed-daily-${record.fileId}-${record.rowNumber}`,
      rowNumber: record.rowNumber,
      sourceKey: `${record.dataset}|${record.sourceKey}`,
      title: record.title || "Untitled source record",
      detail: `${record.fileName} · source row ${record.raw.__sourceRow || record.rowNumber} · ${record.status || "status not supplied"}`,
      disposition,
      issues,
      changes,
      defaultDecision: disposition === "blocked" ? "skip" as const : "approve" as const,
    };
  });
  return { items, sourceSystem };
}

async function getHistory() {
  const runs = await env.DB.prepare(`SELECT id,adapter_key,source_system,file_name,source_as_of,status,record_count,added_count,changed_count,unchanged_count,skipped_count,blocked_count,applied_at
    FROM ingestion_run WHERE program_id=? AND adapter_key LIKE 'lockheed_daily_%' ORDER BY source_as_of DESC,created_at DESC LIMIT 80`).bind(PROGRAM_ID).all();
  const subjects = await env.DB.prepare(`SELECT s.id,s.dataset_key,s.entity_kind,s.source_key,s.title,s.canonical_entity_kind,s.canonical_entity_id,s.first_seen_at,s.last_seen_at,
    o.source_as_of,o.disposition,o.normalized_payload,
    CASE s.canonical_entity_kind WHEN 'capability' THEN (SELECT c.name FROM capability c WHERE c.id=s.canonical_entity_id) WHEN 'change_request' THEN (SELECT cr.title FROM change_request cr WHERE cr.id=s.canonical_entity_id) WHEN 'objective' THEN (SELECT io.title FROM incumbent_objective io WHERE io.id=s.canonical_entity_id) END AS canonical_title,
    CASE s.canonical_entity_kind WHEN 'capability' THEN (SELECT c.lifecycle_status FROM capability c WHERE c.id=s.canonical_entity_id) WHEN 'change_request' THEN (SELECT cr.external_status FROM change_request cr WHERE cr.id=s.canonical_entity_id) WHEN 'objective' THEN (SELECT io.status FROM incumbent_objective io WHERE io.id=s.canonical_entity_id) END AS canonical_status
    FROM external_source_subject s
    LEFT JOIN external_source_observation o ON o.id=(SELECT lo.id FROM external_source_observation lo WHERE lo.subject_id=s.id ORDER BY lo.source_as_of DESC,lo.observed_at DESC LIMIT 1)
    WHERE s.program_id=? AND s.dataset_key IN ('capes','jira','mcps','objectives') ORDER BY s.dataset_key,s.source_key`).bind(PROGRAM_ID).all();
  return { history: runs.results, subjects: subjects.results };
}

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const subjectId = new URL(request.url).searchParams.get("subjectId");
    if (!subjectId) return Response.json(await getHistory());
    const subject = await env.DB.prepare("SELECT * FROM external_source_subject WHERE id=? AND program_id=?").bind(subjectId, PROGRAM_ID).first();
    if (!subject) return Response.json({ error: "Source subject not found." }, { status: 404 });
    const observations = await env.DB.prepare(`SELECT o.id,o.disposition,o.source_updated_at,o.source_as_of,o.normalized_payload,o.raw_payload,o.observed_at,r.file_name
      FROM external_source_observation o JOIN ingestion_run r ON r.id=o.run_id WHERE o.subject_id=? ORDER BY o.source_as_of DESC,o.observed_at DESC`).bind(subjectId).all<{ id: string }>();
    const result = [];
    for (const observation of observations.results) {
      const [deltas, relations] = await Promise.all([
        env.DB.prepare("SELECT field_name,before_value,after_value FROM external_source_delta WHERE observation_id=? ORDER BY field_name").bind(observation.id).all(),
        env.DB.prepare("SELECT relation_type,target_reference,target_subject_id,canonical_target_kind,canonical_target_id FROM external_source_relation WHERE observation_id=? ORDER BY relation_type,target_reference").bind(observation.id).all(),
      ]);
      result.push({ ...observation, normalized: parsePayload((observation as { normalized_payload?: string }).normalized_payload || null), deltas: deltas.results, relations: relations.results });
    }
    return Response.json({ subject, observations: result });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Lockheed delivery history is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as IncomingBody;
    if (!body.sourceAsOf || !validDate(body.sourceAsOf)) return Response.json({ error: "Source snapshot date is required and must use YYYY-MM-DD." }, { status: 400 });
    if (!Array.isArray(body.files) || !body.files.length) return Response.json({ error: "Select at least one Lockheed daily-delivery file." }, { status: 400 });
    if (body.files.some((file) => !file.fileName || !file.dataset || !Array.isArray(file.rows) || !file.rows.length)) return Response.json({ error: "Every selected file requires a dataset classification and at least one row." }, { status: 400 });
    const parsed = parseLockheedDailyFiles(body.files);
    let ordinal = 0;
    const records = parsed.map((record) => ({ ...record, raw: { ...record.raw, __sourceRow: record.rowNumber }, rowNumber: ++ordinal }));
    const sourceSystem = clean(body.sourceSystem) || LOCKHEED_DAILY_SOURCE_SYSTEM;
    const context = await loadContext(sourceSystem);
    const review = buildReview({ ...body, sourceSystem }, records, context);
    const responsePreview = { items: review.items, canApply: review.items.some((item) => item.disposition !== "blocked") };
    if (body.mode !== "apply") return Response.json({ preview: responsePreview });
    requireWriter(actor);

    const resolutionByRow = new Map((body.resolutions || []).map((item) => [item.rowNumber, item]));
    const approved = review.items.filter((item) => item.disposition !== "blocked" && (resolutionByRow.get(item.rowNumber)?.decision || item.defaultDecision) === "approve");
    if (!approved.length) return Response.json({ error: "Approve at least one valid source row before applying the delivery.", preview: responsePreview }, { status: 409 });
    const approvedRows = new Set(approved.map((item) => item.rowNumber));
    const itemByRow = new Map(review.items.map((item) => [item.rowNumber, item]));
    const subjectByIdentity = new Map(context.subjects.map((subject) => [`${subject.source_system}|${subject.dataset_key}|${subject.source_key.toLocaleLowerCase("en-US")}`, subject]));
    const existingSubjectById = new Map(context.subjects.map((subject) => [subject.id, subject]));
    const incomingSubjectIds = new Map<string, string>();
    for (const record of records) {
      const existing = subjectByIdentity.get(subjectIdentity(sourceSystem, record));
      incomingSubjectIds.set(`${record.dataset}|${record.sourceKey.toLocaleLowerCase("en-US")}`, existing?.id || `external-subject-${crypto.randomUUID()}`);
    }

    const at = new Date().toISOString();
    const filePlans = [] as Array<{ file: LockheedDailyFile; identity: Awaited<ReturnType<typeof importIdentity>>; duplicate: boolean }>;
    for (const file of body.files) {
      const identity = await importIdentity(datasetAdapter(file.dataset), body.sourceAsOf, JSON.stringify({ sourceSystem, rows: file.rows }));
      const prior = await priorImportRun(env.DB, identity.idempotencyKey);
      filePlans.push({ file, identity, duplicate: prior?.status === "applied" });
    }
    const eligibleFileIds = new Set(filePlans.filter((plan) => !plan.duplicate).map((plan) => plan.file.fileId));
    const acceptedRecords = records.filter((record) => eligibleFileIds.has(record.fileId) && approvedRows.has(record.rowNumber));
    const materializer = await CanonicalImportMaterializer.load(env.DB, actor.id, at);
    const canonicalByRow = new Map<number, { kind: "capability" | "change_request" | "objective" | null; id: string | null }>();
    const objectiveBySourceKey = new Map<string, string>();
    for (const record of acceptedRecords) {
      let kind: "capability" | "change_request" | "objective" | null = null;
      let id: string | null = null;
      if (record.canonicalTargetKind === "capability") {
        const capability = materializer.ensureCapability({ code: record.sourceKey, name: record.title, description: record.fields.Description || null, sourceReference: sourceSystem, sourceAsOf: body.sourceAsOf });
        kind = capability.id ? "capability" : null; id = capability.id;
      } else if (record.canonicalTargetKind === "change_request") {
        const change = materializer.ensureChangeRequest({ identifier: record.sourceKey, title: record.title, externalStatus: record.status, externalOwner: record.fields.MxsPMOLead || record.fields.FunctionalOwner || null, sourceSystem, sourceLocator: record.fields.TitleURL || record.fields.URL || null, sourceAsOf: body.sourceAsOf, requestedRelease: record.fields.TargetRelease || null, updateSourceFields: true });
        kind = change.id ? "change_request" : null; id = change.id;
      } else if (record.canonicalTargetKind === "objective") {
        const identifier = record.fields.JIRAID || record.sourceKey;
        const objective = materializer.ensureObjective({ externalSystem: LM_JIRA_SYSTEM, externalIdentifier: identifier, title: record.title, summary: record.fields.Description || null, technicalOwner: record.fields.Team || record.fields.FunctionalOwner || null, status: record.status, plannedStart: record.fields.TargetStart || record.fields.TargetPIStart || null, plannedFinish: record.fields.TargetFinish || record.fields.TargetPIEnd || null, actualFinish: record.fields.Resolved || null, sourceLocator: record.fields.URL || null, sourceAsOf: body.sourceAsOf, primaryChangeRequestId: null });
        kind = objective.id ? "objective" : null; id = objective.id;
        if (id) {
          objectiveBySourceKey.set(normalizedKey(record.sourceKey), id);
          objectiveBySourceKey.set(normalizedKey(identifier), id);
          for (const reference of splitReportedReferences([record.fields.JPOID, record.fields.JPOCode, record.fields.MCPDSOR].filter(Boolean).join(","))) {
            const change = materializer.ensureChangeRequest({ identifier: reference, sourceSystem, sourceLocator: record.fields.URL || null, sourceAsOf: body.sourceAsOf, updateSourceFields: false });
            if (change.id) materializer.ensureObjectiveChangeRequestLink({ objectiveId: id, changeRequestId: change.id, relationship: "reported", sourceSystem, sourceLocator: record.fields.URL || null, sourceAsOf: body.sourceAsOf });
          }
        }
      }
      canonicalByRow.set(record.rowNumber, { kind, id });
    }
    // The MCP projection can name Objectives that arrive in the same daily
    // package. Promote those deterministic same-package references to real
    // reported associations while retaining every raw source relation too.
    for (const record of acceptedRecords.filter((item) => item.dataset === "mcps")) {
      const request = canonicalByRow.get(record.rowNumber);
      if (!request?.id) continue;
      for (const relation of record.relations.filter((item) => item.relationType === "objective_reference")) {
        const objectiveId = objectiveBySourceKey.get(normalizedKey(relation.targetReference));
        if (objectiveId) materializer.ensureObjectiveChangeRequestLink({ objectiveId, changeRequestId: request.id, relationship: "reported", sourceSystem, sourceAsOf: body.sourceAsOf });
      }
    }
    if (materializer.issues.length) return Response.json({ error: "One or more source identities match multiple canonical records. Review the identity exceptions before applying.", identityExceptions: materializer.issues, preview: responsePreview }, { status: 409 });
    let applied = 0; let skipped = 0; let duplicateFiles = filePlans.filter((plan) => plan.duplicate).length;
    const appliedRunIds: string[] = [];
    const deliveryStatements: D1PreparedStatement[] = [...materializer.statements];
    for (const { file, identity, duplicate } of filePlans) {
      const fileRecords = records.filter((record) => record.fileId === file.fileId);
      const fileItems = fileRecords.map((record) => itemByRow.get(record.rowNumber)!);
      if (duplicate) continue;
      const runId = `ingestion-${crypto.randomUUID()}`;
      const fileResolutions: ImportResolution[] = fileItems.map((item) => {
        const resolution = resolutionByRow.get(item.rowNumber);
        // The canonical record was resolved from the authoritative external
        // identity above.  Record that exact object on the import receipt;
        // this is an audit link, not a reviewer-selected mapping.
        const canonical = canonicalByRow.get(item.rowNumber);
        return { rowNumber: item.rowNumber, sourceKey: item.sourceKey, decision: item.disposition === "blocked" ? "skip" : resolution?.decision || item.defaultDecision, targetId: canonical?.id || null };
      });
      const statements = importRunStatements(env.DB, { runId, adapterKey: datasetAdapter(file.dataset), sourceSystem, fileName: file.fileName, sheetName: file.sheetName, sourceAsOf: body.sourceAsOf, ...identity, items: fileItems, resolutions: fileResolutions, rawRows: fileRecords.map((record) => record.raw), normalizedRows: fileRecords.map(comparableLockheedDailyRecord), targetSnapshotKind: "external_source_observation", targetSnapshotId: runId, actorId: actor.id, at });
      const acceptedFileRecords = fileRecords.filter((record) => approvedRows.has(record.rowNumber));
      skipped += fileRecords.length - acceptedFileRecords.length;
      const acceptedSubjectIds = new Set(acceptedFileRecords.map((record) => incomingSubjectIds.get(`${record.dataset}|${record.sourceKey.toLocaleLowerCase("en-US")}`)!));
      // Subject identities precede observations so same-file dependency links
      // cannot violate immediate SQLite foreign-key checks.
      for (const record of acceptedFileRecords) {
        const existing = subjectByIdentity.get(subjectIdentity(sourceSystem, record));
        const subjectId = incomingSubjectIds.get(`${record.dataset}|${record.sourceKey.toLocaleLowerCase("en-US")}`)!;
        const canonical = canonicalByRow.get(record.rowNumber) || { kind: null, id: null };
        const canonicalKind = canonical.kind;
        const canonicalId = canonical.id;
        if (existing) statements.push(env.DB.prepare("UPDATE external_source_subject SET entity_kind=?,title=?,canonical_entity_kind=?,canonical_entity_id=?,last_seen_at=?,updated_at=? WHERE id=? AND program_id=?")
          .bind(record.entityKind, record.title, canonicalKind, canonicalId, body.sourceAsOf, at, existing.id, PROGRAM_ID));
        else statements.push(env.DB.prepare("INSERT INTO external_source_subject (id,program_id,source_system,dataset_key,entity_kind,source_key,title,canonical_entity_kind,canonical_entity_id,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(subjectId, PROGRAM_ID, sourceSystem, record.dataset, record.entityKind, record.sourceKey, record.title, canonicalKind, canonicalId, body.sourceAsOf, body.sourceAsOf, at, at));
      }
      for (const record of acceptedFileRecords) {
        const item = itemByRow.get(record.rowNumber)!;
        const subjectId = incomingSubjectIds.get(`${record.dataset}|${record.sourceKey.toLocaleLowerCase("en-US")}`)!;
        const canonical = canonicalByRow.get(record.rowNumber) || { kind: null, id: null };
        const canonicalKind = canonical.kind;
        const canonicalId = canonical.id;
        const comparable = comparableLockheedDailyRecord(record);
        const observationId = `external-observation-${crypto.randomUUID()}`;
        const contentHash = await sha256Import(JSON.stringify(comparable));
        statements.push(env.DB.prepare("INSERT INTO external_source_observation (id,run_id,subject_id,disposition,source_updated_at,source_as_of,content_hash,raw_payload,normalized_payload,observed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .bind(observationId, runId, subjectId, item.disposition, record.sourceUpdatedAt || null, body.sourceAsOf, contentHash, JSON.stringify(record.raw), JSON.stringify(comparable), at, at));
        for (const change of item.changes) statements.push(env.DB.prepare("INSERT INTO external_source_delta (id,observation_id,field_name,before_value,after_value,created_at) VALUES (?,?,?,?,?,?)")
          .bind(`external-delta-${crypto.randomUUID()}`, observationId, change.field, change.before || null, change.after || null, at));
        for (const relation of record.relations) {
          const candidateSubjectId = incomingSubjectIds.get(`${record.dataset}|${relation.targetReference.toLocaleLowerCase("en-US")}`) || null;
          const targetSubjectId = candidateSubjectId && (acceptedSubjectIds.has(candidateSubjectId) || existingSubjectById.has(candidateSubjectId)) ? candidateSubjectId : null;
          const targetSubject = targetSubjectId ? existingSubjectById.get(targetSubjectId) : null;
          statements.push(env.DB.prepare("INSERT INTO external_source_relation (id,observation_id,relation_type,target_reference,target_subject_id,canonical_target_kind,canonical_target_id,created_at) VALUES (?,?,?,?,?,?,?,?)")
            .bind(`external-relation-${crypto.randomUUID()}`, observationId, relation.relationType, relation.targetReference, targetSubjectId, targetSubject?.canonical_entity_kind || null, targetSubject?.canonical_entity_id || null, at));
        }
        statements.push(audit(env.DB, actor, "external_source_observation_recorded", "external_source_subject", subjectId, { runId, dataset: record.dataset, sourceKey: record.sourceKey, sourceAsOf: body.sourceAsOf, disposition: item.disposition, canonicalKind, canonicalId, changedFields: item.changes.map((change) => change.field) }));
        applied += 1;
      }
      statements.push(audit(env.DB, actor, "lockheed_daily_delivery_applied", "ingestion_run", runId, { fileName: file.fileName, dataset: file.dataset, sourceAsOf: body.sourceAsOf, absenceRule: "not_observed_not_deleted" }));
      deliveryStatements.push(...statements);
      appliedRunIds.push(runId);
    }
    if (!appliedRunIds.length && duplicateFiles === body.files.length) return Response.json({ ok: true, duplicate: true, message: "Every selected file for this source date was already applied. No observations were added.", preview: responsePreview });
    if (deliveryStatements.length) await env.DB.batch(deliveryStatements);
    return Response.json({ ok: true, duplicate: false, runIds: appliedRunIds, applied, skipped, duplicateFiles, preview: responsePreview }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lockheed daily delivery import failed.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
