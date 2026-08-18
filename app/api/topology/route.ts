import { env } from "cloudflare:workers";
import { ensureActor } from "../../../lib/governance-server";
import { saveDeploymentProfile, saveHostProfile, topologyExtensions } from "../../../lib/topology-server";

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const releaseId = new URL(request.url).searchParams.get("releaseId") || undefined;
    return Response.json(await topologyExtensions(env.DB, releaseId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Topology extensions are unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const id = action === "save_host_profile" ? await saveHostProfile(env.DB, actor, body) : action === "save_deployment_profile" ? await saveDeploymentProfile(env.DB, actor, body) : null;
    if (!id) return Response.json({ error: "Unknown topology action." }, { status: 400 });
    return Response.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Topology extension could not be saved.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
