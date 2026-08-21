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
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function inferChangeRequestImportMapping(headers: string[]): ChangeRequestImportMapping {
  const byName = new Map(headers.map((header) => [normalized(header), header]));
  return Object.fromEntries(CHANGE_REQUEST_IMPORT_COLUMNS.map((column) => [column, aliases[column].map(normalized).map((item) => byName.get(item)).find(Boolean) || ""])) as ChangeRequestImportMapping;
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

export function mapChangeRequestSourceRows(rawRows: Record<string, unknown>[], mapping: ChangeRequestImportMapping, defaults: { externalSystem?: string; sourceAsOf?: string } = {}): ChangeRequestSourceRecord[] {
  return rawRows.map((raw, index) => {
    const externalIdentifier = valueFor(raw, mapping.ExternalIdentifier);
    const suppliedType = valueFor(raw, mapping.Type);
    const canonical = normalizeChangeRequestImportRow({
      Type: inferredType(externalIdentifier, suppliedType),
      ExternalSystem: valueFor(raw, mapping.ExternalSystem) || defaults.externalSystem || CONFLUENCE_CHANGE_SOURCE_SYSTEM,
      ExternalIdentifier: externalIdentifier,
      Title: valueFor(raw, mapping.Title),
      ExternalStatus: valueFor(raw, mapping.ExternalStatus),
      ExternalOwner: valueFor(raw, mapping.ExternalOwner),
      SourceLocator: valueFor(raw, mapping.SourceLocator),
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
  const typeByCode = new Map(types.map((item) => [normalized(item.code), item]));
  const releaseByName = new Map<string, ChangeReferenceRelease>();
  for (const release of releases) { releaseByName.set(normalized(release.name), release); if (release.code) releaseByName.set(normalized(release.code), release); }
  const counts = new Map<string, number>();
  for (const row of incoming) counts.set(changeRequestImportKey(row), (counts.get(changeRequestImportKey(row)) || 0) + 1);
  const rows = incoming.map((input, index): ChangeRequestImportPreviewRow => {
    const row = normalizeChangeRequestImportRow(input);
    const key = changeRequestImportKey(row);
    const current = existingByKey.get(key);
    const type = typeByCode.get(normalized(row.Type));
    const release = row.RequestedRelease ? releaseByName.get(normalized(row.RequestedRelease)) : null;
    const issues: string[] = [];
    for (const column of ["Type", "ExternalSystem", "ExternalIdentifier", "Title", "SourceLocator", "SourceAsOf"] as ChangeRequestImportColumn[]) if (!row[column]) issues.push(`${column} is required.`);
    if (row.SourceAsOf && !validDate(row.SourceAsOf)) issues.push("SourceAsOf must use YYYY-MM-DD.");
    if (!type) issues.push(`Change Request type '${row.Type || "blank"}' is not configured.`);
    if (row.RequestedRelease && !release) issues.push(`Requested Release '${row.RequestedRelease}' was not found.`);
    if ((counts.get(key) || 0) > 1) issues.push("External system and identifier occur more than once in this file.");
    const before = current ? existingChangeRequestImportRow(current) : null;
    const changedFields = before ? CHANGE_REQUEST_IMPORT_COLUMNS.filter((column) => normalized(before[column]) !== normalized(row[column])) : [...CHANGE_REQUEST_IMPORT_COLUMNS];
    const disposition: ChangeRequestImportDisposition = issues.length ? "blocked" : !current ? "add" : changedFields.length ? "change" : "unchanged";
    return { rowNumber: index + 2, key, disposition, existingId: current?.id || null, typeId: type?.id || null, releaseId: release?.id || null, changedFields, issues, row };
  });
  return { rows, added: rows.filter((row) => row.disposition === "add").length, changed: rows.filter((row) => row.disposition === "change").length, unchanged: rows.filter((row) => row.disposition === "unchanged").length, blocked: rows.filter((row) => row.disposition === "blocked").length, canApply: rows.length > 0 && rows.every((row) => row.disposition !== "blocked") };
}
