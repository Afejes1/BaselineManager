import { env } from "cloudflare:workers";

const programId = "program-jsf";
const workspaceId = "workspace-jsf-current";

type StoredRow = { id: string; projection_payload: string };

export async function POST(request: Request) {
  try {
    const body = await request.json() as { occurrenceIds?: unknown; releaseScope?: unknown };
    const occurrenceIds = Array.isArray(body.occurrenceIds) ? body.occurrenceIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
    if (!occurrenceIds.length) return Response.json({ error: "There are no source occurrences in the requested export scope." }, { status: 400 });
    const placeholders = occurrenceIds.map(() => "?").join(",");
    const result = await env.DB.prepare(`SELECT id, projection_payload FROM baseline_occurrence WHERE workspace_id = ? AND lifecycle_status='active' AND id IN (${placeholders})`).bind(workspaceId, ...occurrenceIds).all<StoredRow>();
    if (result.results.length !== occurrenceIds.length) return Response.json({ error: "The export scope changed. Reload before exporting." }, { status: 409 });
    const blockers = result.results.flatMap((item) => {
      const row = JSON.parse(item.projection_payload) as Record<string, unknown>;
      const release = String(row.ReleaseName ?? "").trim();
      const product = String(row.LongName ?? row.ShortName ?? "").trim();
      const host = String(row.HW_Host ?? "").trim();
      const messages: string[] = [];
      if (!release) messages.push("ReleaseName is blank.");
      if (!product && !host) messages.push("A product name or HW_Host is required.");
      return messages.map((message) => ({ occurrenceId: item.id, message }));
    });
    if (blockers.length) return Response.json({ error: "Export is blocked until the listed source occurrences are deterministic.", blockers }, { status: 422 });
    const now = new Date().toISOString();
    const publicationId = `publication-${crypto.randomUUID()}`;
    await env.DB.prepare("INSERT INTO audit_event (id,program_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?)").bind(publicationId, programId, "baseline_xlsx_exported", "baseline_workspace", workspaceId, JSON.stringify({ releaseScope: String(body.releaseScope ?? "All releases"), occurrenceIds, asOf: now, workbookContract: "Technical Baseline 24 v1" }), now).run();
    return Response.json({ publicationId, asOf: now });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The export readiness check could not be completed." }, { status: 500 });
  }
}
