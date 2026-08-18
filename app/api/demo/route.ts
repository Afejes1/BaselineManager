import { env } from "cloudflare:workers";
import { enrichDemonstrationWorkspace } from "../../../lib/demo-workspace-server";
import { ensureActor } from "../../../lib/governance-server";

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as { action?: string };
    if (body.action !== "enrich_workspace") return Response.json({ error: "Unknown demonstration action." }, { status: 400 });
    return Response.json({ ok: true, ...(await enrichDemonstrationWorkspace(env.DB, actor)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The demonstration details could not be prepared.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
