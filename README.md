# A2O Technical Baseline Manager

Single-user proof of concept for maintaining a contractor-managed Working
Technical Baseline, retaining the exact 24-column A2O XLSX exchange contract,
comparing release baselines, and relating Government
Change Requests, LM Objectives, technical effects, Initiatives, and leadership
decision papers.

The application database is the editable analytical baseline. An imported A2O
workbook is an intake snapshot, not a declaration that the workbook is an
official Lockheed Martin or Government record. External authority and source
basis are recorded through linked evidence. "Canonical" means a stable identity
inside this application; it does not mean an official program system of record.

The local prototype stores its database and uploaded evidence under
`.wrangler/state`. Git contains the application, not the operational data.

## Windows AWS Workspace prerequisites

- Windows PowerShell 5.1 or PowerShell 7
- Git
- Node.js 22.13.0 or newer
- npm registry access for the first installation
- An approved location for the data being loaded

Python and .NET are not required.

The supported SheetJS package is vendored under `vendor` so XLSX capability is
reproducible without relying on the outdated npm registry release.

Optional, explicit GenAI.mil decision support is documented in
[`docs/GENAI_MIL_ASSISTANT.md`](docs/GENAI_MIL_ASSISTANT.md). It is disabled by
default and never performs a background or startup network request. Configure
it once per AWS Workspace with `npm run local:genai:configure`; its endpoint,
model, and API key remain in ACL-protected local storage outside Git.

## First-time setup

From this `site` directory:

```powershell
npm run local:init
npm run local:key:export -- `
  -DestinationDirectory "E:\A2O-Key-Escrow" -ConfirmOfflineEscrow
npm run local:verify
npm run local:start
```

`local:init` installs the locked dependencies when they are absent, creates
`.env` with demonstration data disabled, creates the local transfer-signing
trust root, and applies all local database migrations on a fresh workspace. `local:start`
refuses pending migrations or an unverified/stale build and starts the
application on localhost only. Open the address printed in the terminal, normally
`http://127.0.0.1:3000`.

Record the displayed key ID in the controlled recovery record, then remove the
escrow media. Never commit, email, or place the `.a2okey` file in a backup or
Workspace Transfer Package. Verification records a signed active-release
provenance marker; backups refuse to relabel existing state with a different
commit merely because that commit has since been pulled.

## Routine operation

Before pulling code updates, stop the runtime and record the still-active
release. Then pull the exact approved commit and update:

```powershell
npm run local:verify:fast
# Pull the approved exact commit.
npm ci
npm run local:update
npm run local:start
```

`local:update` requires a clean source commit, creates a signed pre-update
backup, validates that exact returned archive a second time, applies pending
migrations, rebuilds, and verifies the exact source. The signed backup records
the active release commit plus applied-migration, migration-source,
runtime-configuration, and build-manifest hashes separately from the commit and
script hashes that produced the ZIP. Do not use `local:init` as an update
command.

Before a code update, before a major import, and at the end of a working
session:

```powershell
npm run local:backup
```

Backups are written to `backups` and contain the local D1 database, uploaded
evidence state, a readable SQL export, a complete SHA-256 inventory, and an
HMAC-SHA-256 authenticated schema-4 manifest. A partial archive is not
published under its final name until the restore validator has streamed and
verified it. The directory is excluded from Git; copy the resulting ZIP file
to an approved backup location. Keep the separately escrowed signing key away
from the backup set.

For a portable, application-managed transfer between deployments, open
**Workspace Transfer** in the application and select **Export full workspace**.
The resulting signed `.a2oworkspace` package contains the complete governed dataset,
relationships, audit history, and attached evidence. It excludes credentials
and access roles. The destination authenticates the manifest with its trusted
key before inspecting claims or enabling replacement. Validate the displayed
signer key ID and manifest SHA-256 before authorizing workspace replacement.
This is the supported path for moving analyst data to a
fresh application version; the A2O XLSX file is only the retained stakeholder
exchange format.

To restore a backup, stop the application and run:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\local\Restore-A2OWorkspace.ps1 `
  -BackupPath ".\backups\a2o-workspace-YYYYMMDD-HHMMSSfff.zip" -ValidationOnly
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\local\Restore-A2OWorkspace.ps1 `
  -BackupPath ".\backups\a2o-workspace-YYYYMMDD-HHMMSSfff.zip" -Force
```

Restore preserves the current local state under `.wrangler` before replacing
it, so the prior state remains recoverable. It verifies archive bounds, the
trusted signature, exact inventory, and content hashes before replacing state.
The explicit PowerShell command is used because the selected backup path must
be visible and deliberate.

On a replacement workstation, import the separately escrowed trust root before
initialization or restore:

```powershell
npm run local:key:import -- `
  -KeyPath "E:\A2O-Key-Escrow\a2o-workspace-transfer-a2o-local-….a2okey" `
  -ExpectedKeyId "a2o-local-…"
```

Unsigned schema 0–2 backups are accepted only through the documented one-time
legacy procedure, with an independently recorded whole-archive SHA-256. Create
a new signed backup immediately afterward. Signed schema-3 backups remain
recoverable: restore records an explicit signed-schema-3 compatibility
provenance mode, allowing `local:update` to create a schema-4 recovery point
before it migrates and verifies the restored state.

If an older installation has operational state but never had a signing trust
root, `local:init` refuses to invent one silently. Establish the first root only
against a separately authenticated legacy backup:

```powershell
npm run local:key:establish-legacy -- `
  -LegacyBackupPath "E:\A2O-Recovery\legacy-workspace.zip" `
  -ExpectedLegacySha256 "<independently-recorded-64-hex-value>" `
  -Confirmation "ESTABLISH A2O LEGACY TRUST ROOT"
```

Immediately export that new key to separate escrow, validate and restore the
legacy ZIP, run `local:update` if its backed release differs from the checkout
(otherwise run `local:verify`), and retain a schema-4 signed backup. This
command does not accept a signed schema-3/4 archive and never replaces an
existing key.

## Daily Lockheed objective feed

Load the daily Lockheed GitLab Pages JSON locally from **Import Hub & Quality →
Import Objective JSON**. The application does not fetch GitLab or replace prior
observations. Each applied file is an immutable receipt; preview reports new,
changed, unchanged, removed, and invalid subjects before commit. Upload the
file again on the next working day even when unchanged so observation history
is complete.

`jpo` is a reported external MCP/JPO reference. It may be blank or contain
multiple comma-separated values. `blocks` and `blocked_by` are reported
dependency references; unknown targets remain unresolved. These values do not
create Government ownership, funding approval, or an Objective owner. A valid
Jira identity automatically creates or refreshes the canonical LM Objective;
an invalid or duplicate identity is the only case that needs analyst
resolution.

Synthetic fixture loaders and automated tests remain in source so the exact
release can be verified. Demonstration loading is disabled unless
`DEMO_ENABLED` is exactly `true`; the tests do not write operational workspace
data.

## Daily Lockheed multi-file delivery

Open **Import Hub & Quality → Import daily delivery** to load the delivered CAPES,
Jira, MCP/DSOR, and Objective CSV/XLSX files together. The analyst verifies the
dataset classification and row disposition before applying. Each accepted row
automatically creates or refreshes its canonical Capability, Change Request, or
LM Objective from its valid external identity. Each source observation is retained by date and
compared field by field with the preceding observation. Supplier schedule,
ROM, completion, release, status, and dependency values do not overwrite
Government analysis. See `docs/LOCKHEED_DAILY_DELIVERY.md`.

## Governed source imports

The **Import Hub & Quality** page is the first stop for the Confluence Change
Request export, Lockheed Objective JSON feed, Lockheed daily-delivery files,
and A2O Tech Stack workbook. Each uses a common analyst-review control. Preview every row,
approve or skip the source changes, and then apply the approved records. A
valid external identifier creates or refreshes its canonical object
automatically; a genuine invalid or duplicate identity is blocked for analyst
resolution. Imports retain their source receipts and do not overwrite Government analysis. See
[docs/GOVERNED_IMPORTS.md](docs/GOVERNED_IMPORTS.md).

## Verification

```powershell
npm run local:verify
```

Verification checks the supported Node version, local configuration,
migrations, database access, outbound-network boundary, exact source/build
provenance, runtime-file hashes, and signing-secret ACLs. It does not transmit
or deploy data. Development release candidates must also pass `npm test`, which
runs the TypeScript check, production build, and behavioral tests.

Use `npm run local:init:clean` when a completely clean dependency reinstall is
required. Stop the local application before running it so Windows can replace
native runtime files.

## Operating boundaries

- This mode is for one user on one approved Windows AWS Workspace.
- Keep the server bound to localhost. Do not expose the development port.
- Do not commit `.env`, `.a2o-secrets`, `.wrangler`, `backups`,
  exports, escrow keys, or source workbooks.
- GitHub transfers code only. Back up operational data separately.
- Export a Workspace Transfer Package before changing application versions or
  moving to another Workspace.
- Do not mix demonstration records with program records.
- A shared or production deployment requires managed identity, authorization,
  database and object storage, backups, monitoring, TLS, and security approval.

See [docs/LOCAL_OPERATOR_RUNBOOK.md](docs/LOCAL_OPERATOR_RUNBOOK.md) for the
value-producing analyst workflow and recovery procedures. See
[docs/AUTHORITATIVE_DATA_MODEL.md](docs/AUTHORITATIVE_DATA_MODEL.md) for the
implemented ownership, lifecycle, intake, export, and delivery boundaries.
For an operator-facing walkthrough, see [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
and the rendered [PDF user guide](output/pdf/A2O-Technical-Baseline-Manager-User-Guide.pdf).

## Release discipline

Development and hosted testing occur on the active development branch. The
hardened AWS Workspace branch advances only to an exact clean commit that has
passed TypeScript, behavioral, production-build, network-boundary,
backup/restore, migration, and operator smoke gates. Git carries code only;
operational data and trust-root material follow their separate controlled
transfer procedures.
