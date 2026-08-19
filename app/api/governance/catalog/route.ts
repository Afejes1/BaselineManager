import { env } from "cloudflare:workers";
import { ensureActor, objectCatalog } from "../../../../lib/governance-server";

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    return Response.json({ items: await objectCatalog(env.DB) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The object catalog is unavailable." }, { status: 500 });
  }
}
