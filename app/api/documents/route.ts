import { env } from "cloudflare:workers";
import { audit, documentsBucket, ensureActor, PROGRAM_ID, requireWriter } from "../../../lib/governance-server";
import { EvidenceValidationError, MAX_EVIDENCE_DOCUMENT_BYTES, validateEvidenceFile } from "../../../lib/evidence-validation";

const safeFileName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "evidence-file";

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    requireWriter(actor);
    const bucket = documentsBucket();
    if (!bucket) return Response.json({ error: "Document storage is not available in this environment yet." }, { status: 503 });
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
    const documentId = `document-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const r2Key = `governance/${governanceRecordId || initiativeId}/${documentId}-${safeFileName(file.name)}`;
    await bucket.put(r2Key, validated.bytes, { httpMetadata: { contentType: validated.contentType, contentDisposition: `attachment; filename="${safeFileName(file.name)}"` } });
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO evidence_document (id,program_id,governance_record_id,initiative_id,file_name,content_type,byte_size,r2_key,description,uploaded_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(documentId, PROGRAM_ID, governanceRecordId, initiativeId, file.name, validated.contentType, file.size, r2Key, typeof form.get("description") === "string" ? String(form.get("description")).trim().slice(0, 1000) || null : null, actor.id, createdAt),
        audit(env.DB, actor, "evidence_document_attached", "evidence_document", documentId, { governanceRecordId, initiativeId, fileName: file.name, contentType: validated.contentType, byteSize: file.size }),
      ]);
    } catch (error) {
      await bucket.delete(r2Key);
      throw error;
    }
    return Response.json({ id: documentId, fileName: file.name }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The evidence document could not be attached.";
    return Response.json({ error: message }, { status: error instanceof EvidenceValidationError ? 400 : message.includes("viewer") ? 403 : 500 });
  }
}

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const documentId = new URL(request.url).searchParams.get("id") || "";
    const document = await env.DB.prepare("SELECT file_name,content_type,r2_key FROM evidence_document WHERE id=? AND program_id=?").bind(documentId, PROGRAM_ID).first<{ file_name: string; content_type: string | null; r2_key: string }>();
    if (!document) return Response.json({ error: "Evidence document not found." }, { status: 404 });
    const bucket = documentsBucket();
    if (!bucket) return Response.json({ error: "Document storage is not available in this environment yet." }, { status: 503 });
    const object = await bucket.get(document.r2_key);
    if (!object) return Response.json({ error: "The stored evidence document could not be found." }, { status: 404 });
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || document.content_type || "application/octet-stream", "content-disposition": object.httpMetadata?.contentDisposition || `attachment; filename="${safeFileName(document.file_name)}"`, "cache-control": "private, no-store", "content-security-policy": "sandbox", "x-content-type-options": "nosniff" } });
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
    const referencedSignoff = await env.DB.prepare("SELECT id FROM acceptance_signoff WHERE evidence_document_id=? LIMIT 1").bind(documentId).first<{ id: string }>();
    if (referencedSignoff) return Response.json({ error: "This document supports an acceptance sign-off. Update that sign-off before removing the evidence." }, { status: 409 });
    const bucket = documentsBucket();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM evidence_document WHERE id=? AND program_id=?").bind(documentId, PROGRAM_ID),
      audit(env.DB, actor, "evidence_document_removed", "evidence_document", documentId, { rationale }, document),
    ]);
    if (bucket && typeof document.r2_key === "string") await bucket.delete(document.r2_key);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The evidence document could not be removed." }, { status: 500 });
  }
}
