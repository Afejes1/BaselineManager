import { env } from "cloudflare:workers";
import { enrichDemonstrationWorkspace } from "../../../lib/demo-workspace-server";
import { assertAuthenticatedRequest, ensureActor } from "../../../lib/governance-server";
import { demoEnabledFromValue } from "../../../lib/runtime-policy";

function demoEnabled() {
  const value = (env as unknown as { DEMO_ENABLED?: string }).DEMO_ENABLED;
  return demoEnabledFromValue(value);
}

export async function GET(request: Request) {
  try { assertAuthenticatedRequest(request); return Response.json({ enabled: demoEnabled() }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Authentication is required." }, { status: 401 }); }
}

export async function POST(request: Request) {
  try {
    if (!demoEnabled()) return Response.json({ error: "Demonstration data is disabled in this operational environment." }, { status: 403 });
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as { action?: string };
    if (body.action !== "enrich_workspace") return Response.json({ error: "Unknown demonstration action." }, { status: 400 });
    return Response.json({ ok: true, ...(await enrichDemonstrationWorkspace(env.DB, actor)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The demonstration details could not be prepared.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
