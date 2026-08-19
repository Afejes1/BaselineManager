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
