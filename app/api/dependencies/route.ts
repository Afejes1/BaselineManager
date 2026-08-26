import { env } from "cloudflare:workers";
import { dependencyBoardPortfolio } from "../../../lib/dependency-board-server";
import { ensureActor } from "../../../lib/governance-server";

export async function GET(request: Request) {
  try { return Response.json(await dependencyBoardPortfolio(env.DB, await ensureActor(env.DB, request))); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The dependency board is unavailable." }, { status: 500 }); }
}
