import { env } from "cloudflare:workers";

const programId = "program-jsf";
const statuses = new Set(["not_reviewed", "reviewed", "follow_up"]);
const clean = (value: unknown) => String(value ?? "").trim();
type ReviewRow = { source_row_id:string; status:string; reviewed_at:string|null; note:string|null };

export async function GET() {
  try {
    const result = await env.DB.prepare("SELECT source_row_id, status, reviewed_at, note FROM source_occurrence_review_v2 WHERE program_id = ?").bind(programId).all<ReviewRow>();
    return Response.json({ reviews:Object.fromEntries(result.results.map((row) => [row.source_row_id, { status:row.status, reviewedAt:row.reviewed_at, note:row.note }])) });
  } catch (error) {
    return Response.json({ reviews:{}, error:error instanceof Error ? error.message : "Review history is unavailable." }, { status:500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sourceRowId?:unknown; status?:unknown; note?:unknown };
    const sourceRowId = clean(body.sourceRowId);
    const status = clean(body.status);
    const note = clean(body.note) || null;
    if (!sourceRowId || !statuses.has(status)) return Response.json({ error:"sourceRowId and a valid review status are required." }, { status:400 });
    const now = new Date().toISOString();
    const reviewedAt = status === "not_reviewed" ? null : now;
    const id = `review:${sourceRowId}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(programId,"Joint Strike Fighter","F-35 technical baseline program","America/New_York",now,now),
      env.DB.prepare("INSERT INTO source_occurrence_review_v2 (id,program_id,source_row_id,status,reviewed_at,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(source_row_id) DO UPDATE SET status=excluded.status,reviewed_at=excluded.reviewed_at,note=excluded.note,updated_at=excluded.updated_at").bind(id,programId,sourceRowId,status,reviewedAt,note,now,now),
      env.DB.prepare("INSERT INTO audit_event (id,program_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),programId,"source_occurrence_reviewed","source_occurrence",id,JSON.stringify({sourceRowId,status,reviewedAt,note}),now),
    ]);
    return Response.json({ key:id, review:{ status, reviewedAt, note } });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Review status could not be saved." }, { status:500 });
  }
}
