import { env } from "cloudflare:workers";
import type { EvidenceDocument } from "./governance-model";
import { MAX_GOVERNED_EVIDENCE_BYTES, MAX_GOVERNED_EVIDENCE_REFERENCES, storedEvidenceIntegrityMatches } from "./evidence-validation";
import { createExecutiveBrief, documentsBucket, PROGRAM_ID, type Actor } from "./governance-server";
import { bundleFor, initiativeDecisionWorkspace } from "./initiative-decision-server";
import { buildInitiativeReportMarkdown } from "./initiative-report";
import { assessInitiative } from "./initiative-readiness";

type Database = typeof env.DB;
type DocumentRow = { id: string; governance_record_id: string | null; initiative_id: string | null; file_name: string; content_type: string | null; byte_size: number; r2_key: string; description: string | null; created_at: string; integrity_payload: string | null; integrity_at: string | null };
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

function latestTimestamp(values: Array<string | null | undefined>, fallback: string) {
  return values.filter((item): item is string => Boolean(item)).sort((left, right) => right.localeCompare(left))[0] || fallback;
}

export async function createInitiativeLeadershipReport(db: Database, actor: Actor, body: Record<string, unknown>) {
  const initiativeId = clean(body.initiativeId);
  const auditRevision = await db.prepare("SELECT COUNT(*) AS row_count,COALESCE(MAX(rowid),0) AS max_row_id,MAX(created_at) AS changed_at FROM audit_event WHERE program_id=?").bind(PROGRAM_ID).first<{ row_count: number; max_row_id: number; changed_at: string | null }>();
  if (!auditRevision || !Number.isSafeInteger(Number(auditRevision.row_count)) || !Number.isSafeInteger(Number(auditRevision.max_row_id))) throw new Error("The governed source revision could not be captured.");
  const workspace = await initiativeDecisionWorkspace(db, actor, { initiativeId });
  const bundle = bundleFor(workspace, initiativeId);
  const signoffEvidenceIds = [...new Set(bundle.criteria.flatMap((criterion) => criterion.signoffs.flatMap((signoff) => signoff.evidenceDocumentId ? [signoff.evidenceDocumentId] : [])))];
  if (signoffEvidenceIds.length > MAX_GOVERNED_EVIDENCE_REFERENCES) throw new Error(`This Initiative references more than ${MAX_GOVERNED_EVIDENCE_REFERENCES} sign-off evidence documents. Split or retire the acceptance set before creating a governed report.`);
  const signoffClause = signoffEvidenceIds.length ? " OR d.id IN (SELECT value FROM json_each(?))" : "";
  const [documentResult, linkedRecordRevision] = await Promise.all([db.prepare(`SELECT DISTINCT d.id,d.governance_record_id,d.initiative_id,d.file_name,d.content_type,d.byte_size,d.r2_key,d.description,d.created_at,
    (SELECT a.after_payload FROM audit_event a WHERE a.program_id=d.program_id AND a.entity_kind='evidence_document' AND a.entity_id=d.id
     AND a.action IN ('evidence_document_attached','evidence_document_restored','evidence_integrity_sealed') ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS integrity_payload,
    (SELECT a.created_at FROM audit_event a WHERE a.program_id=d.program_id AND a.entity_kind='evidence_document' AND a.entity_id=d.id
     AND a.action IN ('evidence_document_attached','evidence_document_restored','evidence_integrity_sealed') ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS integrity_at
    FROM evidence_document d WHERE d.program_id=? AND NOT (d.content_type='application/octet-stream' AND d.description LIKE '[QUARANTINED LEGACY EVIDENCE%')
    AND (d.initiative_id=? OR EXISTS (SELECT 1 FROM governance_record_link l WHERE l.governance_record_id=d.governance_record_id AND l.entity_kind='initiative' AND l.entity_id=?)${signoffClause})
    ORDER BY d.created_at DESC`).bind(PROGRAM_ID, initiativeId, initiativeId, ...(signoffEvidenceIds.length ? [JSON.stringify(signoffEvidenceIds)] : [])).all<DocumentRow>(),
    db.prepare("SELECT MAX(g.updated_at) AS changed_at FROM governance_record g JOIN governance_record_link l ON l.governance_record_id=g.id WHERE g.program_id=? AND l.entity_kind='initiative' AND l.entity_id=?").bind(PROGRAM_ID, initiativeId).first<{ changed_at: string | null }>()]);
  if (documentResult.results.length > MAX_GOVERNED_EVIDENCE_REFERENCES) throw new Error(`A governed report may include at most ${MAX_GOVERNED_EVIDENCE_REFERENCES} evidence documents. Split the Initiative evidence set before report creation.`);
  const declaredBytes = documentResult.results.reduce((sum, document) => sum + Number(document.byte_size || 0), 0);
  if (declaredBytes > MAX_GOVERNED_EVIDENCE_BYTES) throw new Error("The Initiative evidence set exceeds the governed 100 MB report limit. Split the report scope before creation.");
  const evidenceBucket = documentsBucket();
  const documents: EvidenceDocument[] = [];
  const verifiedDocumentIds = new Set<string>();
  for (const document of documentResult.results) {
    if (!await storedEvidenceIntegrityMatches(evidenceBucket, { fileName: document.file_name, r2Key: document.r2_key, byteSize: document.byte_size, auditPayload: document.integrity_payload })) throw new Error("One or more Initiative evidence documents are missing, quarantined, or fail exact byte verification. Repair or remove the affected evidence before creating a governed report.");
    verifiedDocumentIds.add(document.id);
    documents.push({ id: document.id, governanceRecordId: document.governance_record_id, initiativeId: document.initiative_id, fileName: document.file_name, contentType: document.content_type, byteSize: document.byte_size, description: document.description, quarantined: false, integritySealed: true, createdAt: document.created_at });
  }
  const missingSignoffEvidence = signoffEvidenceIds.filter((documentId) => !verifiedDocumentIds.has(documentId));
  if (missingSignoffEvidence.length) throw new Error("One or more acceptance sign-off documents are missing, quarantined, or fail exact byte verification. Repair the evidence chain before creating a governed report.");
  for (const criterion of bundle.criteria) for (const signoff of criterion.signoffs) if (signoff.evidenceDocumentId && verifiedDocumentIds.has(signoff.evidenceDocumentId)) signoff.evidenceIntegrityStatus = "verified";
  const generatedAt = new Date().toISOString();
  const dataLastChangedAt = latestTimestamp([
    bundle.initiative.updatedAt,
    ...bundle.changeRequests.map((item) => item.updatedAt),
    ...bundle.objectives.map((item) => item.updatedAt),
    ...bundle.objectives.flatMap((item) => item.estimates.map((estimate) => estimate.createdAt)),
    ...(bundle.objectiveChangeRequestLinks ?? []).map((item) => item.updatedAt),
    ...(bundle.objectiveDependencies ?? []).map((item) => item.updatedAt),
    ...(bundle.objectiveEffectAttributions ?? []).map((item) => item.updatedAt),
    ...bundle.requirements.map((item) => item.updatedAt),
    ...bundle.criteria.map((item) => item.updatedAt),
    ...bundle.criteria.flatMap((item) => item.signoffs.map((signoff) => signoff.updatedAt)),
    ...bundle.milestones.map((item) => item.updatedAt),
    ...documents.map((item) => item.createdAt),
    ...documentResult.results.map((item) => item.integrity_at),
    linkedRecordRevision?.changed_at,
    auditRevision.changed_at,
  ], bundle.initiative.updatedAt || generatedAt);
  const assessment = assessInitiative(bundle);
  return createExecutiveBrief(db, actor, body, ({ title, snapshot }) => buildInitiativeReportMarkdown({ title, generatedAt, dataLastChangedAt, bundle, assessment, documents, baseline: snapshot }), { auditRowCount: Number(auditRevision.row_count), auditMaxRowId: Number(auditRevision.max_row_id) });
}
