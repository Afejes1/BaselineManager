import { env } from "cloudflare:workers";
import { ensureActor } from "../../../lib/governance-server";
import { addObjectiveEstimate, initiativeDecisionWorkspace, linkChangeRequest, recordAcceptanceSignoff, saveAcceptanceCriterion, saveDecisionProfile, saveInitiativeMilestone, saveObjective, saveRequirementTrace } from "../../../lib/initiative-decision-server";

export async function GET(request: Request) {
  try { const actor = await ensureActor(env.DB, request); return Response.json(await initiativeDecisionWorkspace(env.DB, actor)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Initiative decision workspace is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);
    const id = action === "save_profile" ? await saveDecisionProfile(env.DB, actor, body)
      : action === "link_change_request" ? await linkChangeRequest(env.DB, actor, body)
      : action === "save_objective" ? await saveObjective(env.DB, actor, body)
      : action === "add_estimate" ? await addObjectiveEstimate(env.DB, actor, body)
      : action === "save_requirement" ? await saveRequirementTrace(env.DB, actor, body)
      : action === "save_criterion" ? await saveAcceptanceCriterion(env.DB, actor, body)
      : action === "record_signoff" ? await recordAcceptanceSignoff(env.DB, actor, body)
      : action === "save_milestone" ? await saveInitiativeMilestone(env.DB, actor, body) : null;
    if (!id) return Response.json({ error: "Unknown Initiative decision action." }, { status: 400 });
    return Response.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Initiative decision update could not be saved.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
