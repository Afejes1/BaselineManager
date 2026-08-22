# Air-gap readiness and deployment gate

This application is being matured for an eventual JSF air-gapped deployment. The hosted demonstration is not itself the air-gapped runtime package. The target environment's operating system, database standard, identity provider, certificate authority, container policy, and backup destination must be confirmed before the final adapter and installer are selected.

## Stable application contracts

- The intake/export boundary is the exact retained 24-column A2O XLSX contract. Application properties outside that contract never alter the workbook shape.
- Source packages and raw rows are immutable intake snapshots. They support reconciliation, rollback, and audit; import does not designate them as official Lockheed Martin or Government records.
- Canonical Baseline Records and normalized release-specific state are the contractor-maintained analytical baseline. Analyst edits do not overwrite intake snapshots.
- An erroneous baseline record is voided and restorable; it is never silently hard-deleted.
- Release roles (`historical`, `as_is`, `to_be`, `reported`) are analytical perspectives. They are not approval states.
- Change Requests are references to the external incumbent system. This application owns Government priority, impact links, dependencies, consequences, and the `fund` / `defer` / `decline` decision record.
- Reports are deterministic and traceable to working baseline records, intake snapshots, and governed evidence links.
- The local Lockheed objective feed importer accepts a selected JSON file,
  preserves immutable daily receipts, multi-valued JPO/MCP references,
  dependency references, and field-level deltas. It makes no GitLab network
  request and does not create Government ownership or funding decisions from
  supplier data.
- A versioned Workspace Transfer Package carries the complete application-owned dataset, relationships, audit history, and attached evidence between compatible deployments. It never carries credentials or destination access roles.

## Outbound network boundary

The local operator runtime is intentionally self-contained:

- The browser uses same-origin `/api/...` routes only. There are no configured analytics, telemetry, webhooks, remote scripts, WebSockets, or direct calls to GitLab, Confluence, or another external service.
- Imports read files selected by the operator. Source URLs supplied by Lockheed Martin or other parties are retained as evidence locators; they are not fetched by the application.
- Local database and object state remain under the project-local `.wrangler/state` directory. The Vite development server binds to `127.0.0.1`.
- The application uses system font stacks. It does not require Google Fonts or another remote font service.
- `npm run local:network-check` scans application source and runtime configuration for external URL literals and common outbound client APIs. `npm run local:verify` runs that check automatically.

Two operator-initiated activities can use a network when the workstation is connected: `npm ci` obtains packages if they are not already available locally, and Git clone/pull/push contacts the configured source-control remote. These are not application runtime calls. For an air-gapped deployment, carry an approved dependency cache or packaged `node_modules` set (or use an approved internal package repository), and transfer source updates through the approved media/process.

The hosted demonstration uses the hosting platform by design. It is separate from the local AWS Workspace operator runtime and is not evidence of an outbound call in the local application.

## Runtime boundary still requiring an environment decision

The hosted build currently uses Cloudflare D1-compatible SQLite, R2-style document storage, and the hosting platform's authenticated-user headers. An air-gapped deployment must supply equivalent adapters:

| Capability | Hosted implementation | Air-gap acceptance decision |
| --- | --- | --- |
| Relational database | D1 / SQLite SQL and migrations | SQLite for single-node use, or approved PostgreSQL/SQL Server adapter for multi-user operations |
| Evidence objects | R2 binding | Approved filesystem or S3-compatible object store with malware scanning and backup |
| Identity | Hosting authenticated-user headers | Approved OIDC/SAML, reverse-proxy identity headers, or local directory integration |
| Authorization | Program-scoped steward/editor/viewer roles | Map approved groups and separation-of-duty policy |
| TLS and certificates | Hosting platform | Local certificate authority, trust chain, renewal, and revocation process |

Do not claim production air-gap readiness until those five decisions are recorded and exercised in the target enclave.

## Operational configuration

Set `DEMO_ENABLED=false` in an operational environment. The `/api/demo` mutation endpoint then returns HTTP 403 and the steward UI hides the demo loader.

Required deployment contents:

- application `dist/` output;
- `drizzle/` migrations and migration journal;
- `package.json` and locked `package-lock.json`;
- `wrangler.jsonc` or the approved air-gap runtime configuration;
- this readiness document and generated SHA-256 manifest;
- approved Node.js runtime and all production dependencies acquired through the enclave's software-supply-chain process.

## Acceptance gates before real JSF data

1. The full development branch passes build, lint, and contract tests; the
   hardened operator package passes its production build and local runtime
   verification from the locked dependency set.
2. Exact 24-column workbook round-trip preserves headers, order, blanks, zeroes, booleans, and all Notes fields.
3. Import reconciliation shows added/changed/unchanged/absent/conflict counts before mutation.
4. Intake-package restore and baseline-record void/restore are exercised, including audit events.
5. ALOU → OCK → OBK → PMA hierarchy rejects cycles and shows product/release/organization rollups.
6. As-Is → To-Be comparison is deterministic across at least three plausible releases.
7. Change Request effects and dependency chains are complete enough to support a fund/defer/decline decision.
8. Backup/restore and Workspace Transfer are tested against a copy of the relational database and evidence store, including checksum validation and a fresh-destination import.
9. `DEMO_ENABLED=false`, approved identity mapping, least-privilege roles, TLS, audit retention, session timeout, and log handling are verified.
10. A representative sanitized workbook passes smoke testing before controlled real-data ingestion.
11. Two sanitized JSON receipts are imported in sequence and the preview
    demonstrates added, changed, unchanged, removed, no-JPO, multi-JPO, and
    unresolved dependency cases.

## Backup and recovery minimum

- Back up the relational database and evidence-object store as one recovery set.
- Retain the application version, migrations, configuration, and manifest with each recovery point.
- Encrypt backup media under the enclave's key-management policy.
- Perform a documented restore drill; a backup that has not been restored is not accepted.
- Verify the restored database preserves source packages, raw source rows, Baseline Records, reviews, audit events, Platform hierarchy, Change Requests, effects, dependencies, and decision authority/rationale.

