import { env } from "cloudflare:workers";
import { ensureActor } from "../../../lib/governance-server";
import { addObjectiveEstimate, initiativeDecisionWorkspace, linkChangeRequest, recordAcceptanceSignoff, saveAcceptanceCriterion, saveDecisionProfile, saveInitiativeMilestone, saveObjective, saveObjectiveDependency, saveObjectiveEffectAttribution, saveRequirementTrace } from "../../../lib/initiative-decision-server";
import { enrichDemonstrationWorkspace } from "../../../lib/demo-workspace-server";

export async function GET(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    // Existing demo workspaces predate this decision model. Seed the deep
    // scenario once when that exact synthetic package is still active; never
    // add it to an imported stakeholder workbook or a DEMO_ENABLED=false build.
    const demoEnabled = String((env as unknown as { DEMO_ENABLED?: string }).DEMO_ENABLED ?? "true").toLowerCase() !== "false";
    if (demoEnabled) {
      const current = await env.DB.prepare("SELECT sp.file_name FROM baseline_workspace bw LEFT JOIN source_package sp ON sp.id=bw.active_import_package_id WHERE bw.id='workspace-jsf-current'").first<{ file_name: string | null }>();
      const exists = await env.DB.prepare("SELECT COUNT(*) AS count FROM initiative WHERE id='demo-initiative-java8'").first<{ count: number }>();
      if (current?.file_name === "JSF_V3_Demonstration_Baseline.xlsx" && !Number(exists?.count || 0)) await enrichDemonstrationWorkspace(env.DB, actor);
    }
    return Response.json(await initiativeDecisionWorkspace(env.DB, actor));
  }
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
      : action === "save_objective_dependency" ? await saveObjectiveDependency(env.DB, actor, body)
      : action === "save_objective_effect_attribution" ? await saveObjectiveEffectAttribution(env.DB, actor, body)
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
