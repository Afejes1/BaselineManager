import JSZip from "jszip";

export const MAX_EVIDENCE_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_GOVERNED_EVIDENCE_REFERENCES = 100;
export const MAX_GOVERNED_EVIDENCE_BYTES = 100 * 1024 * 1024;

type ApprovedEvidenceType = { contentType: string; signature?: number[]; text?: boolean; officeRoot?: string };

export const approvedEvidenceTypes: Record<string, ApprovedEvidenceType> = {
  pdf: { contentType: "application/pdf", signature: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  docx: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signature: [0x50, 0x4b, 0x03, 0x04], officeRoot: "word/document.xml" },
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", signature: [0x50, 0x4b, 0x03, 0x04], officeRoot: "xl/workbook.xml" },
  pptx: { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", signature: [0x50, 0x4b, 0x03, 0x04], officeRoot: "ppt/presentation.xml" },
  png: { contentType: "image/png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  jpg: { contentType: "image/jpeg", signature: [0xff, 0xd8, 0xff] },
  jpeg: { contentType: "image/jpeg", signature: [0xff, 0xd8, 0xff] },
  txt: { contentType: "text/plain; charset=utf-8", text: true },
  md: { contentType: "text/markdown; charset=utf-8", text: true },
  csv: { contentType: "text/csv; charset=utf-8", text: true },
  json: { contentType: "application/json; charset=utf-8", text: true },
};

export class EvidenceValidationError extends Error {}

const evidenceHashPattern = /^sha256:[0-9a-f]{64}$/;

export async function evidenceContentHash(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function evidenceHashFromAuditPayload(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const candidate = JSON.parse(value) as { contentHash?: unknown };
    const contentHash = typeof candidate.contentHash === "string" ? candidate.contentHash.toLowerCase() : "";
    return evidenceHashPattern.test(contentHash) ? contentHash : null;
  } catch {
    return null;
  }
}

export type BoundedEvidenceObject = {
  body: ReadableStream<Uint8Array>;
  size?: number;
  customMetadata?: Record<string, string>;
};

type EvidenceObjectReader = {
  get: (key: string) => Promise<BoundedEvidenceObject | null>;
  head?: (key: string) => Promise<{ size?: number; customMetadata?: Record<string, string> } | null>;
};

async function cancelObjectBody(body: ReadableStream<Uint8Array>, reason: string) {
  try { await body.cancel(reason); }
  catch { /* The object is already being rejected; cancellation is best effort. */ }
}

/**
 * Read an object without ever trusting database or object metadata as the
 * allocation boundary. Cloudflare R2 exposes an authoritative `size`, but the
 * streaming cap remains mandatory for compatible test doubles and for defense
 * in depth if metadata and body ever disagree.
 */
export async function readBoundedObjectBytes(object: BoundedEvidenceObject, options: { maxBytes: number; expectedBytes?: number; label?: string }) {
  const label = options.label || "Stored object";
  const maxBytes = Number(options.maxBytes);
  const expectedBytes = options.expectedBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new EvidenceValidationError(`${label} has an invalid read limit.`);
  if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > maxBytes)) {
    await cancelObjectBody(object.body, "invalid expected byte count");
    throw new EvidenceValidationError(`${label} has an invalid expected byte count.`);
  }
  if (object.size !== undefined) {
    if (!Number.isSafeInteger(object.size) || object.size < 0 || object.size > maxBytes || expectedBytes !== undefined && object.size !== expectedBytes) {
      await cancelObjectBody(object.body, "object size exceeds governed bounds");
      throw new EvidenceValidationError(`${label} exceeds or conflicts with its governed byte count.`);
    }
  }

  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new EvidenceValidationError(`${label} returned an invalid binary stream.`);
      if (value.byteLength > maxBytes - total) {
        try { await reader.cancel("object body exceeded governed read limit"); } catch { /* best effort */ }
        throw new EvidenceValidationError(`${label} exceeds its governed byte limit.`);
      }
      const stableChunk = new Uint8Array(value.byteLength);
      stableChunk.set(value);
      chunks.push(stableChunk);
      total += stableChunk.byteLength;
    }
  } catch (error) {
    try { await reader.cancel("bounded object read rejected"); } catch { /* best effort */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (expectedBytes !== undefined && total !== expectedBytes) throw new EvidenceValidationError(`${label} does not match its governed byte count.`);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

export async function evidenceStorageMetadataMatches(bucket: EvidenceObjectReader | undefined, r2Key: string, expectedHash: string | null) {
  if (!bucket || !expectedHash || !evidenceHashPattern.test(expectedHash)) return false;
  try {
    if (bucket.head) {
      const object = await bucket.head(r2Key);
      return object?.customMetadata?.sha256?.toLowerCase() === expectedHash;
    }
    const object = await bucket.get(r2Key);
    if (!object) return false;
    const matches = object.customMetadata?.sha256?.toLowerCase() === expectedHash;
    await object.body.cancel();
    return matches;
  } catch {
    return false;
  }
}

export async function storedEvidenceIntegrityMatches(bucket: EvidenceObjectReader | undefined, input: { fileName: string; r2Key: string; byteSize: number; auditPayload: unknown }) {
  const auditHash = evidenceHashFromAuditPayload(input.auditPayload);
  if (!bucket || !auditHash || !Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > MAX_EVIDENCE_DOCUMENT_BYTES) return false;
  try {
    const object = await bucket.get(input.r2Key);
    if (!object) return false;
    if (object.customMetadata?.sha256?.toLowerCase() !== auditHash) {
      await cancelObjectBody(object.body, "storage integrity metadata mismatch");
      return false;
    }
    const bytes = await readBoundedObjectBytes(object, { maxBytes: input.byteSize, expectedBytes: input.byteSize, label: "Stored evidence" });
    await validateEvidenceBytes(input.fileName, bytes);
    const actualHash = await evidenceContentHash(bytes);
    return actualHash === auditHash;
  } catch {
    return false;
  }
}

async function officeXml(entry: JSZip.JSZipObject) {
  const bytes = await entry.async("uint8array");
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
    || (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff)
    || (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0x00 && bytes[3] === 0x00)) {
    throw new EvidenceValidationError("Office XML parts must use UTF-8 encoding before attachment.");
  }
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new EvidenceValidationError("Office XML parts must be valid UTF-8 before attachment."); }
  if (content.includes("\0")) throw new EvidenceValidationError("Office XML parts must not contain binary or UTF-16 text.");
  const declaration = /^\uFEFF?\s*<\?xml\s+([^?]*)\?>/i.exec(content);
  if (declaration) {
    const encoding = /(?:^|\s)encoding\s*=\s*(["'])([^"']+)\1/i.exec(declaration[1])?.[2];
    if (encoding && !/^utf-?8$/i.test(encoding)) throw new EvidenceValidationError("Office XML parts must declare UTF-8 encoding before attachment.");
  }
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(content)) throw new EvidenceValidationError("Office XML parts with document types or custom entities are not approved evidence.");
  assertWellFormedOfficeXml(content);
  return content;
}

function assertWellFormedOfficeXml(content: string) {
  const stack: string[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const open = content.indexOf("<", cursor);
    if (open < 0) break;
    if (content.startsWith("<!--", open)) {
      const end = content.indexOf("-->", open + 4);
      if (end < 0 || content.slice(open + 4, end).includes("--")) throw new EvidenceValidationError("An Office XML part is not well formed.");
      cursor = end + 3;
      continue;
    }
    if (content.startsWith("<![CDATA[", open)) {
      const end = content.indexOf("]]>", open + 9);
      if (end < 0) throw new EvidenceValidationError("An Office XML part is not well formed.");
      cursor = end + 3;
      continue;
    }
    if (content.startsWith("<?", open)) {
      const end = content.indexOf("?>", open + 2);
      if (end < 0) throw new EvidenceValidationError("An Office XML part is not well formed.");
      cursor = end + 2;
      continue;
    }
    if (content.startsWith("<!", open)) throw new EvidenceValidationError("Unsupported Office XML declarations are not approved evidence.");
    let end = open + 1;
    let quote = "";
    for (; end < content.length; end += 1) {
      const character = content[end];
      if (quote) { if (character === quote) quote = ""; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (end >= content.length || quote) throw new EvidenceValidationError("An Office XML part is not well formed.");
    const token = content.slice(open, end + 1);
    const closing = /^<\/([A-Za-z_][A-Za-z0-9_.:-]*)\s*>$/.exec(token);
    if (closing) {
      if (stack.pop() !== closing[1]) throw new EvidenceValidationError("An Office XML part has mismatched elements.");
    } else {
      const opening = /^<([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[\s\S]*?)?\s*(\/?)>$/.exec(token);
      if (!opening) throw new EvidenceValidationError("An Office XML part is not well formed.");
      if (!opening[2]) stack.push(opening[1]);
    }
    cursor = end + 1;
  }
  if (stack.length) throw new EvidenceValidationError("An Office XML part has unclosed elements.");
}

function extensionOf(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

const pdfNameToken = /\/([^\u0000\t\n\f\r ()<>\[\]{}/%]+)/g;
const pdfWhitespace = "[\\x00\\x09\\x0a\\x0c\\x0d\\x20]";

const activePdfNames = new Set([
  "action", "aa", "goto", "goto3dview", "gotoe", "gotor", "hide", "importdata", "javascript", "js", "launch", "movie", "named", "nop", "openaction",
  "rendition", "resetform", "richmedia", "richmediacontent", "richmediaexecute", "richmediasettings", "sound", "submitform", "thread",
  "screen", "setocgstate", "trans", "uri", "3d", "3dview",
]);
const embeddedPdfNames = new Set(["af", "afrelationship", "collection", "ef", "embeddedfile", "embeddedfiles", "fileattachment", "filespec"]);
const formPdfNames = new Set(["acroform", "co", "fields", "ft", "needappearances", "widget", "xfa"]);
const encryptedPdfNames = new Set(["crypt", "encrypt"]);

function decodedPdfNames(text: string) {
  const names: string[] = [];
  for (const match of text.matchAll(pdfNameToken)) {
    // PDF names use # followed by two hexadecimal digits to encode one byte.
    // Decode exactly once: a decoded # is a literal name byte, not a second
    // escape introducer.
    names.push(match[1].replace(/#([0-9a-f]{2})/gi, (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
  }
  return names;
}

type PdfSyntaxToken = { kind: "dictionaryStart" | "dictionaryEnd" | "arrayStart" | "arrayEnd" | "name" | "number" | "word" | "string"; value?: string };
type PdfSyntaxValue =
  | { kind: "dictionary"; entries: Map<string, PdfSyntaxValue> }
  | { kind: "array"; values: PdfSyntaxValue[] }
  | { kind: "reference"; objectNumber: string; generation: string }
  | { kind: "name"; value: string }
  | { kind: "number"; value: number }
  | { kind: "scalar" };

const pdfSyntaxWhitespace = (character: string) => /[\x00\t\n\f\r ]/.test(character);
const pdfSyntaxDelimiter = (character: string) => !character || pdfSyntaxWhitespace(character) || /[()<>\[\]{}/%]/.test(character);

function pdfSyntaxTokens(source: string) {
  const tokens: PdfSyntaxToken[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    if (pdfSyntaxWhitespace(character)) { cursor += 1; continue; }
    if (character === "%") {
      while (cursor < source.length && source[cursor] !== "\r" && source[cursor] !== "\n") cursor += 1;
      continue;
    }
    if (character === "(") {
      let depth = 1;
      cursor += 1;
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === "\\") {
          cursor += 1;
          if (source[cursor] === "\r" && source[cursor + 1] === "\n") cursor += 2;
          else if (cursor < source.length) cursor += 1;
        } else {
          if (source[cursor] === "(") depth += 1;
          else if (source[cursor] === ")") depth -= 1;
          cursor += 1;
        }
      }
      if (depth) throw new EvidenceValidationError("The PDF contains an unterminated literal string.");
      tokens.push({ kind: "string" });
      continue;
    }
    if (character === "<") {
      if (source[cursor + 1] === "<") { tokens.push({ kind: "dictionaryStart" }); cursor += 2; continue; }
      const end = source.indexOf(">", cursor + 1);
      if (end < 0 || /[^0-9a-f\s]/i.test(source.slice(cursor + 1, end))) throw new EvidenceValidationError("The PDF contains an invalid hexadecimal string.");
      tokens.push({ kind: "string" });
      cursor = end + 1;
      continue;
    }
    if (character === ">") {
      if (source[cursor + 1] !== ">") throw new EvidenceValidationError("The PDF contains an unmatched dictionary delimiter.");
      tokens.push({ kind: "dictionaryEnd" });
      cursor += 2;
      continue;
    }
    if (character === "[") { tokens.push({ kind: "arrayStart" }); cursor += 1; continue; }
    if (character === "]") { tokens.push({ kind: "arrayEnd" }); cursor += 1; continue; }
    if (character === "/") {
      const start = ++cursor;
      while (cursor < source.length && !pdfSyntaxDelimiter(source[cursor])) cursor += 1;
      const value = source.slice(start, cursor).replace(/#([0-9a-f]{2})/gi, (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
      tokens.push({ kind: "name", value });
      continue;
    }
    const start = cursor;
    while (cursor < source.length && !pdfSyntaxDelimiter(source[cursor])) cursor += 1;
    if (cursor === start) throw new EvidenceValidationError("The PDF contains an unsupported object token.");
    const value = source.slice(start, cursor);
    tokens.push({ kind: /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? "number" : "word", value });
  }
  return tokens;
}

function parsePdfSyntaxValue(tokens: PdfSyntaxToken[], start: number): { value: PdfSyntaxValue; next: number } {
  const token = tokens[start];
  if (!token) throw new EvidenceValidationError("The PDF dictionary contains a missing value.");
  if (token.kind === "dictionaryStart") {
    const entries = new Map<string, PdfSyntaxValue>();
    let cursor = start + 1;
    while (tokens[cursor]?.kind !== "dictionaryEnd") {
      const key = tokens[cursor];
      if (!key || key.kind !== "name" || key.value == null) throw new EvidenceValidationError("The PDF dictionary contains an invalid key.");
      if (entries.has(key.value)) throw new EvidenceValidationError("The PDF dictionary contains a duplicate key.");
      const parsed = parsePdfSyntaxValue(tokens, cursor + 1);
      entries.set(key.value, parsed.value);
      cursor = parsed.next;
    }
    return { value: { kind: "dictionary", entries }, next: cursor + 1 };
  }
  if (token.kind === "arrayStart") {
    const values: PdfSyntaxValue[] = [];
    let cursor = start + 1;
    while (tokens[cursor]?.kind !== "arrayEnd") {
      if (!tokens[cursor]) throw new EvidenceValidationError("The PDF contains an unterminated array.");
      const parsed = parsePdfSyntaxValue(tokens, cursor);
      values.push(parsed.value);
      cursor = parsed.next;
    }
    return { value: { kind: "array", values }, next: cursor + 1 };
  }
  if (token.kind === "number") {
    const generation = tokens[start + 1];
    const reference = tokens[start + 2];
    if (generation?.kind === "number" && reference?.kind === "word" && reference.value === "R"
      && /^\d+$/.test(token.value || "") && /^\d+$/.test(generation.value || "")) {
      return { value: { kind: "reference", objectNumber: token.value!, generation: generation.value! }, next: start + 3 };
    }
    const value = Number(token.value);
    if (!Number.isFinite(value)) throw new EvidenceValidationError("The PDF contains an invalid number.");
    return { value: { kind: "number", value }, next: start + 1 };
  }
  if (token.kind === "name") return { value: { kind: "name", value: token.value || "" }, next: start + 1 };
  if (token.kind === "word" || token.kind === "string") return { value: { kind: "scalar" }, next: start + 1 };
  throw new EvidenceValidationError("The PDF contains an unexpected object delimiter.");
}

function pdfObjectDictionary(object: string) {
  const header = /^\d+\s+\d+\s+obj\b/.exec(object);
  const end = object.lastIndexOf("endobj");
  if (!header || end < header[0].length) throw new EvidenceValidationError("The PDF indirect object is incomplete.");
  const tokens = pdfSyntaxTokens(object.slice(header[0].length, end));
  const parsed = parsePdfSyntaxValue(tokens, 0);
  if (parsed.value.kind !== "dictionary" || parsed.next !== tokens.length) throw new EvidenceValidationError("The PDF catalog and page-tree objects must be actual standalone dictionaries.");
  return parsed.value.entries;
}

function xmlText(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => { const code = Number.parseInt(hex, 16); return Number.isSafeInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd"; })
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => { const code = Number.parseInt(decimal, 10); return Number.isSafeInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd"; })
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function xmlElementText(value: string) {
  return xmlText(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, ""));
}

function officeXmlSemanticMarkup(value: string) {
  // Semantic package checks must only inspect real XML elements. Comments,
  // CDATA, and processing instructions may legally contain tag-shaped text,
  // but an OPC consumer never treats that text as package metadata.
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    .replace(/<\?[\s\S]*?\?>/g, " ");
}

function officeXmlAttribute(attributes: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(attributes);
  return match ? xmlText(match[2]) : null;
}

function spreadsheetFormulaIsActive(formula: string) {
  const normalized = xmlElementText(formula).trim();
  return /(?:^|[^A-Za-z0-9_.])(?:_xlfn\.)?(?:WEBSERVICE|HYPERLINK|RTD|CALL|REGISTER\.ID|EXEC|IMAGE|STOCKHISTORY)\s*\(/i.test(normalized)
    || /(?:^|[=+\-@\s])[A-Za-z][A-Za-z0-9_.-]*\s*\|[^!\r\n]{0,2048}!/i.test(normalized)
    || /(?:https?|ftp|file):\/\/|\\\\|\[[^\]\r\n]+\][^!\r\n]*!/i.test(normalized);
}

function validateCsvCells(text: string) {
  const dangerous = (raw: string) => {
    const value = raw.trimStart();
    if (/^[=+@]/.test(value)) return true;
    return value.startsWith("-") && !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(value);
  };
  let cell = "";
  let quoted = false;
  let atCellStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (atCellStart && character === '"') { quoted = true; atCellStart = false; continue; }
    if (character === "," || character === ";" || character === "\t" || character === "\r" || character === "\n") {
      if (dangerous(cell)) throw new EvidenceValidationError("CSV cells beginning with spreadsheet formula operators are not approved evidence. Export values-only CSV content before attachment.");
      cell = "";
      atCellStart = true;
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      continue;
    }
    cell += character;
    atCellStart = false;
  }
  if (quoted) throw new EvidenceValidationError("The CSV evidence contains an unterminated quoted cell.");
  if (dangerous(cell)) throw new EvidenceValidationError("CSV cells beginning with spreadsheet formula operators are not approved evidence. Export values-only CSV content before attachment.");
}

function markdownCharacterIsEscaped(text: string, index: number) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function decodedMarkdownDestination(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", bsol: "\\", colon: ":", gt: ">", lt: "<", newline: "\n", period: ".", plus: "+", quot: '"', sol: "/", tab: "\t" };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => { const code = Number.parseInt(hex, 16); return Number.isSafeInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd"; })
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => { const code = Number.parseInt(decimal, 10); return Number.isSafeInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd"; })
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name.toLowerCase()] ?? entity)
    .replace(/\\([!"#$%&'()*+,./:;<=>?@[\]\\^_`{|}~-])/g, "$1");
}

function markdownDestinationIsActive(rawValue: string) {
  let value = rawValue.trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  const decoded = decodedMarkdownDestination(value);
  // URL parsers discard ASCII whitespace/control characters around and, for
  // dangerous schemes, within the scheme token. Compact them before checking
  // so entity-encoded tabs/newlines cannot disguise an executable destination.
  const compacted = decoded.replace(/[\u0000-\u0020\u007f]+/g, "");
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\\\\)/i.test(compacted)) return true;
  // Unknown character references in the leading token are ambiguous across
  // Markdown renderers. Fail closed rather than letting a named entity conceal
  // a scheme or protocol-relative prefix.
  const leadingToken = value.split(/[/?#]/, 1)[0];
  return /&(?:#[xX]?[0-9a-f]+|[a-z][a-z0-9]+);/i.test(leadingToken) && /:|&(?:colon|sol|bsol);/i.test(value);
}

function validateMarkdownText(text: string) {
  for (const match of text.matchAll(/<\s*\/?\s*[a-z][^>\r\n]*>/gim)) {
    if (!markdownCharacterIsEscaped(text, match.index!)) throw new EvidenceValidationError("Markdown evidence cannot contain raw HTML. Export a flattened document or plain Markdown text.");
  }
  for (const match of text.matchAll(/!\[/gm)) {
    if (!markdownCharacterIsEscaped(text, match.index!)) throw new EvidenceValidationError("Markdown evidence cannot contain embedded images. Attach the image as separate governed evidence.");
  }
  for (const match of text.matchAll(/\[[^\]\r\n]+\]\(\s*(<[^>\r\n]*>|[^\s\r\n)]*)/g)) {
    if (!markdownCharacterIsEscaped(text, match.index!) && markdownDestinationIsActive(match[1])) throw new EvidenceValidationError("Markdown evidence cannot contain external or executable links. Record external locators as plain text.");
  }
  for (const match of text.matchAll(/^[ \t]{0,3}\[[^\]\r\n]+\]:[ \t]*(<[^>\r\n]*>|[^\s\r\n]+)/gm)) {
    const destinationIndex = match.index! + match[0].lastIndexOf(match[1]);
    if (!markdownCharacterIsEscaped(text, match.index! + match[0].indexOf("[")) && !markdownCharacterIsEscaped(text, destinationIndex) && markdownDestinationIsActive(match[1])) throw new EvidenceValidationError("Markdown evidence cannot contain external or executable links. Record external locators as plain text.");
  }
}

const readUint32 = (bytes: Uint8Array, offset: number) => ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;

function pngCrc32(bytes: Uint8Array, start: number, length: number) {
  let crc = 0xffffffff;
  for (let index = start; index < start + length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function validatePngDocument(bytes: Uint8Array) {
  if (bytes.byteLength < 57) throw new EvidenceValidationError("The PNG evidence is truncated.");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let sawHeader = false;
  let sawPalette = false;
  let sawData = false;
  let sawEnd = false;
  const dataChunks: Uint8Array[] = [];
  const allowedCritical = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new EvidenceValidationError("The PNG evidence contains a truncated chunk.");
    const length = readUint32(bytes, offset);
    if (length > bytes.byteLength - offset - 12) throw new EvidenceValidationError("The PNG evidence contains an invalid chunk length.");
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) throw new EvidenceValidationError("The PNG evidence contains an invalid chunk type.");
    const dataStart = offset + 8;
    const storedCrc = readUint32(bytes, dataStart + length);
    if (pngCrc32(bytes, offset + 4, length + 4) !== storedCrc) throw new EvidenceValidationError("The PNG evidence failed chunk integrity validation.");
    if (type[0] === type[0].toUpperCase() && !allowedCritical.has(type)) throw new EvidenceValidationError("The PNG evidence contains an unsupported critical chunk.");
    if (["acTL", "fcTL", "fdAT"].includes(type)) throw new EvidenceValidationError("Animated PNG evidence must be flattened to a static image.");
    if (type === "IHDR") {
      if (sawHeader || offset !== 8 || length !== 13) throw new EvidenceValidationError("The PNG evidence has an invalid image header.");
      width = readUint32(bytes, dataStart);
      height = readUint32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!width || !height || width > 50_000 || height > 50_000 || width * height > 100_000_000 || !validDepths[colorType]?.includes(bitDepth) || bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 || bytes[dataStart + 12] !== 0) throw new EvidenceValidationError("The PNG image header is unsupported or exceeds inspection limits.");
      sawHeader = true;
    } else if (type === "PLTE") {
      if (!sawHeader || sawData || !length || length % 3 !== 0 || length > 768) throw new EvidenceValidationError("The PNG evidence contains an invalid palette.");
      sawPalette = true;
    } else if (type === "IDAT") {
      if (!sawHeader || sawEnd || !length) throw new EvidenceValidationError("The PNG evidence contains an invalid image-data sequence.");
      sawData = true;
      dataChunks.push(bytes.slice(dataStart, dataStart + length));
    } else if (type === "IEND") {
      if (!sawData || sawEnd || length !== 0 || offset + 12 !== bytes.byteLength) throw new EvidenceValidationError("The PNG evidence has an invalid end marker or trailing bytes.");
      sawEnd = true;
    }
    offset += length + 12;
  }
  if (!sawHeader || !sawData || !sawEnd || colorType === 3 && !sawPalette) throw new EvidenceValidationError("The PNG evidence is missing required image structure.");
  const compressedLength = dataChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const compressed = new Uint8Array(compressedLength);
  let writeOffset = 0;
  for (const chunk of dataChunks) { compressed.set(chunk, writeOffset); writeOffset += chunk.byteLength; }
  const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const expectedBytes = height * (rowBytes + 1);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > 200 * 1024 * 1024) throw new EvidenceValidationError("The expanded PNG evidence exceeds inspection limits.");
  try {
    const reader = new Blob([compressed.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    let expanded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value) {
        if (expanded % (rowBytes + 1) === 0 && byte > 4) throw new EvidenceValidationError("The PNG evidence contains an invalid scanline filter.");
        expanded += 1;
        if (expanded > expectedBytes) throw new EvidenceValidationError("The PNG image data exceeds its declared dimensions.");
      }
    }
    if (expanded !== expectedBytes) throw new EvidenceValidationError("The PNG image data does not match its declared dimensions.");
  } catch (error) {
    if (error instanceof EvidenceValidationError) throw error;
    throw new EvidenceValidationError("The PNG image data could not be decoded.");
  }
}

function validateJpegDocument(bytes: Uint8Array) {
  if (bytes.byteLength < 32 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new EvidenceValidationError("The JPEG evidence is truncated or has an invalid start marker.");
  let offset = 2;
  let sawFrame = false;
  let sawQuantization = false;
  let sawHuffman = false;
  let sawScan = false;
  let entropyBytes = 0;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) throw new EvidenceValidationError("The JPEG evidence contains data outside an image scan.");
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) throw new EvidenceValidationError("The JPEG evidence is missing its end marker.");
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (offset !== bytes.byteLength || !sawFrame || !sawQuantization || !sawHuffman || !sawScan || entropyBytes < 1) throw new EvidenceValidationError("The JPEG evidence is incomplete or has trailing bytes.");
      return;
    }
    if (marker === 0xd8 || marker === 0x00 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) throw new EvidenceValidationError("The JPEG evidence contains an invalid marker sequence.");
    if (offset + 2 > bytes.byteLength) throw new EvidenceValidationError("The JPEG evidence contains a truncated segment.");
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.byteLength) throw new EvidenceValidationError("The JPEG evidence contains an invalid segment length.");
    const dataStart = offset + 2;
    const dataEnd = offset + length;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 11) throw new EvidenceValidationError("The JPEG frame header is truncated.");
      const height = (bytes[dataStart + 1] << 8) | bytes[dataStart + 2];
      const width = (bytes[dataStart + 3] << 8) | bytes[dataStart + 4];
      const components = bytes[dataStart + 5];
      if (bytes[dataStart] !== 8 || !width || !height || width * height > 100_000_000 || ![1, 3, 4].includes(components) || length !== 8 + components * 3) throw new EvidenceValidationError("The JPEG frame header is unsupported or invalid.");
      sawFrame = true;
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      throw new EvidenceValidationError("Only baseline or progressive Huffman JPEG evidence is approved.");
    } else if (marker === 0xdb) sawQuantization = true;
    else if (marker === 0xc4) sawHuffman = true;
    if (marker === 0xda) {
      if (!sawFrame || length < 8) throw new EvidenceValidationError("The JPEG scan header is invalid.");
      sawScan = true;
      offset = dataEnd;
      const scanStart = offset;
      while (offset < bytes.byteLength) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        let markerOffset = offset + 1;
        while (markerOffset < bytes.byteLength && bytes[markerOffset] === 0xff) markerOffset += 1;
        if (markerOffset >= bytes.byteLength) break;
        const nextMarker = bytes[markerOffset];
        if (nextMarker === 0x00 || nextMarker >= 0xd0 && nextMarker <= 0xd7) { offset = markerOffset + 1; continue; }
        entropyBytes += offset - scanStart;
        break;
      }
      continue;
    }
    offset = dataEnd;
  }
  throw new EvidenceValidationError("The JPEG evidence is missing its final end marker.");
}

function validatePdfDocument(bytes: Uint8Array) {
  const text = new TextDecoder("latin1").decode(bytes);
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:[\t\r\n ]|$)/.test(text.slice(0, 16))) {
    throw new EvidenceValidationError("The PDF header does not declare a supported PDF version.");
  }

  const startXref = text.lastIndexOf("startxref");
  if (startXref < 0) throw new EvidenceValidationError("The PDF is missing its final cross-reference marker.");
  const finalTrailer = text.slice(startXref);
  const trailerMatch = new RegExp(`^startxref${pdfWhitespace}+(\\d+)${pdfWhitespace}+%%EOF${pdfWhitespace}*$`).exec(finalTrailer);
  if (!trailerMatch) throw new EvidenceValidationError("The PDF is truncated or has content after its final end-of-file marker.");
  const crossReferenceOffset = Number(trailerMatch[1]);
  if (!Number.isSafeInteger(crossReferenceOffset) || crossReferenceOffset <= 0 || crossReferenceOffset >= startXref) {
    throw new EvidenceValidationError("The PDF cross-reference offset is invalid.");
  }
  const crossReferenceTarget = text.slice(crossReferenceOffset, startXref);
  if (!/^xref\b/.test(crossReferenceTarget)) throw new EvidenceValidationError("Use a flattened PDF with a classic inspectable cross-reference table; cross-reference streams are not approved evidence.");
  const trailerIndex = crossReferenceTarget.indexOf("trailer");
  if (trailerIndex < 0) throw new EvidenceValidationError("The PDF cross-reference table does not contain a document trailer.");
  const entries = new Map<string, number>();
  let cursor = 4;
  const skipWhitespace = () => { while (cursor < trailerIndex && /[\x00\t\n\f\r ]/.test(crossReferenceTarget[cursor])) cursor += 1; };
  while (true) {
    skipWhitespace();
    if (cursor >= trailerIndex) break;
    const subsection = /^(\d+)\s+(\d+)[\t ]*(?:\r\n|\r|\n)/.exec(crossReferenceTarget.slice(cursor));
    if (!subsection) throw new EvidenceValidationError("The PDF cross-reference table contains an invalid subsection header.");
    const firstObject = Number(subsection[1]);
    const count = Number(subsection[2]);
    if (!Number.isSafeInteger(firstObject) || !Number.isSafeInteger(count) || count < 1 || count > 1_000_000) throw new EvidenceValidationError("The PDF cross-reference table contains an invalid object range.");
    cursor += subsection[0].length;
    for (let index = 0; index < count; index += 1) {
      const entry = /^(\d{10})[\t ](\d{5})[\t ]([nf])[\t ]*(?:\r\n|\r|\n)/.exec(crossReferenceTarget.slice(cursor));
      if (!entry) throw new EvidenceValidationError("The PDF cross-reference table contains an invalid object entry.");
      if (entry[3] === "n") entries.set(`${firstObject + index}:${Number(entry[2])}`, Number(entry[1]));
      cursor += entry[0].length;
    }
  }
  const trailerText = crossReferenceTarget.slice(trailerIndex + "trailer".length);
  const trailerDictionary = /^\s*<<([\s\S]*?)>>/.exec(trailerText)?.[1];
  if (!trailerDictionary || /\/Prev\b/.test(trailerDictionary)) throw new EvidenceValidationError("Use a flattened PDF with one complete, non-incremental cross-reference table.");
  const root = /\/Root\s+(\d+)\s+(\d+)\s+R\b/.exec(trailerDictionary);
  const size = /\/Size\s+(\d+)\b/.exec(trailerDictionary);
  if (!root || !size || Number(size[1]) < 1) throw new EvidenceValidationError("The PDF trailer does not identify a valid document catalog.");
  const objectText = (objectNumber: string, generation: string) => {
    const offset = entries.get(`${Number(objectNumber)}:${Number(generation)}`);
    if (!Number.isSafeInteger(offset) || offset! <= 0 || offset! >= crossReferenceOffset) throw new EvidenceValidationError("The PDF references an object outside its authenticated cross-reference table.");
    const candidate = text.slice(offset!, crossReferenceOffset);
    const header = new RegExp(`^${Number(objectNumber)}\\s+${Number(generation)}\\s+obj\\b`).exec(candidate);
    const end = candidate.indexOf("endobj", header?.[0].length || 0);
    if (!header || end < 0) throw new EvidenceValidationError("The PDF cross-reference table does not resolve to a complete indirect object.");
    return candidate.slice(0, end + 6);
  };
  const catalog = pdfObjectDictionary(objectText(root[1], root[2]));
  const catalogType = catalog.get("Type");
  if (catalogType?.kind !== "name" || catalogType.value !== "Catalog") throw new EvidenceValidationError("The PDF root object is not a document catalog.");
  const pagesReference = catalog.get("Pages");
  if (pagesReference?.kind !== "reference") throw new EvidenceValidationError("The PDF catalog does not identify a page tree.");
  const visited = new Set<string>();
  const inspectPageTree = (objectNumber: string, generation: string, depth = 0): number => {
    const key = `${Number(objectNumber)}:${Number(generation)}`;
    if (depth > 64 || visited.has(key) || visited.size > 10_000) throw new EvidenceValidationError("The PDF page tree is cyclic or exceeds inspection limits.");
    visited.add(key);
    const object = pdfObjectDictionary(objectText(objectNumber, generation));
    const objectType = object.get("Type");
    if (objectType?.kind === "name" && objectType.value === "Page") return 1;
    if (objectType?.kind !== "name" || objectType.value !== "Pages") throw new EvidenceValidationError("The PDF page tree contains a non-page object.");
    const count = object.get("Count");
    const kids = object.get("Kids");
    if (count?.kind !== "number" || !Number.isSafeInteger(count.value) || count.value < 1 || kids?.kind !== "array" || !kids.values.length) throw new EvidenceValidationError("The PDF does not contain an inspectable non-empty page tree.");
    if (kids.values.some((reference) => reference.kind !== "reference")) throw new EvidenceValidationError("The PDF page tree contains a non-reference child.");
    const actualCount = kids.values.reduce((sum, reference) => {
      if (reference.kind !== "reference") return sum;
      return sum + inspectPageTree(reference.objectNumber, reference.generation, depth + 1);
    }, 0);
    if (actualCount !== count.value) throw new EvidenceValidationError("The PDF page-tree count does not match its resolved pages.");
    return actualCount;
  };
  if (inspectPageTree(pagesReference.objectNumber, pagesReference.generation) < 1) throw new EvidenceValidationError("The PDF does not contain an inspectable page.");

  const names = decodedPdfNames(text);
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  if (!normalizedNames.has("catalog") || !normalizedNames.has("pages")) {
    throw new EvidenceValidationError("The PDF does not contain the required document catalog and page tree.");
  }
  if (normalizedNames.has("objstm") || normalizedNames.has("xref")) throw new EvidenceValidationError("PDF object or cross-reference streams are not approved because they can conceal document objects from bounded inspection.");
  if (names.some((name) => activePdfNames.has(name.toLowerCase()))) {
    throw new EvidenceValidationError("PDFs with actions, scripts, external links, or multimedia must be flattened before attachment.");
  }
  if (names.some((name) => embeddedPdfNames.has(name.toLowerCase()))) {
    throw new EvidenceValidationError("PDFs with embedded files, portfolios, or file-attachment annotations must be flattened before attachment.");
  }
  if (names.some((name) => formPdfNames.has(name.toLowerCase()))) {
    throw new EvidenceValidationError("Interactive PDF forms and XFA documents must be flattened before attachment.");
  }
  if (names.some((name) => encryptedPdfNames.has(name.toLowerCase()))) {
    throw new EvidenceValidationError("Encrypted PDFs are not approved evidence because their contents cannot be fully inspected.");
  }
}

async function validateOfficePackage(fileName: string, bytes: Uint8Array, expectedRoot: string) {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new EvidenceValidationError(`The ${extensionOf(fileName).toUpperCase()} file is not a valid modern Office package.`); }
  const entries = Object.values(zip.files);
  if (entries.length > 5_000) throw new EvidenceValidationError("The Office document contains too many package entries.");
  const expandedBytes = entries.reduce((sum, entry) => sum + Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0), 0);
  if (expandedBytes > 50 * 1024 * 1024) throw new EvidenceValidationError("The expanded Office document exceeds the evidence processing limit.");
  const rootEntry = zip.file(expectedRoot);
  const contentTypesEntry = zip.file("[Content_Types].xml");
  const packageRelationshipsEntry = zip.file("_rels/.rels");
  if (!rootEntry || !contentTypesEntry || !packageRelationshipsEntry) throw new EvidenceValidationError(`The .${extensionOf(fileName)} package does not contain the expected Office document structure.`);
  const names = entries.map((entry) => entry.name.toLowerCase());
  if (names.some((name) => name.includes("vbaproject.bin") || name.includes("/embeddings/") || name.includes("oleobject"))) throw new EvidenceValidationError("Macro or embedded-object Office documents are not approved evidence types.");
  if (names.some((name) => /(?:^|\/)(?:activex|ctrlprops|customui|webextensions)(?:\/|$)/i.test(name))) throw new EvidenceValidationError("Office documents with active controls or web extensions are not approved evidence types.");
  const contentTypes = officeXmlSemanticMarkup(await officeXml(contentTypesEntry));
  const contentTypesRoot = /^\uFEFF?\s*<Types\b([^>]*)>/i.exec(contentTypes);
  if (!contentTypesRoot || officeXmlAttribute(contentTypesRoot[1], "xmlns") !== "http://schemas.openxmlformats.org/package/2006/content-types") throw new EvidenceValidationError("The Office package content-type manifest is invalid.");
  const extension = extensionOf(fileName);
  const expectedContentType = extension === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    : extension === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
  const overrides = [...contentTypes.matchAll(/<Override\b([^>]*)\/?\s*>/gi)];
  const hasExpectedOverride = overrides.some((match) => {
    const partName = officeXmlAttribute(match[1], "PartName")?.replace(/^\//, "");
    const contentType = officeXmlAttribute(match[1], "ContentType");
    return partName === expectedRoot && contentType === expectedContentType;
  });
  if (!hasExpectedOverride) throw new EvidenceValidationError("The Office package does not declare the expected main document content type.");
  const declaredContentTypes = [...contentTypes.matchAll(/<(?:Default|Override)\b([^>]*)\/?\s*>/gi)].map((match) => officeXmlAttribute(match[1], "ContentType") || "");
  if (declaredContentTypes.some((contentType) => /macroenabled|vnd\.ms-office\.vba/i.test(contentType))) throw new EvidenceValidationError("Macro-enabled Office documents are not approved evidence types.");
  const packageRelationships = officeXmlSemanticMarkup(await officeXml(packageRelationshipsEntry));
  const packageRelationshipsRoot = /^\uFEFF?\s*<Relationships\b([^>]*)>/i.exec(packageRelationships);
  if (!packageRelationshipsRoot || officeXmlAttribute(packageRelationshipsRoot[1], "xmlns") !== "http://schemas.openxmlformats.org/package/2006/relationships") throw new EvidenceValidationError("The Office package relationship manifest is invalid.");
  const hasMainRelationship = [...packageRelationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)].some((match) => {
    const type = officeXmlAttribute(match[1], "Type");
    const target = officeXmlAttribute(match[1], "Target")?.replace(/^\//, "").replaceAll("\\", "/");
    const targetMode = officeXmlAttribute(match[1], "TargetMode");
    return type?.endsWith("/officeDocument") && target === expectedRoot && !targetMode;
  });
  if (!hasMainRelationship) throw new EvidenceValidationError("The Office package does not resolve its main document relationship.");
  const rootXml = officeXmlSemanticMarkup(await officeXml(rootEntry));
  const rootLocalName = extension === "docx" ? "document" : extension === "xlsx" ? "workbook" : "presentation";
  const transitionalNamespacePath = extension === "docx" ? "wordprocessingml/2006/main" : extension === "xlsx" ? "spreadsheetml/2006/main" : "presentationml/2006/main";
  const strictNamespacePath = extension === "docx" ? "wordprocessingml/main" : extension === "xlsx" ? "spreadsheetml/main" : "presentationml/main";
  const rootMatch = new RegExp(`^\\uFEFF?\\s*<(?:(?<prefix>[A-Za-z_][A-Za-z0-9_.-]*):)?${rootLocalName}\\b(?<attributes>[^>]*)>`, "i").exec(rootXml);
  const prefix = rootMatch?.groups?.prefix || "";
  const attributes = rootMatch?.groups?.attributes || "";
  const namespace = officeXmlAttribute(attributes, prefix ? `xmlns:${prefix}` : "xmlns");
  if (!rootMatch || ![`http://schemas.openxmlformats.org/${transitionalNamespacePath}`, `http://purl.oclc.org/ooxml/${strictNamespacePath}`].includes(namespace || "")) throw new EvidenceValidationError("The Office package main part does not contain the expected document root and namespace.");
  for (const entry of entries.filter((item) => item.name.endsWith(".rels"))) {
    const relationships = officeXmlSemanticMarkup(await officeXml(entry));
    for (const relationship of relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)) {
      const type = officeXmlAttribute(relationship[1], "Type") || "";
      const target = officeXmlAttribute(relationship[1], "Target") || "";
      const targetMode = officeXmlAttribute(relationship[1], "TargetMode") || "";
      if (/^External$/i.test(targetMode)
        || /\/relationships\/(?:hyperlink|attachedTemplate|externalLink|oleObject|package|control)(?:[#\s]|$)/i.test(type)
        || /(?:https?:|ftp:|file:|\\\\)/i.test(target)) {
        throw new EvidenceValidationError("Office documents with external, linked, or active relationships must be sanitized before attachment.");
      }
    }
  }
  if (extension === "xlsx") {
    if (names.some((name) => /^xl\/(?:externalLinks|connections\.xml|queryTables|customData|model|macrosheets|dialogsheets)(?:\/|$)/i.test(name))) throw new EvidenceValidationError("Spreadsheets with external data connections, query content, or macro sheets must be exported as values-only evidence.");
    for (const entry of entries.filter((item) => /^xl\/.*\.xml$/i.test(item.name))) {
      const content = await officeXml(entry);
      const formulas = [
        ...[...content.matchAll(/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?f\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][A-Za-z0-9_.-]*:)?f>/gi)].map((match) => match[1]),
        ...[...content.matchAll(/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?definedName\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][A-Za-z0-9_.-]*:)?definedName>/gi)].map((match) => match[1]),
      ];
      if (formulas.some(spreadsheetFormulaIsActive)) throw new EvidenceValidationError("Spreadsheets with external, DDE, link, or executable formulas must be exported as values-only evidence.");
    }
  }
  if (extension === "docx") {
    if (names.some((name) => /^word\/(?:afchunk|altchunk)/i.test(name))) throw new EvidenceValidationError("Word documents with alternative-format chunks are not approved evidence types.");
    for (const entry of entries.filter((item) => /^word\/.*\.xml$/i.test(item.name))) {
      const content = await officeXml(entry);
      if (/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?(?:altChunk|oleObject)\b/i.test(content)) throw new EvidenceValidationError("Word documents with linked or embedded active content are not approved evidence types.");
      const instructionText = [...content.matchAll(/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?instrText\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][A-Za-z0-9_.-]*:)?instrText>/gi)].map((match) => xmlElementText(match[1]));
      const simpleInstructions = [...content.matchAll(/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?fldSimple\b([^>]*)>/gi)].flatMap((match) => {
        const attribute = /(?:^|\s)(?:[A-Za-z_][A-Za-z0-9_.-]*:)?instr\s*=\s*(["'])([\s\S]*?)\1/i.exec(match[1]);
        return attribute ? [xmlText(attribute[2])] : [];
      });
      const instructionGroups = [[...instructionText, ...simpleInstructions].join(" "), instructionText.join(""), ...instructionText, ...simpleInstructions];
      if (instructionGroups.some((instructions) => /(?:^|\s)(?:DDE|DDEAUTO|INCLUDETEXT|INCLUDEPICTURE|LINK|DATABASE|HYPERLINK|MACROBUTTON|GOTOBUTTON|RD)\b/i.test(instructions)
        || /(?:https?|ftp|file):\/\/|\\\\|(?:^|[\s"'])\/[A-Za-z0-9._-]+\//i.test(instructions))) {
        throw new EvidenceValidationError("Word documents with active, linked, or external field instructions must be flattened before attachment.");
      }
    }
  }
  if (extension === "pptx") {
    for (const entry of entries.filter((item) => /^ppt\/.*\.xml$/i.test(item.name))) {
      const content = await officeXml(entry);
      if (/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?(?:hlinkClick|hlinkHover|oleObj|externalData)\b|ppaction:\/\//i.test(content)) throw new EvidenceValidationError("Presentations with hyperlinks, actions, or external data must be flattened before attachment.");
    }
  }
}

export async function validateEvidenceBytes(fileName: string, input: ArrayBuffer | Uint8Array) {
  if (!fileName || fileName.length > 255) throw new EvidenceValidationError("Evidence file names are limited to 255 characters.");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.byteLength) throw new EvidenceValidationError("Choose a non-empty document to attach.");
  if (bytes.byteLength > MAX_EVIDENCE_DOCUMENT_BYTES) throw new EvidenceValidationError("Evidence documents are limited to 10 MB.");
  const extension = extensionOf(fileName);
  const approved = approvedEvidenceTypes[extension];
  if (!approved) throw new EvidenceValidationError("Use an approved evidence type: PDF, DOCX, XLSX, PPTX, PNG, JPG, TXT, Markdown, CSV, or JSON.");
  if (approved.signature && !approved.signature.every((byte, index) => bytes[index] === byte)) throw new EvidenceValidationError(`The .${extension} file signature does not match its name.`);
  if (approved.text) {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new EvidenceValidationError(`The .${extension} file is not valid UTF-8 plain text.`); }
    if (text.includes("\0")) throw new EvidenceValidationError(`The .${extension} file does not appear to be plain text.`);
    if (extension === "csv") validateCsvCells(text);
    if (extension === "md") validateMarkdownText(text);
    if (extension === "json") try { JSON.parse(text); } catch { throw new EvidenceValidationError("The JSON evidence file is not valid JSON."); }
  }
  if (extension === "pdf") validatePdfDocument(bytes);
  if (extension === "png") await validatePngDocument(bytes);
  if (extension === "jpg" || extension === "jpeg") validateJpegDocument(bytes);
  if (approved.officeRoot) await validateOfficePackage(fileName, bytes, approved.officeRoot);
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  return { bytes: stableBytes.buffer, contentType: approved.contentType };
}

export async function validateEvidenceFile(file: File) {
  return validateEvidenceBytes(file.name, await file.arrayBuffer());
}
