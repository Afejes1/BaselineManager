# A2O Technical Baseline Manager

Single-user proof of concept for governing the A2O Tech Stack, retaining its
24-column XLSX contract, comparing release baselines, and relating Government
Change Requests, LM Objectives, technical effects, Initiatives, and leadership
decision papers.

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

To restore a backup, stop the application and run:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\local\Restore-A2OWorkspace.ps1 `
  -BackupPath ".\backups\a2o-workspace-YYYYMMDD-HHMMSS.zip" -Force
```

Restore preserves the current local state under `.wrangler` before replacing
it, so the prior state remains recoverable. The explicit PowerShell command is
used because the selected backup path must be visible and deliberate.

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
- Do not mix demonstration records with program records.
- A shared or production deployment requires managed identity, authorization,
  database and object storage, backups, monitoring, TLS, and security approval.

See [docs/LOCAL_OPERATOR_RUNBOOK.md](docs/LOCAL_OPERATOR_RUNBOOK.md) for the
value-producing analyst workflow and recovery procedures.
