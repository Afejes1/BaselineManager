import { env } from "cloudflare:workers";
import type { EvidenceDocument } from "./governance-model";
import { createExecutiveBrief, PROGRAM_ID, type Actor } from "./governance-server";
import { bundleFor, initiativeDecisionWorkspace } from "./initiative-decision-server";
import { buildInitiativeReportMarkdown } from "./initiative-report";

type Database = typeof env.DB;
type DocumentRow = { id: string; governance_record_id: string | null; initiative_id: string | null; file_name: string; content_type: string | null; byte_size: number; description: string | null; created_at: string };
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

function latestTimestamp(values: Array<string | null | undefined>, fallback: string) {
  return values.filter((item): item is string => Boolean(item)).sort((left, right) => right.localeCompare(left))[0] || fallback;
}

export async function createInitiativeLeadershipReport(db: Database, actor: Actor, body: Record<string, unknown>) {
  const initiativeId = clean(body.initiativeId);
  const workspace = await initiativeDecisionWorkspace(db, actor);
  const bundle = bundleFor(workspace, initiativeId);
  const documentResult = await db.prepare("SELECT DISTINCT d.id,d.governance_record_id,d.initiative_id,d.file_name,d.content_type,d.byte_size,d.description,d.created_at FROM evidence_document d WHERE d.program_id=? AND (d.initiative_id=? OR EXISTS (SELECT 1 FROM governance_record_link l WHERE l.governance_record_id=d.governance_record_id AND l.entity_kind='initiative' AND l.entity_id=?)) ORDER BY d.created_at DESC").bind(PROGRAM_ID, initiativeId, initiativeId).all<DocumentRow>();
  const documents: EvidenceDocument[] = documentResult.results.map((document) => ({ id: document.id, governanceRecordId: document.governance_record_id, initiativeId: document.initiative_id, fileName: document.file_name, contentType: document.content_type, byteSize: document.byte_size, description: document.description, createdAt: document.created_at }));
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
  ], bundle.initiative.updatedAt || generatedAt);
  const assessment = workspace.assessments[initiativeId];
  if (!assessment) throw new Error("Initiative readiness could not be assessed.");
  return createExecutiveBrief(db, actor, body, ({ title, snapshot }) => buildInitiativeReportMarkdown({ title, generatedAt, dataLastChangedAt, bundle, assessment, documents, baseline: snapshot }));
}
