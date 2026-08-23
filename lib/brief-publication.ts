import type { BriefSnapshot } from "./governance-model.js";

export const BRIEF_RENDERER_VERSION = "a2o-brief-export-v2";
export const BRIEF_PUBLICATION_FORMATS = ["markdown", "pdf", "docx"] as const;
export type BriefPublicationFormat = typeof BRIEF_PUBLICATION_FORMATS[number];

export const briefPublicationType: Record<BriefPublicationFormat, { extension: string; contentType: string }> = {
  markdown: { extension: "md", contentType: "text/markdown; charset=utf-8" },
  pdf: { extension: "pdf", contentType: "application/pdf" },
  docx: { extension: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};

export function isCurrentBriefSnapshot(value: unknown): value is BriefSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<BriefSnapshot>;
  const nonNegativeInteger = (item: unknown) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  if (typeof snapshot.asOf !== "string" || !snapshot.asOf || !Number.isFinite(Date.parse(snapshot.asOf))) return false;
  if (snapshot.handlingMarking !== "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED" && snapshot.handlingMarking !== "SYNTHETIC DEMONSTRATION DATA — NOT PROGRAM DATA") return false;
  if (typeof snapshot.releaseName !== "string" || !nonNegativeInteger(snapshot.sourceRows) || !nonNegativeInteger(snapshot.products) || !nonNegativeInteger(snapshot.releases) || !nonNegativeInteger(snapshot.reviewRows)) return false;
  if (!Array.isArray(snapshot.productNames) || !snapshot.productNames.every((item) => typeof item === "string")) return false;
  if (!Array.isArray(snapshot.linkedRecords) || !snapshot.linkedRecords.every((item) => item && typeof item === "object" && typeof item.type === "string" && typeof item.title === "string" && typeof item.status === "string")) return false;
  return true;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return "null";
}

export async function briefSourceHash(input: { id: string; title: string; snapshot: BriefSnapshot; bodyMarkdown: string }) {
  const source = canonicalJson({ id: input.id, title: input.title, snapshot: input.snapshot, bodyMarkdown: input.bodyMarkdown });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function isBriefPublicationFormat(value: unknown): value is BriefPublicationFormat {
  return typeof value === "string" && (BRIEF_PUBLICATION_FORMATS as readonly string[]).includes(value);
}
