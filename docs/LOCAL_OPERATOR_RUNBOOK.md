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
| Source and exported workbooks | Operator-selected location | Store only in an approved data location |

Do not load classified, CUI, or other controlled program data unless the AWS
Workspace and storage location are approved for that data.

## Initial operating sequence

1. Run `npm run local:init`.
2. Run `npm run local:verify`.
3. Run `npm run local:start`.
4. Confirm the workspace identifies demonstration data as disabled.
5. Import the current A2O exchange workbook.
6. Resolve blocking import and release-assignment findings.
7. Export the retained XLSX projection.
8. Compare intake and export column order, row count, release assignments, and
   material values.
9. Run `npm run local:backup`.

Do not proceed to leadership analysis until the round trip is credible.

## First decision vertical slice

Build one Initiative completely before expanding the portfolio.

1. Select a current leadership decision, such as elimination of Java 8.
2. Define the Initiative's As-Is condition, To-Be outcome, decision requested,
   and measurable success criteria.
3. Enter the governing MCP, DSOR, or other Change Request references. Record
   external identifier, source location, owner, status, and source-as-of date.
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
2. Run `npm run local:backup`.
3. Pull the approved Git branch.
4. Run `npm ci`.
5. Run `npm run local:init`.
6. Run `npm run local:verify`.
7. Start the application and smoke-check import history, a baseline record, one
   release comparison, and one Initiative scorecard.

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
