# Lockheed Daily Delivery Intake

## Purpose

The daily Lockheed files are supplier planning observations. They support
trend, mismatch, schedule, effort, progress, and dependency analysis. They are
not the Government technical baseline and do not approve a Change Request,
Objective, estimate, requirement, acceptance result, or funding decision.

| File | Analytical subject | Canonical object materialized from a valid external identity |
| --- | --- | --- |
| `FOR_JPO_CAPES.CSV` | CAPES capability-planning observation | Capability |
| `FOR_JPO_JIRA.CSV` | Jira planning/work observation | LM Objective |
| `FOR_JPO_MCPS.CSV` | Lockheed MCP/DSOR projection | Government Change Request |
| `FOR_JPO_OBJS.CSV` | Lockheed Objective projection | LM Objective |

Classification is inferred from the filename and headers, then shown to the
analyst for confirmation. This is necessary because automated exports and
HTML-derived CSV files can change names, headings, or formatting.

## Operating flow

1. Open **Import Hub & Quality → Import daily delivery**.
2. Select one or more delivered CSV/XLSX files.
3. Set the source snapshot date.
4. Verify every detected dataset classification.
5. Preview all rows.
6. Review source identity, field differences, and findings.
7. Approve or skip each row. Valid identities create or refresh their
   canonical objects automatically; only invalid or duplicate identities need
   resolution.
8. Apply the reviewed delivery.
9. Inspect a source subject to see every retained observation and field delta.

The exact same file content, adapter, and source date is idempotent: it is a
no-op when applied again. A changed file on a later date creates another
observation, including unchanged rows, so the application can show what the
supplier reported on each delivery date.

## History and authority rules

- The stable identity is source system + dataset + source key.
- Raw rows and normalized fields are retained for every applied observation.
- Field deltas compare the new observation with the prior accepted observation.
- Dates, ROM, budget hours, percent complete, status, release, and dependency
  changes remain supplier claims.
- A valid external identifier materializes its matching canonical object. This
  does not make supplier values Government analysis, funding decisions, or
  approval data.
- A missing row means **not observed in the supplied file**. It is not deleted,
  cancelled, or declared absent from the supplier system.
- Parser failures and duplicate source identities are blocking. The row must be
  corrected or skipped.

## Initial mapping basis

The first adapter version was derived from delivered-file names and headers
visible in a screenshot. Use preview on representative actual files before
applying them. Unknown columns are retained in the raw and normalized payload;
they are not discarded. If the production extract contains a materially
different header or multi-table layout, add a source-specific alias or parsing
rule rather than manually rewriting the file.

The full development branch contains synthetic two-day fixtures that
demonstrate changes to Objective ROM, completion, schedule, status, and
dependencies. Fixtures are excluded from the hardened operator package.
