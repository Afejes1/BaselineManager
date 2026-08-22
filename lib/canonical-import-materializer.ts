import { env } from "cloudflare:workers";
import { PROGRAM_ID } from "./governance-server";

/**
 * The import adapters all use this small materializer rather than each
 * inventing its own matching rules.  It deliberately separates a source
 * observation from the canonical object it can safely identify.
 *
 * A deterministic external identifier is enough to create/update a canonical
 * record.  A collision (two existing records with the same normalized source
 * identity) is not resolved silently; adapters surface that as a review item.
 */
type Database = typeof env.DB;

export const CANONICAL_JPO_SYSTEM = "JPO reference";
export const LM_JIRA_SYSTEM = "Lockheed Martin Jira";

export type CanonicalImportIssue = { code: "ambiguous_identity" | "invalid_identity"; message: string };
export type CanonicalImportResult = { id: string | null; created: boolean; issue?: CanonicalImportIssue };

type ChangeRequestRow = {
  id: string;
  type_id: string;
  external_identifier: string;
  title: string;
  external_system: string | null;
  source_as_of: string | null;
};
type ObjectiveRow = { id: string; external_system: string; external_identifier: string; change_request_id: string | null };
type CapabilityRow = { id: string; code: string | null; name: string; normalized_name: string };
type ReleaseRow = { id: string; name: string; code: string | null };
type TypeRow = { id: string; code: string; normalized_code: string };

const clean = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
export const normalizeImportText = (value: unknown) => clean(value).toLocaleLowerCase("en-US");
const compact = (value: unknown) => normalizeImportText(value).replace(/[^a-z0-9]+/g, "");

/** Normalizes only known Government request identifiers; other source keys are retained verbatim. */
export function normalizeJpoIdentifier(value: unknown) {
  const text = clean(value);
  const match = text.match(/\b(MCP|DSOR)\s*[-_ ]?\s*(\d+)\b/i);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : text;
}

export function inferChangeRequestType(value: unknown) {
  const normalized = normalizeJpoIdentifier(value);
  if (normalized.startsWith("MCP-")) return "MCP";
  if (normalized.startsWith("DSOR-")) return "DSOR";
  return "OTHER";
}

export function sourceObjectiveStatus(value: unknown) {
  const normalized = compact(value);
  if (["complete", "completed", "done", "closed", "resolved"].includes(normalized)) return "complete";
  if (["blocked", "onhold", "at risk", "atrisk"].includes(normalized)) return "blocked";
  if (["verification", "verify", "test", "testing"].includes(normalized)) return "verification";
  if (["inprogress", "active", "executing", "implementation"].includes(normalized)) return "in_progress";
  if (["planned", "plan", "ready"].includes(normalized)) return "planned";
  if (["cancelled", "canceled", "withdrawn"].includes(normalized)) return "cancelled";
  return "proposed";
}

export function splitReportedReferences(value: unknown) {
  return [...new Set(clean(value).split(/[,;|]+/).map((item) => normalizeJpoIdentifier(item)).filter(Boolean))];
}

function validDate(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

function isRecognizedRelease(value: string) {
  return /^(release|r)\s*[- ]?\d+[a-z0-9._-]*$/i.test(value);
}

/**
 * A per-request resolver.  It reads the existing canonical catalog once,
 * adds every proposed identity to its own maps, and emits statements in
 * parent-before-child order for one D1 batch.
 */
export class CanonicalImportMaterializer {
  readonly statements: D1PreparedStatement[] = [];
  readonly issues: CanonicalImportIssue[] = [];
  private readonly requestsByIdentifier = new Map<string, ChangeRequestRow[]>();
  private readonly objectivesByIdentity = new Map<string, ObjectiveRow[]>();
  private readonly capabilitiesByKey = new Map<string, CapabilityRow[]>();
  private readonly releasesByKey = new Map<string, ReleaseRow[]>();
  private readonly typesByCode = new Map<string, TypeRow>();

  private constructor(private readonly db: Database, private readonly actorId: string, private readonly at: string) {}

  static async load(db: Database, actorId: string, at: string) {
    const result = new CanonicalImportMaterializer(db, actorId, at);
    const [requests, objectives, capabilities, releases, types] = await Promise.all([
      db.prepare("SELECT id,type_id,external_identifier,title,external_system,source_as_of FROM change_request WHERE program_id=?").bind(PROGRAM_ID).all<ChangeRequestRow>(),
      db.prepare("SELECT id,external_system,external_identifier,change_request_id FROM incumbent_objective WHERE program_id=?").bind(PROGRAM_ID).all<ObjectiveRow>(),
      db.prepare("SELECT id,code,name,normalized_name FROM capability WHERE program_id=?").bind(PROGRAM_ID).all<CapabilityRow>(),
      db.prepare("SELECT id,name,code FROM release WHERE program_id=?").bind(PROGRAM_ID).all<ReleaseRow>(),
      db.prepare("SELECT id,code,normalized_code FROM change_request_type WHERE program_id=?").bind(PROGRAM_ID).all<TypeRow>(),
    ]);
    for (const row of requests.results) result.addRequest(row);
    for (const row of objectives.results) result.addObjective(row);
    for (const row of capabilities.results) result.addCapability(row);
    for (const row of releases.results) result.addRelease(row);
    for (const row of types.results) result.typesByCode.set(normalizeImportText(row.code), row);
    return result;
  }

  private addRequest(row: ChangeRequestRow) {
    const key = normalizeImportText(normalizeJpoIdentifier(row.external_identifier));
    this.requestsByIdentifier.set(key, [...(this.requestsByIdentifier.get(key) || []), row]);
  }
  private addObjective(row: ObjectiveRow) {
    const exact = `${normalizeImportText(row.external_system)}|${normalizeImportText(row.external_identifier)}`;
    const broad = `*|${normalizeImportText(row.external_identifier)}`;
    this.objectivesByIdentity.set(exact, [...(this.objectivesByIdentity.get(exact) || []), row]);
    this.objectivesByIdentity.set(broad, [...(this.objectivesByIdentity.get(broad) || []), row]);
  }
  private addCapability(row: CapabilityRow) {
    for (const key of [row.code, row.name].filter(Boolean).map(compact)) this.capabilitiesByKey.set(key, [...(this.capabilitiesByKey.get(key) || []), row]);
  }
  private addRelease(row: ReleaseRow) {
    for (const key of [row.name, row.code].filter(Boolean).map(normalizeImportText)) this.releasesByKey.set(key, [...(this.releasesByKey.get(key) || []), row]);
  }
  private ambiguity(message: string): CanonicalImportResult {
    const issue = { code: "ambiguous_identity" as const, message };
    this.issues.push(issue);
    return { id: null, created: false, issue };
  }

  private ensureType(code: string) {
    const normalized = normalizeImportText(code);
    const current = this.typesByCode.get(normalized);
    if (current) return current.id;
    const id = `change-type-${crypto.randomUUID()}`;
    const label = code === "OTHER" ? "External Change Request" : code;
    this.statements.push(this.db.prepare("INSERT INTO change_request_type (id,program_id,code,normalized_code,label,description,active,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, PROGRAM_ID, code, normalized, label, "Created automatically from an accepted external source identity.", 1, 999, this.at, this.at));
    this.typesByCode.set(normalized, { id, code, normalized_code: normalized });
    return id;
  }

  /** Creates a reference record only when a valid MCP/DSOR/other identity is present. */
  ensureChangeRequest(input: {
    identifier: unknown;
    title?: unknown;
    externalStatus?: unknown;
    externalOwner?: unknown;
    sourceSystem: string;
    sourceLocator?: string | null;
    sourceAsOf?: string | null;
    requestedRelease?: unknown;
    updateSourceFields?: boolean;
  }): CanonicalImportResult {
    const identifier = normalizeJpoIdentifier(input.identifier);
    if (!identifier) return this.ambiguity("The source row does not contain a usable MCP/DSOR or Change Request identifier.");
    const key = normalizeImportText(identifier);
    const matches = this.requestsByIdentifier.get(key) || [];
    if (matches.length > 1) return this.ambiguity(`${identifier} matches ${matches.length} canonical Change Requests. Resolve the duplicate canonical identity before applying.`);
    const release = input.requestedRelease ? this.ensureRelease(String(input.requestedRelease), input.sourceSystem, input.sourceAsOf || null) : { id: null, created: false };
    if (release.issue) return release;
    if (matches.length === 1) {
      const current = matches[0];
      if (input.updateSourceFields) {
        const suppliedTitle = clean(input.title) || current.title;
        this.statements.push(this.db.prepare("UPDATE change_request SET title=?,external_status=?,external_owner=?,source_locator=?,source_as_of=?,requested_release_id=COALESCE(?,requested_release_id),updated_at=? WHERE id=? AND program_id=?")
          .bind(suppliedTitle, clean(input.externalStatus) || null, clean(input.externalOwner) || null, input.sourceLocator || null, input.sourceAsOf || null, release.id, this.at, current.id, PROGRAM_ID));
        current.title = suppliedTitle;
      }
      return { id: current.id, created: false };
    }
    const id = `change-${crypto.randomUUID()}`;
    const type = inferChangeRequestType(identifier);
    const title = clean(input.title) || `${identifier} — title not supplied by source`;
    const row: ChangeRequestRow = { id, type_id: this.ensureType(type), external_identifier: identifier, title, external_system: CANONICAL_JPO_SYSTEM, source_as_of: input.sourceAsOf || null };
    this.statements.push(this.db.prepare("INSERT INTO change_request (id,program_id,type_id,external_system,external_identifier,title,external_status,external_owner,source_locator,source_as_of,requested_release_id,government_priority,decision_status,reference_status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, PROGRAM_ID, row.type_id, CANONICAL_JPO_SYSTEM, identifier, title, clean(input.externalStatus) || null, clean(input.externalOwner) || null, input.sourceLocator || null, input.sourceAsOf || null, release.id, "unranked", "pending", "active", this.actorId, this.at, this.at));
    this.addRequest(row);
    return { id, created: true };
  }

  ensureRelease(value: string, sourceSystem: string, sourceAsOf: string | null): CanonicalImportResult {
    const name = clean(value);
    if (!name) return { id: null, created: false };
    const matches = this.releasesByKey.get(normalizeImportText(name)) || [];
    if (matches.length > 1) return this.ambiguity(`${name} matches ${matches.length} canonical Releases. Resolve the duplicate canonical identity before applying.`);
    if (matches.length === 1) return { id: matches[0].id, created: false };
    // A free-text source field is not allowed to silently turn into a Release.
    // Recognized labels are safe to create as a planned reference, and can be
    // enriched later through Release management.
    if (!isRecognizedRelease(name)) return { id: null, created: false };
    const id = `release-${crypto.randomUUID()}`;
    const normalized = normalizeImportText(name);
    const row: ReleaseRow = { id, name, code: name };
    this.statements.push(this.db.prepare("INSERT INTO release (id,program_id,code,normalized_code,name,normalized_name,status,source_reference,source_as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, PROGRAM_ID, name, normalized, name, normalized, "planned", `${sourceSystem} import`, sourceAsOf, this.at, this.at));
    this.addRelease(row);
    return { id, created: true };
  }

  ensureObjective(input: {
    externalSystem: string;
    externalIdentifier: unknown;
    title?: unknown;
    summary?: unknown;
    technicalOwner?: unknown;
    status?: unknown;
    plannedStart?: unknown;
    plannedFinish?: unknown;
    actualStart?: unknown;
    actualFinish?: unknown;
    sourceLocator?: string | null;
    sourceAsOf?: string | null;
    primaryChangeRequestId?: string | null;
    updateSourceFields?: boolean;
  }): CanonicalImportResult {
    const externalSystem = clean(input.externalSystem) || LM_JIRA_SYSTEM;
    const externalIdentifier = clean(input.externalIdentifier);
    if (!externalIdentifier) return this.ambiguity("The source row does not contain a usable Objective identity.");
    const exact = this.objectivesByIdentity.get(`${normalizeImportText(externalSystem)}|${normalizeImportText(externalIdentifier)}`) || [];
    const broad = this.objectivesByIdentity.get(`*|${normalizeImportText(externalIdentifier)}`) || [];
    const matches = exact.length ? exact : broad;
    if (matches.length > 1) return this.ambiguity(`${externalIdentifier} matches ${matches.length} canonical Objectives. Resolve the duplicate canonical identity before applying.`);
    const status = sourceObjectiveStatus(input.status);
    const title = clean(input.title) || `${externalIdentifier} — title not supplied by source`;
    const dates = [input.plannedStart, input.plannedFinish, input.actualStart, input.actualFinish].map((value) => clean(value));
    if (matches.length === 1) {
      const current = matches[0];
      if (input.updateSourceFields !== false) {
        this.statements.push(this.db.prepare("UPDATE incumbent_objective SET title=?,summary=?,technical_owner=?,status=?,planned_start=?,planned_finish=?,actual_start=?,actual_finish=?,source_locator=?,source_as_of=?,updated_at=? WHERE id=? AND program_id=?")
          .bind(title, clean(input.summary) || null, clean(input.technicalOwner) || null, status, validDate(dates[0]) ? dates[0] : null, validDate(dates[1]) ? dates[1] : null, validDate(dates[2]) ? dates[2] : null, validDate(dates[3]) ? dates[3] : null, input.sourceLocator || null, input.sourceAsOf || null, this.at, current.id, PROGRAM_ID));
      }
      return { id: current.id, created: false };
    }
    const id = `objective-${crypto.randomUUID()}`;
    const row: ObjectiveRow = { id, external_system: externalSystem, external_identifier: externalIdentifier, change_request_id: input.primaryChangeRequestId || null };
    this.statements.push(this.db.prepare("INSERT INTO incumbent_objective (id,program_id,change_request_id,external_system,external_identifier,external_item_type,title,summary,technical_owner,status,planned_start,planned_finish,actual_start,actual_finish,source_locator,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, PROGRAM_ID, row.change_request_id, externalSystem, externalIdentifier, "Objective", title, clean(input.summary) || null, clean(input.technicalOwner) || null, status, validDate(dates[0]) ? dates[0] : null, validDate(dates[1]) ? dates[1] : null, validDate(dates[2]) ? dates[2] : null, validDate(dates[3]) ? dates[3] : null, input.sourceLocator || null, input.sourceAsOf || null, this.actorId, this.at, this.at));
    this.addObjective(row);
    return { id, created: true };
  }

  ensureObjectiveChangeRequestLink(input: { objectiveId: string; changeRequestId: string; relationship?: "primary" | "reported" | "related"; sourceSystem: string; sourceLocator?: string | null; sourceAsOf?: string | null }) {
    const relationship = input.relationship || "reported";
    this.statements.push(this.db.prepare("INSERT INTO objective_change_request_link (id,program_id,objective_id,change_request_id,relationship,source_system,source_locator,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(objective_id,change_request_id,relationship) DO UPDATE SET source_system=excluded.source_system,source_locator=excluded.source_locator,source_as_of=excluded.source_as_of,updated_at=excluded.updated_at")
      .bind(`objective-cr-link-${crypto.randomUUID()}`, PROGRAM_ID, input.objectiveId, input.changeRequestId, relationship, input.sourceSystem, input.sourceLocator || null, input.sourceAsOf || null, this.actorId, this.at, this.at));
  }

  ensureCapability(input: { code?: unknown; name?: unknown; description?: unknown; sourceReference?: string | null; sourceAsOf?: string | null }): CanonicalImportResult {
    const code = clean(input.code);
    const name = clean(input.name);
    if (!code && !name) return this.ambiguity("The source row does not contain a usable Capability identity.");
    const candidateKeys = [code, name].filter(Boolean).map(compact);
    const candidates = [...new Map(candidateKeys.flatMap((key) => this.capabilitiesByKey.get(key) || []).map((row) => [row.id, row])).values()];
    if (candidates.length > 1) return this.ambiguity(`${code || name} matches ${candidates.length} canonical Capabilities. Resolve the duplicate canonical identity before applying.`);
    if (candidates.length === 1) return { id: candidates[0].id, created: false };
    const id = `capability-${crypto.randomUUID()}`;
    const canonicalName = name || code;
    const row: CapabilityRow = { id, code: code || null, name: canonicalName, normalized_name: normalizeImportText(canonicalName) };
    this.statements.push(this.db.prepare("INSERT INTO capability (id,program_id,parent_id,code,name,normalized_name,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, PROGRAM_ID, null, row.code, row.name, row.normalized_name, clean(input.description) || null, this.at, this.at));
    this.addCapability(row);
    return { id, created: true };
  }
}
