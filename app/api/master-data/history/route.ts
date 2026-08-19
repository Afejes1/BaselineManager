import { env } from "cloudflare:workers";
import { ensureActor } from "../../../../lib/governance-server";
import { auditHistory } from "../../../../lib/master-data-server";

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind")?.trim() || "";
    const id = url.searchParams.get("id")?.trim() || "";
    if (!kind || !id) return Response.json({ error: "Object type and identifier are required." }, { status: 400 });
    return Response.json({ entries: await auditHistory(env.DB, kind, id) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "History is unavailable." }, { status: 500 }); }
}
