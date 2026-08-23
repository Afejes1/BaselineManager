import { env } from "cloudflare:workers";
import { BRIEF_RENDERER_VERSION, briefPublicationType, briefSourceHash, isBriefPublicationFormat, isCurrentBriefSnapshot } from "../../../lib/brief-publication";
import { persistBriefPublication } from "../../../lib/brief-publication-server";
import { evidenceContentHash, MAX_EVIDENCE_DOCUMENT_BYTES, readBoundedObjectBytes, validateEvidenceBytes } from "../../../lib/evidence-validation";
import type { BriefSnapshot } from "../../../lib/governance-model";
import { documentsBucket, ensureActor, PROGRAM_ID } from "../../../lib/governance-server";

const safeName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "Executive-Brief";

function errorStatus(message: string) {
  if (/Authentication is required|loopback requests only/.test(message)) return 401;
  if (/viewer/.test(message)) return 403;
  if (/changed|Review the report|integrity|match the current/.test(message)) return 409;
  if (/storage is required/.test(message)) return 503;
  return 400;
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const briefId = String(body.briefId || "").trim();
    const format = String(body.format || "").trim();
    if (!briefId || !isBriefPublicationFormat(format)) return Response.json({ error: "A report and supported publication format are required." }, { status: 400 });
    const result = await persistBriefPublication({
      db: env.DB,
      bucket: documentsBucket(),
      actor,
      briefId,
      format,
      expectedUpdatedAt: String(body.expectedUpdatedAt || ""),
      expectedSourceHash: String(body.expectedSourceHash || ""),
    });
    return new Response(result.bytes, { status: 201, headers: {
      "content-type": result.contentType,
      "content-disposition": `attachment; filename="${safeName(result.fileName)}"`,
      "content-length": String(result.byteSize),
      "cache-control": "private, no-store",
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
      "x-brief-publication-id": result.publicationId,
      "x-artifact-content-sha256": result.contentHash,
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The report artifact could not be published.";
    return Response.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const publicationId = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!publicationId) return Response.json({ error: "A publication identifier is required." }, { status: 400 });
    const publication = await env.DB.prepare(`
      SELECT p.format,p.content_hash,p.byte_size,p.source_hash,p.renderer_version,p.snapshot_payload,p.artifact_document_id,
             b.id AS brief_id,b.title,b.snapshot_payload AS brief_snapshot_payload,b.body_markdown,
             d.file_name,d.content_type,d.r2_key,d.description
      FROM brief_publication p
      JOIN executive_brief b ON b.id=p.brief_id
      LEFT JOIN evidence_document d ON d.id=p.artifact_document_id
      WHERE p.id=? AND b.program_id=?
    `).bind(publicationId, PROGRAM_ID).first<{ format: string; content_hash: string; byte_size: number; source_hash: string; renderer_version: string; snapshot_payload: string; artifact_document_id: string | null; brief_id: string; title: string; brief_snapshot_payload: string; body_markdown: string; file_name: string | null; content_type: string | null; r2_key: string | null; description: string | null }>();
    if (!publication) return Response.json({ error: "The publication was not found." }, { status: 404 });
    if (!publication.r2_key || !publication.file_name) return Response.json({ error: "This legacy publication recorded only a client hash; no durable artifact is available." }, { status: 409 });
    if (publication.content_type === "application/octet-stream" && publication.description?.startsWith("[QUARANTINED LEGACY EVIDENCE")) {
      return Response.json({ error: "This publication artifact is quarantined and cannot be opened through the application." }, { status: 423 });
    }
    if (!isBriefPublicationFormat(publication.format) || publication.renderer_version !== BRIEF_RENDERER_VERSION || !publication.artifact_document_id) return Response.json({ error: "This publication does not have supported durable renderer provenance." }, { status: 409 });
    let publicationSnapshot: BriefSnapshot;
    let currentSnapshot: BriefSnapshot;
    try {
      publicationSnapshot = JSON.parse(publication.snapshot_payload) as BriefSnapshot;
      currentSnapshot = JSON.parse(publication.brief_snapshot_payload) as BriefSnapshot;
    } catch { return Response.json({ error: "The publication source snapshot is corrupt." }, { status: 409 }); }
    if (!isCurrentBriefSnapshot(publicationSnapshot) || !isCurrentBriefSnapshot(currentSnapshot)) return Response.json({ error: "This legacy report snapshot must be regenerated before its artifact can be opened or republished." }, { status: 409 });
    if (publicationSnapshot.handlingMarking !== "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED" || currentSnapshot.handlingMarking !== "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED") return Response.json({ error: "This historical report is under-marked and must be regenerated before distribution." }, { status: 409 });
    const [currentSourceHash, publicationSnapshotHash] = await Promise.all([
      briefSourceHash({ id: publication.brief_id, title: publication.title, snapshot: currentSnapshot, bodyMarkdown: publication.body_markdown }),
      briefSourceHash({ id: publication.brief_id, title: publication.title, snapshot: publicationSnapshot, bodyMarkdown: publication.body_markdown }),
    ]);
    if (publication.source_hash.toLowerCase() !== currentSourceHash || publication.source_hash.toLowerCase() !== publicationSnapshotHash) return Response.json({ error: "The durable artifact no longer matches its frozen report source attestation." }, { status: 409 });
    const bucket = documentsBucket();
    if (!bucket) return Response.json({ error: "Document storage is unavailable." }, { status: 503 });
    const object = await bucket.get(publication.r2_key);
    if (!object) return Response.json({ error: "The stored publication artifact is missing." }, { status: 404 });
    if (!Number.isSafeInteger(publication.byte_size) || publication.byte_size <= 0 || publication.byte_size > MAX_EVIDENCE_DOCUMENT_BYTES) {
      await object.body.cancel().catch(() => undefined);
      return Response.json({ error: "The publication has an invalid governed byte count." }, { status: 409 });
    }
    let bytes: ArrayBuffer;
    try { bytes = await readBoundedObjectBytes(object, { maxBytes: publication.byte_size, expectedBytes: publication.byte_size, label: "Stored publication" }); }
    catch { return Response.json({ error: "The stored publication conflicts with its governed byte count." }, { status: 409 }); }
    let validated: Awaited<ReturnType<typeof validateEvidenceBytes>>;
    try { validated = await validateEvidenceBytes(publication.file_name, bytes); }
    catch { return Response.json({ error: "The stored publication no longer satisfies the current artifact policy." }, { status: 423 }); }
    const actualHash = await evidenceContentHash(bytes);
    const metadataHash = object.customMetadata?.sha256?.toLowerCase() || null;
    if (actualHash !== publication.content_hash.toLowerCase() || metadataHash !== actualHash) {
      console.error("Brief publication integrity verification failed", { publicationId, actualHash, metadataHash, recordedHash: publication.content_hash, recordedBytes: publication.byte_size, actualBytes: bytes.byteLength });
      return Response.json({ error: "The stored publication failed its integrity check and was not downloaded." }, { status: 409 });
    }
    if (validated.contentType !== briefPublicationType[publication.format].contentType || publication.content_type !== validated.contentType) return Response.json({ error: "The stored publication content type does not match its attested format." }, { status: 409 });
    return new Response(bytes, { headers: {
      "content-type": validated.contentType,
      "content-disposition": `attachment; filename="${safeName(publication.file_name)}"`,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
      "x-artifact-content-sha256": actualHash,
      "x-brief-source-sha256": currentSourceHash,
      "x-brief-publication-id": publicationId,
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The publication artifact could not be downloaded.";
    return Response.json({ error: message }, { status: errorStatus(message) });
  }
}
