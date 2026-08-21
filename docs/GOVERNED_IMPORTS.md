# Governed Imports

## Control objective

An import is a proposed source observation. It is not permission to overwrite
Government analysis or silently create relationships. Every supported import
uses the same operating sequence:

1. Select a local source file and identify its source date.
2. Parse the file with a source-specific adapter.
3. Display every source row as **new**, **changed**, **unchanged**, or
   **blocked**.
4. Display the proposed canonical match and field-level differences.
5. Allow the analyst to approve, skip, or override the proposed match.
6. Apply all approved rows in one database transaction.
7. Retain the source receipt, normalized values, decisions, findings, and
   target identifiers in import history.

Blocked rows cannot be approved. Skipped rows remain in the source receipt and
do not change a canonical record. An exact repeat of an applied source
snapshot is a no-op.

## Implemented adapters

| Adapter | Input | Canonical target | Identity and update rule |
| --- | --- | --- | --- |
| Confluence Change Request dashboard | CSV or XLSX | Change Request | `jpo code` / external identifier under the Confluence source system. The analyst may override a proposed match. Approved rows update external-source fields only. Government priority, funding decision, effects, dependencies, estimates, and analysis are retained. |
| Lockheed Objective feed | JSON | External LM feed subject, optionally reconciled to a governed LM Objective | Root JSON key is the supplier dependency identity. Jira is an additional supplier identifier. A governed Objective link is explicit; JPO references do not establish ownership. Daily snapshots and field deltas are retained. |
| Lockheed daily delivery | Multi-file CSV or XLSX (`CAPES`, `JIRA`, `MCPS`, `OBJS`) | Stable external source subject with an optional Capability, Change Request, or Objective trace link | Source system + dataset + source key. Every applied delivery retains raw/normalized observations and per-field deltas. Supplier values never overwrite governed analysis. Missing rows are not deletions. |
| A2O Tech Stack exchange | Exact 24-column XLSX | Baseline record and normalized baseline relationships | `ReleaseName + #`; when `#` is blank, a release-scoped product/placement identity is used. Approved rows materialize the baseline. Skipped rows remain in the intake receipt. Missing rows are reported and are not deleted or voided. Additional columns, such as `CSCI`, are flagged for governance and never silently dropped into an unrelated field. |

## Import Hub routing

Use **Import Hub & Quality** as the entry point. It identifies the correct
adapter by the file you have:

- A2O 24-column workbook → **Import A2O workbook**
- GitLab Pages `FOR_JPO` JSON → **Import Objective JSON**
- `FOR_JPO_CAPES`, `FOR_JPO_JIRA`, `FOR_JPO_MCPS`, or `FOR_JPO_OBJS` CSV/XLSX
  files → **Import daily delivery**
- Confluence MCP/DSOR dashboard CSV/XLSX → **Import Change Request export**

The structured LM Objective workbook is a separate manual format. It is not
the Lockheed JSON feed or daily delivery CSV set.

## Confluence column mapping

The Confluence adapter is tolerant of case, punctuation, and spacing changes.
The analyst confirms the mapping before preview. The minimum canonical fields
are external identifier and title. Known headings include:

- `Title`
- `jpo code`
- `Governance Phase`
- `Term`
- `Scope of Change`
- `MOSCoW`
- `Category`
- `Request Type`
- `Contract`
- `MxS/PMO Lead`
- `Functional Owner`
- `Title url`

All columns, including priority flags and scoring fields, remain in the raw
source payload even when they are not canonical Change Request fields. The
`Request Type` column may describe the nature of the request, such as **NEW
CAPABILITY**; the importer therefore infers MCP or DSOR from the external
identifier unless the source explicitly supplies that governance type.

## Future adapters

A new adapter must provide:

- source-system identifier and source-date rule;
- file parser and column/field mapping;
- deterministic identity candidates;
- target choices for analyst override;
- source-controlled fields that may be updated;
- blocking and advisory validation rules;
- immutable raw and normalized receipts;
- field-level comparison output;
- atomic apply and an idempotency key.

Do not add a direct “upload and overwrite” path. Do not infer authoritative
relationships from free text without analyst confirmation.
