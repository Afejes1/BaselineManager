export const assistantContextKinds = ["initiative", "change_request", "objective", "product", "platform", "release"] as const;
export type AssistantContextKind = typeof assistantContextKinds[number];
export const assistantProposalKinds = ["create_initiative", "update_initiative", "save_objective", "save_milestone", "create_call_note"] as const;
export type AssistantProposalKind = typeof assistantProposalKinds[number];

export type AssistantContext = { kind: AssistantContextKind; id: string; label: string };
export type AssistantSavedPrompt = { id: string; scopeKind: AssistantContextKind | null; title: string; promptText: string; updatedAt: string };
export type AssistantScratchpadEntry = { id: string; contextKind: AssistantContextKind; contextId: string; contextLabel: string; title: string; promptText: string; responseText: string; modelName: string | null; groundingSummary: string; createdAt: string };
export type AssistantProposal = { id: string; kind: AssistantProposalKind; title: string; rationale: string; fields: Record<string, string | number | boolean | null> };
export type AssistantAnswer = { answer: string; proposals: AssistantProposal[] };

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const supportedKinds = new Set<string>(assistantContextKinds);
const supportedProposalKinds = new Set<string>(assistantProposalKinds);

export function assistantContext(value: Record<string, unknown>): AssistantContext | null {
  const kind = clean(value.kind);
  const id = clean(value.id);
  const label = clean(value.label);
  return supportedKinds.has(kind) && id && label ? { kind: kind as AssistantContextKind, id, label } : null;
}

export function isAssistantContextKind(value: string): value is AssistantContextKind {
  return supportedKinds.has(value);
}

export function assistantContextHref(context: Pick<AssistantContext, "kind" | "id">) {
  if (context.kind === "initiative") return `/initiatives/${encodeURIComponent(context.id)}`;
  if (context.kind === "change_request") return `/changes/${encodeURIComponent(context.id)}`;
  if (context.kind === "objective") return `/objectives/${encodeURIComponent(context.id)}`;
  if (context.kind === "product") return `/products/${encodeURIComponent(context.id)}`;
  if (context.kind === "platform") return `/platforms/${encodeURIComponent(context.id)}`;
  return `/releases/${encodeURIComponent(context.id)}`;
}

function simpleFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fields: Record<string, string | number | boolean | null> = {};
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,48}$/.test(key)) continue;
    if (candidate === null) fields[key] = null;
    else if (typeof candidate === "boolean" || typeof candidate === "number") fields[key] = candidate;
    else if (typeof candidate === "string") fields[key] = candidate.slice(0, 4_000);
  }
  return fields;
}

function proposal(value: unknown, index: number): AssistantProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = clean(record.kind);
  const title = clean(record.title).slice(0, 180);
  const rationale = clean(record.rationale).slice(0, 2_000);
  if (!supportedProposalKinds.has(kind) || !title || !rationale) return null;
  return { id: `proposal-${index + 1}`, kind: kind as AssistantProposalKind, title, rationale, fields: simpleFields(record.fields) };
}

export function assistantProposal(value: unknown): AssistantProposal | null { return proposal(value, 0); }

/**
 * GenAI.mil deployments commonly provide OpenAI-compatible JSON mode.  If a
 * model ignores JSON mode, retain its plain response for analysis and simply
 * offer no proposed write actions rather than discarding its answer.
 */
export function parseAssistantAnswer(content: string): AssistantAnswer {
  const raw = content.trim();
  if (!raw) return { answer: "GenAI.mil returned an empty response.", proposals: [] };
  const jsonCandidate = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
    const answer = clean(parsed.answer).slice(0, 12_000);
    const proposals = Array.isArray(parsed.proposals) ? parsed.proposals.map(proposal).filter((item): item is AssistantProposal => Boolean(item)).slice(0, 6) : [];
    return { answer: answer || "GenAI.mil returned structured proposals without a narrative answer.", proposals };
  } catch {
    return { answer: raw.slice(0, 12_000), proposals: [] };
  }
}
