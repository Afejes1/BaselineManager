import { env } from "cloudflare:workers";
import { MAX_EVIDENCE_CLEANUP_RETRY_BATCH, retryPendingEvidenceObjectCleanup } from "../../../lib/evidence-cleanup";
import { documentsBucket, ensureActor, requireSteward } from "../../../lib/governance-server";

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    requireSteward(actor);
    const bucket = documentsBucket();
    if (!bucket) return Response.json({ error: "Document storage is unavailable; queued evidence cleanup cannot run." }, { status: 503 });
    let requestedLimit = MAX_EVIDENCE_CLEANUP_RETRY_BATCH;
    if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() === "application/json") {
      const payload = await request.json() as { limit?: unknown };
      if (payload.limit !== undefined && (!Number.isSafeInteger(payload.limit) || Number(payload.limit) < 1)) {
        return Response.json({ error: "Cleanup limit must be a positive integer." }, { status: 400 });
      }
      requestedLimit = Number(payload.limit ?? MAX_EVIDENCE_CLEANUP_RETRY_BATCH);
    }
    const result = await retryPendingEvidenceObjectCleanup(env.DB, bucket, actor.id, requestedLimit);
    const status = result.remaining || result.failed ? 202 : 200;
    return Response.json({ ok: true, limit: Math.min(requestedLimit, MAX_EVIDENCE_CLEANUP_RETRY_BATCH), ...result }, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queued evidence cleanup could not run.";
    return Response.json({ error: message }, { status: /Only a Baseline steward/.test(message) ? 403 : 500 });
  }
}
