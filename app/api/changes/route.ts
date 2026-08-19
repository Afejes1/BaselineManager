import { env } from "cloudflare:workers";
import { addChangeDependency, addChangeEffect, assignOccurrences, changePortfolio, saveChangeRequest, setFundingDecision } from "../../../lib/change-server";
import { ensureActor } from "../../../lib/governance-server";

export async function GET(request: Request) {
  try { await ensureActor(env.DB, request); return Response.json(await changePortfolio(env.DB)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Change Request portfolio is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const id = action === "save_request" ? await saveChangeRequest(env.DB, actor, body)
      : action === "set_decision" ? await setFundingDecision(env.DB, actor, body)
      : action === "add_effect" ? await addChangeEffect(env.DB, actor, body)
      : action === "add_dependency" ? await addChangeDependency(env.DB, actor, body)
      : action === "assign_occurrences" ? await assignOccurrences(env.DB, actor, body) : null;
    if (!id) return Response.json({ error: "Unknown Change Request action." }, { status: 400 });
    return Response.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Change Request update could not be saved.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}

