"use client";

import { useEffect, useMemo, useState } from "react";
import { assistantAction } from "../lib/assistant-actions";
import type { AssistantContext, AssistantProposal, AssistantSavedPrompt, AssistantScratchpadEntry } from "../lib/assistant-model";
import { SafeMarkdown } from "./safe-markdown";
import { ViewportModal } from "./viewport-modal";

type AssistantState = {
  context: AssistantContext;
  groundingSummary: string;
  configured: boolean;
  configurationMessage: string;
  model: string | null;
  toolMode: "json-proposals" | "native-tools";
  savedPrompts: AssistantSavedPrompt[];
  scratchpad: AssistantScratchpadEntry[];
};
type AssistantAnswer = { context: AssistantContext; groundingSummary: string; groundingFingerprint: string; model: string; toolMode: "json-proposals" | "native-tools"; answer: string; proposals: AssistantProposal[] };

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

function valueText(value: string | number | boolean | null) {
  if (value === null || value === "") return "Not specified";
  return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
}

function ProposalCard({ proposal, disabled, onApply }: { proposal: AssistantProposal; disabled: boolean; onApply: () => void }) {
  const definition = assistantAction(proposal.kind);
  const visibleFields = definition?.fields.filter((field) => Object.hasOwn(proposal.fields, field.name)) || [];
  return <article className="assistant-proposal-card">
    <div className="assistant-proposal-copy">
      <span className="assistant-proposal-type">Proposed · {definition?.label || proposal.kind.replaceAll("_", " ")}</span>
      <h4>{proposal.title}</h4>
      <p>{proposal.rationale}</p>
      <dl className="assistant-proposal-fields">{visibleFields.map((field) => <div key={field.name}><dt>{field.label}</dt><dd>{valueText(proposal.fields[field.name])}</dd></div>)}</dl>
    </div>
    <div className="assistant-proposal-controls"><small>Nothing has been changed. Applying uses the normal role checks, validation, hard-link controls, and audit trail.</small><button className="primary-button" type="button" disabled={disabled} onClick={onApply}>Apply reviewed change</button></div>
  </article>;
}

function PromptGroup({ heading, prompts, onChoose, onDelete, disabled }: { heading: string; prompts: AssistantSavedPrompt[]; onChoose: (prompt: AssistantSavedPrompt) => void; onDelete: (id: string) => void; disabled: boolean }) {
  return <section><strong>{heading}</strong>{prompts.length ? prompts.map((item) => <div className="assistant-saved-prompt" key={item.id}><button type="button" className="mini-action" onClick={() => onChoose(item)}>{item.title}</button><button type="button" className="text-action" disabled={disabled} onClick={() => onDelete(item.id)}>Remove</button></div>) : <small>No saved prompts.</small>}</section>;
}

function AssistantWorkspace({ context, onDismiss }: { context: AssistantContext; onDismiss: () => void }) {
  const [state, setState] = useState<AssistantState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [savedPromptTitle, setSavedPromptTitle] = useState("");
  const [savedPromptId, setSavedPromptId] = useState("");
  const [promptScope, setPromptScope] = useState<"context" | "global">("context");
  const [scratchpadTitle, setScratchpadTitle] = useState("");
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const contextKey = `${context.kind}:${context.id}:${context.label}`;
  const promptChoices = useMemo(() => suggestions[context.kind], [context.kind]);
  const globalPrompts = state?.savedPrompts.filter((item) => item.scopeKind === null) || [];
  const contextualPrompts = state?.savedPrompts.filter((item) => item.scopeKind === context.kind) || [];

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
  useEffect(() => { void load(); setAnswer(null); }, [contextKey]); // This prepares local context only; it does not contact a model.

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, context }) });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The assistant action could not be completed.");
    return payload;
  }
  function choosePrompt(choice: { id?: string; title: string; prompt: string; scope?: "context" | "global" }) {
    setPrompt(choice.prompt); setSavedPromptTitle(choice.title); setSavedPromptId(choice.id || ""); setPromptScope(choice.scope || "context"); setMessage("");
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
    try { await post({ action: "save_prompt", promptId: savedPromptId || undefined, scope: promptScope, title: savedPromptTitle, prompt }); setSavedPromptId(""); await load(); setMessage("Saved prompt updated."); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The prompt could not be saved."); }
    finally { setSaving(false); }
  }
  async function deletePrompt(promptId: string) {
    if (!window.confirm("Remove this saved prompt? This does not affect any source data, analysis scratchpad, evidence, or decision.")) return;
    setSaving(true); setMessage("");
    try { await post({ action: "delete_prompt", promptId }); if (savedPromptId === promptId) setSavedPromptId(""); await load(); setMessage("Saved prompt removed."); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The prompt could not be removed."); }
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
    if (!answer) return;
    setSaving(true); setMessage("");
    try { await post({ action: "apply_proposal", proposal, groundingFingerprint: answer.groundingFingerprint }); setMessage("Reviewed change applied through the governed, audited record workflow. Reload this page when you are ready to inspect the updated record."); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The proposed change could not be applied."); }
    finally { setSaving(false); }
  }

  return <ViewportModal onDismiss={onDismiss} dismissDisabled={asking || saving} labelledBy="genai-assistant-title" className="assistant-modal">
    <header className="assistant-modal-header"><div><span className="eyebrow">GENAI.MIL · GROUNDED ASSISTANT</span><h2 id="genai-assistant-title">Ask about {context.label}</h2><p>{loading ? "Preparing bounded local context…" : state?.groundingSummary || "Context could not be loaded."}</p></div><div><span className={`assistant-state assistant-state-${state?.configured ? "ready" : "off"}`}>{state?.configured ? "Ready on demand" : "Not configured"}</span><button className="ghost-button" type="button" disabled={asking || saving} onClick={onDismiss}>Close</button></div></header>
    <p className="assistant-boundary"><strong>Explicit, bounded transmission only.</strong> No background or automatic model calls occur. Pressing <b>Ask GenAI.mil</b> sends this record’s bounded related data only to the approved GenAI.mil endpoint. Output is analysis—not source evidence, a Government assessment, or a decision.</p>
    {state && !state.configured ? <p className="assistant-config" role="status">{state.configurationMessage}</p> : null}
    <div className="assistant-workspace-grid"><section className="assistant-composer"><div className="assistant-section-heading"><div><span className="eyebrow">QUESTION</span><h3>Grounded analysis request</h3></div><small>{state?.toolMode === "native-tools" ? "Native tool proposals" : "JSON review proposals"}</small></div><div className="assistant-prompt-library"><span>Starter prompts</span>{promptChoices.map((choice) => <button key={choice.title} type="button" className="mini-action" onClick={() => choosePrompt({ ...choice })}>{choice.title}</button>)}</div><label className="assistant-question">Question or custom prompt<textarea rows={8} value={prompt} onChange={(event) => { setPrompt(event.target.value); setSavedPromptId(""); }} placeholder="Ask for a decision summary, data-gap review, narrow milestone proposal, or an accountable next action…" /></label><div className="assistant-actions"><button className="primary-button" type="button" disabled={asking || loading || !state?.configured} title={state?.configured ? "Send this explicit request to GenAI.mil" : state?.configurationMessage} onClick={() => void ask()}>{asking ? "Asking GenAI.mil…" : "Ask GenAI.mil"}</button></div><details className="assistant-prompt-manager"><summary>Manage reusable prompts</summary><div className="assistant-prompt-editor"><label>Title<input value={savedPromptTitle} onChange={(event) => setSavedPromptTitle(event.target.value)} placeholder="Reusable prompt title" /></label><label>Scope<select value={promptScope} onChange={(event) => setPromptScope(event.target.value as "context" | "global")}><option value="context">This {context.kind.replaceAll("_", " ")} type</option><option value="global">All assistant pages</option></select></label><button className="ghost-button" type="button" disabled={saving || !prompt.trim()} onClick={() => void savePrompt()}>{savedPromptId ? "Update prompt" : "Save prompt"}</button></div><div className="assistant-saved-prompt-groups"><PromptGroup heading="All assistant pages" prompts={globalPrompts} onChoose={(item) => choosePrompt({ id: item.id, title: item.title, prompt: item.promptText, scope: "global" })} onDelete={(id) => void deletePrompt(id)} disabled={saving} /><PromptGroup heading={`This ${context.kind.replaceAll("_", " ")} type`} prompts={contextualPrompts} onChoose={(item) => choosePrompt({ id: item.id, title: item.title, prompt: item.promptText, scope: "context" })} onDelete={(id) => void deletePrompt(id)} disabled={saving} /></div></details></section>
      <section className="assistant-results"><div className="assistant-section-heading"><div><span className="eyebrow">RESPONSE</span><h3>Analysis and review</h3></div>{answer ? <span>{answer.model}</span> : null}</div>{message ? <p className="assistant-message" role="status">{message}</p> : null}{answer ? <><SafeMarkdown content={answer.answer} className="assistant-answer" /><div className="assistant-save-row"><label>Scratchpad title<input value={scratchpadTitle} onChange={(event) => setScratchpadTitle(event.target.value)} /></label><button className="ghost-button" type="button" disabled={saving} onClick={() => void saveScratchpad()}>Save analysis scratchpad</button></div>{answer.proposals.length ? <section className="assistant-proposals"><strong>Reviewable proposed changes</strong>{answer.proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} disabled={saving} onApply={() => void apply(proposal)} />)}</section> : <p className="entity-meta">No write proposal was returned. You can save this analysis or use it to make a governed edit yourself.</p>}</> : <p className="assistant-empty">Your response will appear here. The app does not retain a chat thread or make follow-on model calls.</p>}{state?.scratchpad.length ? <details className="assistant-scratchpad"><summary>Saved AI analysis scratchpad ({state.scratchpad.length})</summary>{state.scratchpad.map((entry) => <article key={entry.id}><strong>{entry.title}</strong><small>{entry.modelName || "Model not recorded"} · {new Date(entry.createdAt).toLocaleString()}</small><SafeMarkdown content={entry.responseText} /></article>)}</details> : null}</section></div>
  </ViewportModal>;
}

/** Top-of-page launcher; opening it prepares local context but never calls GenAI.mil. */
export function AssistantLauncher({ context, compact = false }: { context: AssistantContext; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button className={compact ? "mini-action" : "ghost-button"} type="button" onClick={() => setOpen(true)}>Ask GenAI.mil</button>{open ? <AssistantWorkspace context={context} onDismiss={() => setOpen(false)} /> : null}</>;
}

/** Retained as a compatibility export for any local extensions. */
export const ContextAssistant = AssistantLauncher;
