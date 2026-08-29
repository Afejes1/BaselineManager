import { env } from "cloudflare:workers";
import { ensureActor } from "../../../lib/governance-server";
import { applyAssistantProposal, askAssistant, assistantLibrary, assistantWorkspace, deleteAssistantPrompt, deleteAssistantScratchpad, saveAssistantPrompt, saveAssistantScratchpad } from "../../../lib/assistant-server";
import { acceptAssessmentSuggestion, applySolutionBundle, discoverSolutionSources, dismissSolutionDraft, generateSolutionDraft, listSolutionDrafts, reviewSolutionDraft } from "../../../lib/assistant-solution-server";

export async function GET(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const query = new URL(request.url).searchParams;
    if (query.get("scope") === "library") return Response.json(await assistantLibrary(env.DB, actor));
    return Response.json(await assistantWorkspace(env.DB, actor, { kind: query.get("contextKind"), id: query.get("contextId"), label: query.get("contextLabel") }));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The GenAI.mil assistant workspace is unavailable. Run the local workspace update if its assistant storage migration has not been applied." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as Record<string, unknown>;
    const context = body.context;
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "ask") return Response.json(await askAssistant(env.DB, actor, context, body));
    if (action === "save_prompt") return Response.json({ ok: true, id: await saveAssistantPrompt(env.DB, actor, context, body) });
    if (action === "delete_prompt") { await deleteAssistantPrompt(env.DB, actor, context, body); return Response.json({ ok: true }); }
    if (action === "save_scratchpad") return Response.json({ ok: true, id: await saveAssistantScratchpad(env.DB, actor, context, body) });
    if (action === "delete_scratchpad") { await deleteAssistantScratchpad(env.DB, actor, body); return Response.json({ ok: true }); }
    if (action === "apply_proposal") return Response.json({ ok: true, id: await applyAssistantProposal(env.DB, actor, context, body.proposal, body.groundingFingerprint) });
    if (action === "discover_solution_sources") return Response.json(await discoverSolutionSources(env.DB, actor, body));
    if (action === "generate_solution_options") return Response.json(await generateSolutionDraft(env.DB, actor, body));
    if (action === "list_solution_drafts") return Response.json(await listSolutionDrafts(env.DB, actor, body));
    if (action === "review_solution_draft") return Response.json({ ok: true, id: await reviewSolutionDraft(env.DB, actor, body) });
    if (action === "apply_solution_bundle") return Response.json({ ok: true, ...(await applySolutionBundle(env.DB, actor, body)) });
    if (action === "accept_assessment_suggestion") return Response.json({ ok: true, id: await acceptAssessmentSuggestion(env.DB, actor, body) });
    if (action === "dismiss_solution_draft") return Response.json({ ok: true, id: await dismissSolutionDraft(env.DB, actor, body) });
    return Response.json({ error: "Unknown assistant action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The GenAI.mil assistant could not complete that action.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
