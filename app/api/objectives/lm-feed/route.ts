import { env } from "cloudflare:workers";
import { audit, ensureActor, PROGRAM_ID, requireWriter } from "../../../../lib/governance-server";
import { LM_OBJECTIVE_FEED_SYSTEM, comparableFeedRecord, deltaJson, feedJson, parseLmObjectiveFeed, reconcileLmObjectiveFeedSnapshot, type ExistingLmFeedItem, type LmObjectiveFeedRecord } from "../../../../lib/lm-objective-feed";

type RequestRow = { id: string; external_identifier: string };
type StateRow = { feed_key: string; subject_id: string };
type FeedSnapshotRow = { id: string; file_name: string; source_locator: string | null; source_as_of: string | null; observed_at: string; record_count: number; added_count: number; changed_count: number; unchanged_count: number; removed_count: number; blocked_count: number; status: string };
type FeedSubjectRow = { id: string; feed_key: string; jira_identifier: string | null; url: string | null; canonical_objective_id: string | null; updated_at: string; latest_snapshot_id: string | null; rel_to: string | null; roadmap_parent: string | null; scope: string | null; domains_json: string | null; item_number: number | null; target_start: string | null; target_finish: string | null; rom: string | null; percent_complete: number | null; funding: string | null; release: string | null; overview: string | null; background: string | null; canonical_objective_title: string | null; normalized_payload: string | null };
type FeedJpoRow = { subject_id: string; external_identifier: string; change_request_id: string | null; change_request_external_identifier: string | null };
type FeedDependencyRow = { id: string; source_feed_key: string; source_subject_id: string; direction: "blocks" | "blocked_by"; target_reference: string; target_subject_id: string | null };
const timestamp = () => new Date().toISOString();
const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const text = (value: string | null) => value || null;
const safeExternalUrl = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch { return null; }
};

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashed = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashed)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function priorRecord(item: ExistingLmFeedItem | undefined): LmObjectiveFeedRecord | null {
  if (!item) return null;
  try {
    const parsed = JSON.parse(item.normalizedPayload) as Record<string, unknown>;
    const raw = parsed.raw;
    return parseLmObjectiveFeed({ [item.sourceKey]: raw }).records[0] || null;
  } catch { return null; }
}

async function currentContext() {
  const [requests, states, latest] = await Promise.all([
    env.DB.prepare("SELECT id,external_identifier FROM change_request WHERE program_id=?").bind(PROGRAM_ID).all<RequestRow>(),
    env.DB.prepare("SELECT s.feed_key,s.subject_id FROM lm_objective_feed_state s JOIN lm_objective_feed_subject f ON f.id=s.subject_id WHERE f.program_id=? AND f.external_system=?").bind(PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM).all<StateRow>(),
    env.DB.prepare("SELECT id FROM lm_objective_feed_snapshot WHERE program_id=? AND external_system=? AND status='applied' ORDER BY observed_at DESC,created_at DESC LIMIT 1").bind(PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM).first<{ id: string }>(),
  ]);
  const prior = latest ? await env.DB.prepare("SELECT feed_key,subject_id AS objective_id,normalized_payload FROM lm_objective_feed_item WHERE snapshot_id=?").bind(latest.id).all<ExistingLmFeedItem>() : { results: [] as ExistingLmFeedItem[] };
  return { requests: requests.results, states: states.results, prior: prior.results, latestSnapshotId: latest?.id || null };
}

function sourcePayload(body: { rawPayload?: unknown; payload?: unknown; sourcePayload?: unknown }) {
  if (typeof body.rawPayload === "string") return body.rawPayload;
  if (body.sourcePayload && typeof body.sourcePayload === "object") return JSON.stringify(body.sourcePayload);
  if (body.payload && typeof body.payload === "object") return JSON.stringify(body.payload);
  return "";
}

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const search = new URL(request.url).searchParams;
    const objectiveId = search.get("objectiveId");
    if (objectiveId) {
      // A removal has a delta but no source item in that day’s file. Start from
      // the explicitly reconciled subject so the Objective’s source history
      // exposes both reported records and later disappearances.
      const items = await env.DB.prepare("SELECT DISTINCT s.id AS snapshot_id,f.id AS subject_id,s.observed_at,s.source_as_of,s.source_locator,i.normalized_payload FROM lm_objective_feed_subject f JOIN lm_objective_feed_snapshot s ON s.program_id=f.program_id AND s.external_system=f.external_system LEFT JOIN lm_objective_feed_item i ON i.snapshot_id=s.id AND i.subject_id=f.id LEFT JOIN lm_objective_feed_delta d ON d.snapshot_id=s.id AND d.subject_id=f.id WHERE f.canonical_objective_id=? AND f.program_id=? AND (i.id IS NOT NULL OR d.id IS NOT NULL) ORDER BY s.observed_at DESC,s.created_at DESC").bind(objectiveId, PROGRAM_ID).all<{ snapshot_id: string; subject_id: string; observed_at: string; source_as_of: string | null; source_locator: string | null; normalized_payload: string | null }>();
      const deltas = await env.DB.prepare("SELECT d.snapshot_id,d.subject_id,d.change_kind,d.field_name,d.before_value,d.after_value FROM lm_objective_feed_delta d JOIN lm_objective_feed_subject f ON f.id=d.subject_id WHERE f.canonical_objective_id=? AND f.program_id=? ORDER BY d.created_at").bind(objectiveId, PROGRAM_ID).all<{ snapshot_id: string; subject_id: string; change_kind: string; field_name: string | null; before_value: string | null; after_value: string | null }>();
      const deltaBySnapshot = new Map<string, { diffs: Array<{ field: string; before: string; after: string }>; kinds: string[] }>();
      for (const delta of deltas.results) {
        const key = `${delta.snapshot_id}:${delta.subject_id}`;
        const values = deltaBySnapshot.get(key) || { diffs: [], kinds: [] };
        if (delta.field_name) values.diffs.push({ field: delta.field_name, before: delta.before_value || "", after: delta.after_value || "" });
        values.kinds.push(delta.change_kind);
        deltaBySnapshot.set(key, values);
      }
      const snapshots = items.results.map((item) => {
        let payload: Record<string, unknown> = {};
        try { payload = item.normalized_payload ? JSON.parse(item.normalized_payload) as Record<string, unknown> : {}; } catch { /* corrupt historic payload remains visible as receipt */ }
        const changes = deltaBySnapshot.get(`${item.snapshot_id}:${item.subject_id}`) || { diffs: [], kinds: [] };
        return { receivedAt: item.observed_at, sourceAsOf: item.source_as_of, sourceUrl: safeExternalUrl(item.source_locator) || safeExternalUrl(typeof payload.url === "string" ? payload.url : null), jpoIdentifiers: Array.isArray(payload.jpoIds) ? payload.jpoIds : [], blocks: Array.isArray(payload.blocks) ? payload.blocks : [], blockedBy: Array.isArray(payload.blockedBy) ? payload.blockedBy : [], fields: payload, diffs: changes.diffs, changeKinds: [...new Set(changes.kinds)] };
      });
      return Response.json({ snapshots });
    }
    const includeSubjects = search.get("subjects") === "1";
    const [snapshots, deltas, subjectRows, jpoRows] = await Promise.all([
      env.DB.prepare("SELECT id,file_name,source_locator,source_as_of,observed_at,record_count,added_count,changed_count,unchanged_count,removed_count,blocked_count,status FROM lm_objective_feed_snapshot WHERE program_id=? AND external_system=? ORDER BY observed_at DESC,created_at DESC LIMIT 60").bind(PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM).all<FeedSnapshotRow>(),
      env.DB.prepare("SELECT d.snapshot_id,d.change_kind,COUNT(*) AS count FROM lm_objective_feed_delta d JOIN lm_objective_feed_snapshot s ON s.id=d.snapshot_id WHERE s.program_id=? AND s.external_system=? GROUP BY d.snapshot_id,d.change_kind").bind(PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM).all(),
      includeSubjects
        ? env.DB.prepare("SELECT f.id,f.feed_key,f.jira_identifier,f.url,f.canonical_objective_id,f.updated_at,s.latest_snapshot_id,s.rel_to,s.roadmap_parent,s.scope,s.domains_json,s.item_number,s.target_start,s.target_finish,s.rom,s.percent_complete,s.funding,s.release,s.overview,s.background,o.title AS canonical_objective_title,i.normalized_payload FROM lm_objective_feed_subject f LEFT JOIN lm_objective_feed_state s ON s.subject_id=f.id LEFT JOIN lm_objective_feed_item i ON i.snapshot_id=s.latest_snapshot_id AND i.subject_id=f.id LEFT JOIN incumbent_objective o ON o.id=f.canonical_objective_id AND o.program_id=f.program_id WHERE f.program_id=? AND f.external_system=? ORDER BY f.updated_at DESC LIMIT 500").bind(PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM).all<FeedSubjectRow>()
        : Promise.resolve({ results: [] }),
      includeSubjects
        ? env.DB.prepare("SELECT j.subject_id,j.external_identifier,j.change_request_id,cr.external_identifier AS change_request_external_identifier FROM lm_objective_feed_jpo_link j JOIN lm_objective_feed_subject f ON f.id=j.subject_id LEFT JOIN change_request cr ON cr.id=j.change_request_id WHERE f.program_id=? AND f.external_system=? ORDER BY j.external_identifier").bind(PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM).all<FeedJpoRow>()
        : Promise.resolve({ results: [] }),
    ]);
    const latestSnapshotId = snapshots.results[0]?.id || null;
    const jpoLinksBySubject = new Map<string, FeedJpoRow[]>();
    for (const link of jpoRows.results) jpoLinksBySubject.set(link.subject_id, [...(jpoLinksBySubject.get(link.subject_id) || []), link]);
    const subjects = subjectRows.results.map((subject) => {
      let source: Record<string, unknown> = {};
      try { source = subject.normalized_payload ? JSON.parse(subject.normalized_payload) as Record<string, unknown> : {}; } catch { /* a historic payload must never hide the subject */ }
      return {
        ...subject,
        normalized_payload: undefined,
        url: safeExternalUrl(subject.url),
        title: typeof source.title === "string" ? source.title : null,
        blocks: Array.isArray(source.blocks) ? source.blocks : [],
        blockedBy: Array.isArray(source.blockedBy) ? source.blockedBy : [],
        jpoLinks: jpoLinksBySubject.get(subject.id) || [],
        presentInLatestSnapshot: subject.latest_snapshot_id === latestSnapshotId,
      };
    });
    const dependencies = includeSubjects && latestSnapshotId
      ? await env.DB.prepare("SELECT id,source_feed_key,source_subject_id,direction,target_reference,target_subject_id FROM lm_objective_feed_dependency WHERE snapshot_id=? ORDER BY source_feed_key,direction,target_reference").bind(latestSnapshotId).all<FeedDependencyRow>()
      : { results: [] as FeedDependencyRow[] };
    return Response.json({ snapshots: snapshots.results, history: snapshots.results, deltas: deltas.results, subjects, dependencies: dependencies.results, latestSnapshotId });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "LM objective feed history is unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as { mode?: "preview" | "apply" | "link_subject"; action?: "link_subject"; subjectId?: string; canonicalObjectiveId?: string; fileName?: string; sourceLocator?: string; sourceAsOf?: string; observedAt?: string; rawPayload?: string; payload?: unknown; sourcePayload?: unknown };
    if (body.mode === "link_subject" || body.action === "link_subject") {
      requireWriter(actor);
      if (!body.subjectId || !body.canonicalObjectiveId) return Response.json({ error: "A feed subject and a governed Objective are required." }, { status: 400 });
      const [subject, objective] = await Promise.all([
        env.DB.prepare("SELECT id,canonical_objective_id FROM lm_objective_feed_subject WHERE id=? AND program_id=? AND external_system=?").bind(body.subjectId, PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM).first<{ id: string; canonical_objective_id: string | null }>(),
        env.DB.prepare("SELECT id,title FROM incumbent_objective WHERE id=? AND program_id=?").bind(body.canonicalObjectiveId, PROGRAM_ID).first<{ id: string; title: string }>(),
      ]);
      if (!subject) return Response.json({ error: "The Lockheed feed subject was not found in this program." }, { status: 404 });
      if (!objective) return Response.json({ error: "The selected governed Objective was not found in this program." }, { status: 404 });
      const at = timestamp();
      await env.DB.batch([
        env.DB.prepare("UPDATE lm_objective_feed_subject SET canonical_objective_id=?,updated_at=? WHERE id=? AND program_id=? AND external_system=?").bind(objective.id, at, subject.id, PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM),
        audit(env.DB, actor, "lm_objective_feed_subject_linked", "lm_objective_feed_subject", subject.id, { canonicalObjectiveId: objective.id, canonicalObjectiveTitle: objective.title }, { priorCanonicalObjectiveId: subject.canonical_objective_id }),
      ]);
      return Response.json({ ok: true, subjectId: subject.id, canonicalObjectiveId: objective.id, canonicalObjectiveTitle: objective.title });
    }
    const payloadText = sourcePayload(body);
    if (!payloadText || !body.fileName) return Response.json({ error: "A JSON feed file name and JSON payload are required." }, { status: 400 });
    let payload: unknown;
    try { payload = JSON.parse(payloadText); } catch { return Response.json({ error: "The uploaded file is not valid JSON." }, { status: 400 }); }
    const parsed = parseLmObjectiveFeed(payload);
    const context = await currentContext();
    const preview = reconcileLmObjectiveFeedSnapshot(parsed.records, context.prior);
    const canApply = preview.canApply && !parsed.validationIssues.some((item) => item.blocking);
    const unresolvedJpoLinks = parsed.records.reduce((count, record) => count + record.jpoIds.filter((identifier) => !context.requests.some((request) => normalize(request.external_identifier) === normalize(identifier))).length, 0);
    const responsePreview = { ...preview, canApply, sourceIssues: parsed.issues, unresolvedJpoLinks };
    if (body.mode !== "apply") return Response.json({ preview: responsePreview, previousSnapshotId: context.latestSnapshotId });
    requireWriter(actor);
    if (!canApply) return Response.json({ error: "Resolve blocking JSON feed issues before applying the snapshot.", preview: responsePreview }, { status: 409 });

    const contentHash = await digest(payloadText);
    const at = timestamp();
    const snapshotId = `lm-feed-${crypto.randomUUID()}`;
    const priorByKey = new Map(context.prior.map((item) => [item.sourceKey, item]));
    const stateByKey = new Map(context.states.map((item) => [item.feed_key, item.subject_id]));
    const requestByIdentifier = new Map(context.requests.map((item) => [normalize(item.external_identifier), item]));
    const objectiveIdByKey = new Map<string, string>();
    const statements: D1PreparedStatement[] = [
      env.DB.prepare("INSERT INTO lm_objective_feed_snapshot (id,program_id,external_system,file_name,source_locator,source_as_of,observed_at,content_hash,snapshot_payload,record_count,added_count,changed_count,unchanged_count,removed_count,blocked_count,status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(snapshotId, PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM, body.fileName, text(body.sourceLocator || null), text(body.sourceAsOf || null), body.observedAt || at, contentHash, payloadText, parsed.records.length, preview.added, preview.changed, preview.unchanged, preview.removed.length, preview.blocked, "applied", actor.id, at, at),
    ];
    for (const item of preview.items) {
      const record = item.record;
      const prior = priorByKey.get(record.sourceKey);
      const matching = stateByKey.get(record.sourceKey) || prior?.objectiveId || null;
      const subjectId = matching || `lm-feed-subject-${crypto.randomUUID()}`;
      objectiveIdByKey.set(record.sourceKey, subjectId);
      if (!matching) statements.push(env.DB.prepare("INSERT INTO lm_objective_feed_subject (id,program_id,external_system,feed_key,jira_identifier,url,canonical_objective_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(subjectId, PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM, record.sourceKey, record.jira, record.url, null, at, at));
      else statements.push(env.DB.prepare("UPDATE lm_objective_feed_subject SET feed_key=?,jira_identifier=?,url=?,updated_at=? WHERE id=? AND program_id=? AND external_system=?").bind(record.sourceKey, record.jira, record.url, at, subjectId, PROGRAM_ID, LM_OBJECTIVE_FEED_SYSTEM));
      const normalizedPayload = feedJson(record);
      statements.push(env.DB.prepare("INSERT INTO lm_objective_feed_item (id,snapshot_id,subject_id,feed_key,jira_identifier,jpo_raw,disposition,normalized_payload,raw_payload,content_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(`lm-feed-item-${crypto.randomUUID()}`, snapshotId, subjectId, record.sourceKey, record.jira, record.jpoRaw, item.disposition, normalizedPayload, JSON.stringify(record.raw), await digest(normalizedPayload), at));
      statements.push(env.DB.prepare("INSERT INTO lm_objective_feed_state (subject_id,latest_snapshot_id,feed_key,url,rel_to,roadmap_parent,scope,domains_json,item_number,target_start,target_finish,rom,percent_complete,funding,release,overview,background,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subject_id) DO UPDATE SET latest_snapshot_id=excluded.latest_snapshot_id,feed_key=excluded.feed_key,url=excluded.url,rel_to=excluded.rel_to,roadmap_parent=excluded.roadmap_parent,scope=excluded.scope,domains_json=excluded.domains_json,item_number=excluded.item_number,target_start=excluded.target_start,target_finish=excluded.target_finish,rom=excluded.rom,percent_complete=excluded.percent_complete,funding=excluded.funding,release=excluded.release,overview=excluded.overview,background=excluded.background,updated_at=excluded.updated_at").bind(subjectId, snapshotId, record.sourceKey, record.url, record.relTo, record.roadmapParent, record.scope, JSON.stringify(record.domains), record.itemNumber, record.targetStart, record.targetFinish, record.rom == null ? null : String(record.rom), record.percentComplete, record.funding, record.release, record.overview, record.background, at));
      statements.push(env.DB.prepare("DELETE FROM lm_objective_feed_jpo_link WHERE subject_id=?").bind(subjectId));
      for (const jpo of record.jpoIds) {
        const resolved = requestByIdentifier.get(normalize(jpo));
        statements.push(env.DB.prepare("INSERT INTO lm_objective_feed_jpo_link (id,subject_id,latest_snapshot_id,external_identifier,change_request_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(`lm-feed-jpo-${crypto.randomUUID()}`, subjectId, snapshotId, jpo, resolved?.id || null, at, at));
      }
      const before = priorRecord(prior);
      if (item.disposition === "add") statements.push(env.DB.prepare("INSERT INTO lm_objective_feed_delta (id,snapshot_id,subject_id,feed_key,change_kind,field_name,before_value,after_value,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`lm-feed-delta-${crypto.randomUUID()}`, snapshotId, subjectId, record.sourceKey, "added", null, null, normalizedPayload, at));
      else if (item.disposition === "change") for (const field of item.changedFields) {
        const left = comparableFeedRecord(before!) as Record<string, unknown>;
        const right = comparableFeedRecord(record) as Record<string, unknown>;
        statements.push(env.DB.prepare("INSERT INTO lm_objective_feed_delta (id,snapshot_id,subject_id,feed_key,change_kind,field_name,before_value,after_value,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`lm-feed-delta-${crypto.randomUUID()}`, snapshotId, subjectId, record.sourceKey, "changed", field, deltaJson(left[field]), deltaJson(right[field]), at));
      } else statements.push(env.DB.prepare("INSERT INTO lm_objective_feed_delta (id,snapshot_id,subject_id,feed_key,change_kind,field_name,before_value,after_value,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`lm-feed-delta-${crypto.randomUUID()}`, snapshotId, subjectId, record.sourceKey, "unchanged", null, null, null, at));
    }
    for (const removed of preview.removed) { const subjectId = stateByKey.get(removed.sourceKey) || removed.objectiveId; if (subjectId) statements.push(env.DB.prepare("INSERT INTO lm_objective_feed_delta (id,snapshot_id,subject_id,feed_key,change_kind,field_name,before_value,after_value,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`lm-feed-delta-${crypto.randomUUID()}`, snapshotId, subjectId, removed.sourceKey, "removed", null, null, null, at)); }
    for (const record of parsed.records) for (const [direction, targets] of [["blocks", record.blocks], ["blocked_by", record.blockedBy]] as const) for (const target of targets) statements.push(env.DB.prepare("INSERT INTO lm_objective_feed_dependency (id,snapshot_id,source_feed_key,source_subject_id,direction,target_reference,target_subject_id,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(`lm-feed-dependency-${crypto.randomUUID()}`, snapshotId, record.sourceKey, objectiveIdByKey.get(record.sourceKey) || stateByKey.get(record.sourceKey), direction, target, objectiveIdByKey.get(target) || stateByKey.get(target) || null, at));
    statements.push(audit(env.DB, actor, "lm_objective_feed_snapshot_imported", "lm_objective_feed_snapshot", snapshotId, { fileName: body.fileName, sourceLocator: body.sourceLocator || null, sourceAsOf: body.sourceAsOf || null, records: parsed.records.length, added: preview.added, changed: preview.changed, unchanged: preview.unchanged, removed: preview.removed.length, unresolvedJpoLinks }));
    await env.DB.batch(statements);
    return Response.json({ ok: true, snapshotId, preview: responsePreview }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LM objective feed could not be applied.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
