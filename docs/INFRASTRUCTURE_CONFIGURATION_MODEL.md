# Governed Infrastructure Configuration Model

## Purpose

The application must describe the technical baseline as a connected, release-aware system configuration. It must answer, with governed records rather than narrative alone:

- What equipment and software exist?
- Where are they installed?
- How are they connected and nested?
- Which Release describes the configuration?
- What changed between Releases?
- Which Products, Change Requests, LM Objectives, Initiatives, evidence records, and decisions depend on the configuration?

The analytics and leadership reports consume this model. They do not replace it.

## Model boundary

This is a bounded program technical-baseline model, not an enterprise asset-management or discovery product. It governs the configuration needed for JSF technical analysis and decision support:

- Platform installation hierarchy: ALOU, OCK, OBK, and PMA.
- Physical and logical infrastructure: UPS, network switch, chassis, blade, physical server, storage array, logical drive, virtual machine, appliance, and governed extensions.
- Release-specific state: placement, parent, lifecycle, operating state, CPU, memory, storage, and other configuration facts.
- Installed Products: operating systems, hypervisors, middleware, databases, runtimes, agents, firmware, and applications.
- Connections: network, power, storage, cluster, and management relationships.

The model does not claim automated discovery, IP address management, cable-plant management, procurement, inventory custody, vulnerability management, or real-time monitoring.

## Governing principles

1. **Stable identity is separate from Release state.** A server, switch, chassis, VM, or storage device is created once. Its placement, capacity, operating state, and parent may change by Release.
2. **A Release is mandatory for configuration state.** A configuration statement without a Release is not part of an As-Is or To-Be baseline.
3. **A Platform is the installation boundary.** Every infrastructure node belongs to one governed Platform. Platform hierarchy carries the installation context.
4. **Products are hard links.** Hardware models, operating systems, hypervisors, middleware, databases, runtimes, agents, firmware, and applications link to canonical Product records.
5. **Organizations are hard links.** Manufacturers, suppliers, owners, operators, integrators, and support organizations link to canonical Organization records.
6. **Hierarchy is explicit.** Release-specific node states form an acyclic parent-child tree. A VM may be placed on a physical server or blade; a logical drive may be placed on a storage array or host; a blade may be placed in a chassis.
7. **Absence is not invention.** Unknown and not-reported values are allowed. The system must not create a VM, container, server, or relationship merely to fill a visual layer.
8. **Evidence and provenance remain attributable.** A statement may be supported, contradicted, reported, or verified by governed evidence. A URL or document title is a locator, not a substitute for an evidence relationship.
9. **Free text is deliberate.** Names, identifiers, versions, notes, rationales, and external locators may be text. Entity references, relationship types, lifecycle states, and governed vocabulary values must not be hand-typed substitutes for canonical records.
10. **History is additive.** A new Release state does not overwrite an earlier Release state. Comparisons use the retained states.

## First-class objects

| Object | Stable or Release-specific | Required relationships | Responsibility |
| --- | --- | --- | --- |
| Platform | Stable | Program; optional parent Platform | Installation/site hierarchy such as ALOU, OCK, OBK, or PMA |
| Infrastructure Node | Stable | Platform; optional manufacturer Organization; optional hardware Product | Identity of a physical or logical configuration item |
| Release Infrastructure State | Release-specific | Release; Infrastructure Node; Platform; optional parent state | Placement, capacity, lifecycle, and operating facts for one Release |
| Product Installation | Release-specific | Product; Release Infrastructure State; Release; Platform; optional baseline record | A Product installed or operating on a governed node |
| Infrastructure Connection | Release-specific | Source state; target state; Release; Platform | A governed connection between two node states |
| Evidence Link | Governed relationship | Evidence record; one infrastructure object | Provenance for the configuration statement |

## Canonical hierarchy

The model permits the following common patterns without requiring every layer:

```text
Program
└─ Platform hierarchy: ALOU → OCK → OBK → PMA
   └─ Release
      └─ UPS / switch / chassis / storage / appliance / physical server
         └─ blade or logical drive (when present)
            └─ virtual machine (when present)
               └─ installed operating system, hypervisor, middleware, runtime, database, agent, and application Products
```

A bare-metal application links directly to the physical server or blade state. A non-containerized application has no invented container layer. A physical appliance may host a Product installation without a VM. Connections supplement the hierarchy; they do not replace it.

## Field governance

### Canonical references

The following values must be selected from existing governed records or created as governed records before use:

- Platform
- Release
- parent infrastructure state
- manufacturer or supplier Organization
- hardware Product
- installed Product
- source and target node state
- evidence record
- controlled storage medium and file-system vocabulary when applicable

### Controlled values

Node type, installation role, lifecycle state, operating state, deployment state, connection type, evidence relationship, and catalog category use controlled values.

### Permitted text

The following remain text because they identify or describe a particular instance rather than another first-class object:

- node code and display name
- asset tag and serial number
- installed instance name and version
- drive letter or mount point
- connection label and measured capacity
- description, notes, rationale, and external source locator

Text fields must not be used to duplicate a canonical Product, Organization, Platform, Release, parent node, or evidence relationship.

## Required workflows

### Platform configuration

An analyst can:

1. open a Platform;
2. select a Release;
3. add or edit a stable node and its Release state;
4. place the state beneath a valid parent;
5. record installed Products and connections;
6. attach evidence;
7. retire or remove a Release-scoped relationship with an audit rationale;
8. inspect the full tree and navigate to linked Products and evidence.

### Cross-Release comparison

For the same stable node or Product, the application shows additions, removals, placement changes, capacity changes, state changes, Product-version changes, and connection changes between selected Releases.

### Product traceability

From a Product, the analyst can enumerate every installation by Release, node, and Platform and can navigate to the host configuration. From a node, the analyst can enumerate every installed Product.

### Import and transfer

- The A2O exchange may create or link baseline Products, Releases, and Resource Platforms, but it must not invent deeper infrastructure not present in the source.
- Workspace export/import includes every infrastructure object, state, installation, connection, vocabulary value, evidence link, and audit record needed to reconstruct the workspace.
- Re-import is idempotent and preserves earlier Release states and analyst-authored relationships.

## Completion matrix

The goal is complete only when every row below is verified against a migrated database and the user-visible application.

| Capability | Current implementation | Verification evidence |
| --- | --- | --- |
| Stable node identity | Verified | CRUD exercised; duplicate stable identity rejected by the API |
| Release-specific state | Verified | The same stable nodes have retained Release 5, 6, and 7 states with different capacity and operating facts |
| Platform and Release ownership | Verified | Cross-Platform moves and cross-Release connections are rejected |
| Hardware Product and manufacturer links | Verified | UI selectors persist canonical Product and Organization foreign keys; realistic demonstration hardware uses both |
| OS/hypervisor/middleware/application links | Verified | Product installations include bare-metal and VM-hosted operating systems, hypervisors, agents, and applications |
| Parent hierarchy and cycle prevention | Verified | Valid trees materialize; attempted hierarchy cycles are rejected |
| Connections | Verified | Network, power, storage, and management connections are navigable; create and rationale-backed removal produce audit events |
| Controlled storage/file-system vocabulary | Verified | Storage medium and file-system selectors use governed reference data; the demonstration graph has no missing controlled-value references |
| Evidence hard links | Verified | Infrastructure nodes, Release states, Product installations, and connections are searchable governance targets with exact object links |
| Product and Platform drill-down | Verified | Product, Platform, Release, topology, and evidence views expose mutually navigable infrastructure relationships |
| Cross-Release infrastructure comparison | Verified | Node, installation, and connection additions, removals, and field changes are compared between selected Releases |
| Workspace transfer | Verified | Package version 3.0 round trip preserved all 78 tables, 9,374 rows, infrastructure counts, and foreign-key integrity |
| Realistic demonstration workspace | Verified | The demonstration graph contains physical equipment, virtual machines, Product installations, and connections across three Releases |
| Air-gap operation | Verified | Local migration, database access, build, outbound-network boundary scan, and data-transfer verification pass with external calls disabled |
| Leadership and analytics consumption | Verified | Analytics consumes governed infrastructure state and links back to Product, Platform, Release, and topology records |

## Verification record

The release gate completed on August 22, 2026 against a migrated local D1/SQLite workspace:

- 11 stable infrastructure nodes, 29 Release states, 22 Product installations, 15 active connections, and 18 controlled reference values were retained.
- Product and Organization foreign keys were populated for the representative UPS, network switch, chassis, blade, server, and PMA endpoint hardware.
- Cross-Release configuration, identity, ownership, hierarchy, connection, evidence-link, and audit rules were exercised through the application APIs.
- The complete workspace export was validated and restored with exact table counts and no foreign-key violations.
- `npm run local:verify` passed the offline boundary scan, migration check, SQLite access check, and production application build.
