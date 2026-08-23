import { env } from "cloudflare:workers";
import { audit, documentsBucket, ensureActor, PROGRAM_ID, requireSteward, requireWriter } from "../../../lib/governance-server";
import { EvidenceValidationError, evidenceContentHash, evidenceHashFromAuditPayload, MAX_EVIDENCE_DOCUMENT_BYTES, readBoundedObjectBytes, validateEvidenceBytes, validateEvidenceFile } from "../../../lib/evidence-validation";
import { evidenceDocumentHref, evidenceDocumentReferences } from "../../../lib/evidence-references";
import { completeEvidenceObjectCleanupOperationStatement, enqueueEvidenceObjectCleanup, evidenceObjectCleanupNotBefore, resolveEvidenceObjectCleanupObligations } from "../../../lib/evidence-cleanup";

const safeFileName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "evidence-file";

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    requireWriter(actor);
    const bucket = documentsBucket();
    if (!bucket) return Response.json({ error: "Document storage is not available in this environment yet." }, { status: 503 });
    if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() === "application/json") {
      requireSteward(actor);
      const payload = await request.json() as { action?: unknown; id?: unknown };
      if (payload.action !== "seal_integrity") return Response.json({ error: "The requested evidence operation is not supported." }, { status: 400 });
      const documentId = typeof payload.id === "string" ? payload.id.trim() : "";
      if (!documentId) return Response.json({ error: "An evidence document is required." }, { status: 400 });
      const document = await env.DB.prepare("SELECT id,file_name,content_type,byte_size,r2_key,description FROM evidence_document WHERE id=? AND program_id=?").bind(documentId, PROGRAM_ID).first<{ id: string; file_name: string; content_type: string | null; byte_size: number; r2_key: string; description: string | null }>();
      if (!document) return Response.json({ error: "Evidence document not found." }, { status: 404 });
      if (document.content_type === "application/octet-stream" && document.description?.startsWith("[QUARANTINED LEGACY EVIDENCE")) return Response.json({ error: "Quarantined legacy evidence must be remediated through the approved offline recovery process; it cannot be sealed in place." }, { status: 423 });
      const [object, integrityAudit] = await Promise.all([
        bucket.get(document.r2_key),
        env.DB.prepare("SELECT after_payload FROM audit_event WHERE program_id=? AND entity_kind='evidence_document' AND entity_id=? AND action IN ('evidence_document_attached','evidence_document_restored','evidence_integrity_sealed') ORDER BY created_at DESC,id DESC LIMIT 1").bind(PROGRAM_ID, documentId).first<{ after_payload: string | null }>(),
      ]);
      if (!object) return Response.json({ error: "The stored evidence document could not be found." }, { status: 404 });
      if (!Number.isSafeInteger(document.byte_size) || document.byte_size <= 0 || document.byte_size > MAX_EVIDENCE_DOCUMENT_BYTES) {
        await object.body.cancel().catch(() => undefined);
        return Response.json({ error: "The governed evidence byte count is invalid. Restore or reattach the source instead of sealing it." }, { status: 409 });
      }
      let bytes: ArrayBuffer;
      try { bytes = await readBoundedObjectBytes(object, { maxBytes: document.byte_size, expectedBytes: document.byte_size, label: "Stored evidence" }); }
      catch { return Response.json({ error: "The stored evidence byte count does not match its database record. Restore or reattach the source instead of sealing it." }, { status: 409 }); }
      const validated = await validateEvidenceBytes(document.file_name, bytes);
      const contentHash = await evidenceContentHash(validated.bytes);
      const existingAuditHash = evidenceHashFromAuditPayload(integrityAudit?.after_payload);
      const existingMetadataHash = object.customMetadata?.sha256?.toLowerCase() || null;
      if (existingAuditHash && existingAuditHash !== contentHash || existingMetadataHash && existingMetadataHash !== contentHash) {
        console.error("Evidence sealing rejected an existing integrity mismatch", { documentId, existingAuditHash, existingMetadataHash, contentHash });
        return Response.json({ error: "The stored evidence conflicts with an existing integrity record. Use offline recovery rather than replacing its trust history." }, { status: 409 });
      }
      const originalOptions = { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata };
      await bucket.put(document.r2_key, validated.bytes, { httpMetadata: { contentType: validated.contentType, contentDisposition: `attachment; filename="${safeFileName(document.file_name)}"` }, customMetadata: { ...(object.customMetadata || {}), sha256: contentHash } });
      try {
        const results = await env.DB.batch([
          env.DB.prepare("UPDATE evidence_document SET content_type=? WHERE id=? AND program_id=?").bind(validated.contentType, documentId, PROGRAM_ID),
          audit(env.DB, actor, "evidence_integrity_sealed", "evidence_document", documentId, { fileName: document.file_name, contentType: validated.contentType, byteSize: bytes.byteLength, contentHash, validationPolicy: "hardened-evidence-v1" }, document),
        ]);
        if (!results[0]?.success || Number(results[0]?.meta?.changes || 0) !== 1 || !results[1]?.success) throw new Error("The evidence integrity seal could not be committed.");
      } catch (error) {
        try { await bucket.put(document.r2_key, validated.bytes, originalOptions); }
        catch (rollbackError) { console.error("Evidence metadata rollback failed after sealing error", { documentId, rollbackError }); }
        throw error;
      }
      return Response.json({ ok: true, id: documentId, contentHash });
    }
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_EVIDENCE_DOCUMENT_BYTES + 64 * 1024) return Response.json({ error: "Evidence uploads are limited to 10 MB plus multipart metadata." }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return Response.json({ error: "Choose a non-empty document to attach." }, { status: 400 });
    if (file.size > MAX_EVIDENCE_DOCUMENT_BYTES) return Response.json({ error: "Evidence documents are limited to 10 MB." }, { status: 413 });
    const governanceRecordId = typeof form.get("governanceRecordId") === "string" ? String(form.get("governanceRecordId")).trim() || null : null;
    const initiativeId = typeof form.get("initiativeId") === "string" ? String(form.get("initiativeId")).trim() || null : null;
    if (!governanceRecordId && !initiativeId) return Response.json({ error: "Attach the document to a governance record or initiative." }, { status: 400 });
    if (governanceRecordId) {
      const record = await env.DB.prepare("SELECT id FROM governance_record WHERE id=? AND program_id=?").bind(governanceRecordId, PROGRAM_ID).first<{ id: string }>();
      if (!record) return Response.json({ error: "The selected governance record is unavailable." }, { status: 404 });
    }
    if (initiativeId) {
      const initiative = await env.DB.prepare("SELECT id FROM initiative WHERE id=? AND program_id=?").bind(initiativeId, PROGRAM_ID).first<{ id: string }>();
      if (!initiative) return Response.json({ error: "The selected Initiative is unavailable." }, { status: 404 });
    }
    const validated = await validateEvidenceFile(file);
    const contentHash = await evidenceContentHash(validated.bytes);
    const documentId = `document-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const r2Key = `governance/${governanceRecordId || initiativeId}/${documentId}-${safeFileName(file.name)}`;
    const uploadOperationId = `evidence-upload:${documentId}`;
    const cleanupQueue = await enqueueEvidenceObjectCleanup(env.DB, actor.id, uploadOperationId, [{ entityId: documentId, sourceDocumentId: documentId, r2Key, reason: "evidence_upload_not_committed", notBefore: evidenceObjectCleanupNotBefore() }]);
    if (cleanupQueue.failed.length || cleanupQueue.queued.length !== 1) throw new Error("The evidence upload cleanup obligation could not be durably queued; storage was not written.");
    try {
      await bucket.put(r2Key, validated.bytes, { httpMetadata: { contentType: validated.contentType, contentDisposition: `attachment; filename="${safeFileName(file.name)}"` }, customMetadata: { sha256: contentHash } });
      const results = await env.DB.batch([
        env.DB.prepare("INSERT INTO evidence_document (id,program_id,governance_record_id,initiative_id,file_name,content_type,byte_size,r2_key,description,uploaded_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(documentId, PROGRAM_ID, governanceRecordId, initiativeId, file.name, validated.contentType, file.size, r2Key, typeof form.get("description") === "string" ? String(form.get("description")).trim().slice(0, 1000) || null : null, actor.id, createdAt),
        audit(env.DB, actor, "evidence_document_attached", "evidence_document", documentId, { governanceRecordId, initiativeId, fileName: file.name, contentType: validated.contentType, byteSize: file.size, contentHash }),
        completeEvidenceObjectCleanupOperationStatement(env.DB, actor.id, uploadOperationId, createdAt),
      ]);
      if (results.some((result) => !result?.success) || [0, 1, 2].some((index) => Number(results[index]?.meta?.changes || 0) !== 1)) throw new Error("The evidence upload metadata and cleanup completion did not commit atomically.");
    } catch (error) {
      const cleanup = await resolveEvidenceObjectCleanupObligations(env.DB, bucket, actor.id, cleanupQueue.queued);
      if (cleanup.failed) console.error("Evidence upload failed with exact object cleanup still queued", { documentId, pendingAuditId: cleanupQueue.queued[0].pendingAuditId, cleanup });
      throw error;
    }
    return Response.json({ id: documentId, fileName: file.name }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The evidence document could not be attached.";
    return Response.json({ error: message }, { status: error instanceof EvidenceValidationError ? 400 : /viewer|Only a Baseline steward/.test(message) ? 403 : 500 });
  }
}

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const documentId = new URL(request.url).searchParams.get("id") || "";
    const document = await env.DB.prepare(`SELECT d.file_name,d.content_type,d.byte_size,d.r2_key,d.description,p.id AS publication_id
      FROM evidence_document d LEFT JOIN brief_publication p ON p.artifact_document_id=d.id
      WHERE d.id=? AND d.program_id=? LIMIT 1`).bind(documentId, PROGRAM_ID).first<{ file_name: string; content_type: string | null; byte_size: number; r2_key: string; description: string | null; publication_id: string | null }>();
    if (!document) return Response.json({ error: "Evidence document not found." }, { status: 404 });
    if (document.publication_id) return Response.json({ error: "Governed publication artifacts must be opened through their attested publication record." }, { status: 409 });
    if (document.content_type === "application/octet-stream" && document.description?.startsWith("[QUARANTINED LEGACY EVIDENCE")) {
      return Response.json({ error: "This legacy file is quarantined and cannot be opened through the application. Use the approved offline recovery and content-inspection process." }, { status: 423 });
    }
    const bucket = documentsBucket();
    if (!bucket) return Response.json({ error: "Document storage is not available in this environment yet." }, { status: 503 });
    const [object, integrityAudit] = await Promise.all([
      bucket.get(document.r2_key),
      env.DB.prepare("SELECT after_payload FROM audit_event WHERE program_id=? AND entity_kind='evidence_document' AND entity_id=? AND action IN ('evidence_document_attached','evidence_document_restored','evidence_integrity_sealed') ORDER BY created_at DESC,id DESC LIMIT 1").bind(PROGRAM_ID, documentId).first<{ after_payload: string | null }>(),
    ]);
    if (!object) return Response.json({ error: "The stored evidence document could not be found." }, { status: 404 });
    if (!Number.isSafeInteger(document.byte_size) || document.byte_size <= 0 || document.byte_size > MAX_EVIDENCE_DOCUMENT_BYTES) {
      await object.body.cancel().catch(() => undefined);
      return Response.json({ error: "The governed evidence byte count is invalid and was not downloaded." }, { status: 409 });
    }
    let bytes: ArrayBuffer;
    try { bytes = await readBoundedObjectBytes(object, { maxBytes: document.byte_size, expectedBytes: document.byte_size, label: "Stored evidence" }); }
    catch { return Response.json({ error: "The stored evidence byte count does not match its governed database record and was not downloaded." }, { status: 409 }); }
    let validated: Awaited<ReturnType<typeof validateEvidenceBytes>>;
    try { validated = await validateEvidenceBytes(document.file_name, bytes); }
    catch (error) {
      console.error("Evidence download rejected bytes outside the current validation policy", { documentId, error });
      return Response.json({ error: "This evidence no longer satisfies the current safe-content policy. A Baseline steward must use the approved offline recovery process." }, { status: 423 });
    }
    const actualHash = await evidenceContentHash(bytes);
    const auditHash = evidenceHashFromAuditPayload(integrityAudit?.after_payload);
    const metadataHash = object.customMetadata?.sha256?.toLowerCase() || null;
    if (!auditHash || !metadataHash || auditHash !== metadataHash || auditHash !== actualHash || metadataHash !== actualHash) {
      console.error("Evidence integrity verification failed", { documentId, auditHash, metadataHash, actualHash });
      return Response.json({ error: "The stored evidence is unsealed or failed its exact SHA-256 integrity check and was not downloaded. A Baseline steward must validate and seal or reattach it." }, { status: 409 });
    }
    if (document.content_type && document.content_type !== validated.contentType) return Response.json({ error: "The evidence content type conflicts with its current validated bytes and was not downloaded." }, { status: 409 });
    return new Response(bytes, { headers: { "content-type": validated.contentType, "content-disposition": `attachment; filename="${safeFileName(document.file_name)}"`, "content-length": String(bytes.byteLength), "cache-control": "private, no-store", "content-security-policy": "sandbox", "x-content-type-options": "nosniff", "x-evidence-content-sha256": actualHash, "x-evidence-integrity": "verified" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The evidence document could not be opened." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    requireWriter(actor);
    const payload = await request.json() as { id?: string; rationale?: string };
    const documentId = String(payload.id || "").trim();
    const rationale = String(payload.rationale || "").trim();
    if (!documentId || !rationale) return Response.json({ error: "Document and removal rationale are required." }, { status: 400 });
    const document = await env.DB.prepare("SELECT * FROM evidence_document WHERE id=? AND program_id=?").bind(documentId, PROGRAM_ID).first<Record<string, unknown>>();
    if (!document) return Response.json({ error: "Evidence document not found." }, { status: 404 });
    // Capture the audit revision before reading frozen provenance. Every
    // supported report/import mutation writes its audit event atomically with
    // the source change. The conditional DELETE below therefore fails closed
    // if any mutation races this preflight, including a legacy non-canonical
    // percent-encoded reference.
    const auditRevision = await env.DB.prepare("SELECT COUNT(*) AS row_count,COALESCE(MAX(rowid),0) AS max_rowid FROM audit_event WHERE program_id=?").bind(PROGRAM_ID).first<{ row_count: number; max_rowid: number }>();
    if (!auditRevision || !Number.isSafeInteger(Number(auditRevision.row_count)) || !Number.isSafeInteger(Number(auditRevision.max_rowid))) return Response.json({ error: "The governed audit revision could not be established; evidence was not removed." }, { status: 409 });
    const [referencedSignoff, referencedPublication, candidateBriefStats] = await Promise.all([
      env.DB.prepare("SELECT id FROM acceptance_signoff WHERE evidence_document_id=? LIMIT 1").bind(documentId).first<{ id: string }>(),
      env.DB.prepare("SELECT id FROM brief_publication WHERE artifact_document_id=? LIMIT 1").bind(documentId).first<{ id: string }>(),
      env.DB.prepare("SELECT COUNT(*) AS row_count,COALESCE(SUM(length(CAST(body_markdown AS BLOB))),0) AS byte_count FROM executive_brief WHERE instr(body_markdown,'/api/documents?') > 0").first<{ row_count: number; byte_count: number }>(),
    ]);
    const candidateBriefCount = Number(candidateBriefStats?.row_count);
    const candidateBriefBytes = Number(candidateBriefStats?.byte_count);
    if (!candidateBriefStats || !Number.isSafeInteger(candidateBriefCount) || candidateBriefCount < 0 || candidateBriefCount > 5000
      || !Number.isSafeInteger(candidateBriefBytes) || candidateBriefBytes < 0 || candidateBriefBytes > 10 * 1024 * 1024) {
      return Response.json({ error: "The saved-report evidence index exceeds the bounded deletion review. Archive or reconcile reports before removing evidence." }, { status: 409 });
    }
    const candidateBriefs = await env.DB.prepare("SELECT id,body_markdown FROM executive_brief WHERE instr(body_markdown,'/api/documents?') > 0 ORDER BY created_at DESC LIMIT 5000").all<{ id: string; body_markdown: string }>();
    let referencedBrief: { id: string } | undefined;
    try { referencedBrief = candidateBriefs.results.find((brief) => evidenceDocumentReferences(brief.body_markdown, 5000).includes(documentId)); }
    catch { return Response.json({ error: "A saved report contains malformed or excessive evidence references. Repair that frozen provenance before removing any evidence." }, { status: 409 }); }
    if (referencedSignoff) return Response.json({ error: "This document supports an acceptance sign-off. Update that sign-off before removing the evidence." }, { status: 409 });
    if (referencedPublication) return Response.json({ error: "This document is a retained publication artifact and cannot be removed independently." }, { status: 409 });
    if (referencedBrief) return Response.json({ error: "This document is frozen into a saved report. Supersede the report and retain its evidence chain." }, { status: 409 });
    const bucket = documentsBucket();
    if (!bucket) return Response.json({ error: "Document storage is unavailable; evidence metadata was not removed." }, { status: 503 });
    const removedAt = new Date().toISOString();
    const removalAuditId = `audit-${crypto.randomUUID()}`;
    const cleanupAuditId = `audit-${crypto.randomUUID()}`;
    const results = await env.DB.batch([
      env.DB.prepare(`DELETE FROM evidence_document
        WHERE id=? AND program_id=?
          AND NOT EXISTS (SELECT 1 FROM acceptance_signoff WHERE evidence_document_id=?)
          AND NOT EXISTS (SELECT 1 FROM brief_publication WHERE artifact_document_id=?)
          AND NOT EXISTS (
            SELECT 1 FROM executive_brief
            WHERE instr(body_markdown,?) > 0 OR instr(body_markdown,?) > 0
          )
          AND (SELECT COUNT(*) FROM executive_brief WHERE instr(body_markdown,'/api/documents?') > 0)=?
          AND COALESCE((SELECT SUM(length(CAST(body_markdown AS BLOB))) FROM executive_brief WHERE instr(body_markdown,'/api/documents?') > 0),0)=?
          AND (SELECT COUNT(*) FROM audit_event WHERE program_id=?)=?
          AND COALESCE((SELECT MAX(rowid) FROM audit_event WHERE program_id=?),0)=?`).bind(documentId, PROGRAM_ID, documentId, documentId, evidenceDocumentHref(documentId), `/api/documents?id=${encodeURIComponent(documentId)}`, candidateBriefCount, candidateBriefBytes, PROGRAM_ID, Number(auditRevision.row_count), PROGRAM_ID, Number(auditRevision.max_rowid)),
      env.DB.prepare(`INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,before_payload,after_payload,created_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1`).bind(removalAuditId, PROGRAM_ID, actor.id, "evidence_document_removed", "evidence_document", documentId, JSON.stringify(document), JSON.stringify({ rationale }), removedAt),
      env.DB.prepare(`INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at)
        SELECT ?,?,?,?,?,?,?,? FROM audit_event WHERE id=?`).bind(cleanupAuditId, PROGRAM_ID, actor.id, "evidence_object_cleanup_pending", "evidence_object", documentId, JSON.stringify({ r2Key: document.r2_key, removalAuditId }), removedAt, removalAuditId),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1 || Number(results[2]?.meta?.changes || 0) !== 1) {
      return Response.json({ error: "This document became referenced by a sign-off or frozen report while removal was in progress. Review the latest evidence chain and try again." }, { status: 409 });
    }
    try {
      if (typeof document.r2_key !== "string" || !document.r2_key) throw new Error("The evidence object key is missing.");
      try { await bucket.delete(document.r2_key); }
      catch { await bucket.delete(document.r2_key); }
      const completion = await env.DB.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(`audit-${crypto.randomUUID()}`, PROGRAM_ID, actor.id, "evidence_object_cleanup_completed", "evidence_object", documentId, JSON.stringify({ pendingAuditId: cleanupAuditId }), new Date().toISOString()).run();
      if (!completion.success || Number(completion.meta?.changes || 0) !== 1) throw new Error("The evidence object cleanup completion audit was not committed.");
    } catch (cleanupError) {
      console.error("Evidence metadata removed; object cleanup remains pending", { documentId, cleanupAuditId, cleanupError });
      return Response.json({ ok: true, cleanupPending: true, warning: "Evidence metadata was removed, but storage cleanup is pending and durably recorded for operator follow-up." }, { status: 202 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The evidence document could not be removed." }, { status: 500 });
  }
}
