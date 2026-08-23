import { env } from "cloudflare:workers";
import { BASELINE_PROGRAM_ID, BASELINE_WORKSPACE_ID, readAssembledBaselineRecords } from "../../../../lib/a2o-baseline-server";
import { ensureActor, requireWriter } from "../../../../lib/governance-server";

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    requireWriter(actor);
    const body = await request.json() as { occurrenceIds?: unknown; releaseScope?: unknown };
    const occurrenceIds = Array.isArray(body.occurrenceIds) ? body.occurrenceIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
    if (!occurrenceIds.length) return Response.json({ error: "There are no baseline records in the requested export scope." }, { status: 400 });
    const records = await readAssembledBaselineRecords(env.DB, { ids: occurrenceIds });
    if (records.length !== occurrenceIds.length) return Response.json({ error: "The export scope changed. Reload before exporting." }, { status: 409 });
    const blockers = records.flatMap((record) => {
      const release = String(record.row.ReleaseName ?? "").trim(); const product = String(record.row.LongName ?? record.row.ShortName ?? "").trim(); const host = String(record.row.HW_Host ?? "").trim();
      const messages: string[] = []; if (!release) messages.push("ReleaseName is blank."); if (!product && !host) messages.push("A product name or HW_Host is required.");
      return messages.map((message) => ({ occurrenceId: record.occurrenceId, message }));
    });
    if (blockers.length) return Response.json({ error: "Export is blocked until the listed baseline records are deterministic.", blockers }, { status: 422 });
    const releaseNames = [...new Set(records.map((record) => String(record.row.ReleaseName ?? "").trim()).filter(Boolean))];
    const releaseScope = releaseNames.length === 1 ? releaseNames[0] : "All releases";
    const now = new Date().toISOString(); const publicationId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO audit_event (id,program_id,actor_id,action,entity_kind,entity_id,after_payload,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(publicationId, BASELINE_PROGRAM_ID, actor.id, "a2o_tech_stack_exported", "baseline_workspace", BASELINE_WORKSPACE_ID, JSON.stringify({ releaseScope, occurrenceIds, asOf: now, contract: "A2O Tech Stack 24-column exchange" }), now).run();
    // The browser workbook writer calls GET and receives this exact assembled 24-column projection.
    return Response.json({ publicationId, asOf: now, rows: records.map((record) => ({ occurrenceId: record.occurrenceId, row: record.row })) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The export readiness check could not be completed." }, { status: 500 }); }
}
