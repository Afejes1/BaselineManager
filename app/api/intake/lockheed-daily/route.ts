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
import type { GovernedImportItem, ImportResolution, ImportTargetOption } from "../../../../lib/governed-import";

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
type CanonicalTarget = ImportTargetOption & { normalizedKeys: string[] };

const clean = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
const normalizedKey = (value: unknown) => clean(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const parsePayload = (value: string | null) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const datasetAdapter = (dataset: string) => `lockheed_daily_${dataset}`;
const subjectIdentity = (sourceSystem: string, record: LockheedDailyRecord) => `${sourceSystem}|${record.dataset}|${record.sourceKey.toLocaleLowerCase("en-US")}`;

async function loadContext(sourceSystem: string) {
  const [subjects, capabilities, changes, objectives] = await Promise.all([
    env.DB.prepare(`SELECT s.id,s.source_system,s.dataset_key,s.entity_kind,s.source_key,s.title,s.canonical_entity_kind,s.canonical_entity_id,s.first_seen_at,s.last_seen_at,
      o.normalized_payload,o.source_as_of,o.disposition
      FROM external_source_subject s
      LEFT JOIN external_source_observation o ON o.id=(SELECT lo.id FROM external_source_observation lo WHERE lo.subject_id=s.id ORDER BY lo.source_as_of DESC,lo.observed_at DESC LIMIT 1)
      WHERE s.program_id=? AND s.source_system=?`).bind(PROGRAM_ID, sourceSystem).all<SubjectRow>(),
    env.DB.prepare("SELECT id,code,name FROM capability WHERE program_id=? ORDER BY name").bind(PROGRAM_ID).all<{ id: string; code: string | null; name: string }>(),
    env.DB.prepare("SELECT id,external_identifier,title FROM change_request WHERE program_id=? ORDER BY external_identifier").bind(PROGRAM_ID).all<{ id: string; external_identifier: string; title: string }>(),
    env.DB.prepare("SELECT id,external_identifier,title FROM incumbent_objective WHERE program_id=? ORDER BY external_identifier").bind(PROGRAM_ID).all<{ id: string; external_identifier: string; title: string }>(),
  ]);
  const targets: CanonicalTarget[] = [
    ...capabilities.results.map((row) => ({ id: row.id, kind: "capability", label: `${row.code ? `${row.code} · ` : ""}${row.name}`, normalizedKeys: [row.code, row.name].filter(Boolean).map(normalizedKey) })),
    ...changes.results.map((row) => ({ id: row.id, kind: "change_request", label: `${row.external_identifier} · ${row.title}`, normalizedKeys: [normalizedKey(row.external_identifier)] })),
    ...objectives.results.map((row) => ({ id: row.id, kind: "objective", label: `${row.external_identifier} · ${row.title}`, normalizedKeys: [normalizedKey(row.external_identifier)] })),
  ];
  return { subjects: subjects.results, targets };
}

function uniqueTarget(targets: CanonicalTarget[], kind: string, keys: string[]) {
  const wanted = new Set(keys.map(normalizedKey).filter(Boolean));
  const matches = targets.filter((target) => target.kind === kind && target.normalizedKeys.some((key) => wanted.has(key)));
  return matches.length === 1 ? matches[0] : null;
}

function proposedTarget(record: LockheedDailyRecord, subject: SubjectRow | undefined, targets: CanonicalTarget[]) {
  if (!record.canonicalTargetKind) return null;
  if (subject?.canonical_entity_kind === record.canonicalTargetKind && subject.canonical_entity_id) return targets.find((target) => target.kind === record.canonicalTargetKind && target.id === subject.canonical_entity_id) || null;
  const keys = record.canonicalTargetKind === "objective"
    ? [record.fields.JIRAID, record.sourceKey]
    : record.canonicalTargetKind === "capability" ? [record.sourceKey, record.title] : [record.sourceKey];
  return uniqueTarget(targets, record.canonicalTargetKind, keys);
}

function buildReview(body: IncomingBody, records: LockheedDailyRecord[], context: Awaited<ReturnType<typeof loadContext>>) {
  const sourceSystem = clean(body.sourceSystem) || LOCKHEED_DAILY_SOURCE_SYSTEM;
  const subjects = new Map(context.subjects.map((row) => [`${row.source_system}|${row.dataset_key}|${row.source_key.toLocaleLowerCase("en-US")}`, row]));
  const resolutions = new Map((body.resolutions || []).map((item) => [item.rowNumber, item]));
  const targetById = new Map(context.targets.map((target) => [target.id, target]));
  const items: GovernedImportItem[] = records.map((record) => {
    const subject = subjects.get(subjectIdentity(sourceSystem, record));
    const before = subject ? parsePayload(subject.normalized_payload) as ReturnType<typeof comparableLockheedDailyRecord> | null : null;
    const comparable = comparableLockheedDailyRecord(record);
    const changes = diffLockheedDailyRecords(before, comparable);
    const automatic = proposedTarget(record, subject, context.targets);
    const resolution = resolutions.get(record.rowNumber);
    const resolvedTarget = resolution && Object.prototype.hasOwnProperty.call(resolution, "targetId") ? resolution.targetId ? targetById.get(resolution.targetId) : null : automatic;
    const issues = [...record.issues];
    if (resolution?.targetId && (!resolvedTarget || resolvedTarget.kind !== record.canonicalTargetKind)) issues.push("The selected canonical target is not valid for this source record.");
    const disposition = issues.length ? "blocked" as const : !subject ? "add" as const : changes.length ? "change" as const : "unchanged" as const;
    return {
      id: `lockheed-daily-${record.fileId}-${record.rowNumber}`,
      rowNumber: record.rowNumber,
      sourceKey: `${record.dataset}|${record.sourceKey}`,
      title: record.title || "Untitled source record",
      detail: `${record.fileName} · source row ${record.raw.__sourceRow || record.rowNumber} · ${record.status || "status not supplied"}`,
      disposition,
      issues,
      changes,
      proposedTargetId: resolvedTarget?.id || null,
      proposedTargetLabel: resolvedTarget?.label || null,
      targetKind: record.canonicalTargetKind,
      targetRequired: false,
      defaultDecision: disposition === "blocked" ? "skip" as const : "approve" as const,
    };
  });
  return { items, targets: context.targets.map((target) => ({ id: target.id, kind: target.kind, label: target.label, detail: target.detail })), sourceSystem };
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
    const responsePreview = { items: review.items, targets: review.targets, canApply: review.items.some((item) => item.disposition !== "blocked") };
    if (body.mode !== "apply") return Response.json({ preview: responsePreview });
    requireWriter(actor);

    const resolutionByRow = new Map((body.resolutions || []).map((item) => [item.rowNumber, item]));
    const approved = review.items.filter((item) => item.disposition !== "blocked" && (resolutionByRow.get(item.rowNumber)?.decision || item.defaultDecision) === "approve");
    if (!approved.length) return Response.json({ error: "Approve at least one valid source row before applying the delivery.", preview: responsePreview }, { status: 409 });
    const approvedRows = new Set(approved.map((item) => item.rowNumber));
    const itemByRow = new Map(review.items.map((item) => [item.rowNumber, item]));
    const targetById = new Map(context.targets.map((target) => [target.id, target]));
    const subjectByIdentity = new Map(context.subjects.map((subject) => [`${subject.source_system}|${subject.dataset_key}|${subject.source_key.toLocaleLowerCase("en-US")}`, subject]));
    const existingSubjectById = new Map(context.subjects.map((subject) => [subject.id, subject]));
    const incomingSubjectIds = new Map<string, string>();
    for (const record of records) {
      const existing = subjectByIdentity.get(subjectIdentity(sourceSystem, record));
      incomingSubjectIds.set(`${record.dataset}|${record.sourceKey.toLocaleLowerCase("en-US")}`, existing?.id || `external-subject-${crypto.randomUUID()}`);
    }

    const at = new Date().toISOString();
    let applied = 0; let skipped = 0; let duplicateFiles = 0;
    const appliedRunIds: string[] = [];
    const deliveryStatements: D1PreparedStatement[] = [];
    for (const file of body.files) {
      const fileRecords = records.filter((record) => record.fileId === file.fileId);
      const fileItems = fileRecords.map((record) => itemByRow.get(record.rowNumber)!);
      const identity = await importIdentity(datasetAdapter(file.dataset), body.sourceAsOf, JSON.stringify({ sourceSystem, rows: file.rows }));
      const prior = await priorImportRun(env.DB, identity.idempotencyKey);
      if (prior?.status === "applied") { duplicateFiles += 1; continue; }
      const runId = `ingestion-${crypto.randomUUID()}`;
      const fileResolutions: ImportResolution[] = fileItems.map((item) => {
        const resolution = resolutionByRow.get(item.rowNumber);
        return { rowNumber: item.rowNumber, sourceKey: item.sourceKey, decision: item.disposition === "blocked" ? "skip" : resolution?.decision || item.defaultDecision, targetId: resolution && Object.prototype.hasOwnProperty.call(resolution, "targetId") ? resolution.targetId || null : item.proposedTargetId || null };
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
        const resolution = fileResolutions.find((candidate) => candidate.rowNumber === record.rowNumber)!;
        const target = resolution.targetId ? targetById.get(resolution.targetId) : null;
        const canonicalKind = target?.kind || null;
        const canonicalId = target?.id || null;
        if (existing) statements.push(env.DB.prepare("UPDATE external_source_subject SET entity_kind=?,title=?,canonical_entity_kind=?,canonical_entity_id=?,last_seen_at=?,updated_at=? WHERE id=? AND program_id=?")
          .bind(record.entityKind, record.title, canonicalKind, canonicalId, body.sourceAsOf, at, existing.id, PROGRAM_ID));
        else statements.push(env.DB.prepare("INSERT INTO external_source_subject (id,program_id,source_system,dataset_key,entity_kind,source_key,title,canonical_entity_kind,canonical_entity_id,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(subjectId, PROGRAM_ID, sourceSystem, record.dataset, record.entityKind, record.sourceKey, record.title, canonicalKind, canonicalId, body.sourceAsOf, body.sourceAsOf, at, at));
      }
      for (const record of acceptedFileRecords) {
        const item = itemByRow.get(record.rowNumber)!;
        const subjectId = incomingSubjectIds.get(`${record.dataset}|${record.sourceKey.toLocaleLowerCase("en-US")}`)!;
        const resolution = fileResolutions.find((candidate) => candidate.rowNumber === record.rowNumber)!;
        const target = resolution.targetId ? targetById.get(resolution.targetId) : null;
        const canonicalKind = target?.kind || null;
        const canonicalId = target?.id || null;
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
