export const runtimeAuthModes = ["local-single-user", "sites"] as const;
export type RuntimeAuthMode = typeof runtimeAuthModes[number];

export type RuntimePolicyInput = {
  AUTH_MODE?: unknown;
  DEMO_ENABLED?: unknown;
  WORKSPACE_TRANSFER_MODE?: unknown;
  STEWARD_USER_IDS?: unknown;
};

export type RuntimePolicy = {
  authMode: RuntimeAuthMode;
  demoEnabled: boolean;
  workspaceTransferMode: "disabled" | "local";
  stewardUserIds: ReadonlySet<string>;
};

export function isLoopbackHostname(value: string) {
  const hostname = value.trim().toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function demoEnabledFromValue(value: unknown) {
  // Demonstration behavior is deliberately opt-in. Missing, misspelled, or
  // differently cased values must never seed or replace an operational workspace.
  return value === "true";
}

function authModeFromValue(value: unknown): RuntimeAuthMode {
  if (value === "local-single-user" || value === "sites") return value;
  throw new Error("AUTH_MODE must be exactly local-single-user or sites.");
}

function transferModeFromValue(value: unknown): RuntimePolicy["workspaceTransferMode"] {
  if (value === "disabled" || value === "local") return value;
  throw new Error("WORKSPACE_TRANSFER_MODE must be exactly disabled or local.");
}

function stewardIdsFromValue(value: unknown) {
  if (value === undefined || value === null || value === "") return new Set<string>();
  if (typeof value !== "string") throw new Error("STEWARD_USER_IDS must be a comma-separated string when configured.");
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (values.some((item) => item.length > 256 || /[\r\n]/.test(item))) throw new Error("STEWARD_USER_IDS contains an invalid identifier.");
  return new Set(values);
}

export function readRuntimePolicy(input: RuntimePolicyInput): RuntimePolicy {
  const authMode = authModeFromValue(input.AUTH_MODE);
  const workspaceTransferMode = transferModeFromValue(input.WORKSPACE_TRANSFER_MODE);
  if (authMode === "sites" && workspaceTransferMode !== "disabled") {
    throw new Error("Workspace Transfer must be disabled in Sites authentication mode.");
  }
  return {
    authMode,
    demoEnabled: demoEnabledFromValue(input.DEMO_ENABLED),
    workspaceTransferMode,
    stewardUserIds: stewardIdsFromValue(input.STEWARD_USER_IDS),
  };
}
