import { env } from "cloudflare:workers";
import type { DocumentBucket } from "./governance-server";

const PROGRAM_ID = "program-jsf";
const PENDING_ACTION = "evidence_object_cleanup_pending";
const COMPLETED_ACTION = "evidence_object_cleanup_completed";
const ENTITY_KIND = "evidence_object";

export const MAX_EVIDENCE_CLEANUP_RETRY_BATCH = 25;
const MAX_WORKSPACE_CLEANUP_OBJECTS = 5_000;
const MAX_R2_KEY_BYTES = 1_024;

type Database = typeof env.DB;

type PendingCleanupRow = {
  id: string;
  entity_id: string;
  after_payload: string | null;
};

export type EvidenceObjectCleanupQueueItem = {
  entityId: string;
  r2Key: string;
  reason: string;
  sourceDocumentId?: string;
  notBefore?: string;
};

export type QueuedCleanupItem = EvidenceObjectCleanupQueueItem & { pendingAuditId: string; operationId: string };

export type EvidenceObjectCleanupResult = {
  attempted: number;
  completed: number;
  failed: number;
  malformed: number;
  remaining: number;
};

export type EvidenceObjectCleanupEnqueueResult = {
  queued: QueuedCleanupItem[];
  failed: EvidenceObjectCleanupQueueItem[];
};

const unresolvedPredicate = (pendingAlias: string) => `NOT EXISTS (
  SELECT 1 FROM audit_event completed
  WHERE completed.program_id=${pendingAlias}.program_id
    AND completed.action='${COMPLETED_ACTION}'
    AND completed.entity_kind='${ENTITY_KIND}'
    AND json_valid(completed.after_payload)=1
    AND json_extract(completed.after_payload,'$.pendingAuditId')=${pendingAlias}.id
)`;

function validR2Key(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).byteLength <= MAX_R2_KEY_BYTES;
}

function pendingPayload(row: PendingCleanupRow) {
  if (!row.after_payload) return null;
  try {
    const payload = JSON.parse(row.after_payload) as Record<string, unknown>;
    if (!validR2Key(payload.r2Key)) return null;
    return {
      r2Key: payload.r2Key,
      reason: typeof payload.reason === "string" ? payload.reason : "unspecified",
      operationId: typeof payload.operationId === "string" ? payload.operationId : null,
      notBefore: typeof payload.notBefore === "string" ? payload.notBefore : null,
    };
  } catch {
    return null;
  }
}

function pendingRowsSql(operationId: string | undefined) {
  return `SELECT pending.id,pending.entity_id,pending.after_payload
    FROM audit_event pending
    WHERE pending.program_id=?
      AND pending.action='${PENDING_ACTION}'
      AND pending.entity_kind='${ENTITY_KIND}'
      ${operationId ? "AND json_valid(pending.after_payload)=1 AND json_extract(pending.after_payload,'$.operationId')=?" : ""}
      AND json_valid(pending.after_payload)=1
      AND typeof(json_extract(pending.after_payload,'$.r2Key'))='text'
      AND length(CAST(json_extract(pending.after_payload,'$.r2Key') AS BLOB)) BETWEEN 1 AND ${MAX_R2_KEY_BYTES}
      AND (json_type(pending.after_payload,'$.notBefore') IS NULL OR json_type(pending.after_payload,'$.notBefore')='null' OR (
        json_type(pending.after_payload,'$.notBefore')='text'
        AND json_extract(pending.after_payload,'$.notBefore')<=?
      ))
      AND ${unresolvedPredicate("pending")}
    ORDER BY pending.created_at ASC,pending.id ASC
    LIMIT ?`;
}

function pendingCountSql(operationId: string | undefined) {
  return `SELECT COUNT(*) AS count
    FROM audit_event pending
    WHERE pending.program_id=?
      AND pending.action='${PENDING_ACTION}'
      AND pending.entity_kind='${ENTITY_KIND}'
      ${operationId ? "AND json_valid(pending.after_payload)=1 AND json_extract(pending.after_payload,'$.operationId')=?" : ""}
      AND ${unresolvedPredicate("pending")}`;
}

export async function pendingEvidenceObjectCleanupCount(db: Database, operationId?: string) {
  const statement = db.prepare(pendingCountSql(operationId));
  const row = operationId
    ? await statement.bind(PROGRAM_ID, operationId).first<{ count: number }>()
    : await statement.bind(PROGRAM_ID).first<{ count: number }>();
  return Number(row?.count || 0);
}

async function processPendingRows(db: Database, bucket: DocumentBucket, actorId: string, rows: PendingCleanupRow[]) {
  let completed = 0;
  let failed = 0;
  let malformed = 0;
  for (const row of rows) {
    const payload = pendingPayload(row);
    if (!payload) {
      malformed += 1;
      failed += 1;
      continue;
    }
    try {
      // An upload can receive an ambiguous storage or database response after
      // its object or metadata actually committed. Never delete a key that a
      // live evidence row now owns; resolving the exact pending audit as
      // retained is the safe recovery outcome.
      const liveReference = await db.prepare("SELECT id FROM evidence_document WHERE program_id=? AND r2_key=? LIMIT 1").bind(PROGRAM_ID, payload.r2Key).first<{ id: string }>();
      const outcome = liveReference ? "retained_live_reference" : "object_deleted";
      // R2 deletion is idempotent. If the completion audit write fails after
      // this call, the still-pending obligation can safely be retried.
      if (!liveReference) await bucket.delete(payload.r2Key);
      const result = await db.prepare(`INSERT INTO audit_event
        (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at)
        SELECT ?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_event completed
          WHERE completed.program_id=? AND completed.action='${COMPLETED_ACTION}'
            AND completed.entity_kind='${ENTITY_KIND}' AND json_valid(completed.after_payload)=1
            AND json_extract(completed.after_payload,'$.pendingAuditId')=?
        )`)
        .bind(`audit-${crypto.randomUUID()}`, PROGRAM_ID, actorId, COMPLETED_ACTION, ENTITY_KIND, row.entity_id, JSON.stringify({ pendingAuditId: row.id, operationId: payload.operationId, reason: payload.reason, outcome, liveDocumentId: liveReference?.id || null }), new Date().toISOString(), PROGRAM_ID, row.id)
        .run();
      if (!result.success) throw new Error("The cleanup completion audit was not committed.");
      completed += 1;
    } catch (error) {
      failed += 1;
      console.error("Evidence object cleanup remains queued", { pendingAuditId: row.id, error });
    }
  }
  return { completed, failed, malformed };
}

async function retryEvidenceObjectCleanup(db: Database, bucket: DocumentBucket, actorId: string, limit: number, operationId?: string) {
  const statement = db.prepare(pendingRowsSql(operationId));
  const eligibleAt = new Date().toISOString();
  const result = operationId
    ? await statement.bind(PROGRAM_ID, operationId, eligibleAt, limit).all<PendingCleanupRow>()
    : await statement.bind(PROGRAM_ID, eligibleAt, limit).all<PendingCleanupRow>();
  const processed = await processPendingRows(db, bucket, actorId, result.results);
  return {
    attempted: result.results.length,
    ...processed,
    remaining: await pendingEvidenceObjectCleanupCount(db, operationId),
  } satisfies EvidenceObjectCleanupResult;
}

export async function retryPendingEvidenceObjectCleanup(db: Database, bucket: DocumentBucket, actorId: string, requestedLimit = MAX_EVIDENCE_CLEANUP_RETRY_BATCH) {
  const boundedLimit = Number.isSafeInteger(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, MAX_EVIDENCE_CLEANUP_RETRY_BATCH))
    : MAX_EVIDENCE_CLEANUP_RETRY_BATCH;
  return retryEvidenceObjectCleanup(db, bucket, actorId, boundedLimit);
}

export async function cleanupEvidenceObjectsForWorkspaceOperation(db: Database, bucket: DocumentBucket, actorId: string, operationId: string, expectedMaximum: number) {
  const boundedMaximum = Math.max(0, Math.min(expectedMaximum, MAX_WORKSPACE_CLEANUP_OBJECTS));
  const count = await pendingEvidenceObjectCleanupCount(db, operationId);
  if (count > boundedMaximum) throw new Error("The workspace cleanup queue exceeds the bounded operation envelope.");
  if (!count) return { attempted: 0, completed: 0, failed: 0, malformed: 0, remaining: 0 } satisfies EvidenceObjectCleanupResult;
  return retryEvidenceObjectCleanup(db, bucket, actorId, count, operationId);
}

function queuedItem(item: EvidenceObjectCleanupQueueItem, operationId: string) {
  if (!item.entityId.trim() || !item.reason.trim() || !validR2Key(item.r2Key)
    || item.notBefore !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.notBefore)) throw new Error("An evidence cleanup queue item is malformed.");
  return { ...item, pendingAuditId: `audit-${crypto.randomUUID()}`, operationId } satisfies QueuedCleanupItem;
}

function enqueueStatement(db: Database, actorId: string, operationId: string, item: QueuedCleanupItem, createdAt: string) {
  return db.prepare(`INSERT INTO audit_event
    (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(item.pendingAuditId, PROGRAM_ID, actorId, PENDING_ACTION, ENTITY_KIND, item.entityId, JSON.stringify({ r2Key: item.r2Key, reason: item.reason, operationId, sourceDocumentId: item.sourceDocumentId || null, notBefore: item.notBefore || null }), createdAt);
}

export function evidenceObjectCleanupNotBefore(delayMinutes = 15) {
  const boundedDelay = Number.isSafeInteger(delayMinutes) ? Math.max(1, Math.min(delayMinutes, 60)) : 15;
  return new Date(Date.now() + boundedDelay * 60_000).toISOString();
}

export async function resolveEvidenceObjectCleanupObligations(db: Database, bucket: DocumentBucket, actorId: string, items: readonly QueuedCleanupItem[]) {
  return processPendingRows(db, bucket, actorId, items.map((item) => ({ id: item.pendingAuditId, entity_id: item.entityId, after_payload: JSON.stringify({ r2Key: item.r2Key, reason: item.reason, operationId: item.operationId, notBefore: item.notBefore || null }) })));
}

export function completeEvidenceObjectCleanupOperationStatement(db: Database, actorId: string, operationId: string, createdAt: string, outcome = "retained_live_reference") {
  return db.prepare(`INSERT INTO audit_event
    (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at)
    SELECT 'audit-' || lower(hex(randomblob(16))),pending.program_id,?,'${COMPLETED_ACTION}','${ENTITY_KIND}',pending.entity_id,
      json_object('pendingAuditId',pending.id,'operationId',?,'reason',json_extract(pending.after_payload,'$.reason'),'outcome',?),?
    FROM audit_event pending
    WHERE pending.program_id=? AND pending.action='${PENDING_ACTION}' AND pending.entity_kind='${ENTITY_KIND}'
      AND json_valid(pending.after_payload)=1 AND json_extract(pending.after_payload,'$.operationId')=?
      AND EXISTS (
        SELECT 1 FROM evidence_document live
        WHERE live.program_id=pending.program_id
          AND live.r2_key=json_extract(pending.after_payload,'$.r2Key')
      )
      AND ${unresolvedPredicate("pending")}`)
    .bind(actorId, operationId, outcome, createdAt, PROGRAM_ID, operationId);
}

export async function enqueueEvidenceObjectCleanup(db: Database, actorId: string, operationId: string, items: EvidenceObjectCleanupQueueItem[]): Promise<EvidenceObjectCleanupEnqueueResult> {
  if (items.length > MAX_WORKSPACE_CLEANUP_OBJECTS) throw new Error("The evidence cleanup enqueue set exceeds the workspace limit.");
  const prepared = items.map((item) => queuedItem(item, operationId));
  const queued: QueuedCleanupItem[] = [];
  const failed: EvidenceObjectCleanupQueueItem[] = [];
  const createdAt = new Date().toISOString();
  const chunkSize = 50;
  for (let offset = 0; offset < prepared.length; offset += chunkSize) {
    const chunk = prepared.slice(offset, offset + chunkSize);
    try {
      const results = await db.batch(chunk.map((item) => enqueueStatement(db, actorId, operationId, item, createdAt)));
      if (results.some((result) => !result.success)) throw new Error("One or more cleanup obligations were not committed.");
      queued.push(...chunk);
    } catch (batchError) {
      console.error("Batch enqueue of evidence cleanup obligations failed; retrying individually", { operationId, itemCount: chunk.length, batchError });
      for (const item of chunk) {
        try {
          const result = await enqueueStatement(db, actorId, operationId, item, createdAt).run();
          if (!result.success) throw new Error("The cleanup obligation was not committed.");
          queued.push(item);
        } catch (error) {
          console.error("Evidence cleanup obligation could not be durably queued", { operationId, entityId: item.entityId, error });
          failed.push(item);
        }
      }
    }
  }
  return { queued, failed };
}

export function enqueueReplacedEvidenceCleanupStatement(db: Database, actorId: string, operationId: string, createdAt: string) {
  return db.prepare(`INSERT INTO audit_event
    (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at)
    SELECT 'audit-' || lower(hex(randomblob(16))),d.program_id,?,'${PENDING_ACTION}','${ENTITY_KIND}',d.id,
      json_object('r2Key',d.r2_key,'reason','workspace_replaced','operationId',?,'sourceDocumentId',d.id),?
    FROM evidence_document d
    WHERE d.program_id=?`).bind(actorId, operationId, createdAt, PROGRAM_ID);
}
