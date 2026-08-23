import { env } from "cloudflare:workers";
import packageMetadata from "../../../package.json";
import { documentsBucket, ensureActor } from "../../../lib/governance-server";
import type { OperatorDiagnostic, OperatorDiagnostics } from "../../../lib/operator-diagnostics";

type CountRow = { count: number };
const buildSource = (import.meta.env as Record<string, string | undefined>).VITE_APP_BUILD_SHA || "development";
const workspaceTransferMode = (env as unknown as { WORKSPACE_TRANSFER_MODE?: string }).WORKSPACE_TRANSFER_MODE === "local" ? "local" : "disabled";

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const checks: OperatorDiagnostic[] = [];
    const [baseline, changes, objectives, initiatives, evidence, dependencyColumns, infrastructureStateColumns, infrastructureTables, foreignKeys, lastExport, evidenceRows] = await Promise.all([
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
      env.DB.prepare("SELECT id,file_name,r2_key FROM evidence_document WHERE program_id='program-jsf' ORDER BY created_at DESC LIMIT 20").all<{ id: string; file_name: string; r2_key: string }>(),
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
    ];
    checks.push({ id: "database", label: "Application database", status: "pass", detail: "Database query completed." });
    checks.push({ id: "schema", label: "Schema compatibility", status: schemaProblems.length ? "fail" : "pass", detail: schemaProblems.length ? `Missing governed schema elements: ${schemaProblems.join(", ")}. Apply database migrations.` : "Decision, infrastructure, controlled-reference, and transfer fields are present." });
    checks.push({ id: "foreign-keys", label: "Referential integrity", status: foreignKeys.results.length ? "fail" : "pass", detail: foreignKeys.results.length ? `${foreignKeys.results.length} foreign-key violations detected.` : "No foreign-key violations detected." });
    const bucket = documentsBucket();
    let missingEvidence = 0;
    if (bucket) for (const row of evidenceRows.results) {
      if (bucket.head) { if (!await bucket.head(row.r2_key)) missingEvidence += 1; }
      else { const object = await bucket.get(row.r2_key); if (!object) missingEvidence += 1; else await object.body.cancel(); }
    }
    const evidenceCount = Number(evidence?.count || 0);
    const evidenceScope = evidenceCount > evidenceRows.results.length ? `Latest ${evidenceRows.results.length} of ${evidenceCount}` : `${evidenceRows.results.length}`;
    checks.push({ id: "documents", label: "Evidence storage", status: !bucket && evidenceCount ? "fail" : !bucket ? "warning" : missingEvidence ? "fail" : evidenceCount > evidenceRows.results.length ? "warning" : "pass", detail: !bucket ? "Document storage binding is unavailable." : missingEvidence ? `${missingEvidence} sampled evidence files are missing from storage.` : `${evidenceScope} evidence files checked without downloading their contents.` });
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
