# Air-gap readiness and deployment gate

This application is being matured for an eventual JSF air-gapped deployment. The hosted demonstration is not itself the air-gapped runtime package. The target environment's operating system, database standard, identity provider, certificate authority, container policy, and backup destination must be confirmed before the final adapter and installer are selected.

## Stable application contracts

- The intake/export boundary is the exact retained 24-column A2O XLSX contract. Application properties outside that contract never alter the workbook shape.
- Source packages and raw rows are immutable intake snapshots. They support reconciliation, rollback, and audit; import does not designate them as official Lockheed Martin or Government records.
- Canonical Baseline Records and normalized release-specific state are the contractor-maintained analytical baseline. Analyst edits do not overwrite intake snapshots.
- An erroneous baseline record is voided and restorable; it is never silently hard-deleted.
- Release roles (`historical`, `as_is`, `to_be`, `reported`) are analytical perspectives. They are not approval states.
- Change Requests are references to the external incumbent system. This application owns Government priority, impact links, dependencies, consequences, and the `fund` / `defer` / `decline` decision record.
- Reports are deterministic and traceable to working baseline records, intake snapshots, and governed evidence links. Published PDF/DOCX/Markdown artifacts are rendered, validated, hashed, and retained by the server; lifecycle cannot be advanced to Published by an independent client status edit.
- The local Lockheed objective feed importer accepts a selected JSON file,
  preserves immutable daily receipts, multi-valued JPO/MCP references,
  dependency references, and field-level deltas. It makes no GitLab network
  request and does not create Government ownership or funding decisions from
  supplier data.
- A versioned Workspace Transfer Package carries the complete application-owned dataset, relationships, audit history, and attached evidence between compatible deployments. Its manifest is authenticated with HMAC-SHA-256 before claims are trusted. It never carries credentials, destination access roles, or its signing key.

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

Set `AUTH_MODE=local-single-user`, `DEMO_ENABLED=false`, and
`WORKSPACE_TRANSFER_MODE=local` in the single-user operator environment. These
values are exact and fail closed when missing or misspelled. The server must be
bound to `127.0.0.1`; local authentication is not a multi-user identity
substitute. A hosted environment uses `AUTH_MODE=sites`, disables Workspace
Transfer, and configures an explicit `STEWARD_USER_IDS` allowlist for fresh
database bootstrap.

Required deployment contents:

- application `dist/` output;
- `drizzle/` migrations and migration journal;
- `package.json` and locked `package-lock.json`;
- `wrangler.jsonc` or the approved air-gap runtime configuration;
- this readiness document and generated SHA-256 manifest;
- approved Node.js runtime and all production dependencies acquired through the enclave's software-supply-chain process.

## Acceptance gates before real JSF data

1. The full development branch passes TypeScript, production build, and
   behavioral/contract tests; the
   hardened operator package passes its production build and local runtime
   verification from the locked dependency set.
2. Exact 24-column workbook round-trip preserves headers, order, blanks, zeroes, booleans, and all Notes fields.
3. Import reconciliation shows added/changed/unchanged/absent/conflict counts before mutation.
4. Intake-package restore and baseline-record void/restore are exercised, including audit events.
5. ALOU → OCK → OBK → PMA hierarchy rejects cycles and shows product/release/organization rollups.
6. As-Is → To-Be comparison is deterministic across at least three plausible releases.
7. Change Request effects and dependency chains are complete enough to support a fund/defer/decline decision.
8. Backup/restore and Workspace Transfer are tested against a copy of the relational database and evidence store, including signature/authenticity failure, checksum validation, bounded archive expansion, and a fresh-destination import.
9. Exact auth/demo/transfer modes, approved identity mapping, explicit steward bootstrap, least-privilege roles, TLS, audit retention, session timeout, and log handling are verified.
10. A representative sanitized workbook passes smoke testing before controlled real-data ingestion.
11. Two sanitized JSON receipts are imported in sequence and the preview
    demonstrates added, changed, unchanged, removed, no-JPO, multi-JPO, and
    unresolved dependency cases.

## Backup and recovery minimum

- Back up the relational database and evidence-object store as one recovery set.
- Retain the application version, migrations, configuration, and manifest with each recovery point.
- Encrypt backup media under the enclave's key-management policy.
- Authenticate every new backup and Workspace Transfer manifest. Escrow the
  signing key on separately controlled encrypted media, record its non-secret
  key ID, test import on a fresh host, and never store the key with the data backup.
- Perform a documented restore drill; a backup that has not been restored is not accepted.
- Verify the restored database preserves source packages, raw source rows, Baseline Records, reviews, audit events, Platform hierarchy, Change Requests, effects, dependencies, and decision authority/rationale.

## Evidence-processing boundary

Uploads are restricted by extension, signature, size, and structure. Modern
Office files with macros, embedded objects, or external relationships are
rejected. PDFs must be passive, structurally complete documents; actions,
scripts, external links, embedded files, forms/XFA, encryption, multimedia, and
object streams are rejected. Legacy evidence that cannot satisfy the current
policy restores into quarantine and cannot count toward readiness, sign-off,
report generation, or in-application download. These controls do not replace
the enclave's approved malware-scanning process. Legacy evidence that does
satisfy the content policy but predates paired audit/storage hashes remains
non-authoritative until a steward validates and seals its exact bytes or
reattaches the source.

## Offline dependency prerequisite

An air-gapped installation must receive the approved Node.js runtime and the
exact locked production dependency artifact through the enclave software
supply-chain process. A successful connected `npm ci` is not evidence that the
same dependencies are available offline. Exercise installation, build, and
verification with the actual offline artifact before operational acceptance.

