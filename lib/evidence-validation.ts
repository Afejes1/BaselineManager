import JSZip from "jszip";

export const MAX_EVIDENCE_DOCUMENT_BYTES = 10 * 1024 * 1024;

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

function extensionOf(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

async function validateOfficePackage(fileName: string, bytes: Uint8Array, expectedRoot: string) {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new EvidenceValidationError(`The ${extensionOf(fileName).toUpperCase()} file is not a valid modern Office package.`); }
  const entries = Object.values(zip.files);
  if (entries.length > 5_000) throw new EvidenceValidationError("The Office document contains too many package entries.");
  const expandedBytes = entries.reduce((sum, entry) => sum + Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0), 0);
  if (expandedBytes > 50 * 1024 * 1024) throw new EvidenceValidationError("The expanded Office document exceeds the evidence processing limit.");
  if (!zip.file(expectedRoot) || !zip.file("[Content_Types].xml")) throw new EvidenceValidationError(`The .${extensionOf(fileName)} package does not contain the expected Office document structure.`);
  const names = entries.map((entry) => entry.name.toLowerCase());
  if (names.some((name) => name.includes("vbaproject.bin") || name.includes("/embeddings/") || name.includes("oleobject"))) throw new EvidenceValidationError("Macro or embedded-object Office documents are not approved evidence types.");
  const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  if (/macroenabled|vnd\.ms-office\.vba/i.test(contentTypes)) throw new EvidenceValidationError("Macro-enabled Office documents are not approved evidence types.");
  for (const entry of entries.filter((item) => item.name.endsWith(".rels"))) {
    const relationships = await entry.async("string");
    if (/TargetMode\s*=\s*["']External["']/i.test(relationships)) throw new EvidenceValidationError("Office documents with external relationships must be sanitized before attachment.");
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
    if (extension === "json") try { JSON.parse(text); } catch { throw new EvidenceValidationError("The JSON evidence file is not valid JSON."); }
  }
  if (extension === "pdf") {
    const text = new TextDecoder("latin1").decode(bytes);
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/.test(text)) throw new EvidenceValidationError("PDFs with active content or embedded files must be sanitized before attachment.");
  }
  if (approved.officeRoot) await validateOfficePackage(fileName, bytes, approved.officeRoot);
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  return { bytes: stableBytes.buffer, contentType: approved.contentType };
}

export async function validateEvidenceFile(file: File) {
  return validateEvidenceBytes(file.name, await file.arrayBuffer());
}
