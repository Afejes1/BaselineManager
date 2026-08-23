import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const manifestPath = path.join(distRoot, "a2o-build-manifest.json");
const git = (...args) => execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
const gitCommit = git("rev-parse", "HEAD");
const gitTree = git("rev-parse", "HEAD^{tree}");
const requestedBuildSha = process.env.VITE_APP_BUILD_SHA?.trim();

if (requestedBuildSha && requestedBuildSha !== gitCommit) {
  throw new Error(`VITE_APP_BUILD_SHA must equal the exact checked-out commit (${gitCommit}).`);
}

const vinextCli = path.join(projectRoot, "node_modules", "vinext", "dist", "cli.js");
const build = spawnSync(process.execPath, [vinextCli, "build"], {
  cwd: projectRoot,
  env: { ...process.env, VITE_APP_BUILD_SHA: gitCommit },
  stdio: "inherit",
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const runtimeFiles = [
  ...await filesUnder(path.join(distRoot, "server")),
  ...await filesUnder(path.join(distRoot, "client")),
].sort((left, right) => left.localeCompare(right));
const files = [];
for (const absolute of runtimeFiles) {
  const bytes = await readFile(absolute);
  files.push({
    path: path.relative(projectRoot, absolute).split(path.sep).join("/"),
    bytes: (await stat(absolute)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

const sourceStatus = git("status", "--porcelain=v1", "--untracked-files=all");
const manifest = {
  schemaVersion: 1,
  product: "A2O Technical Baseline Manager",
  createdAt: new Date().toISOString(),
  gitCommit,
  gitTree,
  buildSha: gitCommit,
  sourceState: sourceStatus ? "dirty" : "clean",
  files,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`A2O build manifest: ${manifest.sourceState} source · ${gitCommit} · ${files.length} runtime files`);
