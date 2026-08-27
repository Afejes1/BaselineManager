import { env } from "cloudflare:workers";
import { audit, ensureActor, PROGRAM_ID, requireWriter } from "../../../../lib/governance-server";
import { importIdentity, priorImportRun, sha256Import } from "../../../../lib/import-run-server";
import { CD_SW_ADAPTER_KEY, CD_SW_SOURCE_SYSTEM, parseCdSwMatrix, type CdSwDataset, type CdSwMachine, type CdSwSoftwareRow } from "../../../../lib/cd-sw-import";
import type { GovernedImportItem, ImportFieldChange, ImportResolution } from "../../../../lib/governed-import";

type IncomingBody = {
  mode?: "preview" | "apply";
  fileName?: string;
  sheetName?: string;
  sourceAsOf?: string;
  sourceSystem?: string;
  releaseId?: string;
  platformId?: string;
  matrix?: unknown[][];
  resolutions?: ImportResolution[];
};

type ProductRow = { id: string; canonical_name: string; normalized_name: string; lifecycle_status: string; product_type: string | null; software_classification: string | null; description: string | null };
type AliasRow = { entity_id: string; namespace: string; normalized_alias: string };
type NodeRow = { id: string; normalized_code: string; normalized_name: string; lifecycle_status: string; node_type: string; code: string; name: string };
type StateRow = { id: string; infrastructure_node_id: string; lifecycle_status: string; confidence: string };
type InstallationRow = { id: string; source_identity: string; product_id: string; node_state_id: string; installation_role: string; instance_name: string | null; version: string | null; deployment_status: string; confidence: string };
type SourcePayloadRow = { source_key: string; normalized_payload: string };

type MachineReviewRecord = { kind: "machine"; item: GovernedImportItem; raw: unknown; normalized: Record<string, unknown>; machine: CdSwMachine; nodeId: string; stateId: string };
type SoftwareReviewRecord = { kind: "software"; item: GovernedImportItem; raw: unknown; normalized: Record<string, unknown>; software: CdSwSoftwareRow; productId: string; placements: Array<{ machine: CdSwMachine; nodeId: string; stateId: string; installationId: string; sourceIdentity: string; existing: InstallationRow | null }> };
type ReviewRecord = MachineReviewRecord | SoftwareReviewRecord;

const clean = (value: unknown, limit = 1_000) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, limit);
const canonicalNormalized = (value: unknown) => clean(value).toLocaleLowerCase("en-US");
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const compact = (values: string[]) => [...new Set(values.map((value) => clean(value)).filter(Boolean))];
const json = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };

async function stableId(prefix: string, value: string) {
  return `${prefix}-${(await sha256Import(value)).slice(0, 24)}`;
}

function scalar(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => clean(item)).join(" · ");
  return clean(value);
}

function sourceChanges(before: Record<string, unknown> | null, after: Record<string, unknown>, fields: string[]): ImportFieldChange[] {
  if (!before) return [];
  return fields.flatMap((field) => {
    const prior = scalar(before[field]);
    const next = scalar(after[field]);
    return prior === next ? [] : [{ field, before: prior, after: next }];
  });
}

async function loadContext(releaseId: string, platformId: string) {
  const [release, platform, products, aliases, nodes, states, installations, latestItems] = await Promise.all([
    env.DB.prepare("SELECT id,name,status FROM release WHERE id=? AND program_id=?").bind(releaseId, PROGRAM_ID).first<{ id: string; name: string; status: string }>(),
    env.DB.prepare("SELECT id,code,name,status FROM platform WHERE id=? AND program_id=?").bind(platformId, PROGRAM_ID).first<{ id: string; code: string; name: string; status: string }>(),
    env.DB.prepare("SELECT id,canonical_name,normalized_name,lifecycle_status,product_type,software_classification,description FROM product WHERE program_id=?").bind(PROGRAM_ID).all<ProductRow>(),
    env.DB.prepare("SELECT entity_id,namespace,normalized_alias FROM canonical_alias WHERE program_id=? AND entity_kind='product' AND namespace IN ('cd_sw_uuid','cd_sw_alias') AND status IN ('proposed','accepted')").bind(PROGRAM_ID).all<AliasRow>(),
    env.DB.prepare("SELECT id,normalized_code,normalized_name,lifecycle_status,node_type,code,name FROM infrastructure_node WHERE program_id=? AND platform_id=?").bind(PROGRAM_ID, platformId).all<NodeRow>(),
    env.DB.prepare("SELECT id,infrastructure_node_id,lifecycle_status,confidence FROM release_infrastructure_node WHERE program_id=? AND release_id=? AND platform_id=?").bind(PROGRAM_ID, releaseId, platformId).all<StateRow>(),
    env.DB.prepare("SELECT id,source_identity,product_id,node_state_id,installation_role,instance_name,version,deployment_status,confidence FROM infrastructure_product_installation WHERE program_id=? AND release_id=? AND platform_id=? AND source_identity LIKE 'cd-sw:%'").bind(PROGRAM_ID, releaseId, platformId).all<InstallationRow>(),
    env.DB.prepare("SELECT ii.source_key,ii.normalized_payload FROM ingestion_item ii JOIN ingestion_run ir ON ir.id=ii.run_id WHERE ir.program_id=? AND ir.adapter_key=? AND ir.status='applied' ORDER BY ir.applied_at DESC,ii.row_number ASC LIMIT 20000").bind(PROGRAM_ID, CD_SW_ADAPTER_KEY).all<SourcePayloadRow>(),
  ]);
  if (!release) throw new Error("Choose a governed Release before previewing the CD SW matrix.");
  if (!platform || platform.status === "retired") throw new Error("Choose an active or planned governed Platform before previewing the CD SW matrix.");
  const latest = new Map<string, Record<string, unknown>>();
  latestItems.results.forEach((row) => { if (!latest.has(row.source_key)) latest.set(row.source_key, json(row.normalized_payload, {})); });
  return { release, platform, products: products.results, aliases: aliases.results, nodes: nodes.results, states: states.results, installations: installations.results, latest };
}

async function buildReview(dataset: CdSwDataset, releaseId: string, platformId: string) {
  const context = await loadContext(releaseId, platformId);
  const productsByName = new Map(context.products.map((row) => [row.normalized_name, row]));
  const productsById = new Map(context.products.map((row) => [row.id, row]));
  const aliases = new Map(context.aliases.map((row) => [`${row.namespace}|${row.normalized_alias}`, row.entity_id]));
  const nodesById = new Map(context.nodes.map((row) => [row.id, row]));
  const nodesByCode = new Map(context.nodes.map((row) => [row.normalized_code, row]));
  const nodesByName = new Map(context.nodes.map((row) => [row.normalized_name, row]));
  const statesByNode = new Map(context.states.map((row) => [row.infrastructure_node_id, row]));
  const installationsByIdentity = new Map(context.installations.map((row) => [row.source_identity, row]));
  const records: ReviewRecord[] = [];
  const machineTargets = new Map<string, { machine: CdSwMachine; nodeId: string; stateId: string; node: NodeRow | null; state: StateRow | null }>();

  for (const machine of dataset.machines) {
    const deterministicNodeId = await stableId("cdsw-node", `${platformId}|${machine.sourceUuid || machine.code || machine.name}`);
    const existingNode = nodesById.get(deterministicNodeId) || nodesByCode.get(canonicalNormalized(machine.code)) || nodesByName.get(canonicalNormalized(machine.name)) || null;
    const nodeId = existingNode?.id || deterministicNodeId;
    const existingState = statesByNode.get(nodeId) || null;
    const stateId = existingState?.id || await stableId("cdsw-state", `${releaseId}|${nodeId}`);
    machineTargets.set(machine.key, { machine, nodeId, stateId, node: existingNode, state: existingState });
    const sourceKey = `machine:${machine.key}`;
    const normalized = { kind: "machine", sourceType: machine.sourceType, sourceUuid: machine.sourceUuid, name: machine.name, code: machine.code, nodeType: machine.nodeType, releaseId, platformId };
    const changes = sourceChanges(context.latest.get(sourceKey) || null, normalized, ["sourceType", "sourceUuid", "name", "code", "nodeType"]);
    const issues = [...machine.issues, ...machine.warnings];
    if (existingNode?.lifecycle_status === "retired") issues.unshift("The matching infrastructure node is retired and cannot receive a current reported state.");
    if (existingState?.lifecycle_status === "absent" && existingState.confidence !== "reported") issues.unshift("The matching Release node is adjudicated as absent; the source row will not reactivate it.");
    const blocked = issues.some((issue) => !issue.startsWith("Warning:"));
    const disposition = blocked ? "blocked" as const : !existingNode ? "add" as const : changes.length ? "change" as const : "unchanged" as const;
    const item: GovernedImportItem = {
      id: `cdsw-machine-${records.length + 1}`,
      rowNumber: records.length + 1,
      sourceKey,
      title: `${machine.code} · ${machine.name}`,
      detail: `Machine column ${machine.columnLabel} · ${machine.sourceType || "type not supplied"} · ${existingNode ? "matches an existing node" : "new reported node"}`,
      disposition,
      issues,
      changes,
      proposedTargetId: nodeId,
      proposedTargetLabel: existingNode ? `${existingNode.code} · ${existingNode.name}` : `${machine.code} · ${machine.name}`,
      targetKind: "infrastructure_node",
      defaultDecision: blocked ? "skip" : "approve",
    };
    records.push({ kind: "machine", item, machine, nodeId, stateId, raw: { sourceType: machine.sourceType, sourceUuid: machine.sourceUuid, name: machine.name, code: machine.code, column: machine.columnLabel }, normalized });
  }

  for (const software of dataset.softwareRows) {
    const uuidTarget = software.sourceUuid ? aliases.get(`cd_sw_uuid|${canonicalNormalized(software.sourceUuid)}`) : null;
    const aliasTarget = software.alias ? aliases.get(`cd_sw_alias|${canonicalNormalized(software.alias)}`) : null;
    const namedProduct = productsByName.get(canonicalNormalized(software.productName)) || null;
    const conflictingTargets = compact([uuidTarget || "", aliasTarget || "", namedProduct?.id || ""]);
    const matchedProduct = conflictingTargets.length === 1 ? productsById.get(conflictingTargets[0]) || namedProduct : namedProduct;
    const productId = matchedProduct?.id || await stableId("cdsw-product", canonicalNormalized(software.productName));
    const placements = [] as SoftwareReviewRecord["placements"];
    for (const machineKey of software.machineKeys) {
      const target = machineTargets.get(machineKey)!;
      const sourceIdentity = `cd-sw:${software.key}:${machineKey}`;
      const existing = installationsByIdentity.get(sourceIdentity) || null;
      const installationId = existing?.id || await stableId("cdsw-install", `${releaseId}|${platformId}|${sourceIdentity}`);
      placements.push({ machine: target.machine, nodeId: target.nodeId, stateId: target.stateId, installationId, sourceIdentity, existing });
    }
    const sourceKey = `software:${software.key}`;
    const normalized = {
      kind: "software", componentName: software.componentName, softwareName: software.softwareName, productName: software.productName,
      version: software.version, description: software.description, vendor: software.vendor, csci: software.csci, sourceType: software.sourceType,
      trusted: software.trusted, niap: software.niap, verifiedBy: software.verifiedBy, sourceUuid: software.sourceUuid, alias: software.alias,
      installationRole: software.installationRole, machineKeys: [...software.machineKeys].sort(), releaseId, platformId,
    };
    const changes = sourceChanges(context.latest.get(sourceKey) || null, normalized, ["componentName", "softwareName", "productName", "version", "description", "vendor", "csci", "sourceType", "trusted", "niap", "verifiedBy", "sourceUuid", "alias", "installationRole", "machineKeys"]);
    const issues = [...software.issues, ...software.warnings];
    if (conflictingTargets.length > 1) issues.unshift("The source UUID, Alias, and Product name resolve to different governed Products. Resolve the canonical identity before importing this row.");
    if (matchedProduct?.lifecycle_status === "retired") issues.unshift("The matching Product is retired and cannot receive an installed placement.");
    const assessedDifferences = placements.filter((placement) => placement.existing && placement.existing.confidence !== "reported" && (
      placement.existing.product_id !== productId || placement.existing.node_state_id !== placement.stateId || placement.existing.installation_role !== software.installationRole || clean(placement.existing.instance_name) !== clean(software.alias) || clean(placement.existing.version) !== clean(software.version)
    )).length;
    if (assessedDifferences) issues.push(`Warning: ${assessedDifferences} adjudicated placement${assessedDifferences === 1 ? " differs" : "s differ"}; the import receipt will retain the source claim without overwriting the adjudicated value.`);
    const missingPlacements = placements.filter((placement) => !placement.existing).length;
    if (!changes.length && missingPlacements) changes.push({ field: "reported placements", before: String(placements.length - missingPlacements), after: String(placements.length) });
    const blocked = issues.some((issue) => !issue.startsWith("Warning:"));
    const disposition = blocked ? "blocked" as const : !matchedProduct ? "add" as const : changes.length ? "change" as const : "unchanged" as const;
    const item: GovernedImportItem = {
      id: `cdsw-software-${records.length + 1}`,
      rowNumber: records.length + 1,
      sourceKey,
      title: software.productName || "Untitled software source row",
      detail: `Spreadsheet row ${software.rowNumber} · ${placements.length} reported placement${placements.length === 1 ? "" : "s"} · ${software.alias || software.sourceUuid || "composite source identity"}`,
      disposition,
      issues,
      changes,
      proposedTargetId: productId,
      proposedTargetLabel: matchedProduct?.canonical_name || software.productName,
      targetKind: "product",
      defaultDecision: blocked ? "skip" : "approve",
    };
    records.push({ kind: "software", item, software, productId, placements, raw: { ...software.raw, placements: software.machineKeys }, normalized });
  }
  return { context, records, items: records.map((record) => record.item) };
}

function sourceReference(body: IncomingBody, suffix: string) {
  return `CD SW · ${clean(body.sourceSystem) || CD_SW_SOURCE_SYSTEM} · ${clean(body.fileName)} · ${clean(body.sheetName)} · ${suffix}`;
}

function productDescription(software: CdSwSoftwareRow) {
  return compact([
    software.description,
    software.componentName && software.componentName !== software.productName ? `Source component: ${software.componentName}` : "",
    software.vendor ? `Reported vendor: ${software.vendor}` : "",
    software.csci ? `CSCI: ${software.csci}` : "",
    software.sourceType ? `Reported type: ${software.sourceType}` : "",
  ]).join(" · ").slice(0, 4_000) || null;
}

async function executeBatches(statements: D1PreparedStatement[], size = 80) {
  for (let index = 0; index < statements.length; index += size) await env.DB.batch(statements.slice(index, index + size));
}

async function applyReview(body: IncomingBody, dataset: CdSwDataset, records: ReviewRecord[], actor: Awaited<ReturnType<typeof ensureActor>>, identity: Awaited<ReturnType<typeof importIdentity>>) {
  requireWriter(actor);
  const releaseId = clean(body.releaseId);
  const platformId = clean(body.platformId);
  const sourceAsOf = clean(body.sourceAsOf);
  const resolutions = new Map((body.resolutions || []).map((resolution) => [resolution.rowNumber, resolution.decision]));
  const approved = records.filter((record) => record.item.disposition !== "blocked" && (resolutions.get(record.item.rowNumber) || record.item.defaultDecision) === "approve");
  if (!approved.length) throw new Error("Approve at least one valid machine or software row before applying the CD SW import.");
  const approvedMachineKeys = new Set(approved.filter((record): record is MachineReviewRecord => record.kind === "machine").map((record) => record.machine.key));
  const prior = await priorImportRun(env.DB, identity.idempotencyKey);
  if (prior?.status === "applied") return { duplicate: true, runId: prior.id, applied: prior.record_count, placements: 0 };
  if (prior) await env.DB.batch([
    env.DB.prepare("DELETE FROM ingestion_item WHERE run_id=?").bind(prior.id),
    env.DB.prepare("DELETE FROM ingestion_run WHERE id=? AND program_id=? AND status<>'applied'").bind(prior.id, PROGRAM_ID),
  ]);
  const runId = `ingestion-run-${crypto.randomUUID()}`;
  const at = new Date().toISOString();
  const fileName = clean(body.fileName);
  const sheetName = clean(body.sheetName);
  const sourceSystem = clean(body.sourceSystem) || CD_SW_SOURCE_SYSTEM;
  await env.DB.prepare("INSERT INTO ingestion_run (id,program_id,adapter_key,source_system,file_name,sheet_name,source_locator,source_as_of,content_hash,idempotency_key,status,record_count,added_count,changed_count,unchanged_count,skipped_count,blocked_count,target_snapshot_kind,target_snapshot_id,reviewed_by_user_id,reviewed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(runId, PROGRAM_ID, CD_SW_ADAPTER_KEY, sourceSystem, fileName, sheetName || null, null, sourceAsOf, identity.contentHash, identity.idempotencyKey, "staged", records.length, 0, 0, 0, records.length - approved.length, records.filter((record) => record.item.disposition === "blocked").length, "release_platform", `${releaseId}|${platformId}`, actor.id, at, at, at).run();
  try {
    const receiptStatements = records.map((record) => {
      const decision = record.item.disposition === "blocked" ? "skip" : resolutions.get(record.item.rowNumber) || record.item.defaultDecision;
      return env.DB.prepare("INSERT INTO ingestion_item (id,run_id,row_number,source_key,target_kind,target_id,match_method,decision,disposition,raw_payload,normalized_payload,changes_payload,issues_payload,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(`${runId}-item-${record.item.rowNumber}`, runId, record.item.rowNumber, record.item.sourceKey, record.item.targetKind || null, record.item.proposedTargetId || null, record.item.disposition === "add" ? "new_record" : "deterministic_key", decision, record.item.disposition, JSON.stringify(record.raw), JSON.stringify(record.normalized), JSON.stringify(record.item.changes), JSON.stringify(record.item.issues), at);
    });
    await executeBatches(receiptStatements);

    const entityStatements: D1PreparedStatement[] = [];
    for (const record of approved) {
      if (record.kind === "machine") {
        const ref = sourceReference(body, `machine column ${record.machine.columnLabel}`);
        const description = `CD SW reported machine. Source type: ${record.machine.sourceType || "not supplied"}. Source UUID: ${record.machine.sourceUuid || "not supplied"}.`;
        entityStatements.push(env.DB.prepare("INSERT INTO infrastructure_node (id,program_id,platform_id,node_type,code,normalized_code,name,normalized_name,lifecycle_status,description,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
          .bind(record.nodeId, PROGRAM_ID, platformId, record.machine.nodeType, record.machine.code, canonicalNormalized(record.machine.code), record.machine.name, canonicalNormalized(record.machine.name), "active", description, actor.id, at, at));
        entityStatements.push(env.DB.prepare("INSERT INTO release_infrastructure_node (id,program_id,release_id,platform_id,infrastructure_node_id,parent_state_id,lifecycle_status,operating_state,confidence,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(release_id,infrastructure_node_id) DO UPDATE SET lifecycle_status='active',operating_state='unknown',source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,notes=excluded.notes,updated_at=excluded.updated_at WHERE release_infrastructure_node.confidence='reported'")
          .bind(record.stateId, PROGRAM_ID, releaseId, platformId, record.nodeId, null, "active", "unknown", "reported", ref, sourceAsOf, "Reported by the CD SW machine matrix. Capacity and containment remain unassessed until separately edited.", actor.id, at, at));
      }
    }
    for (const record of approved) {
      if (record.kind !== "software") continue;
      const software = record.software;
      const ref = sourceReference(body, `source row ${software.rowNumber}`);
      entityStatements.push(env.DB.prepare("INSERT INTO product (id,program_id,canonical_name,normalized_name,short_name,product_type,software_classification,description,lifecycle_status,source_reference,source_as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
        .bind(record.productId, PROGRAM_ID, software.productName, canonicalNormalized(software.productName), software.componentName || software.alias || null, "Software", software.sourceType || null, productDescription(software), "active", ref, sourceAsOf, at, at));
      for (const [namespace, alias] of [["cd_sw_uuid", software.sourceUuid], ["cd_sw_alias", software.alias]] as const) {
        if (!alias) continue;
        entityStatements.push(env.DB.prepare("INSERT INTO canonical_alias (id,program_id,entity_kind,entity_id,alias,normalized_alias,namespace,source_reference,status,reviewed_by_user_id,reviewed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(program_id,entity_kind,namespace,normalized_alias) DO NOTHING")
          .bind(`alias-${crypto.randomUUID()}`, PROGRAM_ID, "product", record.productId, alias, canonicalNormalized(alias), namespace, ref, "proposed", null, null, at, at));
      }
      for (const placement of record.placements) {
        if (!approvedMachineKeys.has(placement.machine.key)) continue;
        entityStatements.push(env.DB.prepare("INSERT INTO infrastructure_product_installation (id,program_id,release_id,platform_id,node_state_id,product_id,baseline_occurrence_id,installation_role,instance_name,normalized_instance_name,source_identity,version,deployment_status,confidence,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET node_state_id=excluded.node_state_id,product_id=excluded.product_id,installation_role=excluded.installation_role,instance_name=excluded.instance_name,normalized_instance_name=excluded.normalized_instance_name,version=excluded.version,deployment_status=excluded.deployment_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,notes=excluded.notes,updated_at=excluded.updated_at WHERE infrastructure_product_installation.confidence='reported'")
          .bind(placement.installationId, PROGRAM_ID, releaseId, platformId, placement.stateId, record.productId, null, software.installationRole, software.alias || null, canonicalNormalized(software.alias), placement.sourceIdentity, software.version || null, "installed", "reported", ref, sourceAsOf, `Reported by X in machine column ${placement.machine.columnLabel}. Software UUID: ${software.sourceUuid || "not supplied"}; machine UUID: ${placement.machine.sourceUuid || "not supplied"}.`, actor.id, at, at));
      }
    }
    await executeBatches(entityStatements);
    const placementCount = approved.filter((record): record is SoftwareReviewRecord => record.kind === "software").reduce((sum, record) => sum + record.placements.filter((placement) => approvedMachineKeys.has(placement.machine.key)).length, 0);
    const added = approved.filter((record) => record.item.disposition === "add").length;
    const changed = approved.filter((record) => record.item.disposition === "change").length;
    const unchanged = approved.filter((record) => record.item.disposition === "unchanged").length;
    await env.DB.batch([
      env.DB.prepare("UPDATE ingestion_run SET status='applied',added_count=?,changed_count=?,unchanged_count=?,applied_by_user_id=?,applied_at=?,updated_at=? WHERE id=?").bind(added, changed, unchanged, actor.id, at, at, runId),
      audit(env.DB, actor, "cd_sw_matrix_import_applied", "ingestion_run", runId, { fileName, sheetName, sourceAsOf, releaseId, platformId, approvedRows: approved.length, placements: placementCount, sourceRule: "reported_only_preserves_adjudicated_values" }),
    ]);
    return { duplicate: false, runId, applied: approved.length, placements: placementCount };
  } catch (error) {
    await env.DB.prepare("UPDATE ingestion_run SET status='failed',updated_at=? WHERE id=? AND status='staged'").bind(new Date().toISOString(), runId).run().catch(() => undefined);
    throw error;
  }
}

async function history() {
  const [runs, releases, platforms] = await Promise.all([
    env.DB.prepare("SELECT id,file_name,sheet_name,source_system,source_as_of,status,record_count,added_count,changed_count,unchanged_count,skipped_count,blocked_count,target_snapshot_id,applied_at,created_at FROM ingestion_run WHERE program_id=? AND adapter_key=? ORDER BY created_at DESC LIMIT 40").bind(PROGRAM_ID, CD_SW_ADAPTER_KEY).all(),
    env.DB.prepare("SELECT id,name,code,status FROM release WHERE program_id=? AND status<>'retired' ORDER BY name").bind(PROGRAM_ID).all(),
    env.DB.prepare("SELECT id,code,name,platform_type,status FROM platform WHERE program_id=? AND status<>'retired' ORDER BY platform_type,code,name").bind(PROGRAM_ID).all(),
  ]);
  return { history: runs.results, releases: releases.results, platforms: platforms.results };
}

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    return Response.json(await history());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "CD SW import history is unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const body = await request.json() as IncomingBody;
    const fileName = clean(body.fileName);
    const sheetName = clean(body.sheetName);
    const sourceAsOf = clean(body.sourceAsOf);
    const releaseId = clean(body.releaseId);
    const platformId = clean(body.platformId);
    if (!fileName || !sheetName || !sourceAsOf || !validDate(sourceAsOf) || !releaseId || !platformId || !Array.isArray(body.matrix)) throw new Error("File, worksheet, source date, Release, Platform, and matrix data are required.");
    const dataset = parseCdSwMatrix(body.matrix);
    const review = await buildReview(dataset, releaseId, platformId);
    const identity = await importIdentity(CD_SW_ADAPTER_KEY, sourceAsOf, JSON.stringify({ fileName, sheetName, releaseId, platformId, matrix: body.matrix }));
    const prior = await priorImportRun(env.DB, identity.idempotencyKey);
    if (body.mode === "apply") {
      const result = await applyReview(body, dataset, review.records, actor, identity);
      return Response.json({ ok: true, ...result, preview: { items: review.items, canApply: review.items.some((item) => item.disposition !== "blocked") } });
    }
    return Response.json({
      preview: { items: review.items, canApply: review.items.some((item) => item.disposition !== "blocked") },
      duplicate: prior?.status === "applied",
      duplicateRunId: prior?.status === "applied" ? prior.id : null,
      summary: { machines: dataset.machines.length, softwareRows: dataset.softwareRows.length, placements: dataset.placementCount, headerRow: dataset.headerRowNumber, machineStartColumn: dataset.machineStartColumn + 1, ignoredMatrixValues: dataset.ignoredMatrixValueCount, warnings: dataset.warnings },
      target: { release: review.context.release, platform: review.context.platform },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The CD SW matrix could not be processed.";
    return Response.json({ error: message }, { status: message.includes("viewer") ? 403 : 400 });
  }
}
