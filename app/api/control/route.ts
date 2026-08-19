import { env } from "cloudflare:workers";
import { controlSnapshot } from "../../../lib/control-server";
import { ensureActor } from "../../../lib/governance-server";
export async function GET(request: Request) { try { await ensureActor(env.DB, request); return Response.json(await controlSnapshot(env.DB)); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Control data is unavailable." }, { status: 500 }); } }
