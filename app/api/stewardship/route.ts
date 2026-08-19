import { env } from "cloudflare:workers";
import { ensureActor } from "../../../lib/governance-server";
import { mergeCanonicalEntity, saveCanonicalAlias, stewardshipPortfolio } from "../../../lib/stewardship-server";

export async function GET(request: Request) {
  try { await ensureActor(env.DB, request); return Response.json(await stewardshipPortfolio(env.DB)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Identity data is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const id = action === "save_alias" ? await saveCanonicalAlias(env.DB, actor, body) : action === "merge_entity" ? await mergeCanonicalEntity(env.DB, actor, body) : null;
    if (!id) return Response.json({ error: "Unknown identity action." }, { status: 400 });
    return Response.json({ ok: true, id });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Identity update failed." }, { status: 400 }); }
}
