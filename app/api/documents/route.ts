import { env } from "cloudflare:workers";
import { audit, documentsBucket, ensureActor, PROGRAM_ID, requireWriter } from "../../../lib/governance-server";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const safeFileName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "evidence-file";

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    requireWriter(actor);
    const bucket = documentsBucket();
    if (!bucket) return Response.json({ error: "Document storage is not available in this environment yet." }, { status: 503 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return Response.json({ error: "Choose a non-empty document to attach." }, { status: 400 });
    if (file.size > MAX_DOCUMENT_BYTES) return Response.json({ error: "Evidence documents are limited to 25 MB." }, { status: 413 });
    const governanceRecordId = typeof form.get("governanceRecordId") === "string" ? String(form.get("governanceRecordId")).trim() || null : null;
    const initiativeId = typeof form.get("initiativeId") === "string" ? String(form.get("initiativeId")).trim() || null : null;
    if (!governanceRecordId && !initiativeId) return Response.json({ error: "Attach the document to a governance record or initiative." }, { status: 400 });
    const documentId = `document-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const r2Key = `governance/${governanceRecordId || initiativeId}/${documentId}-${safeFileName(file.name)}`;
    await bucket.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream", contentDisposition: `attachment; filename=\"${safeFileName(file.name)}\"` } });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO evidence_document (id,program_id,governance_record_id,initiative_id,file_name,content_type,byte_size,r2_key,description,uploaded_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(documentId, PROGRAM_ID, governanceRecordId, initiativeId, file.name, file.type || null, file.size, r2Key, typeof form.get("description") === "string" ? String(form.get("description")).trim() || null : null, actor.id, createdAt),
      audit(env.DB, actor, "evidence_document_attached", "evidence_document", documentId, { governanceRecordId, initiativeId, fileName: file.name, byteSize: file.size }),
    ]);
    return Response.json({ id: documentId, fileName: file.name }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The evidence document could not be attached." }, { status: 500 });
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
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || document.content_type || "application/octet-stream", "content-disposition": object.httpMetadata?.contentDisposition || `attachment; filename=\"${safeFileName(document.file_name)}\"` } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The evidence document could not be opened." }, { status: 500 });
  }
}
