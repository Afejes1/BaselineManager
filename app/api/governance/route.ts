import { env } from "cloudflare:workers";
import { createGovernanceRecord, createInitiative, createWorkPackage, ensureActor, portfolio, recordBriefPublication, saveWorkPackageDependency, updateExecutiveBrief, updateGovernanceRecord, updateInitiative, updateWorkPackage } from "../../../lib/governance-server";
import { createInitiativeLeadershipReport } from "../../../lib/initiative-report-server";

export async function GET(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    return Response.json(await portfolio(env.DB, actor));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The governance workspace is unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    let id: string | undefined;
    if (action === "create_initiative") id = await createInitiative(env.DB, actor, body);
    else if (action === "update_initiative") await updateInitiative(env.DB, actor, body);
    else if (action === "create_work_package") id = await createWorkPackage(env.DB, actor, body);
    else if (action === "update_work_package") await updateWorkPackage(env.DB, actor, body);
    else if (action === "save_work_package_dependency") id = await saveWorkPackageDependency(env.DB, actor, body);
    else if (action === "create_governance_record") id = await createGovernanceRecord(env.DB, actor, body);
    else if (action === "update_governance_record") await updateGovernanceRecord(env.DB, actor, body);
    else if (action === "create_executive_brief") id = await createInitiativeLeadershipReport(env.DB, actor, body);
    else if (action === "update_executive_brief") await updateExecutiveBrief(env.DB, actor, body);
    else if (action === "record_brief_publication") await recordBriefPublication(env.DB, actor, body);
    else return Response.json({ error: "Unknown governance action." }, { status: 400 });
    return Response.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The governance update could not be saved.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
