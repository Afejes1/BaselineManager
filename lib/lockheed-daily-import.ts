export const LOCKHEED_DAILY_SOURCE_SYSTEM = "Lockheed Martin daily delivery";

export type LockheedDailyDataset = "capes" | "jira" | "mcps" | "objectives";

export type LockheedDailyFile = {
  fileId: string;
  fileName: string;
  sheetName?: string;
  dataset: LockheedDailyDataset;
  rows: Record<string, unknown>[];
};

export type LockheedDailyRelation = {
  relationType: "blocks" | "blocked_by" | "objective_reference" | "parent";
  targetReference: string;
};

export type LockheedDailyRecord = {
  fileId: string;
  fileName: string;
  dataset: LockheedDailyDataset;
  rowNumber: number;
  entityKind: "capability_projection" | "jira_work_item" | "change_request_projection" | "objective_projection";
  sourceKey: string;
  title: string;
  status: string;
  sourceUpdatedAt: string;
  canonicalTargetKind: "capability" | "change_request" | "objective" | null;
  fields: Record<string, string>;
  relations: LockheedDailyRelation[];
  raw: Record<string, unknown>;
  issues: string[];
};

const clean = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/^\uFEFF/, "").trim().replace(/\s+/g, " ");
const headerKey = (value: unknown) => clean(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9%]+/g, "");

const FIELD_NAMES: Record<string, string> = {
  key: "Key", issuetype: "IssueType", summary: "Summary", title: "Title", status: "Status", lmstatus: "LMStatus", action: "Action",
  created: "Created", updated: "Updated", resolved: "Resolved", parent: "Parent", parentlink: "ParentLink", parentnodename: "ParentNodeName",
  targetpi: "TargetPI", targetrelease: "TargetRelease", targetstart: "TargetStart", targetfinish: "TargetFinish", targetend: "TargetEnd",
  targetpistart: "TargetPIStart", targetpiend: "TargetPIEnd", budgethours: "BudgetHours", rom: "ROM", percentcomplete: "PercentComplete",
  "%complete": "PercentComplete", jiraid: "JIRAID", jpoid: "JPOID", jpocode: "JPOCode", mcpdsor: "MCPDSOR", description: "Description", funding: "Funding", objectives: "Objectives",
  blocks: "Blocks", blockedby: "BlockedBy", phase: "Phase", worktype: "WorkType", category: "Category", contract: "Contract",
};

function valueOf(row: Record<string, unknown>, ...aliases: string[]) {
  const wanted = new Set(aliases.map(headerKey));
  const match = Object.entries(row).find(([key]) => wanted.has(headerKey(key)));
  return clean(match?.[1]);
}

function list(value: unknown) {
  return [...new Set(clean(value).split(/[,;|]+/).map((item) => clean(item)).filter(Boolean))];
}

function mcpKey(value: string) {
  const match = value.match(/\b(MCP|DSOR)\s*[-_]\s*(\d+)\b/i);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : clean(value);
}

export function classifyLockheedDailyFile(fileName: string, headers: string[]): LockheedDailyDataset {
  const name = fileName.toLocaleLowerCase("en-US");
  const keys = new Set(headers.map(headerKey));
  if (name.includes("obj") || keys.has("lmstatus") || keys.has("percentcomplete")) return "objectives";
  if (name.includes("mcp") || keys.has("mcpdsor")) return "mcps";
  if (name.includes("cape")) return "capes";
  return "jira";
}

export function normalizeLockheedDailyRow(file: Pick<LockheedDailyFile, "fileId" | "fileName" | "dataset">, raw: Record<string, unknown>, rowNumber: number): LockheedDailyRecord {
  const fields = Object.fromEntries(Object.entries(raw).map(([header, value]) => [FIELD_NAMES[headerKey(header)] || clean(header), clean(value)]).filter(([, value]) => value));
  let sourceKey = "";
  let title = "";
  let status = "";
  let sourceUpdatedAt = "";
  let entityKind: LockheedDailyRecord["entityKind"];
  let canonicalTargetKind: LockheedDailyRecord["canonicalTargetKind"];
  const relations: LockheedDailyRelation[] = [];

  if (file.dataset === "mcps") {
    sourceKey = mcpKey(valueOf(raw, "MCP/DSOR", "JPO ID", "jpo code"));
    title = valueOf(raw, "Title", "Summary");
    status = valueOf(raw, "Action", "Status");
    entityKind = "change_request_projection";
    canonicalTargetKind = "change_request";
    for (const target of list(valueOf(raw, "Objectives"))) relations.push({ relationType: "objective_reference", targetReference: target });
  } else if (file.dataset === "objectives") {
    sourceKey = valueOf(raw, "Key") || valueOf(raw, "JIRA ID");
    title = valueOf(raw, "Summary", "Title");
    status = valueOf(raw, "LM Status", "Status");
    sourceUpdatedAt = valueOf(raw, "Updated");
    entityKind = "objective_projection";
    canonicalTargetKind = "objective";
    const parent = valueOf(raw, "Parent", "Parent Link");
    if (parent) relations.push({ relationType: "parent", targetReference: parent });
  } else {
    sourceKey = valueOf(raw, "Key", "JIRA ID");
    title = valueOf(raw, "Summary", "Title");
    status = valueOf(raw, "Status", "LM Status");
    sourceUpdatedAt = valueOf(raw, "Updated");
    entityKind = file.dataset === "capes" ? "capability_projection" : "jira_work_item";
    canonicalTargetKind = file.dataset === "capes" || valueOf(raw, "Issue Type").toLocaleLowerCase("en-US").includes("capability") ? "capability" : null;
    const parent = valueOf(raw, "Parent Link", "Parent / Node Name", "Parent");
    if (parent) relations.push({ relationType: "parent", targetReference: parent });
  }
  for (const target of list(valueOf(raw, "Blocks"))) relations.push({ relationType: "blocks", targetReference: target });
  for (const target of list(valueOf(raw, "Blocked By"))) relations.push({ relationType: "blocked_by", targetReference: target });

  const issues: string[] = [];
  if (!sourceKey) issues.push("A source key is required.");
  if (!title) issues.push("A title or summary is required.");
  if (file.dataset === "mcps" && !/^(MCP|DSOR)-\d+$/i.test(sourceKey)) issues.push("The MCP/DSOR value does not contain a recognized MCP or DSOR identifier.");
  return { ...file, rowNumber, entityKind, sourceKey, title, status, sourceUpdatedAt, canonicalTargetKind, fields, relations, raw, issues };
}

export function parseLockheedDailyFiles(files: LockheedDailyFile[]) {
  const records = files.flatMap((file) => file.rows.map((row, index) => normalizeLockheedDailyRow(file, row, index + 2)));
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = `${record.dataset}|${record.sourceKey.toLocaleLowerCase("en-US")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return records.map((record) => counts.get(`${record.dataset}|${record.sourceKey.toLocaleLowerCase("en-US")}`)! > 1
    ? { ...record, issues: [...record.issues, `${record.sourceKey || "Blank key"} occurs more than once in the ${record.dataset.toUpperCase()} file.`] }
    : record);
}

export function comparableLockheedDailyRecord(record: LockheedDailyRecord) {
  return { dataset: record.dataset, entityKind: record.entityKind, sourceKey: record.sourceKey, title: record.title, status: record.status, sourceUpdatedAt: record.sourceUpdatedAt, fields: Object.fromEntries(Object.entries(record.fields).sort(([left], [right]) => left.localeCompare(right))), relations: [...record.relations].sort((left, right) => `${left.relationType}|${left.targetReference}`.localeCompare(`${right.relationType}|${right.targetReference}`)) };
}

export function diffLockheedDailyRecords(before: ReturnType<typeof comparableLockheedDailyRecord> | null, after: ReturnType<typeof comparableLockheedDailyRecord>) {
  const left: Record<string, string> = before ? { ...before.fields, Title: before.title, Status: before.status, SourceUpdatedAt: before.sourceUpdatedAt, Relationships: JSON.stringify(before.relations) } : {};
  const right: Record<string, string> = { ...after.fields, Title: after.title, Status: after.status, SourceUpdatedAt: after.sourceUpdatedAt, Relationships: JSON.stringify(after.relations) };
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().filter((field) => clean(left[field]) !== clean(right[field])).map((field) => ({ field, before: clean(left[field]), after: clean(right[field]) }));
}
