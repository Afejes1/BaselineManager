import { env } from "cloudflare:workers";
import { ensureActor } from "../../../lib/governance-server";
import { linkPlatformOrganization, platformPortfolio, removePlatformAssignment, savePlatform, savePlatformAssignment, saveReleaseProfile } from "../../../lib/platform-server";

export async function GET(request: Request) {
  try { await ensureActor(env.DB, request); return Response.json(await platformPortfolio(env.DB)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Platform hierarchy is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const id = action === "save_platform" ? await savePlatform(env.DB, actor, body)
      : action === "link_organization" ? await linkPlatformOrganization(env.DB, actor, body)
      : action === "save_assignment" ? await savePlatformAssignment(env.DB, actor, body)
      : action === "remove_assignment" ? await removePlatformAssignment(env.DB, actor, body)
      : action === "save_release_profile" ? await saveReleaseProfile(env.DB, actor, body) : null;
    if (!id) return Response.json({ error: "Unknown Platform action." }, { status: 400 });
    return Response.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Platform update could not be saved.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
