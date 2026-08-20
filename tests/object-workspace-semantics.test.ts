import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("architecture call records support multi-object traceability and accountable follow-up", () => {
  const schema = read("db/schema.ts");
  const migration = read("drizzle/0010_object_workspaces.sql");
  const control = read("lib/control-server.ts");
  for (const kind of ["product", "platform", "organization", "release", "change_request", "objective", "initiative", "work_package"]) {
    assert.match(migration, new RegExp(`'${kind}'`));
  }
  assert.match(schema, /participants: text\("participants"\)/);
  assert.match(schema, /actionItems: text\("action_items"\)/);
  assert.match(control, /Call follow-up/);
});

test("the architecture-call catalog does not depend on a compound SQLite query", () => {
  const server = read("lib/governance-server.ts");
  const catalog = server.slice(server.indexOf("export async function objectCatalog"), server.indexOf("function mapWorkPackage"));
  assert.doesNotMatch(catalog, /UNION ALL/);
  assert.match(catalog, /Promise\.all/);
  assert.match(catalog, /baseline_occurrence/);
});

test("first-class product and work-package pages expose relationship views", () => {
  const product = read("app/products/[id]/page.tsx");
  const workPackage = read("app/delivery/[id]/page.tsx");
  assert.match(product, /Release history/);
  assert.match(product, /Change & delivery/);
  assert.match(product, /Calls & evidence/);
  assert.match(workPackage, /Relationships/);
  assert.match(workPackage, /Schedule logic/);
  assert.match(workPackage, /ObjectRecordsPanel/);
});

test("an Initiative call record uses the canonical Initiative identifier", () => {
  const initiative = read("app/initiatives/[initiative]/page.tsx");
  const workspace = read("components/object-workspace.tsx");
  assert.match(initiative, /objectContext=\{\{ kind: "initiative", id: bundle\.initiative\.id/);
  assert.match(initiative, /ObjectRecordsPanel context=\{\{ kind: "initiative", id: bundle\.initiative\.id/);
  assert.match(workspace, /Current page · linked automatically/);
  assert.match(workspace, /new Set\(\[currentKey, \.\.\.selected\]\)/);
});

test("traceability links identify and navigate to their governed object", () => {
  const evidence = read("app/evidence/page.tsx");
  const server = read("lib/governance-server.ts");
  assert.match(evidence, /aria-label="Hard links"/);
  assert.match(evidence, /displayStatus\(link\.entityKind\)/);
  assert.match(evidence, /href=\{link\.href\}/);
  assert.match(server, /function governanceLinkHref/);
  assert.match(server, /href: governanceLinkHref\(link\.entity_kind, link\.entity_id, link\.display_label\)/);
});

test("delivery model keeps Government work Initiative-owned and requirements reusable", () => {
  const migration = read("drizzle/0013_delivery_model.sql");
  const governance = read("lib/governance-server.ts");
  const decisions = read("lib/initiative-decision-server.ts");
  const delivery = read("app/delivery/page.tsx");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `requirement`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `objective_requirement`/);
  assert.match(migration, /work_package_parent_same_initiative/);
  assert.match(migration, /work_package_initiative_code_v2_uq/);
  assert.match(governance, /change_request_id,objective_id,parent_id/);
  assert.match(governance, /\.bind\(workPackageId, initiativeId, null, null, parentId/);
  assert.match(decisions, /INSERT INTO objective_requirement/);
  assert.match(decisions, /objective_requirement_id/);
  assert.match(delivery, /This is not an official DoD WBS/);
  const demo = read("lib/demo-workspace-server.ts");
  assert.match(demo, /INSERT INTO requirement \(/);
  assert.match(demo, /INSERT INTO objective_requirement \(/);
  assert.match(demo, /objective_requirement_id/);
});
