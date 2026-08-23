export const WORKSPACE_SIGNATURE_TYPE = "a2o.workspace-transfer.signature" as const;
export const WORKSPACE_SIGNATURE_VERSION = "1.0.0" as const;
export const WORKSPACE_SIGNATURE_ALGORITHM = "HMAC-SHA-256" as const;
const signingDomain = "A2O Workspace Transfer Package Signature v1";
const hashPattern = /^[0-9a-f]{64}$/;
const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const signaturePattern = /^[A-Za-z0-9_-]{43}$/;

export type WorkspaceSigningConfig = { keyId: string; key: string };
export type WorkspaceSignatureEnvelope = {
  signatureType: typeof WORKSPACE_SIGNATURE_TYPE;
  signatureVersion: typeof WORKSPACE_SIGNATURE_VERSION;
  algorithm: typeof WORKSPACE_SIGNATURE_ALGORITHM;
  keyId: string;
  manifestSha256: string;
  signature: string;
};

export function workspaceSigningConfig(input: { WORKSPACE_TRANSFER_SIGNING_KEY_ID?: unknown; WORKSPACE_TRANSFER_SIGNING_KEY?: unknown }): WorkspaceSigningConfig {
  if (typeof input.WORKSPACE_TRANSFER_SIGNING_KEY_ID !== "string" || !keyIdPattern.test(input.WORKSPACE_TRANSFER_SIGNING_KEY_ID)) {
    throw new Error("WORKSPACE_TRANSFER_SIGNING_KEY_ID is missing or invalid.");
  }
  if (typeof input.WORKSPACE_TRANSFER_SIGNING_KEY !== "string" || input.WORKSPACE_TRANSFER_SIGNING_KEY.length < 32 || input.WORKSPACE_TRANSFER_SIGNING_KEY.length > 4_096 || /[\r\n\0]/.test(input.WORKSPACE_TRANSFER_SIGNING_KEY)) {
    throw new Error("WORKSPACE_TRANSFER_SIGNING_KEY must contain at least 32 bytes of secret material.");
  }
  if (new TextEncoder().encode(input.WORKSPACE_TRANSFER_SIGNING_KEY).byteLength < 32) throw new Error("WORKSPACE_TRANSFER_SIGNING_KEY must contain at least 32 bytes of secret material.");
  return { keyId: input.WORKSPACE_TRANSFER_SIGNING_KEY_ID, key: input.WORKSPACE_TRANSFER_SIGNING_KEY };
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 16) throw new Error("The workspace signature payload is nested too deeply.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("The workspace signature payload contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 10_000) throw new Error("The workspace signature payload contains too many object fields.");
    return `{${entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => {
      if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") throw new Error("The workspace signature payload contains an unsupported value.");
      return `${JSON.stringify(key)}:${canonicalJson(item, depth + 1)}`;
    }).join(",")}}`;
  }
  throw new Error("The workspace signature payload contains an unsupported value.");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  if (!signaturePattern.test(value)) throw new Error("The workspace package signature is malformed.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=";
  let binary: string;
  try { binary = atob(padded); } catch { throw new Error("The workspace package signature is malformed."); }
  if (binary.length !== 32) throw new Error("The workspace package signature is malformed.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function signingPayload(envelope: Omit<WorkspaceSignatureEnvelope, "signature">, manifest: unknown) {
  return canonicalJson({ domain: signingDomain, ...envelope, manifest });
}

async function hmacKey(config: WorkspaceSigningConfig, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(config.key), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signWorkspaceManifest(manifestText: string, manifest: unknown, config: WorkspaceSigningConfig): Promise<WorkspaceSignatureEnvelope> {
  const unsigned = {
    signatureType: WORKSPACE_SIGNATURE_TYPE,
    signatureVersion: WORKSPACE_SIGNATURE_VERSION,
    algorithm: WORKSPACE_SIGNATURE_ALGORITHM,
    keyId: config.keyId,
    manifestSha256: await sha256Hex(manifestText),
  };
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(config, "sign"), new TextEncoder().encode(signingPayload(unsigned, manifest)));
  return { ...unsigned, signature: base64Url(signature) };
}

function isEnvelope(value: unknown): value is WorkspaceSignatureEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<WorkspaceSignatureEnvelope>;
  return candidate.signatureType === WORKSPACE_SIGNATURE_TYPE
    && candidate.signatureVersion === WORKSPACE_SIGNATURE_VERSION
    && candidate.algorithm === WORKSPACE_SIGNATURE_ALGORITHM
    && typeof candidate.keyId === "string" && keyIdPattern.test(candidate.keyId)
    && typeof candidate.manifestSha256 === "string" && hashPattern.test(candidate.manifestSha256)
    && typeof candidate.signature === "string" && signaturePattern.test(candidate.signature);
}

export async function verifyWorkspaceManifestSignature(manifestText: string, manifest: unknown, envelopeValue: unknown, config: WorkspaceSigningConfig) {
  if (!isEnvelope(envelopeValue)) throw new Error("The workspace package signature is missing or malformed.");
  if (envelopeValue.keyId !== config.keyId) throw new Error("The workspace package was signed by an untrusted key identifier.");
  if (await sha256Hex(manifestText) !== envelopeValue.manifestSha256) throw new Error("The workspace package manifest hash is invalid.");
  const { signature, ...unsigned } = envelopeValue;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(config, "verify"), fromBase64Url(signature), new TextEncoder().encode(signingPayload(unsigned, manifest)));
  if (!valid) throw new Error("The workspace package signature is invalid.");
  return envelopeValue;
}
