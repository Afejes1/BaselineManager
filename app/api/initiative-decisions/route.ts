import { env } from "cloudflare:workers";
import { ensureActor } from "../../../lib/governance-server";
import { addObjectiveEstimate, initiativeDecisionWorkspace, recordAcceptanceSignoff, saveAcceptanceCriterion, saveObjective, saveObjectiveDependency, saveObjectiveEffectAttribution, saveRequirementTrace } from "../../../lib/initiative-decision-server";
import { enrichDemonstrationWorkspace } from "../../../lib/demo-workspace-server";
import { demoEnabledFromValue } from "../../../lib/runtime-policy";

export async function GET(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    // Existing demo workspaces predate this decision model. Seed the deep
    // scenario once when that exact synthetic package is still active; never
    // add it to an imported stakeholder workbook or a DEMO_ENABLED=false build.
    const demoEnabled = demoEnabledFromValue((env as unknown as { DEMO_ENABLED?: string }).DEMO_ENABLED);
    if (demoEnabled && actor.role !== "viewer") {
      const current = await env.DB.prepare("SELECT sp.file_name FROM baseline_workspace bw LEFT JOIN source_package sp ON sp.id=bw.active_import_package_id WHERE bw.id='workspace-jsf-current'").first<{ file_name: string | null }>();
      const exists = await env.DB.prepare("SELECT COUNT(*) AS count FROM solution_option WHERE id='demo-solution-java8-targeted'").first<{ count: number }>();
      if (current?.file_name === "JSF_V3_Demonstration_Baseline.xlsx" && !Number(exists?.count || 0)) await enrichDemonstrationWorkspace(env.DB, actor);
    }
    const searchParams = new URL(request.url).searchParams;
    const evidenceScope = {
      initiativeId: searchParams.get("initiativeId")?.trim() || undefined,
      objectiveId: searchParams.get("objectiveId")?.trim() || undefined,
      changeRequestId: searchParams.get("changeRequestId")?.trim() || undefined,
    };
    const requestedScopes = Object.values(evidenceScope).filter(Boolean);
    if (requestedScopes.length > 1 || requestedScopes.some((value) => value!.length > 200)) return Response.json({ error: "Choose one valid evidence verification scope." }, { status: 400 });
    return Response.json(await initiativeDecisionWorkspace(env.DB, actor, evidenceScope));
  }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Initiative decision workspace is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);
    const id = action === "save_objective" ? await saveObjective(env.DB, actor, body)
      : action === "save_objective_dependency" ? await saveObjectiveDependency(env.DB, actor, body)
      : action === "save_objective_effect_attribution" ? await saveObjectiveEffectAttribution(env.DB, actor, body)
      : action === "add_estimate" ? await addObjectiveEstimate(env.DB, actor, body)
      : action === "save_requirement" ? await saveRequirementTrace(env.DB, actor, body)
      : action === "save_criterion" ? await saveAcceptanceCriterion(env.DB, actor, body)
      : action === "record_signoff" ? await recordAcceptanceSignoff(env.DB, actor, body) : null;
    if (!id) return Response.json({ error: "Unknown Initiative decision action." }, { status: 400 });
    return Response.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Initiative decision update could not be saved.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
