export const CHANGE_REQUEST_IMPORT_COLUMNS = ["Type", "ExternalSystem", "ExternalIdentifier", "Title", "ExternalStatus", "ExternalOwner", "SourceLocator", "SourceAsOf", "RequestedRelease"] as const;
export type ChangeRequestImportColumn = typeof CHANGE_REQUEST_IMPORT_COLUMNS[number];
export type ChangeRequestImportRow = Record<ChangeRequestImportColumn, string>;
export type ChangeRequestImportDisposition = "add" | "change" | "unchanged" | "blocked";
export type ChangeRequestImportPreviewRow = { rowNumber: number; key: string; disposition: ChangeRequestImportDisposition; existingId: string | null; typeId: string | null; releaseId: string | null; changedFields: ChangeRequestImportColumn[]; issues: string[]; row: ChangeRequestImportRow };
export type ChangeRequestImportPreview = { rows: ChangeRequestImportPreviewRow[]; added: number; changed: number; unchanged: number; blocked: number; canApply: boolean };

export type ChangeRequestImportMapping = Record<ChangeRequestImportColumn, string>;
export type ChangeRequestSourceRecord = {
  rowNumber: number;
  raw: Record<string, unknown>;
  canonical: ChangeRequestImportRow;
};

export const CONFLUENCE_CHANGE_SOURCE_SYSTEM = "JSF Confluence DSOR/MCP Dashboard";

const aliases: Record<ChangeRequestImportColumn, string[]> = {
  Type: ["request type", "type", "request_type"],
  ExternalSystem: ["external system", "source system", "external_system"],
  ExternalIdentifier: ["jpo code", "jpo", "mcp", "mcp code", "dsor", "external id", "external identifier", "external_identifier"],
  Title: ["title", "request title", "name"],
  ExternalStatus: ["governance phase", "status", "external status", "external_status"],
  ExternalOwner: ["mxs/pmo lead", "functional owner", "owner", "external owner", "external_owner"],
  SourceLocator: ["title url", "url", "source locator", "source link", "source_locator"],
  SourceAsOf: ["source as of", "as of", "source date", "source_as_of"],
  RequestedRelease: ["release", "requested release", "requested_release"],
};

export type ExistingChangeRequestReference = { id: string; typeId: string; typeCode: string; externalSystem: string | null; externalIdentifier: string; title: string; externalStatus: string | null; externalOwner: string | null; sourceLocator: string | null; sourceAsOf: string | null; requestedReleaseId: string | null; requestedReleaseName: string | null };
export type ChangeReferenceType = { id: string; code: string };
export type ChangeReferenceRelease = { id: string; name: string; code?: string | null };

const clean = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
export const normalizedChangeImportValue = (value: unknown) => clean(value).toLocaleLowerCase("en-US");
const normalized = normalizedChangeImportValue;
const headerKey = (value: unknown) => normalized(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
/**
 * MCP/DSOR is a cross-source identity.  A Confluence row, a Lockheed daily
 * row, and a JPO reference can therefore all refer to the same Change
 * Request even when their source-system labels or punctuation differ.
 */
export function canonicalChangeRequestIdentity(value: unknown) {
  const source = clean(value);
  const match = source.match(/\b(MCP|DSOR)\s*[-_ ]?\s*(\d+)\b/i);
  return normalized(match ? `${match[1].toUpperCase()}-${match[2]}` : source);
}
/** Fields an external delivery is allowed to refresh on the canonical record. */
const SOURCE_CONTROLLED_CHANGE_REQUEST_FIELDS: ChangeRequestImportColumn[] = ["Title", "ExternalStatus", "ExternalOwner", "SourceLocator", "SourceAsOf", "RequestedRelease"];
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function inferChangeRequestImportMapping(headers: string[]): ChangeRequestImportMapping {
  // Confluence scripts commonly emit snake_case headers (for example
  // jpo_code and Title_url).  Treat separators as presentation, not schema,
  // so a normal delivered CSV maps without analyst intervention.
  const byName = new Map(headers.map((header) => [headerKey(header), header]));
  return Object.fromEntries(CHANGE_REQUEST_IMPORT_COLUMNS.map((column) => [column, aliases[column].map(headerKey).map((item) => byName.get(item)).find(Boolean) || ""])) as ChangeRequestImportMapping;
}

function valueFor(raw: Record<string, unknown>, header: string) {
  return header ? clean(raw[header]) : "";
}

function inferredType(identifier: string, supplied: string) {
  if (supplied) {
    const known = supplied.toUpperCase().match(/\b(MCP|DSOR)\b/);
    if (known?.[1]) return known[1];
  }
  return identifier.toUpperCase().startsWith("DSOR") ? "DSOR" : identifier.toUpperCase().startsWith("MCP") ? "MCP" : supplied || "OTHER";
}

/**
 * Some dashboard rows have no MCP/DSOR/JPO.  A row-specific Confluence page
 * is still a stable external identity, so retain it instead of requiring an
 * analyst to invent a placeholder Change Request.  A row with neither an
 * identifier nor a row-specific locator remains a genuine identity exception.
 */
function identifierFromSourceLocator(sourceLocator: string) {
  const locator = clean(sourceLocator);
  if (!locator) return "";
  const confluencePage = locator.match(/\/pages\/(\d+)(?:\/|$|[?#])/i)?.[1];
  return confluencePage ? `CONFLUENCE-${confluencePage}` : `SOURCE-${locator}`;
}

export function mapChangeRequestSourceRows(rawRows: Record<string, unknown>[], mapping: ChangeRequestImportMapping, defaults: { externalSystem?: string; sourceAsOf?: string } = {}): ChangeRequestSourceRecord[] {
  return rawRows.map((raw, index) => {
    const sourceLocator = valueFor(raw, mapping.SourceLocator);
    const explicitIdentifier = valueFor(raw, mapping.ExternalIdentifier);
    const externalIdentifier = explicitIdentifier || identifierFromSourceLocator(sourceLocator);
    const suppliedType = valueFor(raw, mapping.Type);
    const canonical = normalizeChangeRequestImportRow({
      Type: inferredType(externalIdentifier, suppliedType),
      ExternalSystem: valueFor(raw, mapping.ExternalSystem) || defaults.externalSystem || CONFLUENCE_CHANGE_SOURCE_SYSTEM,
      ExternalIdentifier: externalIdentifier,
      Title: valueFor(raw, mapping.Title),
      ExternalStatus: valueFor(raw, mapping.ExternalStatus),
      ExternalOwner: valueFor(raw, mapping.ExternalOwner),
      SourceLocator: sourceLocator,
      SourceAsOf: valueFor(raw, mapping.SourceAsOf) || defaults.sourceAsOf || "",
      RequestedRelease: valueFor(raw, mapping.RequestedRelease),
    });
    return { rowNumber: index + 2, raw, canonical };
  });
}

export function normalizeChangeRequestImportRow(input: Partial<Record<ChangeRequestImportColumn, unknown>>): ChangeRequestImportRow {
  return Object.fromEntries(CHANGE_REQUEST_IMPORT_COLUMNS.map((column) => [column, clean(input[column])])) as ChangeRequestImportRow;
}

export function changeRequestImportKey(row: Pick<ChangeRequestImportRow, "ExternalSystem" | "ExternalIdentifier">) {
  return `${normalized(row.ExternalSystem)}|${normalized(row.ExternalIdentifier)}`;
}

export function existingChangeRequestImportRow(item: ExistingChangeRequestReference): ChangeRequestImportRow {
  return { Type: item.typeCode, ExternalSystem: item.externalSystem || "", ExternalIdentifier: item.externalIdentifier, Title: item.title, ExternalStatus: item.externalStatus || "", ExternalOwner: item.externalOwner || "", SourceLocator: item.sourceLocator || "", SourceAsOf: item.sourceAsOf || "", RequestedRelease: item.requestedReleaseName || "" };
}

export function reconcileChangeRequestImport(incoming: ChangeRequestImportRow[], existing: ExistingChangeRequestReference[], types: ChangeReferenceType[], releases: ChangeReferenceRelease[]): ChangeRequestImportPreview {
  const existingByKey = new Map(existing.map((item) => [changeRequestImportKey({ ExternalSystem: item.externalSystem || "", ExternalIdentifier: item.externalIdentifier }), item]));
  const existingByCanonicalIdentity = new Map<string, ExistingChangeRequestReference[]>();
  for (const item of existing) {
    const identity = canonicalChangeRequestIdentity(item.externalIdentifier);
    existingByCanonicalIdentity.set(identity, [...(existingByCanonicalIdentity.get(identity) || []), item]);
  }
  const typeByCode = new Map(types.map((item) => [normalized(item.code), item]));
  const releaseByName = new Map<string, ChangeReferenceRelease>();
  for (const release of releases) { releaseByName.set(normalized(release.name), release); if (release.code) releaseByName.set(normalized(release.code), release); }
  const counts = new Map<string, number>();
  for (const row of incoming) counts.set(changeRequestImportKey(row), (counts.get(changeRequestImportKey(row)) || 0) + 1);
  const rows = incoming.map((input, index): ChangeRequestImportPreviewRow => {
    const row = normalizeChangeRequestImportRow(input);
    const key = changeRequestImportKey(row);
    const canonicalMatches = existingByCanonicalIdentity.get(canonicalChangeRequestIdentity(row.ExternalIdentifier)) || [];
    // Prefer the exact source identity for traceability, but fall back to the
    // source-independent MCP/DSOR identity.  This is what allows a daily
    // Lockheed file and the Confluence export to land on one real Change
    // Request without an analyst mapping thousands of rows by hand.
    const current = existingByKey.get(key) || (canonicalMatches.length === 1 ? canonicalMatches[0] : undefined);
    const type = typeByCode.get(normalized(row.Type));
    const release = row.RequestedRelease ? releaseByName.get(normalized(row.RequestedRelease)) : null;
    const issues: string[] = [];
    // External type, locator, release, and title vary by source delivery.
    // The canonical importer supplies a neutral reference type/title when a
    // source omits them.  Only a missing identity or invalid date blocks a
    // row from being safely materialized.
    if (!row.ExternalIdentifier) issues.push("ExternalIdentifier is required.");
    if (row.ExternalIdentifier.startsWith("CONFLUENCE-") || row.ExternalIdentifier.startsWith("SOURCE-")) issues.push("Warning: No MCP/DSOR/JPO identifier was supplied; the row-specific source locator is being used as its external identity.");
    if (row.SourceAsOf && !validDate(row.SourceAsOf)) issues.push("SourceAsOf must use YYYY-MM-DD.");
    if (!type) issues.push(`Warning: Change Request type '${row.Type || "blank"}' will be created as an external reference type.`);
    if (row.RequestedRelease && !release) issues.push(`Warning: Requested Release '${row.RequestedRelease}' will be retained as a source claim; a recognized Release label is added automatically.`);
    if ((counts.get(key) || 0) > 1) issues.push("External system and identifier occur more than once in this file.");
    if (canonicalMatches.length > 1) issues.push(`External identifier '${row.ExternalIdentifier}' matches ${canonicalMatches.length} canonical Change Requests.`);
    const before = current ? existingChangeRequestImportRow(current) : null;
    const changedFields = before ? SOURCE_CONTROLLED_CHANGE_REQUEST_FIELDS.filter((column) => normalized(before[column]) !== normalized(row[column])) : [...CHANGE_REQUEST_IMPORT_COLUMNS];
    const blocking = issues.filter((issue) => !issue.startsWith("Warning:")).length > 0;
    const disposition: ChangeRequestImportDisposition = blocking ? "blocked" : !current ? "add" : changedFields.length ? "change" : "unchanged";
    return { rowNumber: index + 2, key, disposition, existingId: current?.id || null, typeId: type?.id || null, releaseId: release?.id || null, changedFields, issues, row };
  });
  return { rows, added: rows.filter((row) => row.disposition === "add").length, changed: rows.filter((row) => row.disposition === "change").length, unchanged: rows.filter((row) => row.disposition === "unchanged").length, blocked: rows.filter((row) => row.disposition === "blocked").length, canApply: rows.length > 0 && rows.every((row) => row.disposition !== "blocked") };
}
