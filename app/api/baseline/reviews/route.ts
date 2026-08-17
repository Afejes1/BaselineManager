import { env } from "cloudflare:workers";

const programId = "program-jsf";
const statuses = new Set(["not_reviewed", "reviewed", "follow_up"]);
const clean = (value: unknown) => String(value ?? "").trim();
const identity = (releaseName: string, sourceKey: string) => `${releaseName}\u001f${sourceKey}`;

type ReviewRow = { release_name:string; source_key:string; status:string; reviewed_at:string|null; note:string|null };

export async function GET() {
  try {
    const result = await env.DB.prepare("SELECT release_name, source_key, status, reviewed_at, note FROM source_occurrence_review WHERE program_id = ?").bind(programId).all<ReviewRow>();
    return Response.json({ reviews:Object.fromEntries(result.results.map((row) => [identity(row.release_name,row.source_key), { status:row.status, reviewedAt:row.reviewed_at, note:row.note }])) });
  } catch (error) {
    return Response.json({ reviews:{}, error:error instanceof Error ? error.message : "Review history is unavailable." }, { status:500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { releaseName?:unknown; sourceKey?:unknown; status?:unknown; note?:unknown };
    const releaseName = clean(body.releaseName);
    const sourceKey = clean(body.sourceKey);
    const status = clean(body.status);
    const note = clean(body.note) || null;
    if (!releaseName || !sourceKey || !statuses.has(status)) return Response.json({ error:"releaseName, sourceKey, and a valid review status are required." }, { status:400 });
    const now = new Date().toISOString();
    const reviewedAt = status === "not_reviewed" ? null : now;
    const id = identity(releaseName,sourceKey);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO program (id,name,description,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").bind(programId,"Joint Strike Fighter","F-35 technical baseline program","America/New_York",now,now),
      env.DB.prepare("INSERT INTO source_occurrence_review (id,program_id,release_name,source_key,status,reviewed_at,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(program_id,release_name,source_key) DO UPDATE SET status=excluded.status,reviewed_at=excluded.reviewed_at,note=excluded.note,updated_at=excluded.updated_at").bind(id,programId,releaseName,sourceKey,status,reviewedAt,note,now,now),
      env.DB.prepare("INSERT INTO audit_event (id,program_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),programId,"source_occurrence_reviewed","source_occurrence",id,JSON.stringify({releaseName,sourceKey,status,reviewedAt,note}),now),
    ]);
    return Response.json({ key:id, review:{ status, reviewedAt, note } });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Review status could not be saved." }, { status:500 });
  }
}
