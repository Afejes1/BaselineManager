import { env } from "cloudflare:workers";
import { PROGRAM_ID } from "./governance-server";
import type { GovernedImportItem, ImportResolution } from "./governed-import";

type Database = typeof env.DB;

export async function sha256Import(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function importIdentity(adapterKey: string, sourceAsOf: string | null | undefined, content: string) {
  const contentHash = await sha256Import(content);
  return { contentHash, idempotencyKey: `${adapterKey}|${sourceAsOf || "undated"}|${contentHash}` };
}

export async function priorImportRun(db: Database, idempotencyKey: string) {
  return db.prepare("SELECT id,status,record_count,added_count,changed_count,unchanged_count,skipped_count,blocked_count,applied_at FROM ingestion_run WHERE program_id=? AND idempotency_key=?")
    .bind(PROGRAM_ID, idempotencyKey).first<{ id: string; status: string; record_count: number; added_count: number; changed_count: number; unchanged_count: number; skipped_count: number; blocked_count: number; applied_at: string | null }>();
}

export function importRunStatements(db: Database, input: {
  runId: string;
  adapterKey: string;
  sourceSystem: string;
  fileName: string;
  sheetName?: string | null;
  sourceLocator?: string | null;
  sourceAsOf?: string | null;
  contentHash: string;
  idempotencyKey: string;
  items: GovernedImportItem[];
  resolutions: ImportResolution[];
  rawRows: unknown[];
  normalizedRows: unknown[];
  targetSnapshotKind?: string | null;
  targetSnapshotId?: string | null;
  actorId: string;
  at: string;
}) {
  const decisions = new Map(input.resolutions.map((item) => [item.rowNumber, item]));
  const approved = input.items.filter((item) => item.disposition !== "blocked" && (decisions.get(item.rowNumber)?.decision || item.defaultDecision) === "approve");
  const skipped = input.items.length - approved.length;
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO ingestion_run (id,program_id,adapter_key,source_system,file_name,sheet_name,source_locator,source_as_of,content_hash,idempotency_key,status,record_count,added_count,changed_count,unchanged_count,skipped_count,blocked_count,target_snapshot_kind,target_snapshot_id,reviewed_by_user_id,reviewed_at,applied_by_user_id,applied_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(input.runId, PROGRAM_ID, input.adapterKey, input.sourceSystem, input.fileName, input.sheetName || null, input.sourceLocator || null, input.sourceAsOf || null, input.contentHash, input.idempotencyKey, "applied", input.items.length, approved.filter((item) => item.disposition === "add").length, approved.filter((item) => item.disposition === "change").length, approved.filter((item) => item.disposition === "unchanged").length, skipped, input.items.filter((item) => item.disposition === "blocked").length, input.targetSnapshotKind || null, input.targetSnapshotId || null, input.actorId, input.at, input.actorId, input.at, input.at, input.at),
  ];
  input.items.forEach((item, index) => {
    const resolution = decisions.get(item.rowNumber);
    const decision = item.disposition === "blocked" ? "skip" : resolution?.decision || item.defaultDecision;
    const targetId = resolution?.targetId || item.proposedTargetId || null;
    statements.push(db.prepare("INSERT INTO ingestion_item (id,run_id,row_number,source_key,target_kind,target_id,match_method,decision,disposition,raw_payload,normalized_payload,changes_payload,issues_payload,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(`ingestion-item-${crypto.randomUUID()}`, input.runId, item.rowNumber, item.sourceKey, targetId ? item.targetKind || "canonical_record" : null, targetId, item.proposedTargetId && resolution?.targetId && resolution.targetId !== item.proposedTargetId ? "analyst_override" : item.proposedTargetId ? "deterministic_key" : "new_record", decision, item.disposition, JSON.stringify(input.rawRows[index] ?? null), JSON.stringify(input.normalizedRows[index] ?? null), JSON.stringify(item.changes), JSON.stringify(item.issues), input.at));
  });
  return statements;
}
