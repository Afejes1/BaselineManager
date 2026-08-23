import { env } from "cloudflare:workers";
import packageMetadata from "../../../package.json";
import { MAX_GOVERNED_EVIDENCE_BYTES, storedEvidenceIntegrityMatches } from "../../../lib/evidence-validation";
import { documentsBucket, ensureActor } from "../../../lib/governance-server";
import type { OperatorDiagnostic, OperatorDiagnostics } from "../../../lib/operator-diagnostics";
import { sourceLineageIsSynthetic } from "../../../lib/output-handling";
import { readRuntimePolicy, type RuntimePolicyInput } from "../../../lib/runtime-policy";
import { assembledRecordMatchesSource, readAssembledBaselineRecords } from "../../../lib/a2o-baseline-server";
import { pendingEvidenceObjectCleanupCount } from "../../../lib/evidence-cleanup";

type CountRow = { count: number };
const buildSource = (import.meta.env as Record<string, string | undefined>).VITE_APP_BUILD_SHA || "development";

export async function GET(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const policy = readRuntimePolicy(env as unknown as RuntimePolicyInput);
    const workspaceTransferMode = policy.workspaceTransferMode;
    const checks: OperatorDiagnostic[] = [];
    const [baseline, changes, objectives, initiatives, evidence, dependencyColumns, infrastructureStateColumns, infrastructureTables, foreignKeys, lastExport, evidenceRows, acceptanceTriggers, pendingObjectCleanup] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM baseline_occurrence WHERE workspace_id='workspace-jsf-current' AND lifecycle_status='active'").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM change_request WHERE program_id='program-jsf'").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM incumbent_objective WHERE program_id='program-jsf'").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM initiative WHERE program_id='program-jsf'").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM evidence_document WHERE program_id='program-jsf'").first<CountRow>(),
      env.DB.prepare("PRAGMA table_info('change_dependency')").all<{ name: string }>(),
      env.DB.prepare("PRAGMA table_info('release_infrastructure_node')").all<{ name: string }>(),
      env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('infrastructure_node','infrastructure_reference_value','release_infrastructure_node','infrastructure_product_installation','infrastructure_connection')").all<{ name: string }>(),
      env.DB.prepare("PRAGMA foreign_key_check").all<Record<string, unknown>>(),
      env.DB.prepare("SELECT created_at FROM audit_event WHERE program_id='program-jsf' AND action IN ('workspace_package_exported','workspace_package_imported') ORDER BY created_at DESC LIMIT 1").first<{ created_at: string }>(),
      env.DB.prepare(`SELECT d.id,d.file_name,d.r2_key,d.byte_size,
        (SELECT a.after_payload FROM audit_event a WHERE a.program_id=d.program_id AND a.entity_kind='evidence_document' AND a.entity_id=d.id
         AND a.action IN ('evidence_document_attached','evidence_document_restored','evidence_integrity_sealed') ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS integrity_payload
        FROM evidence_document d WHERE d.program_id='program-jsf' ORDER BY d.created_at DESC LIMIT 10`).all<{ id: string; file_name: string; r2_key: string; byte_size: number; integrity_payload: string | null }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND (name LIKE 'acceptance_%' OR name LIKE 'evidence_document_%signoff%')").first<CountRow>(),
      pendingEvidenceObjectCleanupCount(env.DB),
    ]);
    const requiredDependencyColumns = ["consequence_if_unmet", "confidence", "source_reference", "source_as_of"];
    const dependencyColumnNames = new Set(dependencyColumns.results.map((item) => item.name));
    const missingDependencyColumns = requiredDependencyColumns.filter((item) => !dependencyColumnNames.has(item));
    const requiredInfrastructureTables = ["infrastructure_node", "infrastructure_reference_value", "release_infrastructure_node", "infrastructure_product_installation", "infrastructure_connection"];
    const infrastructureTableNames = new Set(infrastructureTables.results.map((item) => item.name));
    const missingInfrastructureTables = requiredInfrastructureTables.filter((item) => !infrastructureTableNames.has(item));
    const referenceCounts = infrastructureTableNames.has("infrastructure_reference_value")
      ? await env.DB.prepare("SELECT category,COUNT(*) AS count FROM infrastructure_reference_value WHERE program_id='program-jsf' AND lifecycle_status='active' GROUP BY category").all<{ category: string; count: number }>()
      : { results: [] as Array<{ category: string; count: number }> };
    const requiredInfrastructureStateColumns = ["storage_medium_id", "file_system_value_id"];
    const infrastructureStateColumnNames = new Set(infrastructureStateColumns.results.map((item) => item.name));
    const missingInfrastructureStateColumns = requiredInfrastructureStateColumns.filter((item) => !infrastructureStateColumnNames.has(item));
    const referenceCountByCategory = new Map(referenceCounts.results.map((item) => [item.category, Number(item.count)]));
    const missingReferenceCategories = ["storage_medium", "file_system"].filter((item) => !referenceCountByCategory.get(item));
    const schemaProblems = [
      ...missingDependencyColumns.map((item) => `change_dependency.${item}`),
      ...missingInfrastructureTables.map((item) => `table:${item}`),
      ...missingInfrastructureStateColumns.map((item) => `release_infrastructure_node.${item}`),
      ...missingReferenceCategories.map((item) => `reference:${item}`),
      ...(Number(acceptanceTriggers?.count || 0) >= 8 ? [] : ["acceptance:evidence-invariant-triggers"]),
    ];
    checks.push({ id: "database", label: "Application database", status: "pass", detail: "Database query completed." });
    const configuredSteward = policy.authMode === "local-single-user" || policy.stewardUserIds.has(actor.id);
    checks.push({ id: "runtime-policy", label: "Runtime security policy", status: policy.authMode === "sites" && !policy.stewardUserIds.size ? "warning" : "pass", detail: policy.authMode === "local-single-user" ? "Explicit local-single-user authentication is active; loopback binding is required." : policy.stewardUserIds.size ? "Sites authentication is active with an explicit steward allowlist." : "Sites authentication is active, but no bootstrap steward allowlist is configured for a fresh database." });
    checks.push({ id: "current-role", label: "Current operator role", status: actor.role === "steward" && configuredSteward ? "pass" : actor.role === "steward" ? "warning" : "warning", detail: actor.role === "steward" && configuredSteward ? "The current operator is an explicitly configured Baseline steward." : actor.role === "steward" ? "The current operator is a retained steward but is not present in the runtime allowlist." : `The current operator is ${actor.role}; steward-only recovery operations are unavailable.` });
    checks.push({ id: "demo-policy", label: "Demonstration controls", status: policy.demoEnabled ? "warning" : "pass", detail: policy.demoEnabled ? "Demonstration loading is explicitly enabled; do not use this runtime for program data." : "Demonstration loading is disabled and malformed or missing values fail closed." });
    const activeSources = await readAssembledBaselineRecords(env.DB);
    const syntheticSourceCount = activeSources.filter((item) => sourceLineageIsSynthetic([{ fileName: item.source.fileName || "", sourceKey: item.source.sourceKey || "", projectionMatchesSource: assembledRecordMatchesSource(item) }])).length;
    const activeCount = Number(baseline?.count || 0);
    const unknownSourceCount = activeSources.filter((item) => !item.source.fileName || !item.source.sourceKey || !assembledRecordMatchesSource(item)).length;
    const dataStatus = !activeCount ? "warning" : syntheticSourceCount === activeCount ? "warning" : syntheticSourceCount || unknownSourceCount ? "fail" : "pass";
    const dataDetail = !activeCount ? "No active baseline records are loaded." : syntheticSourceCount === activeCount ? `All ${activeCount} active baseline records are synthetic; this workspace is demonstration-only.` : syntheticSourceCount || unknownSourceCount ? `Active lineage is mixed or incomplete (${syntheticSourceCount} synthetic, ${unknownSourceCount} without a source); resolve it before operational use.` : `${activeCount} active baseline records have non-synthetic source lineage.`;
    checks.push({ id: "data-lineage", label: "Operational data lineage", status: dataStatus, detail: dataDetail });
    checks.push({ id: "schema", label: "Schema compatibility", status: schemaProblems.length ? "fail" : "pass", detail: schemaProblems.length ? `Missing governed schema elements: ${schemaProblems.join(", ")}. Apply database migrations.` : "Decision, infrastructure, controlled-reference, and transfer fields are present." });
    checks.push({ id: "foreign-keys", label: "Referential integrity", status: foreignKeys.results.length ? "fail" : "pass", detail: foreignKeys.results.length ? `${foreignKeys.results.length} foreign-key violations detected.` : "No foreign-key violations detected." });
    const bucket = documentsBucket();
    let missingEvidence = 0;
    let unverifiedEvidence = 0;
    let mismatchedEvidence = 0;
    let inspectedEvidenceBytes = 0;
    if (bucket) for (const row of evidenceRows.results) {
      if (!Number.isSafeInteger(row.byte_size) || row.byte_size < 0 || inspectedEvidenceBytes + row.byte_size > MAX_GOVERNED_EVIDENCE_BYTES) { unverifiedEvidence += 1; continue; }
      inspectedEvidenceBytes += row.byte_size;
      if (await storedEvidenceIntegrityMatches(bucket, { fileName: row.file_name, r2Key: row.r2_key, byteSize: row.byte_size, auditPayload: row.integrity_payload })) continue;
      if (bucket.head) {
        if (!await bucket.head(row.r2_key)) missingEvidence += 1;
        else mismatchedEvidence += 1;
      } else {
        const object = await bucket.get(row.r2_key);
        if (!object) missingEvidence += 1;
        else { mismatchedEvidence += 1; await object.body.cancel(); }
      }
    }
    const evidenceCount = Number(evidence?.count || 0);
    const evidenceScope = evidenceCount > evidenceRows.results.length ? `Latest ${evidenceRows.results.length} of ${evidenceCount}` : `${evidenceRows.results.length}`;
    checks.push({ id: "documents", label: "Evidence storage", status: !bucket && evidenceCount ? "fail" : !bucket ? "warning" : missingEvidence || mismatchedEvidence ? "fail" : unverifiedEvidence || evidenceCount > evidenceRows.results.length ? "warning" : "pass", detail: !bucket ? "Document storage binding is unavailable." : missingEvidence ? `${missingEvidence} sampled evidence files are missing from storage.` : mismatchedEvidence ? `${mismatchedEvidence} sampled evidence files failed exact byte, validation-policy, SHA-256, or storage-metadata verification; use approved recovery before relying on them.` : unverifiedEvidence ? `${unverifiedEvidence} sampled evidence files exceeded the bounded verification envelope or lack a usable integrity seal.` : `${evidenceScope} evidence files passed exact stored-byte and SHA-256 verification.` });
    checks.push({ id: "evidence-cleanup", label: "Evidence object cleanup", status: Number(pendingObjectCleanup || 0) ? "warning" : "pass", detail: Number(pendingObjectCleanup || 0) ? `${Number(pendingObjectCleanup || 0)} removed evidence object(s) remain queued for storage cleanup. A Baseline steward must run the bounded retry and reconcile any remaining entries before final media sanitization.` : "No removed evidence objects are awaiting storage cleanup." });
    checks.push({ id: "recovery", label: "Recovery package", status: lastExport?.created_at ? "pass" : "warning", detail: lastExport?.created_at ? `Last full workspace transfer: ${new Date(lastExport.created_at).toLocaleString("en-US")}.` : "No full Workspace Transfer Package export or import is recorded." });
    let latestMigration: string | null = null;
    try { latestMigration = (await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1").first<{ name: string }>())?.name || null; } catch { latestMigration = null; }
    const overall = checks.some((item) => item.status === "fail") ? "blocked" : checks.some((item) => item.status === "warning") ? "attention" : "ready";
    const result: OperatorDiagnostics = { generatedAt: new Date().toISOString(), overall, applicationVersion: packageMetadata.version, buildSource, workspaceTransferMode, latestMigration, lastWorkspaceExportAt: lastExport?.created_at || null, counts: { baselineRecords: Number(baseline?.count || 0), changeRequests: Number(changes?.count || 0), objectives: Number(objectives?.count || 0), initiatives: Number(initiatives?.count || 0), evidenceDocuments: Number(evidence?.count || 0) }, checks };
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Operator diagnostics are unavailable." }, { status: 500 });
  }
}
