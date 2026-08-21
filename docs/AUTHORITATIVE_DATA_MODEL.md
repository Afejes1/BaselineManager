# Authoritative data model

## Purpose

The application database is the authoritative contractor-managed analytical
baseline. The A2O Tech Stack workbook is an exchange format: it can seed or
reconcile the database and can be regenerated on demand, but it does not own
application identity, relationships, lifecycle, review, or decision records.

"Authoritative" in this application means the value used by this analytical
workspace. It does not assert that a fact is an official Government or
Lockheed Martin program record. Every material claim can cite its actual
source and assessment status.

## First-class objects

| Object | Owns | Does not own |
| --- | --- | --- |
| Product | Stable application, software, or technology identity; name, aliases, type, classification, accountable owner | Release placement, installed version, or supplier claims for one release |
| Organization | Stable Government, incumbent, contractor, OEM, operator, or supplier identity | Product ownership merely because the organization appeared in the workbook OEM column |
| Release | Program increment identity, lifecycle, schedule, predecessor, and analytical role | Baseline approval state or a Product's intrinsic identity |
| Configuration Set | A revisioned set of technical positions for one Release; working, review, approved, or superseded state | Release lifecycle |
| Baseline Record | One Product or technology position in one Release and Configuration Set | Product-wide identity or an imported row snapshot |
| Configuration Node | Logical placement hierarchy reported by the technical baseline: Tier, Resource, and Host | Physical installation identity |
| Platform | Stable installation hierarchy: ALOU, OCK, OBK, and PMA | Tier, Resource, or Host values reported by an A2O exchange row |
| Deployment | A Product placed on a Configuration Node | Release-specific installed state |
| Node State | Release/Configuration-Set hardware facts for a Configuration Node | Stable node identity |
| Deployment State | Release/Configuration-Set runtime, language, version, presence, and installation facts | Stable Product identity |
| Change Request | Externally managed work/funding request and the Government fund/defer/decline decision reference | The technical baseline itself |
| LM Objective | Incumbent delivery commitment owned by exactly one Change Request | Government work-plan ownership or a fixed Release commitment unless one is explicitly planned |
| Lockheed Objective Feed Subject | Stable external-source subject identity, daily raw observations, reported JPO/MCP associations, and dependency references | Government ownership, funding approval, an owning Change Request, or an automatic Release commitment |
| Requirement | Reusable externally governed requirement identity and version/source metadata | Objective ownership |
| Objective Requirement | How one Objective adds, modifies, retires, verifies, or is not applicable to a Requirement | The authoritative requirement text in the external requirements system |
| Initiative | Government outcome that groups Change Requests for analysis and leadership decision support | Incumbent execution ownership |
| Work Package | Initiative-owned Government analysis, coordination, verification, or decision-support work | An official DoD WBS or an LM Objective |
| Evidence Record | A call, decision, risk, question, source artifact reference, or other supporting record | A duplicate Product, Release, Objective, or Change Request |

## Baseline ownership

`baseline_occurrence` is the canonical Baseline Record table retained for
compatibility with the existing application. A Baseline Record links stable
objects to release-specific state. It may have zero or more immutable imported
source rows. A record created in the application therefore does not need a
synthetic workbook package.

The exact A2O columns that do not belong to a normalized object are stored as
Baseline Record exchange extensions. The export service assembles each row
from the normalized database and those extension fields. A saved JSON row is
not an independent source of truth.

## Intake and reconciliation

1. Validate the exact A2O column names and order.
2. Save the workbook package and raw rows as immutable evidence.
3. Match each incoming row to a Baseline Record by accepted external key and
   Release, then by governed placement identity.
4. Reuse existing Product, Organization, Release, Configuration Node, and
   Deployment identities through accepted names and aliases.
5. Update the matched Baseline Record and release-specific state in one
   transaction. New canonical objects receive UUID identities.
6. Preserve reviews, Platform assignments, evidence, Change Request effects,
   and other managed relationships attached to the Baseline Record.
7. Report records absent from the incoming workbook. Do not delete them or
   silently transfer their relationships.

An explicit demo reset may destroy sample data. Ordinary workbook intake may
not behave as a reset.

### Lockheed objective feed

Each locally supplied daily JSON file creates an immutable feed snapshot. A
stable feed subject is scoped by external system, program, and the supplied
source object key; an unambiguous Jira identifier preserves that subject if a
later file renumbers its source key. It may exist without a JPO value. Each snapshot stores the normalized
source item and raw payload, current source state, reported JPO/MCP links,
dependency edges, and field-level deltas. Identical files are accepted as
separate observations. Unresolved `blocks` and `blocked_by` targets remain
raw. An analyst may explicitly reconcile a feed subject to an existing
governed LM Objective; that is a trace link and does not change the Objective's
owning Change Request or establish Government approval.

## A2O Tech Stack projection

The exporter always produces the retained 24 columns in their approved order.
The mapping is deterministic:

| A2O field group | Database authority |
| --- | --- |
| `#` and `Notes*` | Baseline Record exchange extension |
| `ReleaseName` | Release |
| `Tier`, `Resource`, `HW_Host` | Configuration Node hierarchy |
| hardware fields | Node State in the selected Configuration Set |
| `LongName`, `ShortName`, `TechStackType`, `Software Type` | Product |
| `OEM` | Product-Supplier relationship |
| language and container fields | Deployment State |
| capability notes | Staged Baseline Record text until an analyst explicitly resolves it to a Capability relationship |

Properties outside the exchange contract, including Platform assignment,
application version, evidence, reviews, Change Requests, Objectives,
requirements, acceptance criteria, and work packages, remain in the database
and never change the workbook shape.

## Lifecycle boundaries

- Release lifecycle: proposed through operational, superseded, or cancelled.
- Release analytical role: Historical, As-Is, To-Be, or Reported.
- Configuration Set lifecycle: working, under review, approved, or superseded.
- Baseline Record lifecycle: active, proposed retirement, or voided with a
  rationale and audit event.
- Product, Organization, Platform, Capability, and Configuration Node records
  are retired instead of deleted when referenced.
- Imported packages and raw rows are immutable.

An approved Configuration Set is a revisioned snapshot. Subsequent edits occur
in a new working revision; they do not rewrite the approved position.

## Delivery and traceability

- A Change Request owns zero or more LM Objectives.
- An Objective has one owning Change Request. Other Change Requests may depend
  on it without changing ownership.
- A Requirement may be linked to many Objectives through versioned Objective
  Requirement records.
- An Initiative groups Change Requests to state a Government outcome.
- A Work Package belongs to exactly one Initiative and may support multiple
  Objectives through explicit relationships.
- Work-package parent/child links define decomposition. Accepted dependency
  links define schedule logic. Both must remain acyclic.
- Evidence Records may link to any governed object. The link must identify the
  object type and resolve to an existing object before it is saved.

## Deliberate exclusions

This model does not add a generic entity-attribute-value store, a full CMDB,
an official DoD WBS, or an internal Product Breakdown Structure without source
BOM/SBOM data. Those structures would create apparent precision that the
current evidence cannot support.
