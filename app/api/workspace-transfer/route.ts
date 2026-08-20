import { env } from "cloudflare:workers";
import packageMetadata from "../../../package.json";
import { audit, documentsBucket, ensureActor, requireSteward } from "../../../lib/governance-server";
import { exportWorkspacePackage, MAX_WORKSPACE_PACKAGE_BYTES, parseWorkspacePackage, replaceWorkspaceFromPackage } from "../../../lib/workspace-transfer";

const fileName = () => `A2O-Workspace-${new Date().toISOString().slice(0, 10)}.a2oworkspace`;

export async function GET(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const result = await exportWorkspacePackage(env.DB, documentsBucket(), packageMetadata.version);
    await audit(env.DB, actor, "workspace_package_exported", "baseline_workspace", "workspace-jsf-current", { packageVersion: result.manifest.packageVersion, totals: result.manifest.totals }).run();
    return new Response(result.bytes as BodyInit, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${fileName()}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The workspace package could not be created." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureActor(env.DB, request);
    const form = await request.formData();
    const file = form.get("file");
    const mode = String(form.get("mode") || "validate");
    if (!(file instanceof File) || !file.size) return Response.json({ error: "Select a non-empty .a2oworkspace file." }, { status: 400 });
    if (file.size > MAX_WORKSPACE_PACKAGE_BYTES) return Response.json({ error: "Workspace packages are limited to 100 MB." }, { status: 413 });
    const bytes = await file.arrayBuffer();
    if (mode === "validate") {
      const preview = await parseWorkspacePackage(bytes);
      return Response.json({ manifest: preview.manifest, warnings: preview.warnings });
    }
    if (mode !== "replace") return Response.json({ error: "Unsupported workspace import mode." }, { status: 400 });
    requireSteward(actor);
    if (String(form.get("confirmation") || "") !== "REPLACE WORKSPACE") return Response.json({ error: "Type REPLACE WORKSPACE to authorize full replacement." }, { status: 400 });
    const result = await replaceWorkspaceFromPackage(env.DB, documentsBucket(), bytes, actor.id);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The workspace package could not be processed.";
    return Response.json({ error: message }, { status: /Only a Baseline steward/.test(message) ? 403 : 500 });
  }
}
