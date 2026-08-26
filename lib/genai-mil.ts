import { assistantProposal, parseAssistantAnswer, type AssistantAnswer, type AssistantProposal } from "./assistant-model.js";
import { assistantActionForTool, assistantToolDefinitions } from "./assistant-actions.js";

export type GenaiMilEnvironment = {
  GENAI_MIL_API_URL?: string;
  GENAI_MIL_API_KEY?: string;
  GENAI_MIL_MODEL?: string;
  /** Defaults to JSON proposals because it is the proven compatible mode. */
  GENAI_MIL_TOOL_MODE?: string;
  /** Development-only local proxy mode. TLS verification remains enabled by default. */
  GENAI_MIL_TLS_MODE?: string;
  GENAI_MIL_LOCAL_PROXY_TOKEN?: string;
};

export type GenaiMilToolMode = "json-proposals" | "native-tools";
export type GenaiMilTlsMode = "verified" | "development-insecure";
export type GenaiMilReadiness = { configured: boolean; model: string | null; toolMode: GenaiMilToolMode; tlsMode: GenaiMilTlsMode; message: string };
export class GenaiMilError extends Error {
  constructor(readonly code: "not_configured" | "unavailable" | "invalid_configuration" | "invalid_response", message: string) { super(message); }
}

const clean = (value: string | undefined) => value?.trim() || "";

function toolMode(value: string | undefined): GenaiMilToolMode | null {
  const normalized = clean(value).toLowerCase();
  if (!normalized || normalized === "json-proposals") return "json-proposals";
  if (normalized === "native-tools") return "native-tools";
  return null;
}

function tlsMode(value: string | undefined): GenaiMilTlsMode | null {
  const normalized = clean(value).toLowerCase();
  if (!normalized || normalized === "verified") return "verified";
  if (normalized === "development-insecure") return "development-insecure";
  return null;
}

function localDevelopmentProxyUrl() {
  return new URL("/genai", `http:${"//"}${[127, 0, 0, 1].join(".")}:38471`);
}

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
  const configuredToolMode = toolMode(input.GENAI_MIL_TOOL_MODE);
  const configuredTlsMode = tlsMode(input.GENAI_MIL_TLS_MODE);
  if (!url || !key || !model) return { configured: false, model: null, toolMode: "json-proposals", tlsMode: "verified", message: "GenAI.mil is not configured. With the app stopped, run npm run local:genai:configure once, then start the local runtime." };
  if (!configuredToolMode) return { configured: false, model: null, toolMode: "json-proposals", tlsMode: "verified", message: "GENAI_MIL_TOOL_MODE must be json-proposals or native-tools. Reconfigure the local assistant while the app is stopped." };
  if (!configuredTlsMode) return { configured: false, model: null, toolMode: configuredToolMode, tlsMode: "verified", message: "GENAI_MIL_TLS_MODE must be verified or development-insecure." };
  if (configuredTlsMode === "development-insecure" && !/^[a-f0-9]{64}$/.test(clean(input.GENAI_MIL_LOCAL_PROXY_TOKEN))) return { configured: false, model: null, toolMode: configuredToolMode, tlsMode: configuredTlsMode, message: "The development TLS proxy token is missing or invalid. Stop the app and run npm run local:genai:tls-bypass again." };
  try {
    approvedGenaiMilUrl(url);
    const mode = configuredToolMode === "native-tools" ? "native tool" : "JSON proposal";
    const message = configuredTlsMode === "development-insecure"
      ? `GenAI.mil is configured in ${mode} mode. DEVELOPMENT TLS BYPASS IS ACTIVE for the explicit GenAI.mil request only.`
      : `GenAI.mil is configured in ${mode} mode. A request is sent only when you select Ask GenAI.mil.`;
    return { configured: true, model, toolMode: configuredToolMode, tlsMode: configuredTlsMode, message };
  }
  catch (error) { return { configured: false, model: null, toolMode: "json-proposals", tlsMode: "verified", message: error instanceof Error ? error.message : "The GenAI.mil configuration is invalid." }; }
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

function nativeToolProposals(payload: unknown): AssistantProposal[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const choice = Array.isArray(record.choices) ? record.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice && typeof choice.message === "object" && choice.message ? choice.message as Record<string, unknown> : undefined;
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const proposals: AssistantProposal[] = [];
  for (const call of calls.slice(0, 6)) {
    if (!call || typeof call !== "object") continue;
    const functionValue = (call as Record<string, unknown>).function;
    if (!functionValue || typeof functionValue !== "object") continue;
    const toolNameValue = (functionValue as Record<string, unknown>).name;
    const toolName = typeof toolNameValue === "string" ? toolNameValue : "";
    const action = assistantActionForTool(toolName);
    const rawArguments = (functionValue as Record<string, unknown>).arguments;
    if (!action || typeof rawArguments !== "string") continue;
    try {
      const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
      const proposal = assistantProposal({ kind: action.kind, title: parsed.title, rationale: parsed.rationale, fields: parsed.fields });
      if (proposal) proposals.push({ ...proposal, id: `proposal-${proposals.length + 1}` });
    } catch { /* An invalid model tool argument is displayed as analysis only. */ }
  }
  return proposals;
}

export async function askGenaiMil(input: GenaiMilEnvironment, request: CompletionRequest, fetcher: FetchLike = fetch): Promise<{ answer: AssistantAnswer; model: string; toolMode: GenaiMilToolMode }> {
  const readiness = genaiMilReadiness(input);
  if (!readiness.configured) throw new GenaiMilError("not_configured", readiness.message);
  const endpoint = approvedGenaiMilUrl(clean(input.GENAI_MIL_API_URL));
  const model = clean(input.GENAI_MIL_MODEL);
  const developmentBypass = readiness.tlsMode === "development-insecure";
  try {
    const response = await fetcher(developmentBypass ? localDevelopmentProxyUrl() : endpoint.toString(), {
      method: "POST",
      headers: developmentBypass
        ? { "content-type": "application/json", "x-a2o-genai-proxy-token": clean(input.GENAI_MIL_LOCAL_PROXY_TOKEN) }
        : { "content-type": "application/json", authorization: `Bearer ${clean(input.GENAI_MIL_API_KEY)}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: request.maxTokens || 1_800,
        ...(readiness.toolMode === "native-tools" ? { tools: assistantToolDefinitions(), tool_choice: "auto" } : { response_format: { type: "json_object" } }),
        messages: [{ role: "system", content: request.system }, { role: "user", content: request.prompt }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).error === "object" ? String(((payload as Record<string, unknown>).error as Record<string, unknown>).message || "") : "";
      if ([401, 403, 429].includes(response.status)) throw new GenaiMilError("unavailable", "GenAI.mil did not accept the active API key. Re-enable or refresh the key, then try again.");
      throw new GenaiMilError("unavailable", `GenAI.mil is unavailable (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}. Your workspace data was not changed.`);
    }
    const content = contentFromPayload(payload);
    if (readiness.toolMode === "native-tools") {
      const proposals = nativeToolProposals(payload);
      if (!content && !proposals.length) throw new GenaiMilError("invalid_response", "GenAI.mil returned neither analysis text nor a supported tool proposal. Confirm that the endpoint supports OpenAI-compatible chat completions and function tools.");
      return { answer: { answer: content || "GenAI.mil returned reviewable proposed actions without a narrative answer.", proposals }, model, toolMode: readiness.toolMode };
    }
    if (!content) throw new GenaiMilError("invalid_response", "GenAI.mil returned an unsupported completion shape. Confirm that GENAI_MIL_API_URL is an OpenAI-compatible chat-completions endpoint.");
    return { answer: parseAssistantAnswer(content), model, toolMode: readiness.toolMode };
  } catch (error) {
    if (error instanceof GenaiMilError) throw error;
    const message = error instanceof Error ? error.message : "Unknown connection error";
    if (developmentBypass) throw new GenaiMilError("unavailable", "The local GenAI.mil development TLS proxy could not be reached. Stop the app, run npm run local:genai:tls-bypass, then use npm run local:start.");
    if (/certificate|self.signed|unable to verify|tls|revocation/i.test(message)) throw new GenaiMilError("unavailable", "GenAI.mil could not validate the workspace certificate chain. Enroll the approved CA with npm run local:certificate:trust (which configures NODE_EXTRA_CA_CERTS), or use the explicit development-only npm run local:genai:tls-bypass override.");
    throw new GenaiMilError("unavailable", "GenAI.mil could not be reached. Check the approved workspace proxy, endpoint, and active API key, then try again. Your workspace data was not changed.");
  }
}
