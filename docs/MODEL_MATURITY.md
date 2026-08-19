# Model maturity decisions

This document records the boundaries implemented in migration `0009_model_maturity.sql`.

## Working baseline and exchange contract

- The application owns one editable, contractor-maintained **Working Technical Baseline** for analysis and reporting.
- The A2O XLSX file is an exact 24-column import/export exchange contract. It is not treated as an official Lockheed Martin or Government record merely because it was imported.
- Each import creates an immutable package and row snapshot for reconciliation, rollback, and audit. Analyst edits update the working projection and normalized model; they do not rewrite the intake snapshot.
- Supporting sources are linked separately and may include Lockheed Martin artifacts, Government artifacts, technical calls, contractor assessments, or records managed in another system.
- Properties required by the application may extend beyond the 24-column exchange contract. Those properties remain in the database and are excluded from the exact A2O XLSX export.

## Canonical identity

- "Canonical" means stable identity inside this application. It does not imply official program authority.
- A2O workbook text is retained as an intake snapshot.
- Products, Organizations, and configuration nodes are canonical application records.
- An accepted alias maps a reported name or external identifier to one canonical record.
- Product and Organization mergers are explicit steward actions with a rationale, supporting reference, merge event, and audit event.
- Product mergers are blocked when the two records occupy the same deployment position; deployment conflicts must be reconciled first.
- Configuration-node aliases are allowed. Configuration-node mergers are blocked because node-state, deployment, and hierarchy collisions require placement-by-placement review.

## Platform assignment

- Platform is the stable installation hierarchy: `ALOU → OCK → OBK → PMA`.
- A baseline record is assigned to a Platform through a release-specific `platform_baseline_assignment` record.
- Each assignment records role, confidence, review state, source reference, source-as-of date, and reviewer.
- A replacement workbook import clears assignments tied to the prior active projection. This produces an unmapped review queue rather than carrying an old fielding claim onto the reconciled working baseline.
- Platform retirement is a status change. It does not delete history.

## Delivery structure

- LM Objectives remain incumbent-owned delivery units beneath a Change Request.
- Government work packages belong to an Initiative and form the Government WBS.
- A work package may support, assess, verify, or coordinate an LM Objective. The Objective does not own the Government work package.
- Parent/child relationships are decomposition. Accepted dependency edges are schedule logic.
- Reparenting and accepted schedule dependencies are cycle-checked.

## Product structure

The `/pbs` route is labeled **Product Deployment Structure**. It reports Product → Release → configuration placement from working baseline records. It is not presented as an internal component PBS because the current data does not provide governed component relationships.

## Analyst control

The Analyst Control page is an action queue, not an executive dashboard. It reports intake exceptions, manual-review work, unmapped Platform records, pending funding decisions, Objective trace gaps, schedule risks, and Initiative briefing gaps. Each item links to the record or page where the analyst can act. Leadership output remains the Initiative one-pager and Leadership Reports.
