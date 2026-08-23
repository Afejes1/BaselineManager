import { env } from "cloudflare:workers";
import { prepareBriefDocx, prepareBriefMarkdown, prepareBriefPdf } from "./brief-export";
import { BRIEF_RENDERER_VERSION, briefPublicationType, briefSourceHash, isCurrentBriefSnapshot, type BriefPublicationFormat } from "./brief-publication";
import { evidenceContentHash, evidenceHashFromAuditPayload, MAX_EVIDENCE_DOCUMENT_BYTES, MAX_GOVERNED_EVIDENCE_BYTES, storedEvidenceIntegrityMatches, validateEvidenceBytes } from "./evidence-validation";
import { documentsBucket, PROGRAM_ID, requireWriter, type Actor, type DocumentBucket } from "./governance-server";
import type { ExecutiveBrief } from "./governance-model";
import { evidenceDocumentReferences } from "./evidence-references";
import { completeEvidenceObjectCleanupOperationStatement, enqueueEvidenceObjectCleanup, evidenceObjectCleanupNotBefore, resolveEvidenceObjectCleanupObligations } from "./evidence-cleanup";

type Database = typeof env.DB;
type BriefPublicationSource = { id: string; initiative_id: string | null; title: string; status: ExecutiveBrief["status"]; notes: string | null; snapshot_payload: string; body_markdown: string; published_at: string | null; created_at: string; updated_at: string };

const hashPattern = /^sha256:[0-9a-f]{64}$/;
const safeName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "Executive-Brief";

function snapshot(value: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; }
  catch { throw new Error("The saved report snapshot is corrupt and cannot be published."); }
  if (!isCurrentBriefSnapshot(parsed)) throw new Error("This legacy report snapshot must be regenerated before publication.");
  return parsed;
}

async function verifyReferencedEvidence(db: Database, bucket: DocumentBucket, markdown: string) {
  let totalBytes = 0;
  for (const documentId of evidenceDocumentReferences(markdown)) {
    const document = await db.prepare(`SELECT d.id,d.file_name,d.content_type,d.byte_size,d.r2_key,d.description,
      (SELECT a.after_payload FROM audit_event a WHERE a.program_id=d.program_id AND a.entity_kind='evidence_document' AND a.entity_id=d.id
       AND a.action IN ('evidence_document_attached','evidence_document_restored','evidence_integrity_sealed') ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS integrity_payload
      FROM evidence_document d WHERE d.id=? AND d.program_id=?`).bind(documentId, PROGRAM_ID).first<{ id: string; file_name: string; content_type: string | null; byte_size: number; r2_key: string; description: string | null; integrity_payload: string | null }>();
    if (!document) throw new Error(`The report references missing evidence document ${documentId}; regenerate the report before publication.`);
    if (document.content_type === "application/octet-stream" && document.description?.startsWith("[QUARANTINED LEGACY EVIDENCE")) throw new Error(`Evidence document ${documentId} is quarantined and cannot support publication.`);
    const auditHash = evidenceHashFromAuditPayload(document.integrity_payload);
    if (!auditHash) throw new Error(`Evidence document ${documentId} is not integrity verified. A steward must validate and seal or reattach it before publication.`);
    if (!Number.isSafeInteger(document.byte_size) || document.byte_size <= 0 || document.byte_size > MAX_EVIDENCE_DOCUMENT_BYTES) throw new Error(`Evidence document ${documentId} has an invalid governed byte count.`);
    totalBytes += document.byte_size;
    if (totalBytes > MAX_GOVERNED_EVIDENCE_BYTES) throw new Error("The report references more than 100 MB of evidence; split the report before publication verification.");
    if (!await storedEvidenceIntegrityMatches(bucket, { fileName: document.file_name, r2Key: document.r2_key, byteSize: document.byte_size, auditPayload: document.integrity_payload })) throw new Error(`Evidence document ${documentId} failed publication-time exact-byte integrity verification.`);
  }
}

export async function persistBriefPublication(input: {
  db: Database;
  bucket?: DocumentBucket;
  actor: Actor;
  briefId: string;
  format: BriefPublicationFormat;
  expectedUpdatedAt: string;
  expectedSourceHash: string;
}) {
  requireWriter(input.actor);
  const bucket = input.bucket || documentsBucket();
  if (!bucket) throw new Error("Document storage is required to publish a durable report artifact.");
  const source = await input.db.prepare("SELECT id,initiative_id,title,status,notes,snapshot_payload,body_markdown,published_at,created_at,updated_at FROM executive_brief WHERE id=? AND program_id=?").bind(input.briefId, PROGRAM_ID).first<BriefPublicationSource>();
  if (!source) throw new Error("The requested report no longer exists.");
  if (source.status !== "reviewed" && source.status !== "published") throw new Error("Review the report before publishing an authoritative artifact.");
  if (!input.expectedUpdatedAt || source.updated_at !== input.expectedUpdatedAt) throw new Error("The report changed after this artifact was prepared. Reload and publish the current version.");
  const sourceSnapshot = snapshot(source.snapshot_payload);
  if (sourceSnapshot.handlingMarking !== "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED") throw new Error("This historical report is under-marked and must be regenerated before publication.");
  const sourceHash = await briefSourceHash({ id: source.id, title: source.title, snapshot: sourceSnapshot, bodyMarkdown: source.body_markdown });
  if (!hashPattern.test(input.expectedSourceHash) || sourceHash !== input.expectedSourceHash.toLowerCase()) throw new Error("The prepared artifact does not match the current frozen report source.");
  await verifyReferencedEvidence(input.db, bucket, source.body_markdown);
  const expectedType = briefPublicationType[input.format];
  const brief: ExecutiveBrief = {
    id: source.id,
    initiativeId: source.initiative_id,
    initiativeTitle: null,
    title: source.title,
    status: source.status,
    notes: source.notes,
    snapshot: sourceSnapshot,
    snapshotValid: true,
    bodyMarkdown: source.body_markdown,
    publications: [],
    publishedAt: source.published_at,
    createdAt: source.created_at,
    updatedAt: source.updated_at,
  };
  const prepared = input.format === "markdown" ? prepareBriefMarkdown(brief) : input.format === "pdf" ? prepareBriefPdf(brief) : await prepareBriefDocx(brief);
  const validated = await validateEvidenceBytes(prepared.fileName, await prepared.blob.arrayBuffer());
  if (validated.contentType !== expectedType.contentType) throw new Error("The report artifact content type does not match its publication format.");
  const contentHash = await evidenceContentHash(validated.bytes);

  const publicationId = `brief-publication-${crypto.randomUUID()}`;
  const documentId = `document-${crypto.randomUUID()}`;
  const at = new Date().toISOString();
  const fileName = `${safeName(source.title)}.${expectedType.extension}`;
  const r2Key = `governance/brief-publications/${input.briefId}/${publicationId}-${fileName}`;
  const uploadOperationId = `brief-publication-upload:${publicationId}`;
  const cleanupQueue = await enqueueEvidenceObjectCleanup(input.db, input.actor.id, uploadOperationId, [{ entityId: documentId, sourceDocumentId: documentId, r2Key, reason: "brief_publication_upload_not_committed", notBefore: evidenceObjectCleanupNotBefore() }]);
  if (cleanupQueue.failed.length || cleanupQueue.queued.length !== 1) throw new Error("The publication cleanup obligation could not be durably queued; artifact storage was not written.");
  try {
    await bucket.put(r2Key, validated.bytes, { httpMetadata: { contentType: validated.contentType, contentDisposition: `attachment; filename="${fileName}"` }, customMetadata: { sha256: contentHash } });
    const results = await input.db.batch([
      input.db.prepare("INSERT INTO evidence_document (id,program_id,governance_record_id,initiative_id,file_name,content_type,byte_size,r2_key,description,uploaded_by_user_id,created_at) SELECT ?,?,NULL,NULL,?,?,?,?,?,?,? FROM executive_brief WHERE id=? AND program_id=? AND updated_at=? AND status IN ('reviewed','published')")
        .bind(documentId, PROGRAM_ID, fileName, validated.contentType, validated.bytes.byteLength, r2Key, `Durable ${input.format.toUpperCase()} publication artifact for ${source.title}.`, input.actor.id, at, input.briefId, PROGRAM_ID, input.expectedUpdatedAt),
      input.db.prepare("INSERT INTO brief_publication (id,brief_id,format,content_hash,byte_size,source_hash,renderer_version,artifact_document_id,snapshot_payload,created_by_user_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? FROM evidence_document WHERE id=?")
        .bind(publicationId, input.briefId, input.format, contentHash, validated.bytes.byteLength, sourceHash, BRIEF_RENDERER_VERSION, documentId, source.snapshot_payload, input.actor.id, at, documentId),
      input.db.prepare("UPDATE executive_brief SET status='published',published_at=COALESCE(published_at,?),updated_at=? WHERE id=? AND program_id=? AND updated_at=? AND status IN ('reviewed','published')")
        .bind(at, at, input.briefId, PROGRAM_ID, input.expectedUpdatedAt),
      input.db.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at) SELECT ?,?,?,?,?,?,?,? FROM brief_publication WHERE id=?")
        .bind(`audit-${crypto.randomUUID()}`, PROGRAM_ID, input.actor.id, "evidence_document_attached", "evidence_document", documentId, JSON.stringify({ purpose: "brief_publication", publicationId, briefId: input.briefId, fileName, contentType: validated.contentType, byteSize: validated.bytes.byteLength, contentHash }), at, publicationId),
      input.db.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at) SELECT ?,?,?,?,?,?,?,? FROM brief_publication WHERE id=?")
        .bind(`audit-${crypto.randomUUID()}`, PROGRAM_ID, input.actor.id, "executive_brief_published", "executive_brief", input.briefId, JSON.stringify({ publicationId, artifactDocumentId: documentId, format: input.format, contentHash, byteSize: validated.bytes.byteLength, sourceHash, rendererVersion: BRIEF_RENDERER_VERSION }), at, publicationId),
      completeEvidenceObjectCleanupOperationStatement(input.db, input.actor.id, uploadOperationId, at),
    ]);
    if (results.some((result) => !result?.success) || [0, 1, 2, 3, 4, 5].some((index) => Number(results[index]?.meta?.changes || 0) !== 1)) throw new Error("The report changed while its publication was being recorded.");
  } catch (error) {
    const cleanup = await resolveEvidenceObjectCleanupObligations(input.db, bucket, input.actor.id, cleanupQueue.queued);
    if (cleanup.failed) console.error("Brief publication failed with exact artifact cleanup still queued", { publicationId, pendingAuditId: cleanupQueue.queued[0].pendingAuditId, cleanup });
    throw error;
  }
  return { publicationId, documentId, fileName, contentType: validated.contentType, contentHash, byteSize: validated.bytes.byteLength, sourceHash, rendererVersion: BRIEF_RENDERER_VERSION, bytes: validated.bytes };
}
