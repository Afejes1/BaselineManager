# Local Operator Runbook

## Mission

Use one governed application to maintain a contractor-managed Working Technical
Baseline, preserve the A2O XLSX exchange interface, establish release analysis,
and create traceable leadership decisions.

## Data custody

The application code is stored in Git. Operational data is not.

| Asset | Local location | Required control |
| --- | --- | --- |
| Database and uploaded evidence | `.wrangler/state` | Back up after each working session |
| Environment settings | `.env` | Keep local; do not commit |
| Backup packages | `backups/*.zip` | Copy to an approved backup location |
| Portable workspace packages | Operator-selected `.a2oworkspace` file | Retain as controlled application data |
| Source and exported workbooks | Operator-selected location | Store only in an approved data location |

Do not load classified, CUI, or other controlled program data unless the AWS
Workspace and storage location are approved for that data.

## Initial operating sequence

1. Run `npm run local:init`.
2. Run `npm run local:verify`.
3. Run `npm run local:start`.
4. Confirm the workspace identifies demonstration data as disabled.
5. Open **Import Hub & Quality → Import A2O workbook**, then select the current
   A2O exchange workbook.
6. Resolve blocking import and release-assignment findings.
7. Export the retained XLSX projection.
8. Compare intake and export column order, row count, release assignments, and
   material values.
9. Run `npm run local:backup`.

Do not proceed to leadership analysis until the round trip is credible.

## Workspace transfer between application versions

Use **Workspace Transfer** for a clean deployment move or version change. This
package is distinct from both the local emergency backup and the A2O XLSX
exchange.

1. In the current application, open **Workspace Transfer** and export the full
   workspace.
2. Retain the `.a2oworkspace` file with its application version and transfer
   date.
3. Install and initialize the destination application.
4. Open **Workspace Transfer**, select the package, and run validation.
5. Review the classification, application version, row count, and evidence-file
   count.
6. Export the destination workspace if it contains data that must be retained.
7. Authorize replacement using the displayed confirmation phrase.
8. Confirm Operator Diagnostics reports Ready.
9. Open one Baseline Record, one Change Request, one Objective, one Initiative,
   and the Initiative one-page report.

The transfer retains application data, relationships, source history, audit
history, and attached evidence. It does not transfer login credentials or
destination access roles. A package must pass version, structure, row-count,
CRC, and SHA-256 checks before replacement is enabled.

## First decision vertical slice

Build one Initiative completely before expanding the portfolio.

1. Select a current leadership decision, such as elimination of Java 8.
2. Define the Initiative's As-Is condition, To-Be outcome, decision requested,
   and measurable success criteria.
3. Import or enter the governing MCP, DSOR, or other external Change Request
   references. Record external identifier, source location, owner, status, and
   source-as-of date. The external system remains the authority for creating
   and managing the request.
4. Record the target release, funded consequence, deferred consequence, and
   technical effects for each Change Request.
5. Add or import the LM Objectives. Each Objective must have one owning Change
   Request.
6. Attribute Objectives to the technical effects they implement. Do not use a
   dependency to imply ownership.
7. Add cross-request dependencies, estimates, milestones, requirements, Tier 3
   mission acceptance criteria, Tier 4 system acceptance criteria, and evidence.
8. Generate the Initiative scorecard and one-page decision paper.
9. Treat a statement without a source or evidence as an assessment or gap, not
   an established fact.
10. Record the leadership decision and authority, export the A2O workbook, and
    back up the workspace.

## Routine analyst cycle

### Daily Lockheed objective feed

1. Save the daily JSON export in the approved local directory. Do not edit the
   received file before import.
2. Open **Import Hub & Quality → Import Objective JSON**, select the file, and enter the
   source-as-of date.
3. Review new, changed, unchanged, removed, and invalid counts. Inspect
   `blocks`, `blocked_by`, and JPO/MCP values. A blank JPO is valid; a
   comma-separated JPO is multiple reported associations.
4. Apply the snapshot. The receipt and field-level deltas are retained even
   when the file is identical to the prior day. Removed subjects are history,
   not delete instructions for governed records.
5. Treat supplier ROM, percent complete, dates, release text, and dependencies
   as source claims—not Government-approved cost, schedule, funding, or
   progress.
6. A valid Jira identity automatically creates or refreshes the canonical LM
   Objective. Treat a blank or multi-valued JPO as a valid reported source
   association, not an ownership or funding decision. Resolve only a genuine
   invalid or duplicate identity before applying.

The prototype reads a selected local file only. It does not fetch Lockheed
GitLab Pages directly, keeping the workflow explicit for an air-gapped host.

### Before an incumbent technical call

- Start the application and confirm the current release scope.
- Search the Change Request, Objective, product, platform, and affected release.
- Review open dependencies, unresolved requirements, and missing evidence.

### During and after the call

- Update external references and source-as-of dates.
- Record proposed effects, estimates, dependencies, and acceptance criteria.
- Preserve disputed or unverified statements as assessments with attribution.
- Reconcile the affected release comparison.

### Before a leadership brief

- Run data-quality checks.
- Confirm the As-Is and To-Be releases.
- Confirm every Change Request has a decision consequence and target release.
- Confirm every Objective has one owner and traceable technical effects.
- Resolve scorecard blockers or display them explicitly.
- Print the one-page report and verify it remains one page.

### End of session

1. Export the current A2O workbook when a stakeholder handoff is required.
2. Stop the application.
3. Run `npm run local:backup`.
4. Copy the ZIP to an approved backup location.

## Update procedure

1. Stop the application.
2. Run `npm run local:backup` and export a full Workspace Transfer Package.
3. Pull the approved Git branch.
4. Run `npm ci`.
5. Run `npm run local:init`.
6. Run `npm run local:verify`.
7. Start the application. If this is a fresh destination, validate and import
   the Workspace Transfer Package.
8. Smoke-check import history, a baseline record, one release comparison, one
   Change Request dependency chain, and one Initiative scorecard.

## Recovery procedure

1. Stop the application.
2. Identify the last known-good backup ZIP.
3. Run `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File
   .\scripts\local\Restore-A2OWorkspace.ps1 -BackupPath <path> -Force`.
4. Run `npm run local:verify:fast`.
5. Start the application and inspect the last known Initiative and baseline
   record.

Restore moves the pre-restore state to a timestamped recovery directory under
`.wrangler`. Do not delete that recovery copy until the restored workspace has
been verified.

## Proof-of-value acceptance gate

- The real workbook imports without unresolved blocking findings.
- The retained XLSX export has the expected 24 columns and row count.
- One As-Is to To-Be release comparison is validated.
- One Initiative links decisions to Change Requests, owned Objectives,
  technical effects, and affected baseline items.
- Funding and deferral consequences are recorded.
- Requirements and Tier 3/Tier 4 acceptance criteria are traceable.
- The scorecard prints on one page without unsupported headline claims.
- A backup has been created and recovery has been exercised once.
