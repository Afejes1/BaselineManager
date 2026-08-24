# A2O Technical Baseline Manager user guide

## Purpose

Use this guide to load technical-baseline data, connect it to proposed work,
and prepare a small, traceable leadership decision. The application is an
editable Government analytical baseline. It is not a replacement for the
contractor's source systems.

Start with one decision vertical slice. Do not try to describe every product,
release, objective, and platform before you can answer one useful question.

This guide uses a hypothetical example:

> **Government outcome:** Reduce PMA service interruptions through a future
> PMA modernization decision.

The example is illustrative. Replace names, identifiers, releases, and facts
with the records and source material approved for your workspace.

## Before you enter data

1. Confirm the application is running at `http://127.0.0.1:3000`.
2. Keep the source files in an approved local folder. The application reads the
   file you select; it does not fetch Lockheed, Confluence, GitLab, or another
   external system.
3. Back up the workspace before a major import and at the end of the session:

   ```powershell
   npm run local:backup
   ```

4. Work from source material. Do not use a memory, email summary, or inferred
   relationship as if it were a source fact.
5. Leave a date blank when it is genuinely unknown. A blank date means "not
   yet established," not "late."

## The model in one picture

```text
Selected local source files
        |
        v
Immutable import receipts and source observations
        |
        +--> A2O workbook -> Releases, Products, baseline records, configuration nodes
        +--> MCP / DSOR export -> Change Request references
        +--> LM JSON / delivery files -> LM Objectives and reported references

Government analysis connects the records:

Initiative (Government outcome)
        |
        +--> Change Request(s) -----> technical effect(s) -----> affected objects
        |              |                       |                     Product / Platform /
        |              |                       |                     configuration node /
        |              +--> owning LM Objective(s)                  baseline record
        |                              |
        |                              +--> attribution to the effect it implements
        |
        +--> requirements, acceptance criteria, evidence, and decision records
```

The arrows are deliberate. Do not rely on a title, a release name, or a free
text note to imply one of these relationships.

## Four information states

The app labels information to make its meaning clear, not to argue for a
conclusion.

| Label | Meaning | Example | What it is not |
| --- | --- | --- | --- |
| Source claim | What a selected source file, supplier, or external system reported | An LM feed reports an Objective is 40% complete | Government acceptance of 40% progress |
| Government assessment | Government or independent analysis | An analyst assesses an availability risk from a proposed PMA change | A funding decision |
| Government decision | A record with authority, date, and rationale | A board funds an MCP | A lifecycle dropdown by itself |
| Verification / acceptance | Evidence tied to a criterion or signoff | A Tier 4 result is accepted by its designated authority | A file checksum alone |

An evidence file that is **integrity sealed** proves that the retained bytes
match the recorded file. It does not by itself prove the source claim, accept
the result, or approve a decision.

When creating or editing a supporting record, select its **Information origin**:

- Supplier-reported - contractor or external-source content.
- Government-recorded - a Government meeting, direction, or record.
- Independent analysis - analysis performed outside the supplier source.
- Joint record - content jointly recorded.
- Origin not classified - historic or not-yet-classified material.

For a Decision record marked **Approved**, the app requires a decision
authority, decision date, and rationale.

## Worked example: PMA availability decision

Use an outcome, not a solution label, for the Initiative whenever practical.

| Record | Example value | Why it exists |
| --- | --- | --- |
| Initiative | Reduce PMA service interruptions | Government outcome and leadership decision context |
| Decision ask | Direct and fund a bounded PMA modernization analysis and implementation package | The specific Government direction needed |
| Desired outcome | Future PMA service meets the agreed availability target with a verified fielding plan | End state, not a supplier promise |
| Consequence if deferred | PMA downtime risk remains and maintenance burden continues | Decision consequence |
| Change Request | MCP-PMA-001 - PMA modernization package | External work/funding request reference |
| LM Objective | MVI modernization | Incumbent delivery commitment owned by the Change Request |
| Technical effect | Modify Platform: PMA; Aspect: availability and maintainability | Defines the technical scope |
| Release context | Current PMA Release -> Future PMA Release | Context for the effect; not a scope multiplier |
| Evidence record | PMA modernization technical review | Retains a factual call record and its source material |

For a whole-platform modernization, select **Platform -> PMA** as the affected
object on the Change Request. Do **not** select every Product merely because it
is installed on PMA. Add a Product only when the Product itself changes in a
decision-relevant way, such as a replacement, version transition, or retirement.

If the proposed work does not affect currently fielded PMA instances, do not
link their baseline rows as affected. Describe the future platform effect and
the Future PMA Release context instead. A release context does not automatically
claim that every record in that release is in scope.

## Step-by-step: build one decision vertical slice

### 1. Load the baseline first

Open **Import Hub & Quality -> Import A2O workbook** and select the current
24-column A2O Tech Stack XLSX.

1. Identify the source date and file honestly.
2. Preview the import.
3. Review rows marked new, changed, unchanged, or blocked.
4. Resolve a true duplicate or invalid identity. Skip a source row that should
   not be applied; do not force it into an unrelated record.
5. Apply the approved rows.
6. Open **Releases**, **Products**, and **Platforms** to confirm a small sample
   of materialized records.

The workbook provides release, product, and reported technical-baseline context.
It does not replace platform configuration, Government decisions, Objective
ownership, or evidence relationships.

### 2. Load external Change Request and Objective material

Use **Import Hub & Quality** and choose the matching local file:

| File in hand | Select this import |
| --- | --- |
| Confluence MCP / DSOR CSV or XLSX export | Import Change Request export |
| `FOR_JPO.json` | Import Objective JSON |
| CAPES, JIRA, MCPS, or OBJS daily-delivery CSV/XLSX | Import daily delivery |

For each import, review the preview before applying it. An import retains an
immutable receipt and source observation. It may create or refresh canonical
references, but it does not overwrite Government priority, funding decisions,
technical effects, dependencies, acceptance, or analysis.

**Important for LM Objective data:** a reported JPO/MCP reference is a trace
link. It is not automatically the owning Change Request, a Government funding
decision, or a delivery commitment. An Objective has one accountable owning
Change Request; record additional relationships explicitly when needed.

### 3. Create or review the Platform configuration

Open **Platforms**, select PMA, and select the Release you are describing.

The infrastructure model has two layers:

```text
Stable identity                   Release-specific state
----------------                  ---------------------------------
PMA-SRV-01                        PMA-SRV-01 in Future PMA Release
name, code, node type             parent, CPU, memory, storage,
serial number                     lifecycle, operating state, source
```

To edit CPU, memory, storage, or parent placement:

1. Open the Platform and choose the intended Release.
2. In **Release node register**, select **Edit capacity & Release state**.
3. Enter the observed or planned values, supporting reference, and source date.
4. Save the state for that Release.

To create a VM:

1. Select **Add infrastructure node / VM**.
2. Select **Virtual machine** as the type.
3. Select the host as the parent in the selected Release.
4. Add the operating system, hypervisor, application, or other software as
   installed Products only when they are known.

Do not invent nodes, VMs, or connections to make the diagram look complete.
Unknown is an allowed value.

### 4. Complete the Change Request analysis

Open **Change Requests**, select the MCP/DSOR, then record the Government
analysis around the external request.

Minimum useful fields:

| Field | What to enter |
| --- | --- |
| External identifier, system, source-as-of | The source reference and date, not a guessed replacement |
| Government priority | The Government's current prioritization |
| Requested release | The intended delivery context, if known |
| Funded / deferred consequence | What changes if the request is funded or not funded |
| Technical effect | A bounded action on a selected affected object |
| Basis and status | Source claim, Government assessment, or confirmed technical effect |

For the PMA example, add one technical effect:

```text
Action:           Modify
Affected object:  Platform -> PMA
Aspect:           Availability and maintainability
Current value:    Current PMA service posture (if sourced)
Target value:     Future PMA service posture (if sourced or assessed)
From release:     Current PMA Release (if known)
To release:       Future PMA Release (if known)
Status:           Source claim / Government assessment / confirmed effect
```

**Aspect** is short descriptive text explaining *what characteristic changes*.
Use terms such as availability, capacity, hosting, version, interface,
maintainability, security control, or deployment. It is not a free-text place
to create a new Platform or Product identity.

### 5. Add the LM Objective and attribute its work

Open **LM Objectives** and find or create the Objective. For the example:

```text
Objective: MVI modernization
Owning Change Request: MCP-PMA-001
```

Open the Objective's **Technical scope** view and attribute the Change Request
effect that the Objective implements. This is the link that explains how
incumbent work relates to the technical scope. A dependency alone does not
establish ownership or scope.

If the forecast start or finish date is proposed or unknown, leave it blank.
Record a sourced proposed date only when the source provides one. Do not create
a placeholder date merely to make a timeline appear complete.

### 6. Record dependencies precisely

Use a dependency only when it changes planning, sequencing, risk, or decision
logic. Record rationale, source reference, source-as-of date, owner, and the
appropriate information status.

| Relationship | Use it when | PMA example |
| --- | --- | --- |
| Requires | The successor cannot proceed without the predecessor | PMA fielding requires an approved environment change |
| Enables | The predecessor makes successor work possible or easier | Infrastructure assessment enables the PMA implementation package |
| Blocks | The predecessor prevents successor work from progressing | An unresolved security exception blocks fielding |
| Conflicts | The requests compete or cannot coexist as planned | Two changes reserve the same maintenance window |
| Overlaps | Work shares scope or timing but has no stronger dependency | Two analysis packages inspect the same platform |

For finish-to-finish logic, use the work-package dependency control when the
meaning is specifically "the successor cannot finish until the predecessor
finishes." Do not write "finish to finish" as a vague note on a Change Request
dependency. State the actual prerequisite and consequence.

### 7. Create evidence and decision records

Open **Evidence & Records** to retain a technical call, risk, question,
decision, or technical note.

1. Select the record type.
2. Set **Information origin** based on who supplied or recorded it.
3. Set the record lifecycle separately.
4. Link the record to the Initiative, Change Request, Objective, Platform,
   Release, Product, or other affected object.
5. Attach a supporting file when appropriate.
6. For an approved Decision record, enter authority, date, and rationale.

Example evidence record:

```text
Record type:          Technical call
Information origin:   Joint record
Title:                PMA modernization technical review
Links:                Initiative, MCP-PMA-001, MVI modernization, Platform PMA
Summary:              What was reported and what remains to be assessed
Decision ask:         Confirm whether to pursue a future PMA modernization package
```

### 8. Create the Initiative last

Open **Initiatives -> New initiative** once the first Change Request is
meaningfully described.

Enter the Government outcome, owner, priority, decision ask, desired outcome,
and consequence if deferred. The **Release lens** is optional context for the
decision view. It does **not** define the Initiative's technical scope.

After creating the Initiative:

1. Link MCP-PMA-001 to it.
2. Confirm the linked Objective and its technical-effect attribution.
3. Add requirements, milestones, acceptance criteria, and evidence as they
   become available.
4. Open the Initiative and review **Derived technical scope**.

The app derives Initiative scope from the affected objects on linked Change
Requests and from Objective effect attributions. It does not use a manual
"all release records" selection. A Platform effect remains one Platform effect;
baseline records count only when they are explicitly linked.

## Preparing the first one-pager

Open the Initiative and complete the fields that let a reader distinguish known
facts, analysis, gaps, and the decision needed.

Use this checklist:

| One-pager element | Ready when |
| --- | --- |
| Decision | The action, authority, and decision-needed date are plain language |
| As-Is | Current condition is sourced or explicitly marked as an assessment/gap |
| To-Be | The target condition is bounded and not presented as already funded |
| Change Requests | Each has an identifier, consequence, and technical effect |
| Objectives | Each is owned and attributed to a technical effect where applicable |
| Technical scope | Derived affected objects match the real decision scope |
| Dependencies | Material prerequisites and blockers have rationale and source status |
| Evidence | Files and call records are linked; acceptance is not inferred from a seal |
| Readiness gaps | Missing requirements, estimates, criteria, or decisions are visible |

Then use **Open leadership one-pager** to review the live decision sheet. Use
**Save report snapshot** only when you want a frozen, auditable record of the
source state. A saved brief does not silently change when later records are
edited.

For the first PMA brief, it is acceptable to say:

> The Government needs direction on a bounded PMA modernization package.
> Supplier-reported planning and technical scope require validation. The
> Initiative currently identifies the PMA platform as the affected object;
> individual Product and baseline-record effects will be added only when
> supported by the Change Request analysis.

That is clearer and more useful than pretending the full implementation plan,
cost, date, and affected Product list are already known.

## Daily and meeting rhythm

### Daily source intake

1. Save the received file unchanged in the approved local location.
2. Import it through **Import Hub & Quality**.
3. Review new, changed, unchanged, removed, and blocked observations.
4. Apply approved rows.
5. Review deltas in the relevant Objective or Change Request.
6. Record a Government assessment or question when a source change affects a
   decision, scope, priority, schedule, or acceptance condition.

A removed item in a later supplier file is history, not an instruction to delete
the governed record.

### Before a technical touchpoint

- Open the Change Request, Objective, Platform, and relevant Release.
- Review reported dependencies separately from accepted Government dependencies.
- Note unknowns as questions or assessments, not facts.
- Capture outcomes in an Evidence record while the source and participants are
  known.

### Before a leadership meeting

- Review the Initiative's derived scope rather than a manually selected release.
- Verify the source/assessment/decision labels in the evidence chain.
- Confirm the decision, consequence, and desired outcome are specific.
- Generate the one-pager and include the traceability annex when detail will not
  fit on the first page.
- Back up the workspace after the meeting record and decision are entered.

## Common corrections

| Situation | Correct action |
| --- | --- |
| An Objective's reported JPO changed | Import the source observation and inspect the retained delta; do not overwrite Government ownership automatically |
| A proposed date is unknown | Leave it blank and record the uncertainty or source claim |
| A whole Platform is affected | Link the Platform as the technical effect; add Products only when individually affected |
| A Product is only installed on a Platform | Keep it as an installation relationship, not an affected-object claim |
| A source document is attached | Mark the record's information origin; do not treat the file seal as acceptance |
| A decision was made in a board | Create or update a Decision record with authority, date, and rationale |
| Scope changed without notice | Import the new source snapshot, inspect field-level history, and create a Government assessment or decision record if the change is material |
| You need to change a dependency | Edit its lifecycle or basis when anchors are fixed; retire and recreate it to change the predecessor, successor, or relationship |

## End-of-session checklist

- [ ] Review the import results and blocking findings.
- [ ] Confirm material Change Request effects point to real selected objects.
- [ ] Confirm Objectives are owned and attributed where required.
- [ ] Preserve current uncertainty as source claims or assessments.
- [ ] Record decision authority, date, and rationale when an approved decision exists.
- [ ] Save a frozen one-pager only when the source snapshot is ready to retain.
- [ ] Run `npm run local:backup` and copy the resulting backup to an approved location.

## Where to go next

- `README.md` - local setup, updates, backups, and operating boundaries.
- `docs/GOVERNED_IMPORTS.md` - import rules and source adapters.
- `docs/AUTHORITATIVE_DATA_MODEL.md` - object ownership and relationships.
- `docs/INFRASTRUCTURE_CONFIGURATION_MODEL.md` - Platforms, nodes, VMs,
  installations, and connections.
- `docs/LOCAL_OPERATOR_RUNBOOK.md` - detailed operator and recovery procedures.
