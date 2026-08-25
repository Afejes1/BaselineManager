"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssistantContext, AssistantProposal, AssistantSavedPrompt, AssistantScratchpadEntry } from "../lib/assistant-model";

type AssistantState = {
  context: AssistantContext;
  groundingSummary: string;
  configured: boolean;
  configurationMessage: string;
  model: string | null;
  savedPrompts: AssistantSavedPrompt[];
  scratchpad: AssistantScratchpadEntry[];
};
type AssistantAnswer = { context: AssistantContext; groundingSummary: string; model: string; answer: string; proposals: AssistantProposal[] };

const suggestions: Record<AssistantContext["kind"], Array<{ title: string; prompt: string }>> = {
  initiative: [
    { title: "Decision readiness", prompt: "What decision is being requested, what grounded facts support it, and what smallest missing information would make the decision more defensible?" },
    { title: "Milestone proposal", prompt: "Using only the linked Objectives, dependencies, and stated dates, propose a minimal set of draft milestones. Mark each uncertainty and do not invent dates." },
  ],
  change_request: [
    { title: "Scope check", prompt: "Summarize the explicit affected objects, delivery Objectives, dependencies, and missing traceability for this Change Request." },
    { title: "Objective hygiene", prompt: "Which linked Objectives lack dates, estimates, technical-effect attribution, requirements, or acceptance criteria? Recommend the smallest next records to create." },
  ],
  product: [
    { title: "Product impact", prompt: "Explain this Product's fielding context, explicitly linked Change Request effects, related Objectives, and what is missing before making a Government impact statement." },
    { title: "Configuration gaps", prompt: "Review the grounded installations and relationships. Identify missing capacity, version, or source-confidence information without inferring facts." },
  ],
  platform: [
    { title: "Platform impact", prompt: "Explain the Platform hierarchy, release-specific infrastructure, explicit Change Request effects, and related delivery Objectives. Clearly separate reported values from Government context." },
    { title: "Infrastructure gaps", prompt: "Review the grounded nodes, capacity, installations, and connections. Identify the highest-value missing configuration data to collect next." },
  ],
};

export function ContextAssistant({ context }: { context: AssistantContext }) {
  const [state, setState] = useState<AssistantState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [savedPromptTitle, setSavedPromptTitle] = useState("");
  const [scratchpadTitle, setScratchpadTitle] = useState("");
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const contextKey = `${context.kind}:${context.id}:${context.label}`;
  const promptChoices = useMemo(() => suggestions[context.kind], [context.kind]);

  async function load() {
    setLoading(true);
    try {
      const query = new URLSearchParams({ contextKind: context.kind, contextId: context.id, contextLabel: context.label });
      const response = await fetch(`/api/assistant?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json() as AssistantState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The assistant workspace is unavailable.");
      setState(payload); setMessage("");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The assistant workspace is unavailable."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [contextKey]); // Reload only when record context changes.

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, context }) });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The assistant action could not be completed.");
    return payload;
  }
  async function ask() {
    if (!prompt.trim()) { setMessage("Enter a question or choose a saved prompt."); return; }
    setAsking(true); setMessage("");
    try {
      const payload = await post({ action: "ask", prompt }) as unknown as AssistantAnswer;
      setAnswer(payload); setScratchpadTitle(`AI analysis · ${new Date().toLocaleDateString("en-US")}`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "GenAI.mil could not answer this request."); }
    finally { setAsking(false); }
  }
  async function savePrompt() {
    if (!savedPromptTitle.trim() || !prompt.trim()) { setMessage("Provide a title and prompt text before saving a prompt."); return; }
    setSaving(true); setMessage("");
    try { await post({ action: "save_prompt", title: savedPromptTitle, prompt }); setSavedPromptTitle(""); await load(); setMessage("Saved prompt updated."); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The prompt could not be saved."); }
    finally { setSaving(false); }
  }
  async function saveScratchpad() {
    if (!answer) return;
    setSaving(true); setMessage("");
    try { await post({ action: "save_scratchpad", title: scratchpadTitle, prompt, response: answer.answer, proposals: answer.proposals, model: answer.model }); await load(); setMessage("Saved to the AI analysis scratchpad. It is not source evidence or an adjudicated decision."); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The scratchpad entry could not be saved."); }
    finally { setSaving(false); }
  }
  async function apply(proposal: AssistantProposal) {
    setSaving(true); setMessage("");
    try { await post({ action: "apply_proposal", proposal }); setMessage("Reviewed change applied through the governed, audited record workflow. Refresh record data when you are ready to inspect it."); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The proposed change could not be applied."); }
    finally { setSaving(false); }
  }

  return <section className="context-assistant" aria-label="GenAI.mil grounded assistant">
    <header><div><span className="eyebrow">GENAI.MIL · GROUNDED ASSISTANT</span><h3>Ask about this {context.kind.replaceAll("_", " ")}</h3><p>{loading ? "Preparing governed context…" : state?.groundingSummary || "Context could not be loaded."}</p></div><span className={`assistant-state assistant-state-${state?.configured ? "ready" : "off"}`}>{state?.configured ? "Ready on demand" : "Not configured"}</span></header>
    <p className="assistant-boundary">No background or automatic model calls. When you press <b>Ask GenAI.mil</b>, this record’s bounded, related data is sent only to the approved GenAI.mil endpoint. AI output is analysis—not source evidence, a Government assessment, or a decision.</p>
    {state && !state.configured ? <p className="assistant-config" role="status">{state.configurationMessage}</p> : null}
    <div className="assistant-prompt-library"><span>Starter prompts</span>{promptChoices.map((choice) => <button key={choice.title} type="button" className="mini-action" onClick={() => { setPrompt(choice.prompt); setSavedPromptTitle(choice.title); }}>{choice.title}</button>)}{state?.savedPrompts.map((choice) => <button key={choice.id} type="button" className="mini-action" onClick={() => { setPrompt(choice.promptText); setSavedPromptTitle(choice.title); }}>{choice.title}</button>)}</div>
    <label className="assistant-question">Question or custom prompt<textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask for a decision summary, data-gap review, narrow milestone proposal, or an accountable next action…" /></label>
    <div className="assistant-actions"><button className="primary-button" type="button" disabled={asking || loading || !state?.configured} title={state?.configured ? "Send this explicit request to GenAI.mil" : state?.configurationMessage} onClick={() => void ask()}>{asking ? "Asking GenAI.mil…" : "Ask GenAI.mil"}</button><label>Save prompt as<input value={savedPromptTitle} onChange={(event) => setSavedPromptTitle(event.target.value)} placeholder="Reusable prompt title" /></label><button className="ghost-button" type="button" disabled={saving || !prompt.trim()} onClick={() => void savePrompt()}>Save prompt</button></div>
    {message ? <p className="assistant-message" role="status">{message}</p> : null}
    {answer ? <section className="assistant-answer"><header><div><span>ANALYSIS RESPONSE</span><strong>{answer.model}</strong></div><button className="ghost-button" type="button" disabled={saving} onClick={() => void saveScratchpad()}>Save analysis scratchpad</button></header><p>{answer.answer}</p><label className="assistant-scratchpad-title">Scratchpad title<input value={scratchpadTitle} onChange={(event) => setScratchpadTitle(event.target.value)} /></label>{answer.proposals.length ? <div className="assistant-proposals"><strong>Reviewable proposed changes</strong>{answer.proposals.map((proposal) => <article key={proposal.id}><div><span>{proposal.kind.replaceAll("_", " ")}</span><h4>{proposal.title}</h4><p>{proposal.rationale}</p><pre>{JSON.stringify(proposal.fields, null, 2)}</pre></div><button className="primary-button" type="button" disabled={saving} onClick={() => void apply(proposal)}>Apply reviewed change</button></article>)}</div> : <p className="entity-meta">No write proposal was returned. You can save this analysis or use it to make a governed edit yourself.</p>}</section> : null}
    {state?.scratchpad.length ? <details className="assistant-scratchpad"><summary>Saved AI analysis scratchpad ({state.scratchpad.length})</summary>{state.scratchpad.map((entry) => <article key={entry.id}><strong>{entry.title}</strong><small>{entry.modelName || "Model not recorded"} · {new Date(entry.createdAt).toLocaleString()}</small><p>{entry.responseText}</p></article>)}</details> : null}
  </section>;
}
