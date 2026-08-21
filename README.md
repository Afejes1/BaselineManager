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

## First-time setup

From this `site` directory:

```powershell
npm run local:init
npm run local:start
```

`local:init` performs a clean dependency install, creates `.env` with
demonstration data disabled, and applies all local database migrations.
`local:start` reapplies pending migrations and starts the application on
localhost only. Open the address printed in the terminal, normally
`http://127.0.0.1:3000`.

## Routine operation

After pulling code updates:

```powershell
npm ci
npm run local:init
npm run local:verify
npm run local:start
```

Before a code update, before a major import, and at the end of a working
session:

```powershell
npm run local:backup
```

Backups are written to `backups` and contain the local D1 database, uploaded
evidence state, and a readable SQL export. The directory is excluded from Git;
copy the resulting ZIP file to an approved backup location.

For a portable, application-managed transfer between deployments, open
**Workspace Transfer** in the application and select **Export full workspace**.
The resulting `.a2oworkspace` package contains the complete governed dataset,
relationships, audit history, and attached evidence. It excludes credentials
and access roles. In the destination, validate the package before authorizing
workspace replacement. This is the supported path for moving analyst data to a
fresh application version; the A2O XLSX file is only the retained stakeholder
exchange format.

To restore a backup, stop the application and run:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\local\Restore-A2OWorkspace.ps1 `
  -BackupPath ".\backups\a2o-workspace-YYYYMMDD-HHMMSS.zip" -Force
```

Restore preserves the current local state under `.wrangler` before replacing
it, so the prior state remains recoverable. The explicit PowerShell command is
used because the selected backup path must be visible and deliberate.

## Daily Lockheed objective feed

Load the daily Lockheed GitLab Pages JSON locally from **LM Objectives →
Import Lockheed feed**. The application does not fetch GitLab or replace prior
observations. Each applied file is an immutable receipt; preview reports new,
changed, unchanged, removed, and invalid subjects before commit. Upload the
file again on the next working day even when unchanged so observation history
is complete.

`jpo` is a reported external MCP/JPO reference. It may be blank or contain
multiple comma-separated values. `blocks` and `blocked_by` are reported
dependency references; unknown targets remain unresolved. These values do not
create Government ownership, funding approval, or an Objective owner. Use an
explicit analyst link when a source subject is reconciled to a governed LM
Objective.

Synthetic fixtures and automated tests are maintained on the full development
branch. They are intentionally excluded from this AWS Workspace package.

## Daily Lockheed multi-file delivery

Open **Source Intake → Lockheed daily delivery** to load the delivered CAPES,
Jira, MCP/DSOR, and Objective CSV/XLSX files together. The analyst verifies the
dataset classification, row disposition, and optional governed trace link
before applying. Each accepted source observation is retained by date and
compared field by field with the preceding observation. Supplier schedule,
ROM, completion, release, status, and dependency values do not overwrite
Government analysis. See `docs/LOCKHEED_DAILY_DELIVERY.md`.

## Governed source imports

The Confluence Change Request export, Lockheed Objective JSON feed, Lockheed
daily-delivery files, and A2O
Tech Stack workbook use a common analyst-review control. Preview every row,
confirm or override the proposed canonical match, skip questionable rows, and
then apply approved records. Imports retain their source receipts and do not
overwrite Government analysis. See
[docs/GOVERNED_IMPORTS.md](docs/GOVERNED_IMPORTS.md).

## Verification

```powershell
npm run local:verify
```

Verification checks the supported Node version, local configuration,
migrations, database access, and a production build. It does not transmit or
deploy data.

Use `npm run local:init:clean` when a completely clean dependency reinstall is
required. Stop the local application before running it so Windows can replace
native runtime files.

## Operating boundaries

- This mode is for one user on one approved Windows AWS Workspace.
- Keep the server bound to localhost. Do not expose the development port.
- Do not commit `.env`, `.wrangler`, `backups`, exports, or source workbooks.
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

## Hardened AWS Workspace branch

This branch is the compact single-user operator package. It retains the full
application, checked-in database migrations, local database, backup/restore,
workspace transfer, XLSX support, and operator documentation. It excludes
automated tests, synthetic fixtures, lint and schema-generation tooling, and
unused starter assets. Development and schema changes belong on
`codex/model-maturity`; this branch is for installation and operation.
