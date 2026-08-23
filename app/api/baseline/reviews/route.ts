import { env } from "cloudflare:workers";
import { BASELINE_PROGRAM_ID, BASELINE_WORKSPACE_ID } from "../../../../lib/a2o-baseline-server";
import { ensureActor, requireWriter } from "../../../../lib/governance-server";

const statuses = new Set(["not_reviewed", "reviewed", "follow_up"]);
const clean = (value: unknown) => String(value ?? "").trim();
type ReviewRow = { baseline_occurrence_id: string; status: string; reviewed_at: string | null; note: string | null };

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const result = await env.DB.prepare("SELECT brr.baseline_occurrence_id,brr.status,brr.reviewed_at,brr.note FROM baseline_record_review brr JOIN baseline_occurrence bo ON bo.id=brr.baseline_occurrence_id WHERE bo.workspace_id=?").bind(BASELINE_WORKSPACE_ID).all<ReviewRow>();
    return Response.json({ reviews: Object.fromEntries(result.results.map((row) => [row.baseline_occurrence_id, { status: row.status, reviewedAt: row.reviewed_at, note: row.note }])) });
  } catch (error) { return Response.json({ reviews: {}, error: error instanceof Error ? error.message : "Review history is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    requireWriter(actor);
    const body = await request.json() as { occurrenceId?: unknown; status?: unknown; note?: unknown };
    const occurrenceId = clean(body.occurrenceId); const status = clean(body.status); const note = clean(body.note) || null;
    if (!occurrenceId || !statuses.has(status)) return Response.json({ error: "occurrenceId and a valid review status are required." }, { status: 400 });
    const exists = await env.DB.prepare("SELECT id FROM baseline_occurrence WHERE id=? AND workspace_id=?").bind(occurrenceId, BASELINE_WORKSPACE_ID).first<{ id: string }>();
    if (!exists) return Response.json({ error: "Baseline record was not found." }, { status: 404 });
    const now = new Date().toISOString(); const reviewedAt = status === "not_reviewed" ? null : now;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO baseline_record_review (id,baseline_occurrence_id,program_id,status,reviewed_at,reviewed_by_user_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_occurrence_id) DO UPDATE SET status=excluded.status,reviewed_at=excluded.reviewed_at,reviewed_by_user_id=excluded.reviewed_by_user_id,note=excluded.note,updated_at=excluded.updated_at").bind(crypto.randomUUID(), occurrenceId, BASELINE_PROGRAM_ID, status, reviewedAt, actor.id, note, now, now),
      env.DB.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), BASELINE_PROGRAM_ID, actor.id, "baseline_record_reviewed", "baseline_occurrence", occurrenceId, JSON.stringify({ status, reviewedAt, note }), now),
    ]);
    return Response.json({ key: occurrenceId, review: { status, reviewedAt, note } });
  } catch (error) { const message = error instanceof Error ? error.message : "Review status could not be saved."; return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 500 }); }
}
