# Model maturity decisions

This document records the boundaries implemented in migration `0009_model_maturity.sql`.

## Canonical identity

- A2O workbook text remains retained source evidence.
- Products, Organizations, and configuration nodes are canonical application records.
- An accepted alias maps a reported name or external identifier to one canonical record.
- Product and Organization mergers are explicit steward actions with a rationale, supporting reference, merge event, and audit event.
- Product mergers are blocked when the two records occupy the same deployment position; deployment conflicts must be reconciled first.
- Configuration-node aliases are allowed. Configuration-node mergers are blocked because node-state, deployment, and hierarchy collisions require placement-by-placement review.

## Platform assignment

- Platform is the stable installation hierarchy: `ALOU → OCK → OBK → PMA`.
- A baseline record is assigned to a Platform through a release-specific `platform_baseline_assignment` record.
- Each assignment records role, confidence, review state, source reference, source-as-of date, and reviewer.
- A replacement workbook import clears assignments tied to the prior active projection. This produces an unmapped review queue rather than carrying an old fielding claim onto new source evidence.
- Platform retirement is a status change. It does not delete history.

## Delivery structure

- LM Objectives remain incumbent-owned delivery units beneath a Change Request.
- Government work packages belong to an Initiative and form the Government WBS.
- A work package may support, assess, verify, or coordinate an LM Objective. The Objective does not own the Government work package.
- Parent/child relationships are decomposition. Accepted dependency edges are schedule logic.
- Reparenting and accepted schedule dependencies are cycle-checked.

## Product structure

The `/pbs` route is labeled **Product Deployment Structure**. It reports Product → Release → configuration placement from A2O source records. It is not presented as an internal component PBS because the A2O workbook does not provide authoritative component relationships.

## Analyst control

The Analyst Control page is an action queue, not an executive dashboard. It reports source exceptions, manual-review work, unmapped Platform records, pending funding decisions, Objective trace gaps, schedule risks, and Initiative briefing gaps. Each item links to the record or page where the analyst can act. Leadership output remains the Initiative one-pager and Leadership Reports.
