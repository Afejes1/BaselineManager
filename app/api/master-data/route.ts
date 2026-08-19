import { env } from "cloudflare:workers";
import { ensureActor } from "../../../lib/governance-server";
import { masterDataPortfolio, saveMasterEntity, saveRelease, saveReleaseMilestone } from "../../../lib/master-data-server";

export async function GET(request: Request) {
  try { await ensureActor(env.DB, request); return Response.json(await masterDataPortfolio(env.DB)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Master data is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const id = action === "save_release" ? await saveRelease(env.DB, actor, body)
      : action === "save_release_milestone" ? await saveReleaseMilestone(env.DB, actor, body)
      : action === "save_master_entity" ? await saveMasterEntity(env.DB, actor, body) : null;
    if (!id) return Response.json({ error: "Unknown master-data action." }, { status: 400 });
    return Response.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The record could not be saved.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
