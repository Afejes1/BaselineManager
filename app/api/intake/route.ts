import { env } from "cloudflare:workers";
import { ensureActor, PROGRAM_ID, WORKSPACE_ID } from "../../../lib/governance-server";

type PackageRow = {
  id: string; file_name: string; sheet_name: string | null; received_at: string; status: string; row_count: number; accepted_count: number; exception_count: number; release_count: number; active: number;
};

export async function GET(request: Request) {
  try {
    await ensureActor(env.DB, request);
    const result = await env.DB.prepare("SELECT sp.id,sp.file_name,sp.sheet_name,sp.received_at,sp.status,sp.row_count,sp.accepted_count,sp.exception_count,COUNT(DISTINCT sr.release_id) AS release_count,CASE WHEN bw.active_import_package_id=sp.id THEN 1 ELSE 0 END AS active FROM source_package sp LEFT JOIN source_row_24 sr ON sr.source_package_id=sp.id LEFT JOIN baseline_workspace bw ON bw.id=? WHERE sp.program_id=? GROUP BY sp.id ORDER BY active DESC,sp.received_at DESC").bind(WORKSPACE_ID, PROGRAM_ID).all<PackageRow>();
    return Response.json({ packages: result.results.map((entry) => ({ id: entry.id, fileName: entry.file_name, sheetName: entry.sheet_name, receivedAt: entry.received_at, status: entry.status, rowCount: entry.row_count, acceptedCount: entry.accepted_count, exceptionCount: entry.exception_count, releaseCount: entry.release_count, active: Boolean(entry.active) })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The source package history is unavailable." }, { status: 500 });
  }
}
