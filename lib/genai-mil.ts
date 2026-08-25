import { parseAssistantAnswer, type AssistantAnswer } from "./assistant-model.js";

export type GenaiMilEnvironment = {
  GENAI_MIL_API_URL?: string;
  GENAI_MIL_API_KEY?: string;
  GENAI_MIL_MODEL?: string;
};

export type GenaiMilReadiness = { configured: boolean; model: string | null; message: string };
export class GenaiMilError extends Error {
  constructor(readonly code: "not_configured" | "unavailable" | "invalid_configuration" | "invalid_response", message: string) { super(message); }
}

const clean = (value: string | undefined) => value?.trim() || "";

/** Only the approved GenAI.mil service can be used as an outbound destination. */
export function approvedGenaiMilUrl(value: string) {
  let endpoint: URL;
  try { endpoint = new URL(value); }
  catch { throw new GenaiMilError("invalid_configuration", "GENAI_MIL_API_URL must be a complete HTTPS GenAI.mil API endpoint."); }
  const host = endpoint.hostname.toLowerCase();
  if (endpoint.protocol !== "https:" || !(host === "genai.mil" || host.endsWith(".genai.mil"))) throw new GenaiMilError("invalid_configuration", "The assistant permits only an HTTPS GenAI.mil endpoint.");
  return endpoint;
}

export function genaiMilReadiness(input: GenaiMilEnvironment): GenaiMilReadiness {
  const url = clean(input.GENAI_MIL_API_URL);
  const key = clean(input.GENAI_MIL_API_KEY);
  const model = clean(input.GENAI_MIL_MODEL);
  if (!url || !key || !model) return { configured: false, model: null, message: "GenAI.mil is not configured. With the app stopped, run npm run local:genai:configure once, then start the local runtime." };
  try { approvedGenaiMilUrl(url); return { configured: true, model, message: "GenAI.mil is configured. A request is sent only when you select Ask GenAI.mil." }; }
  catch (error) { return { configured: false, model: null, message: error instanceof Error ? error.message : "The GenAI.mil configuration is invalid." }; }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type CompletionRequest = { system: string; prompt: string; maxTokens?: number };

function contentFromPayload(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  const choice = Array.isArray(record.choices) ? record.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice && typeof choice.message === "object" && choice.message ? choice.message as Record<string, unknown> : undefined;
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) return message.content.map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).text || "") : "").join("");
  return "";
}

export async function askGenaiMil(input: GenaiMilEnvironment, request: CompletionRequest, fetcher: FetchLike = fetch): Promise<{ answer: AssistantAnswer; model: string }> {
  const readiness = genaiMilReadiness(input);
  if (!readiness.configured) throw new GenaiMilError("not_configured", readiness.message);
  const endpoint = approvedGenaiMilUrl(clean(input.GENAI_MIL_API_URL));
  const model = clean(input.GENAI_MIL_MODEL);
  try {
    const response = await fetcher(endpoint.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${clean(input.GENAI_MIL_API_KEY)}` },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: request.maxTokens || 1_800, response_format: { type: "json_object" }, messages: [{ role: "system", content: request.system }, { role: "user", content: request.prompt }] }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).error === "object" ? String(((payload as Record<string, unknown>).error as Record<string, unknown>).message || "") : "";
      if ([401, 403, 429].includes(response.status)) throw new GenaiMilError("unavailable", "GenAI.mil did not accept the active API key. Re-enable or refresh the key, then try again.");
      throw new GenaiMilError("unavailable", `GenAI.mil is unavailable (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}. Your workspace data was not changed.`);
    }
    const content = contentFromPayload(payload);
    if (!content) throw new GenaiMilError("invalid_response", "GenAI.mil returned an unsupported completion shape. Confirm that GENAI_MIL_API_URL is an OpenAI-compatible chat-completions endpoint.");
    return { answer: parseAssistantAnswer(content), model };
  } catch (error) {
    if (error instanceof GenaiMilError) throw error;
    const message = error instanceof Error ? error.message : "Unknown connection error";
    if (/certificate|self.signed|unable to verify|tls/i.test(message)) throw new GenaiMilError("unavailable", "GenAI.mil could not validate the workspace certificate chain. Install the approved CA with NODE_EXTRA_CA_CERTS; do not disable TLS verification.");
    throw new GenaiMilError("unavailable", "GenAI.mil could not be reached. Check the approved workspace proxy, endpoint, and active API key, then try again. Your workspace data was not changed.");
  }
}
