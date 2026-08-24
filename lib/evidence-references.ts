import { MAX_GOVERNED_EVIDENCE_REFERENCES } from "./evidence-validation.js";

export function evidenceDocumentHref(documentId: string) {
  const encoded = encodeURIComponent(documentId).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `/api/documents?id=${encoded}`;
}

export function evidenceDocumentReferences(markdown: string, maximumReferences = MAX_GOVERNED_EVIDENCE_REFERENCES) {
  const ids = new Set<string>();
  // Match the endpoint first, then let URLSearchParams interpret its query in
  // exactly the same way as the download route. This preserves frozen
  // provenance for equivalent links such as `?%69d=...` and
  // `?view=1&id=...`, not only the canonical query ordering emitted today.
  for (const match of markdown.matchAll(/\/api\/documents\?[^\s<>"'`\\)\]}]*/g)) {
    if (/%(?![0-9A-Fa-f]{2})/.test(match[0])) throw new Error("The report contains a malformed evidence-document reference.");
    let id: string;
    try { id = new URL(match[0], "https://app.local").searchParams.get("id") || ""; }
    catch { throw new Error("The report contains a malformed evidence-document reference."); }
    if (!id) throw new Error("The report contains a malformed evidence-document reference.");
    ids.add(id);
  }
  if (ids.size > maximumReferences) throw new Error(`The report contains more than ${maximumReferences} evidence-document references allowed by this operation.`);
  return [...ids];
}
