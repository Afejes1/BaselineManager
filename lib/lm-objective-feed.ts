/**
 * Normalization and comparison for the daily Lockheed GitLab Pages export.
 * Source object keys are deliberately retained: dependency values such as
 * `13` and `arch_plan_44` refer to those keys, not to JPO/MCP values.
 */
export const LM_OBJECTIVE_FEED_SYSTEM = "Lockheed GitLab Pages";

export type LmObjectiveFeedRecord = {
  sourceKey: string;
  url: string | null;
  jpoRaw: string | null;
  jpoIds: string[];
  jira: string | null;
  relTo: string | null;
  title: string | null;
  roadmapParent: string | null;
  scope: string | null;
  domains: string[];
  itemNumber: number | null;
  blocks: string[];
  blockedBy: string[];
  targetStart: string | null;
  targetFinish: string | null;
  rom: number | string | null;
  percentComplete: number | null;
  funding: string | null;
  release: string | null;
  overview: string | null;
  background: string | null;
  extra: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type LmObjectiveFeedIssue = { code: "invalid_payload" | "invalid_value"; message: string; blocking: boolean };
export type LmObjectiveFeedImport = { records: LmObjectiveFeedRecord[]; rows: Array<{ record: LmObjectiveFeedRecord }>; sourceRecordCount: number; issues: string[]; validationIssues: LmObjectiveFeedIssue[] };
export type LmObjectiveFeedDisposition = "add" | "change" | "unchanged" | "blocked";
export type LmObjectiveFeedPreviewItem = { record: LmObjectiveFeedRecord; disposition: LmObjectiveFeedDisposition; changedFields: string[]; issues: LmObjectiveFeedIssue[]; objectiveId: string | null };
export type LmObjectiveFeedPreview = { items: LmObjectiveFeedPreviewItem[]; added: number; changed: number; unchanged: number; blocked: number; removed: Array<{ sourceKey: string; objectiveId: string | null }>; canApply: boolean };
export type ExistingLmFeedItem = { sourceKey: string; objectiveId: string | null; normalizedPayload: string };
export type ParsedReportedRom = {
  raw: string;
  unit: "hours" | "cost";
  low: number | null;
  likely: number;
  high: number | null;
  assumptions: string | null;
};

const clean = (value: unknown): string | null => {
  if (value == null) return null;
  const result = String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
  return result || null;
};
const plain = (value: unknown): Record<string, unknown> | null => value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const stringList = (value: unknown): string[] => [...new Set((Array.isArray(value) ? value.map(clean).filter((item): item is string => Boolean(item)) : clean(value) ? [clean(value)!] : []).map((item) => item.normalize("NFKC")))].sort((a, b) => a.localeCompare(b));
const numeric = (value: unknown): number | null => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const canonicalValue = (value: unknown) => JSON.stringify(value ?? null);
const sourceFields = new Set(["url", "jpo", "jira", "rel-to", "cel-to", "title", "roadmap_parent", "scope", "domains", "i-n", "1-n", "blocks", "blocked_by", "target_start", "target_finish", "rom", "percent_complete", "funding", "release", "overview", "background"]);

/**
 * Converts only an unambiguous Lockheed ROM into the application estimate
 * shape. The source field remains authoritative and is retained verbatim;
 * this helper merely gives initiative math a typed, clearly-labelled view.
 */
export function parseReportedRom(value: LmObjectiveFeedRecord["rom"]): ParsedReportedRom | null {
  const raw = clean(value);
  if (!raw || /^\s*-/.test(raw)) return null;
  const normalized = raw.toLocaleLowerCase("en-US");
  const cost = /[$€£]|\b(?:usd|dollars?|cost|budget)\b/.test(normalized);
  const hours = /\b(?:hours?|hrs?|hr|labor|effort|person[-\s]?hours?|fte)\b/.test(normalized);
  // A day-based source ROM needs an explicit workday assumption, which this
  // application must not invent. Mixed money-and-hours text is likewise kept
  // as source evidence rather than guessing which value is authoritative.
  if ((cost && hours) || /\b(?:days?|workdays?)\b/.test(normalized)) return null;
  const values = [...raw.matchAll(/(?:[$€£]\s*)?(\d+(?:,\d{3})*(?:\.\d+)?|\d*\.\d+)\s*([kmb])?/gi)]
    .map((match) => Number(match[1].replaceAll(",", "")) * (match[2]?.toLocaleLowerCase("en-US") === "k" ? 1_000 : match[2]?.toLocaleLowerCase("en-US") === "m" ? 1_000_000 : match[2]?.toLocaleLowerCase("en-US") === "b" ? 1_000_000_000 : 1))
    .filter((item) => Number.isFinite(item) && item >= 0);
  if (!values.length || values.length > 3) return null;
  const [first, second, third] = values;
  if (values.length === 1) return { raw, unit: cost ? "cost" : "hours", low: null, likely: first, high: null, assumptions: hours || cost ? null : "The source did not state a unit; the numeric ROM is interpreted as labor hours." };
  if (values.length === 2) {
    if (first! > second!) return null;
    return { raw, unit: cost ? "cost" : "hours", low: first!, likely: (first! + second!) / 2, high: second!, assumptions: `${hours || cost ? "" : "The source did not state a unit; values are interpreted as labor hours. "}Likely is the derived midpoint of the reported range.`.trim() };
  }
  if (first! > second! || second! > third!) return null;
  return { raw, unit: cost ? "cost" : "hours", low: first!, likely: second!, high: third!, assumptions: hours || cost ? null : "The source did not state a unit; values are interpreted as labor hours." };
}

export function splitJpo(value: unknown) {
  return [...new Set((clean(value) || "").split(/[,;]/).map((item) => item.trim()).filter(Boolean))];
}

export function normalizeLmObjectiveFeedRecord(sourceKey: unknown, payload: unknown): { record: LmObjectiveFeedRecord | null; issues: LmObjectiveFeedIssue[] } {
  const raw = plain(payload);
  const key = clean(sourceKey);
  if (!raw || !key) return { record: null, issues: [{ code: "invalid_payload", message: "Each feed entry must be an object with a nonblank source key.", blocking: true }] };
  const issues: LmObjectiveFeedIssue[] = [];
  const read = (name: string) => raw[name];
  if (read("percent_complete") != null && numeric(read("percent_complete")) == null) issues.push({ code: "invalid_value", message: `${key}: percent_complete is retained as source text but cannot be used as a number.`, blocking: false });
  const itemNumber = read("1-n") ?? read("i-n");
  if (itemNumber != null && numeric(itemNumber) == null) issues.push({ code: "invalid_value", message: `${key}: 1-n is retained as source text but cannot be used as a number.`, blocking: false });
  const extra = Object.fromEntries(Object.entries(raw).filter(([field]) => !sourceFields.has(field)));
  return {
    record: {
      sourceKey: key, url: clean(read("url")), jpoRaw: clean(read("jpo")), jpoIds: splitJpo(read("jpo")), jira: clean(read("jira")), relTo: clean(read("rel-to")) || clean(read("cel-to")),
      title: clean(read("title")), roadmapParent: clean(read("roadmap_parent")), scope: clean(read("scope")), domains: stringList(read("domains")), itemNumber: numeric(itemNumber),
      blocks: stringList(read("blocks")), blockedBy: stringList(read("blocked_by")), targetStart: clean(read("target_start")), targetFinish: clean(read("target_finish")),
      rom: numeric(read("rom")) ?? clean(read("rom")), percentComplete: numeric(read("percent_complete")), funding: clean(read("funding")), release: clean(read("release")), overview: clean(read("overview")), background: clean(read("background")), extra, raw,
    }, issues,
  };
}

/** Supports the direct keyed-object GitLab document and a common `{objectives:{}}` wrapper. */
export function parseLmObjectiveFeed(input: unknown): LmObjectiveFeedImport {
  let payload = input;
  if (typeof input === "string") {
    try { payload = JSON.parse(input); }
    catch { return { records: [], rows: [], sourceRecordCount: 0, issues: ["The Lockheed objective file is not valid JSON."], validationIssues: [{ code: "invalid_payload", message: "The Lockheed objective file is not valid JSON.", blocking: true }] }; }
  }
  if (Array.isArray(payload)) {
    const records: LmObjectiveFeedRecord[] = []; const validationIssues: LmObjectiveFeedIssue[] = [];
    payload.forEach((value, index) => { const item = normalizeLmObjectiveFeedRecord(String(index), value); validationIssues.push(...item.issues); if (item.record) records.push(item.record); });
    if (records.some((record) => record.percentComplete != null && (record.percentComplete < 0 || record.percentComplete > 100))) validationIssues.push({ code: "invalid_value", message: "percent_complete must be between 0 and 100 when supplied.", blocking: false });
    return { records, rows: records.map((record) => ({ record })), sourceRecordCount: records.length, issues: validationIssues.map((item) => item.message), validationIssues };
  }
  const root = plain(payload);
  if (!root) { const issue = { code: "invalid_payload" as const, message: "The feed must be a JSON object keyed by source objective key.", blocking: true }; return { records: [], rows: [], sourceRecordCount: 0, issues: [issue.message], validationIssues: [issue] }; }
  const candidate = plain(root.objectives) || root;
  const records: LmObjectiveFeedRecord[] = [];
  const issues: LmObjectiveFeedIssue[] = [];
  for (const [key, value] of Object.entries(candidate)) {
    const item = normalizeLmObjectiveFeedRecord(key, value);
    issues.push(...item.issues);
    if (item.record) records.push(item.record);
  }
  if (!records.length) issues.push({ code: "invalid_payload", message: "The feed contains no objective records.", blocking: true });
  if (records.some((record) => record.percentComplete != null && (record.percentComplete < 0 || record.percentComplete > 100))) issues.push({ code: "invalid_value", message: "percent_complete must be between 0 and 100 when supplied.", blocking: false });
  return { records, rows: records.map((record) => ({ record })), sourceRecordCount: records.length, issues: issues.map((item) => item.message), validationIssues: issues };
}

export function feedIdentity(record: LmObjectiveFeedRecord) {
  // Jira is the strongest available external identity. URL is only used when a
  // Jira key is absent; sourceKey is always retained for dependency resolution.
  return record.jira || record.url || `feed-key:${record.sourceKey}`;
}

export function comparableFeedRecord(record: LmObjectiveFeedRecord) {
  return {
    sourceKey: record.sourceKey, url: record.url, jpoRaw: record.jpoRaw, jpoIds: record.jpoIds, jira: record.jira, relTo: record.relTo, title: record.title,
    roadmapParent: record.roadmapParent, scope: record.scope, domains: record.domains, itemNumber: record.itemNumber, blocks: record.blocks, blockedBy: record.blockedBy,
    targetStart: record.targetStart, targetFinish: record.targetFinish, rom: record.rom, percentComplete: record.percentComplete, funding: record.funding,
    release: record.release, overview: record.overview, background: record.background, extra: record.extra,
  };
}

export function diffFeedRecords(before: LmObjectiveFeedRecord | null, after: LmObjectiveFeedRecord) {
  if (!before) return Object.keys(comparableFeedRecord(after));
  const left = comparableFeedRecord(before) as Record<string, unknown>;
  const right = comparableFeedRecord(after) as Record<string, unknown>;
  return Object.keys(right).filter((key) => canonicalValue(left[key]) !== canonicalValue(right[key]));
}

function recordFromPayload(value: string): LmObjectiveFeedRecord | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const key = clean(parsed.sourceKey);
    if (!key) return null;
    return normalizeLmObjectiveFeedRecord(key, parsed.raw || parsed).record;
  } catch { return null; }
}

export function reconcileLmObjectiveFeedSnapshot(records: LmObjectiveFeedRecord[], previous: ExistingLmFeedItem[]): LmObjectiveFeedPreview {
  // The root feed key is the dependency address used by `blocks` and
  // `blocked_by`. Jira is a second, independently supplied identity. Prefer a
  // root-key match, but preserve a subject (and any deliberate analyst link)
  // when Lockheed renumbers a root key while keeping one unambiguous Jira ID.
  const priorEntries = previous.map((item) => ({ item, record: recordFromPayload(item.normalizedPayload) }));
  const previousByKey = new Map(previous.map((item) => [item.sourceKey, item]));
  const previousByJira = new Map<string, typeof priorEntries>();
  for (const entry of priorEntries) {
    const jira = entry.record?.jira?.toLocaleLowerCase("en-US");
    if (jira) previousByJira.set(jira, [...(previousByJira.get(jira) || []), entry]);
  }
  const keys = new Set<string>();
  const jiraKeys = new Set<string>();
  const claimedPrevious = new Set<string>();
  const items = records.map((record): LmObjectiveFeedPreviewItem => {
    const jira = record.jira?.toLocaleLowerCase("en-US") || null;
    const keyMatch = previousByKey.get(record.sourceKey);
    const jiraMatches = !keyMatch && jira ? previousByJira.get(jira) || [] : [];
    const jiraMatch = jiraMatches.length === 1 ? jiraMatches[0]?.item || null : null;
    const prior = keyMatch || jiraMatch;
    const priorClaim = prior?.objectiveId || prior?.sourceKey || null;
    const issue: LmObjectiveFeedIssue[] = [];
    if (keys.has(record.sourceKey)) issue.push({ code: "invalid_payload", message: `${record.sourceKey} occurs more than once.`, blocking: true });
    if (jira && jiraKeys.has(jira)) issue.push({ code: "invalid_payload", message: `${record.jira} occurs more than once. Resolve the duplicate before import.`, blocking: true });
    if (!keyMatch && jira && jiraMatches.length > 1) issue.push({ code: "invalid_payload", message: `${record.jira} matches more than one prior source record. Resolve the source identity before import.`, blocking: true });
    if (priorClaim && claimedPrevious.has(priorClaim)) issue.push({ code: "invalid_payload", message: `${record.sourceKey} would reuse the same prior source subject more than once.`, blocking: true });
    keys.add(record.sourceKey);
    if (jira) jiraKeys.add(jira);
    if (priorClaim && !issue.some((item) => item.blocking)) claimedPrevious.add(priorClaim);
    const priorRecord = prior ? recordFromPayload(prior.normalizedPayload) : null;
    const changedFields = diffFeedRecords(priorRecord, record);
    const disposition: LmObjectiveFeedDisposition = issue.some((item) => item.blocking) ? "blocked" : !prior ? "add" : changedFields.length ? "change" : "unchanged";
    return { record, disposition, changedFields, issues: issue, objectiveId: prior?.objectiveId || null };
  });
  const removed = previous.filter((item) => !claimedPrevious.has(item.objectiveId || item.sourceKey)).map((item) => ({ sourceKey: item.sourceKey, objectiveId: item.objectiveId }));
  return { items, added: items.filter((item) => item.disposition === "add").length, changed: items.filter((item) => item.disposition === "change").length, unchanged: items.filter((item) => item.disposition === "unchanged").length, blocked: items.filter((item) => item.disposition === "blocked").length, removed, canApply: items.length > 0 && items.every((item) => item.disposition !== "blocked") };
}

export type LmObjectiveFieldChange = { field: string; before: unknown; after: unknown };
export function normalizeLmObjective(payload: unknown, sourceKey: string) {
  const result = normalizeLmObjectiveFeedRecord(sourceKey, payload);
  if (!result.record) throw new Error(result.issues[0]?.message || "Invalid Lockheed objective.");
  return result.record;
}
export function diffLmObjective(before: LmObjectiveFeedRecord, after: LmObjectiveFeedRecord): LmObjectiveFieldChange[] {
  const left = comparableFeedRecord(before) as Record<string, unknown>; const right = comparableFeedRecord(after) as Record<string, unknown>;
  return Object.keys(right).filter((key) => canonicalValue(left[key]) !== canonicalValue(right[key])).map((field) => ({ field, before: left[field], after: right[field] }));
}
/** Pure comparison used by contract tests and UI adapters. */
export function reconcileLmObjectiveFeed(previous: LmObjectiveFeedRecord[], incoming: LmObjectiveFeedRecord[]) {
  const byIdentity = new Map(previous.map((record) => [feedIdentity(record), record]));
  const remaining = new Set(byIdentity.keys());
  const added: Array<{ record: LmObjectiveFeedRecord }> = []; const changed: Array<{ before: LmObjectiveFeedRecord; after: LmObjectiveFeedRecord; changes: LmObjectiveFieldChange[] }> = []; const unchanged: Array<{ record: LmObjectiveFeedRecord }> = [];
  for (const record of incoming) {
    const prior = byIdentity.get(feedIdentity(record));
    if (!prior) added.push({ record });
    else { remaining.delete(feedIdentity(record)); const changes = diffLmObjective(prior, record); if (changes.length) changed.push({ before: prior, after: record, changes }); else unchanged.push({ record }); }
  }
  return { added, changed, unchanged, removed: previous.filter((record) => remaining.has(feedIdentity(record))) };
}

export const feedJson = (record: LmObjectiveFeedRecord) => JSON.stringify({ ...comparableFeedRecord(record), raw: record.raw });
export const deltaJson = (value: unknown) => canonicalValue(value);
