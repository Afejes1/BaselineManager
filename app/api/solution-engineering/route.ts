import { env } from "cloudflare:workers";
import { ensureActor } from "../../../lib/governance-server";
import { initiativeDecisionWorkspace, saveDecisionProfile } from "../../../lib/initiative-decision-server";
import {
  removeSolutionChangeRequest,
  removeSolutionObjective,
  saveSolutionAssessment,
  saveSolutionDecision,
  saveSolutionKnockOn,
  saveSolutionOption,
  saveSolutionStep,
  saveSolutionStepDependency,
  saveSolutionStepReference,
  setSolutionChangeRequest,
  setSolutionObjective,
} from "../../../lib/initiative-solution-server";

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function GET(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const initiativeId = new URL(request.url).searchParams.get("initiativeId")?.trim() || undefined;
    if (initiativeId && initiativeId.length > 200) return Response.json({ error: "Choose a valid Initiative." }, { status: 400 });
    return Response.json(await initiativeDecisionWorkspace(env.DB, actor, initiativeId ? { initiativeId } : {}));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Solution Engineering is unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);
    const handlers: Record<string, () => Promise<string>> = {
      save_case: () => saveDecisionProfile(env.DB, actor, body),
      save_profile: () => saveDecisionProfile(env.DB, actor, body),
      save_option: () => saveSolutionOption(env.DB, actor, body),
      save_solution_option: () => saveSolutionOption(env.DB, actor, body),
      save_step: () => saveSolutionStep(env.DB, actor, body),
      save_solution_step: () => saveSolutionStep(env.DB, actor, body),
      save_step_reference: () => saveSolutionStepReference(env.DB, actor, body),
      save_step_dependency: () => saveSolutionStepDependency(env.DB, actor, body),
      select_change_request: () => setSolutionChangeRequest(env.DB, actor, body),
      set_solution_change_request: () => setSolutionChangeRequest(env.DB, actor, body),
      remove_change_request: () => removeSolutionChangeRequest(env.DB, actor, body),
      remove_solution_change_request: () => removeSolutionChangeRequest(env.DB, actor, body),
      select_objective: () => setSolutionObjective(env.DB, actor, body),
      set_solution_objective: () => setSolutionObjective(env.DB, actor, body),
      remove_objective: () => removeSolutionObjective(env.DB, actor, body),
      remove_solution_objective: () => removeSolutionObjective(env.DB, actor, body),
      save_knock_on: () => saveSolutionKnockOn(env.DB, actor, body),
      save_assessment: () => saveSolutionAssessment(env.DB, actor, body),
      save_solution_assessment: () => saveSolutionAssessment(env.DB, actor, body),
      adjudicate: () => saveSolutionDecision(env.DB, actor, body),
      save_solution_decision: () => saveSolutionDecision(env.DB, actor, body),
    };
    const handler = handlers[action];
    if (!handler) return Response.json({ error: "Unknown Solution Engineering action." }, { status: 400 });
    return Response.json({ ok: true, id: await handler() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Solution Engineering update could not be saved.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
