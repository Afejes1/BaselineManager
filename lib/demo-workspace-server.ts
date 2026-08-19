import { env } from "cloudflare:workers";
import { audit, ensureActor, PROGRAM_ID, requireWriter, WORKSPACE_ID } from "./governance-server";

type Database = typeof env.DB;
type Actor = Awaited<ReturnType<typeof ensureActor>>;

const DEMO_PREFIX = "DEMO-";
const DEMO_FILE_NAME = "JSF_V3_Demonstration_Baseline.xlsx";
const now = () => new Date().toISOString();

type DemoOccurrence = {
  occurrenceId: string;
  releaseId: string;
  configurationNodeId: string;
  productId: string | null;
  organizationId: string | null;
  sourceKey: string;
  shortName: string | null;
  containerized: string | null;
  releaseName: string;
  hostName: string;
};

type RationalePlan = {
  id: string;
  externalReference: string;
  recordType: "mcp" | "technical_call" | "decision";
  title: string;
  status: "open" | "in_review" | "approved";
  occurredAt: string;
  summary: string;
  decisionAsk: string | null;
  impact: string;
  sourceKey: string;
};

const versions: Record<string, string> = {
  "DEMO-R5-001": "5.2.0", "DEMO-R5-002": "3.8.4", "DEMO-R5-003": "12.1", "DEMO-R5-004": "19c", "DEMO-R5-005": "2.6.1", "DEMO-R5-006": "1.9.7",
  "DEMO-R6-001": "6.0.0-rc2", "DEMO-R6-002": "4.0.0-rc1", "DEMO-R6-003": "12.3", "DEMO-R6-004": "19c RU-24", "DEMO-R6-005": "2.8.0-rc1", "DEMO-R6-006": "1.0.0-rc1",
  "DEMO-R7-001": "6.1.0", "DEMO-R7-002": "4.0.0", "DEMO-R7-003": "19c RU-25", "DEMO-R7-004": "3.0.0", "DEMO-R7-005": "1.1.0", "DEMO-R7-006": "1.0.0",
};

const rationales: RationalePlan[] = [
  {
    id: "demo-record-mcp-r6-mps", externalReference: "DEMO-MCP-061", recordType: "mcp", title: "Mission Planning Service relocation and capacity uplift", status: "in_review", occurredAt: "2026-04-15",
    summary: "Synthetic MCP example for moving Mission Planning Service to its Release 6 compute host and increasing capacity.", decisionAsk: "Approve the proposed Release 6 deployment position.", impact: "Moves the service and changes its reported storage, CPU, and memory values.", sourceKey: "DEMO-R6-001",
  },
  {
    id: "demo-record-call-r6-tls", externalReference: "DEMO-TC-062", recordType: "technical_call", title: "Threat Library Service capacity review", status: "open", occurredAt: "2026-05-02",
    summary: "Synthetic technical-call example documenting the Release 6 scale-up of Threat Library Service.", decisionAsk: null, impact: "Changes the reported storage, CPU, and memory values without a deployment move.", sourceKey: "DEMO-R6-002",
  },
  {
    id: "demo-record-decision-r7-eis", externalReference: "DEMO-DEC-071", recordType: "decision", title: "Execution Insights Service introduction", status: "approved", occurredAt: "2026-07-08",
    summary: "Synthetic decision example authorizing a new Operations-tier analytics service in Release 7.", decisionAsk: "Record approval of the new Release 7 service.", impact: "Adds a new product occurrence, deployment, and managed topology profile.", sourceKey: "DEMO-R7-006",
  },
];

function releaseNumber(name: string) {
  return name.match(/\d+/)?.[0] || "X";
}

function hostDetails(row: DemoOccurrence) {
  const release = releaseNumber(row.releaseName);
  const isNetwork = row.hostName.startsWith("NET-");
  return {
    installationLocation: isNetwork ? `OBK-${release} Edge Test Bay` : `OBK-${release} Mission Systems Bay`,
    facilityOrEnclave: isNetwork ? "Synthetic edge-networking enclave" : "Synthetic mission-systems enclave",
    equipmentRack: isNetwork ? `NET-R${release}-01` : `MS-R${release}-${row.sourceKey.slice(-2)}`,
    hardwareBlade: isNetwork ? "Gateway appliance 01" : `Compute blade ${row.sourceKey.slice(-2)}`,
    virtualizationPlatform: isNetwork ? "Not virtualized" : "VMware vSphere (synthetic)",
  };
}

function deploymentDetails(row: DemoOccurrence) {
  const release = releaseNumber(row.releaseName);
  const short = (row.shortName || "app").trim().toLowerCase();
  const containerized = (row.containerized || "").trim().toLowerCase() === "yes";
  return {
    virtualMachine: `${short}-guest-r${release}`,
    containerInstance: containerized ? `${short}-workload-r${release}` : null,
    applicationVersion: versions[row.sourceKey] || `r${release}.0-demo`,
    installationIdentifier: `INST-${row.sourceKey.replace(DEMO_PREFIX, "")}`,
    deploymentRole: release === "5" ? "reported baseline" : "proposed release position",
  };
}

export async function enrichDemonstrationWorkspace(db: Database, actor: Actor) {
  requireWriter(actor);
  const occurrences = await db.prepare(`
    SELECT bo.id AS occurrence_id,bo.release_id,bo.configuration_node_id,bo.product_id,
      sr.source_key,sr.short_name,sr.containerized,r.name AS release_name,n.name AS host_name,p.owner_organization_id
    FROM baseline_occurrence bo
    JOIN source_row_24 sr ON sr.id=bo.source_row_id
    JOIN source_package sp ON sp.id=sr.source_package_id
    JOIN release r ON r.id=bo.release_id
    JOIN configuration_node n ON n.id=bo.configuration_node_id
    LEFT JOIN product p ON p.id=bo.product_id
    WHERE bo.program_id=? AND bo.workspace_id=?
    ORDER BY sr.row_number ASC
  `).bind(PROGRAM_ID, WORKSPACE_ID).all<{
    occurrence_id: string; release_id: string; configuration_node_id: string; product_id: string | null;
    source_key: string | null; short_name: string | null; containerized: string | null; release_name: string; host_name: string; owner_organization_id: string | null;
  }>();

  const rows: DemoOccurrence[] = occurrences.results.map((row) => ({
    occurrenceId: row.occurrence_id, releaseId: row.release_id, configurationNodeId: row.configuration_node_id, productId: row.product_id, organizationId: row.owner_organization_id,
    sourceKey: row.source_key || "", shortName: row.short_name, containerized: row.containerized, releaseName: row.release_name, hostName: row.host_name,
  }));
  if (!rows.length || rows.some((row) => !row.sourceKey.startsWith(DEMO_PREFIX))) {
    throw new Error("Load the synthetic demonstration baseline before adding its managed details.");
  }
  const isDemoPackage = await db.prepare("SELECT COUNT(*) AS count FROM source_package WHERE file_name=? AND program_id=?").bind(DEMO_FILE_NAME, PROGRAM_ID).first<{ count: number }>();
  if (!Number(isDemoPackage?.count)) throw new Error("The active workspace is not the synthetic demonstration baseline.");

  const at = now();
  const statements: D1PreparedStatement[] = [];
  const seenHosts = new Set<string>();
  for (const row of rows) {
    const hostKey = `${row.releaseId}:${row.configurationNodeId}`;
    if (!seenHosts.has(hostKey)) {
      seenHosts.add(hostKey);
      const host = hostDetails(row);
      statements.push(db.prepare("INSERT INTO managed_host_profile (id,program_id,release_id,configuration_node_id,installation_location,facility_or_enclave,equipment_rack,hardware_blade,virtualization_platform,source_reference,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(release_id,configuration_node_id) DO UPDATE SET installation_location=excluded.installation_location,facility_or_enclave=excluded.facility_or_enclave,equipment_rack=excluded.equipment_rack,hardware_blade=excluded.hardware_blade,virtualization_platform=excluded.virtualization_platform,source_reference=excluded.source_reference,notes=excluded.notes,updated_at=excluded.updated_at")
        .bind(`demo-host-${row.releaseId}-${row.configurationNodeId}`, PROGRAM_ID, row.releaseId, row.configurationNodeId, host.installationLocation, host.facilityOrEnclave, host.equipmentRack, host.hardwareBlade, host.virtualizationPlatform, "Synthetic demo enrichment", "Demo-only managed topology detail. It is not part of the A2O Tech Stack XLSX export.", actor.id, at, at));
    }
    if (!row.productId) continue;
    const deployment = deploymentDetails(row);
    statements.push(db.prepare("INSERT INTO managed_deployment_profile (id,program_id,baseline_occurrence_id,release_id,configuration_node_id,product_id,virtual_machine,container_instance,application_version,installation_identifier,deployment_role,source_reference,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_occurrence_id) DO UPDATE SET virtual_machine=excluded.virtual_machine,container_instance=excluded.container_instance,application_version=excluded.application_version,installation_identifier=excluded.installation_identifier,deployment_role=excluded.deployment_role,source_reference=excluded.source_reference,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(`demo-deployment-${row.occurrenceId}`, PROGRAM_ID, row.occurrenceId, row.releaseId, row.configurationNodeId, row.productId, deployment.virtualMachine, deployment.containerInstance, deployment.applicationVersion, deployment.installationIdentifier, deployment.deploymentRole, "Synthetic demo enrichment", "Demo-only managed deployment detail. It is not part of the A2O Tech Stack XLSX export.", actor.id, at, at));
  }

  let rationaleRecordCount = 0;
  for (const plan of rationales) {
    const row = rows.find((candidate) => candidate.sourceKey === plan.sourceKey);
    if (!row || !row.productId) continue;
    rationaleRecordCount += 1;
    statements.push(db.prepare("DELETE FROM governance_record_link WHERE governance_record_id=?").bind(plan.id));
    statements.push(db.prepare("INSERT INTO governance_record (id,program_id,record_type,external_reference,title,status,owner,occurred_at,due_date,summary,decision_ask,impact,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record_type=excluded.record_type,external_reference=excluded.external_reference,title=excluded.title,status=excluded.status,owner=excluded.owner,occurred_at=excluded.occurred_at,summary=excluded.summary,decision_ask=excluded.decision_ask,impact=excluded.impact,updated_at=excluded.updated_at")
      .bind(plan.id, PROGRAM_ID, plan.recordType, plan.externalReference, plan.title, plan.status, "Baseline steward (synthetic)", plan.occurredAt, null, plan.summary, plan.decisionAsk, plan.impact, actor.id, at, at));
    for (const [kind, entityId] of [["release", row.releaseId], ["product", row.productId], ["occurrence", row.occurrenceId], ["configuration_node", row.configurationNodeId]] as const) {
      statements.push(db.prepare("INSERT INTO governance_record_link (id,governance_record_id,entity_kind,entity_id,relationship,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .bind(`demo-link-${plan.id}-${kind}`, plan.id, kind, entityId, "affects", at, at));
    }
    statements.push(audit(db, actor, "demonstration_rationale_seeded", "governance_record", plan.id, { externalReference: plan.externalReference, sourceKey: plan.sourceKey }));
  }

  // The synthetic installation hierarchy is deliberately small and connected:
  // ALOU (global) → OCK (country) → OBK (squadron/site) → PMA (endpoint).
  // PMA nodes anchor to current/proposed Release 7 configuration nodes; the
  // retained source rows remain the evidence for the product placements.
  const platformPlan = [
    { id: "demo-platform-alou", parentId: null, type: "alou", code: "ALOU-GLOBAL", name: "Global Mission Support Node", sourceKey: null, location: "Program-wide", country: null },
    { id: "demo-platform-ock-us", parentId: "demo-platform-alou", type: "ock", code: "OCK-US", name: "United States Country Node", sourceKey: null, location: "United States", country: "US" },
    { id: "demo-platform-ock-uk", parentId: "demo-platform-alou", type: "ock", code: "OCK-UK", name: "United Kingdom Country Node", sourceKey: null, location: "United Kingdom", country: "GB" },
    { id: "demo-platform-obk-va", parentId: "demo-platform-ock-us", type: "obk", code: "OBK-VA-07", name: "Mission Systems Squadron", sourceKey: null, location: "Virginia synthetic site", country: "US" },
    { id: "demo-platform-obk-ca", parentId: "demo-platform-ock-us", type: "obk", code: "OBK-CA-11", name: "Operations Squadron", sourceKey: null, location: "California synthetic site", country: "US" },
    { id: "demo-platform-obk-uk", parentId: "demo-platform-ock-uk", type: "obk", code: "OBK-UK-01", name: "Partner Integration Squadron", sourceKey: null, location: "United Kingdom synthetic site", country: "GB" },
    { id: "demo-platform-pma-mps", parentId: "demo-platform-obk-va", type: "pma", code: "PMA-PLN-01", name: "Mission Planning Endpoint", sourceKey: "DEMO-R7-001", location: "Planning cell laptop", country: "US" },
    { id: "demo-platform-pma-tls", parentId: "demo-platform-obk-va", type: "pma", code: "PMA-THR-02", name: "Threat Data Endpoint", sourceKey: "DEMO-R7-002", location: "Threat support laptop", country: "US" },
    { id: "demo-platform-pma-sds", parentId: "demo-platform-obk-uk", type: "pma", code: "PMA-DAT-03", name: "Secure Data Endpoint", sourceKey: "DEMO-R7-003", location: "Partner data node", country: "GB" },
    { id: "demo-platform-pma-ops", parentId: "demo-platform-obk-ca", type: "pma", code: "PMA-OPS-04", name: "Operations Console Endpoint", sourceKey: "DEMO-R7-004", location: "Operations desk laptop", country: "US" },
    { id: "demo-platform-pma-ios", parentId: "demo-platform-obk-uk", type: "pma", code: "PMA-INT-05", name: "Integration Endpoint", sourceKey: "DEMO-R7-005", location: "Partner integration laptop", country: "GB" },
    { id: "demo-platform-pma-eis", parentId: "demo-platform-obk-ca", type: "pma", code: "PMA-ANA-06", name: "Execution Analytics Endpoint", sourceKey: "DEMO-R7-006", location: "Leadership analytics laptop", country: "US" },
  ] as const;
  for (const platform of platformPlan) {
    const anchor = platform.sourceKey ? rows.find((row) => row.sourceKey === platform.sourceKey) : null;
    statements.push(db.prepare("INSERT INTO platform (id,program_id,parent_id,configuration_node_id,platform_type,code,normalized_code,name,normalized_name,status,description,installation_location,country_code,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,configuration_node_id=excluded.configuration_node_id,platform_type=excluded.platform_type,code=excluded.code,normalized_code=excluded.normalized_code,name=excluded.name,normalized_name=excluded.normalized_name,status=excluded.status,description=excluded.description,installation_location=excluded.installation_location,country_code=excluded.country_code,updated_at=excluded.updated_at")
      .bind(platform.id, PROGRAM_ID, platform.parentId, anchor?.configurationNodeId || null, platform.type, platform.code, platform.code.toLowerCase(), platform.name, platform.name.toLowerCase(), platform.sourceKey ? "planned" : "active", "Synthetic governed Platform used to exercise hierarchy, rollups, and decision effects.", platform.location, platform.country, actor.id, at, at));
    if (anchor?.organizationId) statements.push(db.prepare("INSERT INTO platform_organization (id,platform_id,organization_id,relationship_type,source_reference,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(platform_id,organization_id,relationship_type) DO UPDATE SET source_reference=excluded.source_reference,updated_at=excluded.updated_at")
      .bind(`demo-platform-org-${platform.id}`, platform.id, anchor.organizationId, "support", "Synthetic demo relationship", at, at));
  }

  const releasesByName = new Map(rows.map((row) => [row.releaseName, row.releaseId]));
  for (const profile of [
    { release: "Release 5", role: "historical", date: "2025-10-01", description: "Prior reported baseline retained for comparison." },
    { release: "Release 6", role: "as_is", date: "2026-04-01", description: "Current reported baseline used for Government assessment." },
    { release: "Release 7", role: "to_be", date: "2026-10-01", description: "Proposed target state contingent on funded Change Requests." },
  ]) {
    const releaseId = releasesByName.get(profile.release);
    if (releaseId) statements.push(db.prepare("INSERT INTO release_profile (id,program_id,release_id,state_role,effective_date,description,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(release_id) DO UPDATE SET state_role=excluded.state_role,effective_date=excluded.effective_date,description=excluded.description,updated_at=excluded.updated_at")
      .bind(`demo-release-profile-${profile.release.slice(-1)}`, PROGRAM_ID, releaseId, profile.role, profile.date, profile.description, actor.id, at, at));
  }

  const requestTypes = [
    ["cr-type-mcp", "MCP", "Maintenance Change Proposal", "Government prioritization reference for incumbent maintenance work.", 10],
    ["cr-type-dsor", "DSOR", "DSOR", "Externally managed request type; the governing system owns its definition and workflow.", 20],
    ["cr-type-other", "OTHER", "Other external request", "Configurable fallback for additional incumbent request types.", 90],
  ] as const;
  for (const type of requestTypes) statements.push(db.prepare("INSERT INTO change_request_type (id,program_id,code,normalized_code,label,description,active,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(program_id,normalized_code) DO UPDATE SET label=excluded.label,description=excluded.description,active=excluded.active,sort_order=excluded.sort_order,updated_at=excluded.updated_at")
    .bind(type[0], PROGRAM_ID, type[1], type[1].toLowerCase(), type[2], type[3], true, type[4], at, at));

  const r5 = releasesByName.get("Release 5") || null;
  const r6 = releasesByName.get("Release 6") || null;
  const r7 = releasesByName.get("Release 7") || null;
  const changePlan = [
    { id: "demo-change-hardening", type: "cr-type-mcp", externalId: "DEMO-MCP-060", title: "Shared platform security hardening", priority: "critical", decision: "fund", releaseId: r6, summary: "Fund the common platform hardening prerequisite used by the Release 6 and 7 service changes.", funded: "Provides the hardened runtime and certificate posture required by dependent services.", deferred: "Mission-planning and threat-data changes cannot be fielded on the intended schedule.", impact: "Modifies shared runtime configuration at the Mission Systems Squadron.", knockOn: "Enables DEMO-MCP-061 and DEMO-DSOR-062; shifts integration-test sequencing.", authority: "Synthetic Configuration Steering Board", rationale: "Funded as the prerequisite with the widest downstream dependency chain." },
    { id: "demo-change-mps", type: "cr-type-mcp", externalId: "DEMO-MCP-061", title: "Mission Planning Service relocation and capacity uplift", priority: "high", decision: "pending", releaseId: r6, summary: "Decide whether to fund the move and capacity increase represented in the proposed Release 6 baseline.", funded: "Mission planners receive the intended capacity and new compute position for Release 6.", deferred: "The service remains on the Release 5 host with lower memory and CPU headroom.", impact: "Moves Mission Planning Service and increases storage, CPU, and memory.", knockOn: "Consumes integration capacity and depends on shared platform hardening.", authority: null, rationale: null },
    { id: "demo-change-tls", type: "cr-type-dsor", externalId: "DEMO-DSOR-062", title: "Threat data resilience and Release 7 relocation", priority: "critical", decision: "pending", releaseId: r7, summary: "Prioritize the threat-data scale and relocation needed for the proposed Release 7 topology.", funded: "Improves threat-library capacity and relocates the service to its planned endpoint.", deferred: "Threat refresh latency and single-position operational risk remain.", impact: "Modifies capacity in Release 6, then moves the deployment in Release 7.", knockOn: "Requires shared platform hardening and affects downstream mission-planning data availability.", authority: null, rationale: null },
    { id: "demo-change-eis", type: "cr-type-mcp", externalId: "DEMO-MCP-071", title: "Introduce Execution Insights Service", priority: "medium", decision: "fund", releaseId: r7, summary: "Add the analytics service used to build the leadership WHAT/WHERE/WHEN view.", funded: "Provides deterministic execution analytics for Release 7 leadership reporting.", deferred: "Leadership reporting continues to depend on manual spreadsheet consolidation.", impact: "Adds a product, workload, and endpoint in Release 7.", knockOn: "Adds data-load and support demand to the Operations Squadron.", authority: "Synthetic Program Colonel", rationale: "Funded because it removes recurring manual reporting effort and has bounded technical impact." },
    { id: "demo-change-gateway", type: "cr-type-dsor", externalId: "DEMO-DSOR-072", title: "Retire legacy Data Gateway position", priority: "high", decision: "defer", releaseId: r7, summary: "Decide when to remove the Data Gateway after dependent interchange functions transition.", funded: "Retires the legacy position and reduces duplicated integration support.", deferred: "Continues dual support and licensing but avoids premature loss of partner interchange.", impact: "Removes Data Gateway from the Release 7 baseline.", knockOn: "Must follow Integration Orchestrator validation and partner certification evidence.", authority: "Synthetic Configuration Steering Board", rationale: "Deferred until the partner certification dependency is confirmed." },
    { id: "demo-change-java-inventory", type: "cr-type-mcp", externalId: "DEMO-MCP-081", title: "Establish the authoritative Java runtime and SBOM inventory", priority: "critical", decision: "fund", releaseId: r6, summary: "Create an evidence-backed inventory of Java runtime versions, product owners, fielded locations, and software bills of materials before selecting upgrade scope.", funded: "Produces the authoritative as-is evidence needed to bound engineering and funding.", deferred: "Unsupported Java 8 exposure and estimate uncertainty continue because product claims cannot be reconciled to fielded installations.", impact: "Assesses Mission Planning Service, Threat Library Service, their Release 6 occurrences, and the two supporting PMA endpoints.", knockOn: "Enables upgrade scoping; SBOM gaps become explicit Government risks rather than undocumented assumptions.", authority: "Synthetic Program Colonel", rationale: "Funded as the evidence prerequisite; no upgrade estimate is treated as credible without an installation-level inventory." },
    { id: "demo-change-java-upgrade", type: "cr-type-mcp", externalId: "DEMO-MCP-082", title: "Remove Java 8 from mission applications", priority: "critical", decision: "pending", releaseId: r7, summary: "Upgrade governed mission application runtimes from Java 8 to the program-approved supported LTS runtime and remediate affected interfaces.", funded: "Removes the unsupported runtime from in-scope Release 7 deployments while retaining a reversible fielding plan.", deferred: "Cyber exposure, sustainment cost, and vendor support risk remain; Release 7 inherits an unsupported runtime dependency.", impact: "Modifies Mission Planning Service and Threat Library Service runtime profiles and requires interface/regression analysis.", knockOn: "Changes build pipelines, container base images, logging agents, PKI libraries, regression scope, technical publications, training, and deployment sequencing.", authority: null, rationale: null },
    { id: "demo-change-java-acceptance", type: "cr-type-dsor", externalId: "DEMO-DSOR-083", title: "Verify Java modernization mission and system acceptance", priority: "high", decision: "pending", releaseId: r7, summary: "Fund the mission-thread, system regression, cyber scan, SBOM, and fielding evidence required to accept the Java runtime change.", funded: "Provides Tier 3 and Tier 4 acceptance evidence and accountable Government sign-off before fielding.", deferred: "The runtime may be technically changed but cannot be credibly accepted or fielded as a governed baseline.", impact: "Verifies mission planning performance, threat-data interoperability, cyber posture, rollback, and configuration evidence.", knockOn: "Consumes test range capacity and mission-operator availability; failure delays Release 7 fielding.", authority: null, rationale: null },
  ] as const;
  for (const change of changePlan) statements.push(db.prepare("INSERT INTO change_request (id,program_id,type_id,external_system,external_identifier,title,external_status,external_owner,source_locator,source_as_of,requested_release_id,government_priority,decision_status,decision_authority,decision_at,decision_by_user_id,decision_rationale,summary,consequence_if_funded,consequence_if_deferred,impact_summary,knock_on_effects,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET requested_release_id=excluded.requested_release_id,government_priority=excluded.government_priority,decision_status=excluded.decision_status,decision_authority=excluded.decision_authority,decision_at=excluded.decision_at,decision_by_user_id=excluded.decision_by_user_id,decision_rationale=excluded.decision_rationale,summary=excluded.summary,consequence_if_funded=excluded.consequence_if_funded,consequence_if_deferred=excluded.consequence_if_deferred,impact_summary=excluded.impact_summary,knock_on_effects=excluded.knock_on_effects,updated_at=excluded.updated_at")
    .bind(change.id, PROGRAM_ID, change.type, "Synthetic incumbent change system", change.externalId, change.title, change.decision === "pending" ? "In Government review" : "Government decision recorded", "Synthetic incumbent product team", `DEMO://${change.externalId}`, "2026-08-18", change.releaseId, change.priority, change.decision, change.authority, change.decision === "pending" ? null : at, change.decision === "pending" ? null : actor.id, change.rationale, change.summary, change.funded, change.deferred, change.impact, change.knockOn, actor.id, at, at));
  for (const change of changePlan) statements.push(db.prepare("DELETE FROM change_effect WHERE change_request_id=?").bind(change.id));
  statements.push(db.prepare("DELETE FROM change_dependency WHERE predecessor_request_id LIKE 'demo-change-%' OR successor_request_id LIKE 'demo-change-%'"));

  const effectPlan = [
    ["demo-change-hardening", "platform", "demo-platform-obk-va", "modify", "security posture", r5, r6, "Legacy shared runtime", "Hardened runtime and certificates", "Dependent services gain an approved hardened landing zone."],
    ["demo-change-mps", "product", rows.find((row) => row.sourceKey === "DEMO-R6-001")?.productId, "modify", "capacity", r5, r6, "180 GB / 8 CPU / 32 GB RAM", "240 GB / 12 CPU / 48 GB RAM", "Increases capacity for Release 6 mission-planning demand."],
    ["demo-change-mps", "platform", "demo-platform-pma-mps", "move", "deployment position", r5, r6, "Release 5 host", "PMA-PLN-01", "Relocates the service to the planned mission-planning endpoint."],
    ["demo-change-tls", "product", rows.find((row) => row.sourceKey === "DEMO-R7-002")?.productId, "modify", "resilience and capacity", r6, r7, "Release 6 reported position", "Release 7 relocated position", "Improves capacity and changes the service deployment position."],
    ["demo-change-tls", "platform", "demo-platform-pma-tls", "move", "fielding", r6, r7, "Prior compute position", "PMA-THR-02", "Changes where the threat-data workload is fielded."],
    ["demo-change-eis", "product", rows.find((row) => row.sourceKey === "DEMO-R7-006")?.productId, "add", "application service", r6, r7, null, "Execution Insights Service", "Adds the Release 7 analytics capability."],
    ["demo-change-eis", "platform", "demo-platform-pma-eis", "add", "fielding", r6, r7, null, "PMA-ANA-06", "Adds an Operations Squadron analytics endpoint."],
    ["demo-change-gateway", "product", rows.find((row) => row.sourceKey === "DEMO-R6-003")?.productId, "remove", "deployment presence", r6, r7, "Data Gateway present", "Not present", "Retires the legacy interchange product after validation."],
    ["demo-change-gateway", "platform", "demo-platform-obk-uk", "assess", "partner certification", r6, r7, "Certification incomplete", "Certification confirmed", "Protects partner interchange before removal."],
    ["demo-change-java-inventory", "product", rows.find((row) => row.sourceKey === "DEMO-R6-001")?.productId, "assess", "runtime and SBOM evidence", r6, r6, "Java family reported; runtime version not governed in the A2O Tech Stack", "Installation-level Java runtime and signed SBOM inventory", "Bounds the affected product and installation population before funding the upgrade."],
    ["demo-change-java-inventory", "product", rows.find((row) => row.sourceKey === "DEMO-R6-002")?.productId, "assess", "runtime and SBOM evidence", r6, r6, "Java family reported; runtime version not governed in the A2O Tech Stack", "Installation-level Java runtime and signed SBOM inventory", "Makes the Java 8 claim inspectable without altering the retained spreadsheet contract."],
    ["demo-change-java-upgrade", "product", rows.find((row) => row.sourceKey === "DEMO-R7-001")?.productId, "modify", "application runtime", r6, r7, "Java 8 runtime (synthetic governed assessment)", "Program-approved supported Java LTS", "Removes unsupported runtime exposure from Mission Planning Service."],
    ["demo-change-java-upgrade", "product", rows.find((row) => row.sourceKey === "DEMO-R7-002")?.productId, "modify", "application runtime", r6, r7, "Java 8 runtime (synthetic governed assessment)", "Program-approved supported Java LTS", "Removes unsupported runtime exposure from Threat Library Service."],
    ["demo-change-java-acceptance", "platform", "demo-platform-obk-va", "assess", "mission and system acceptance", r6, r7, "Acceptance evidence incomplete", "Tier 3 and Tier 4 evidence accepted", "Prevents a technically changed runtime from being fielded without mission and system evidence."],
  ] as const;
  let effectIndex = 0;
  for (const effect of effectPlan) if (effect[2]) statements.push(db.prepare("INSERT INTO change_effect (id,change_request_id,subject_kind,subject_id,action,aspect,from_release_id,to_release_id,current_value,target_value,consequence,rationale,confidence,source_occurrence_id,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(`demo-effect-${++effectIndex}`, effect[0], effect[1], effect[2], effect[3], effect[4], effect[5], effect[6], effect[7], effect[8], effect[9], "Synthetic impact assessment for smoke testing.", "assessed", null, actor.id, at, at));

  for (const dependency of [
    ["demo-dependency-hardening-mps", "demo-change-hardening", "demo-change-mps", "enables", "Hardened shared platform enables the relocation."],
    ["demo-dependency-hardening-tls", "demo-change-hardening", "demo-change-tls", "requires", "Threat-data relocation requires the hardened platform."],
    ["demo-dependency-tls-eis", "demo-change-tls", "demo-change-eis", "enables", "Resilient threat data improves analytics completeness."],
    ["demo-dependency-eis-gateway", "demo-change-eis", "demo-change-gateway", "requires", "Leadership analytics validates the target interchange state before retirement."],
    ["demo-dependency-java-inventory-upgrade", "demo-change-java-inventory", "demo-change-java-upgrade", "enables", "Authoritative inventory and SBOM evidence bound the Java upgrade scope and estimate."],
    ["demo-dependency-java-upgrade-acceptance", "demo-change-java-upgrade", "demo-change-java-acceptance", "enables", "The upgraded build must be available before mission and system acceptance can complete."],
  ] as const) statements.push(db.prepare("INSERT INTO change_dependency (id,predecessor_request_id,successor_request_id,dependency_type,rationale,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .bind(dependency[0], dependency[1], dependency[2], dependency[3], dependency[4], at, at));

  // A single deep Initiative scenario exercises the entire decision chain:
  // leadership outcome → Government funding units → incumbent technical work
  // → requirement trace → acceptance evidence and sign-off. Every claim is
  // synthetic and source-labelled so it cannot be mistaken for program fact.
  const javaInitiativeId = "demo-initiative-java8";
  const javaObjectiveIds = ["demo-objective-java-inventory", "demo-objective-java-upgrade", "demo-objective-java-acceptance"];
  statements.push(db.prepare("DELETE FROM acceptance_signoff WHERE criterion_id IN (SELECT id FROM acceptance_criterion WHERE objective_id IN (?,?,?))").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM acceptance_criterion WHERE objective_id IN (?,?,?)").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM requirement_trace WHERE objective_id IN (?,?,?)").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM objective_estimate WHERE objective_id IN (?,?,?)").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM initiative_milestone WHERE initiative_id=?").bind(javaInitiativeId));
  statements.push(db.prepare("DELETE FROM incumbent_objective WHERE id IN (?,?,?)").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM initiative_change_request WHERE initiative_id=?").bind(javaInitiativeId));
  statements.push(db.prepare("DELETE FROM work_package WHERE initiative_id=?").bind(javaInitiativeId));
  statements.push(db.prepare("DELETE FROM initiative_scope WHERE initiative_id=?").bind(javaInitiativeId));
  statements.push(db.prepare("INSERT INTO initiative (id,program_id,primary_release_id,title,normalized_title,status,priority,owner,target_date,consequence,desired_outcome,decision_ask,as_is_statement,to_be_statement,success_measures,briefing_audience,decision_needed_by,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET primary_release_id=excluded.primary_release_id,title=excluded.title,normalized_title=excluded.normalized_title,status=excluded.status,priority=excluded.priority,owner=excluded.owner,target_date=excluded.target_date,consequence=excluded.consequence,desired_outcome=excluded.desired_outcome,decision_ask=excluded.decision_ask,as_is_statement=excluded.as_is_statement,to_be_statement=excluded.to_be_statement,success_measures=excluded.success_measures,briefing_audience=excluded.briefing_audience,decision_needed_by=excluded.decision_needed_by,updated_at=excluded.updated_at")
    .bind(javaInitiativeId, PROGRAM_ID, r7, "Eliminate Java 8 from mission applications", "eliminate java 8 from mission applications", "decision_required", "critical", "Government Mission Systems Architecture (synthetic)", "2027-06-30", "If the decision is deferred, Release 7 carries unsupported-runtime cyber and sustainment risk; SBOM uncertainty and vendor-support exposure continue across fielded installations.", "Field Release 7 with no in-scope Java 8 runtime, accepted mission behavior, signed configuration evidence, and a governed rollback path.", "Fund DEMO-MCP-082 and DEMO-DSOR-083 subject to an independently bounded estimate, reconciled requirement changes, and named Tier 3/Tier 4 acceptance authorities.", "The A2O Tech Stack reports Java as a language but does not govern runtime version. A synthetic SBOM/runtime assessment identifies Java 8 exposure in Mission Planning Service and Threat Library Service across two Release 6 positions; the incumbent estimate is materially higher than the Government assessment and one interface requirement remains unresolved.", "Release 7 uses the program-approved supported Java LTS runtime for both products, retains verified mission performance and threat-data interoperability, publishes signed SBOMs, and has accepted Tier 3 mission and Tier 4 system evidence before fielding.", "Zero in-scope Java 8 runtime findings; 100% signed SBOM coverage; all linked requirements traced; all required Tier 3/Tier 4 criteria accepted; rollback exercised; no unresolved Severity 1 or 2 regressions.", "Colonel Scott · synthetic demonstration", "2026-09-15", actor.id, at, at));
  const javaProducts = Array.from(new Set([rows.find((row) => row.sourceKey === "DEMO-R6-001")?.productId, rows.find((row) => row.sourceKey === "DEMO-R6-002")?.productId].filter(Boolean))) as string[];
  for (const [index, productId] of javaProducts.entries()) statements.push(db.prepare("INSERT INTO initiative_scope (id,initiative_id,scope_kind,scope_id,display_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(`demo-java-scope-${index + 1}`, javaInitiativeId, "product", productId, rows.find((row) => row.productId === productId)?.shortName || "Synthetic Java product", at, at));
  for (const [index, link] of [
    ["demo-change-java-inventory", "enables", "Establishes the authoritative product, installation, runtime, and SBOM evidence used to bound the funding decision."],
    ["demo-change-java-upgrade", "delivers", "Performs the runtime, library, build-pipeline, interface, and deployment changes that remove Java 8."],
    ["demo-change-java-acceptance", "delivers", "Produces and signs the mission, system, cyber, configuration, and rollback evidence required for fielding."],
  ].entries()) statements.push(db.prepare("INSERT INTO initiative_change_request (id,initiative_id,change_request_id,relationship,contribution_summary,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(`demo-java-link-${index + 1}`, javaInitiativeId, link[0], link[1], link[2], index, at, at));
  const objectivePlan = [
    { id: javaObjectiveIds[0], requestId: "demo-change-java-inventory", externalId: "DEMO-OBJ-J8-01", title: "Reconcile Java runtime and SBOM inventory", summary: "Identify every in-scope product, runtime distribution, transitive native dependency, container/base image, installation, owner, and authoritative SBOM gap.", owner: "Incumbent Configuration Management Team (synthetic)", status: "complete", start: "2026-07-01", finish: "2026-08-21", actualStart: "2026-07-03", actualFinish: "2026-08-18", source: "DEMO://OBJECTIVES/J8-01" },
    { id: javaObjectiveIds[1], requestId: "demo-change-java-upgrade", externalId: "DEMO-OBJ-J8-02", title: "Upgrade runtime, libraries, and build chain", summary: "Rebuild the two mission applications on the supported Java LTS, remediate compatibility findings, update container/base images and deployment automation, and preserve rollback.", owner: "Incumbent Mission Applications IPT (synthetic)", status: "planned", start: "2026-10-01", finish: "2027-02-26", actualStart: null, actualFinish: null, source: "DEMO://OBJECTIVES/J8-02" },
    { id: javaObjectiveIds[2], requestId: "demo-change-java-acceptance", externalId: "DEMO-OBJ-J8-03", title: "Verify mission, system, cyber, and fielding acceptance", summary: "Execute traceable mission-thread and system tests, scan the deliverable, reconcile signed SBOMs, exercise rollback, and obtain named Government acceptance decisions.", owner: "Joint Test and Government Acceptance Team (synthetic)", status: "proposed", start: "2027-03-01", finish: "2027-05-28", actualStart: null, actualFinish: null, source: "DEMO://OBJECTIVES/J8-03" },
  ] as const;
  for (const objective of objectivePlan) statements.push(db.prepare("INSERT INTO incumbent_objective (id,program_id,change_request_id,external_system,external_identifier,title,summary,technical_owner,status,planned_start,planned_finish,actual_start,actual_finish,source_locator,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(objective.id, PROGRAM_ID, objective.requestId, "Synthetic incumbent objective register", objective.externalId, objective.title, objective.summary, objective.owner, objective.status, objective.start, objective.finish, objective.actualStart, objective.actualFinish, objective.source, "2026-08-18", actor.id, at, at));
  const estimates = [
    ["demo-estimate-inventory-inc", javaObjectiveIds[0], "incumbent", 3600, 4800, 6400, 900000, 1200000, 1700000, "Synthetic incumbent bottom-up work-package rollup across discovery, SBOM generation, and installation reconciliation.", "Assumes source repositories and installation inventories are accessible; excludes remediation.", "DEMO://ESTIMATES/J8-01/INC", "2026-07-08", "medium"],
    ["demo-estimate-inventory-gov", javaObjectiveIds[0], "government", 1100, 1600, 2400, 300000, 480000, 750000, "Synthetic Government parametric assessment using two-product scan, repository, and six-installation sample evidence.", "Assumes reusable automated inventory tooling and no air-gap transfer delay.", "DEMO://ESTIMATES/J8-01/GOV", "2026-07-15", "medium"],
    ["demo-estimate-upgrade-inc", javaObjectiveIds[1], "incumbent", 82000, 104000, 128000, 22000000, 28600000, 36000000, "Synthetic incumbent engineering estimate covering code remediation, infrastructure, integration, regression, documentation, and program support.", "Includes broad shared-service contingency; detailed basis remains under Government challenge.", "DEMO://ESTIMATES/J8-02/INC", "2026-08-10", "low"],
    ["demo-estimate-upgrade-gov", javaObjectiveIds[1], "government", 18000, 26000, 39000, 5800000, 8500000, 13200000, "Synthetic independent Government reference-class estimate using product size bands, interface count, and prior runtime modernization actuals.", "Excludes mission acceptance executed under DEMO-OBJ-J8-03; includes 30% uncertainty for undocumented native dependencies.", "DEMO://ESTIMATES/J8-02/GOV", "2026-08-16", "medium"],
    ["demo-estimate-acceptance-inc", javaObjectiveIds[2], "incumbent", 12000, 18000, 26000, 3400000, 5100000, 7600000, "Synthetic incumbent test-range, operator, cyber, configuration, and fielding support estimate.", "Assumes one full regression cycle and one rollback rehearsal.", "DEMO://ESTIMATES/J8-03/INC", "2026-08-12", "low"],
  ] as const;
  for (const estimate of estimates) statements.push(db.prepare("INSERT INTO objective_estimate (id,objective_id,estimate_source,hours_low,hours_likely,hours_high,cost_low,cost_likely,cost_high,basis,assumptions,source_reference,as_of,confidence,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...estimate, actor.id, at, at));
  const requirementPlan = [
    ["demo-requirement-sbom", javaObjectiveIds[0], "DEMO-REQ-CM-031", "Deliver signed installation-level SBOM", "Synthetic authoritative requirements repository", "DEMO://REQUIREMENTS/CM-031", "2026-08-18", "add", null, "The supplier shall deliver a signed machine-readable SBOM for each fielded application build and identify the deployed runtime distribution and version.", "Closes the current evidence gap between repository components and fielded installation state.", "verified"],
    ["demo-requirement-runtime", javaObjectiveIds[1], "DEMO-REQ-CYB-104", "Use a supported application runtime", "Synthetic authoritative requirements repository", "DEMO://REQUIREMENTS/CYB-104", "2026-08-18", "modify", "Mission applications shall use an approved Java runtime.", "Mission applications shall use a program-approved, vendor-supported Java LTS runtime with no Java 8 executable runtime present in the fielded build.", "Makes support status and the Java 8 exit condition objectively verifiable.", "traced"],
    ["demo-requirement-mission", javaObjectiveIds[2], "DEMO-REQ-MIS-220", "Preserve mission-planning thread performance", "Synthetic authoritative requirements repository", "DEMO://REQUIREMENTS/MIS-220", "2026-08-18", "verify", "The mission-planning thread shall complete within the approved performance envelope.", "The mission-planning thread shall complete within the approved performance envelope on the modernized runtime under the representative Release 7 load profile.", "Verifies the runtime change does not degrade mission behavior.", "traced"],
    ["demo-requirement-interface", javaObjectiveIds[1], "DEMO-REQ-INT-118", "Threat-data interface compatibility", "Synthetic authoritative requirements repository", "DEMO://REQUIREMENTS/INT-118", "2026-08-18", "modify", "Threat data shall be available to mission planning.", "Interface timing, error handling, and compatibility text is awaiting requirements authority reconciliation.", "The current requirement is not specific enough to support acceptance after library and runtime changes.", "analysis_needed"],
  ] as const;
  for (const requirement of requirementPlan) statements.push(db.prepare("INSERT INTO requirement_trace (id,objective_id,external_identifier,title,source_system,source_locator,source_as_of,change_action,before_text,after_text,rationale,trace_status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...requirement, actor.id, at, at));
  const criterionPlan = [
    ["demo-criterion-sbom", javaObjectiveIds[0], "demo-requirement-sbom", "tier_4", "DEMO-T4-CM-01", "Every in-scope fielded build has a signed machine-readable SBOM that identifies its runtime distribution and version.", "inspection", "passed", "2026-08-18", "2026-08-18", "DEMO://EVIDENCE/SBOM-INVENTORY-2026-08-18"],
    ["demo-criterion-runtime", javaObjectiveIds[1], "demo-requirement-runtime", "tier_4", "DEMO-T4-CYB-02", "Automated scan and installation inspection find no executable Java 8 runtime in either in-scope Release 7 product deployment.", "test", "ready", "2027-02-26", null, null],
    ["demo-criterion-mission", javaObjectiveIds[2], "demo-requirement-mission", "tier_3", "DEMO-T3-MIS-01", "Representative mission planning completes the approved mission thread within its governed performance envelope using Release 7 threat data.", "demonstration", "draft", "2027-04-16", null, null],
    ["demo-criterion-regression", javaObjectiveIds[2], null, "tier_4", "DEMO-T4-SYS-03", "The Release 7 regression suite completes with no unresolved Severity 1 or Severity 2 defect attributable to the runtime modernization.", "test", "draft", "2027-04-30", null, null],
    ["demo-criterion-rollback", javaObjectiveIds[2], null, "tier_4", "DEMO-T4-FLD-04", "The fielding team restores the approved prior baseline within the governed rollback window using the signed deployment package.", "demonstration", "draft", "2027-05-14", null, null],
  ] as const;
  for (const criterion of criterionPlan) statements.push(db.prepare("INSERT INTO acceptance_criterion (id,objective_id,requirement_trace_id,tier,code,statement,verification_method,status,planned_date,actual_date,evidence_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...criterion, actor.id, at, at));
  for (const signoff of [
    ["demo-signoff-sbom", "demo-criterion-sbom", "Government configuration management authority", "Synthetic CM authority", "accepted", "2026-08-18", "Accepted for demonstration after matching signed SBOM identifiers to the synthetic installation inventory.", null],
    ["demo-signoff-mission", "demo-criterion-mission", "Government mission acceptance authority", null, "pending", null, null, null],
    ["demo-signoff-system", "demo-criterion-regression", "Government system acceptance authority", null, "pending", null, null, null],
  ] as const) statements.push(db.prepare("INSERT INTO acceptance_signoff (id,criterion_id,signoff_role,signer,decision,decided_at,rationale,evidence_document_id,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...signoff, actor.id, at, at));
  const milestonePlan = [
    ["demo-milestone-java-inventory", "demo-change-java-inventory", javaObjectiveIds[0], "Authoritative Java/SBOM inventory accepted", "delivery", "2026-08-18", "2026-08-18", "complete", "Upgrade scope and estimate remain unbounded.", "Government configuration management authority"],
    ["demo-milestone-java-decision", "demo-change-java-upgrade", null, "Colonel funding decision", "decision", "2026-09-15", null, "planned", "Release 7 build start slips and unsupported-runtime exposure carries forward.", "Colonel Scott · synthetic demonstration"],
    ["demo-milestone-java-req", "demo-change-java-upgrade", javaObjectiveIds[1], "Interface requirement reconciled", "dependency", "2026-09-30", null, "at_risk", "The incumbent cannot baseline compatibility work or produce an acceptance-ready interface test.", "Government requirements authority"],
    ["demo-milestone-java-build", "demo-change-java-upgrade", javaObjectiveIds[1], "Modernized build ready for integration", "delivery", "2027-02-26", null, "planned", "Mission and system acceptance cannot enter the range.", "Incumbent Mission Applications IPT"],
    ["demo-milestone-java-t3", "demo-change-java-acceptance", javaObjectiveIds[2], "Tier 3 mission acceptance decision", "verification", "2027-04-16", null, "planned", "Mission suitability remains unproven and fielding cannot be recommended.", "Government mission acceptance authority"],
    ["demo-milestone-java-t4", "demo-change-java-acceptance", javaObjectiveIds[2], "Tier 4 system acceptance decision", "verification", "2027-05-14", null, "planned", "System, cyber, rollback, and configuration readiness remain unaccepted.", "Government system acceptance authority"],
    ["demo-milestone-java-fielding", "demo-change-java-acceptance", javaObjectiveIds[2], "Release 7 fielding recommendation", "fielding", "2027-05-28", null, "planned", "Deployment moves to the next governed window and Java 8 remains in the as-is baseline.", "Government fielding authority"],
  ] as const;
  for (const [index, milestone] of milestonePlan.entries()) statements.push(db.prepare("INSERT INTO initiative_milestone (id,initiative_id,change_request_id,objective_id,title,milestone_type,planned_date,actual_date,status,consequence_if_missed,owner,sort_order,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(milestone[0], javaInitiativeId, ...milestone.slice(1), index, actor.id, at, at));
  for (const [index, work] of [
    ["J8-WP-01", "Challenge incumbent estimate basis and reconcile reference-class actuals", "Government cost / engineering analysis", "2026-09-05", "in_progress", "Publish a documented low/likely/high Government assessment and list unresolved assumptions."],
    ["J8-WP-02", "Reconcile DEMO-REQ-INT-118 with requirements authority", "Government requirements lead", "2026-09-30", "on_hold", "Obtain authoritative interface text and map it to verification evidence."],
    ["J8-WP-03", "Name Tier 3 and Tier 4 acceptance authorities", "Government test and evaluation lead", "2026-09-15", "planned", "Confirm accountable roles and required evidence before funding the acceptance request."],
    ["J8-WP-04", "Prepare Colonel decision brief and funding recommendation", "Government baseline steward", "2026-09-12", "in_progress", "Present as-is/to-be, options, estimate variance, consequences, dependencies, and explicit decision ask."],
  ].entries()) statements.push(db.prepare("INSERT INTO work_package (id,initiative_id,parent_id,wbs_code,title,owner,due_date,status,notes,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(`demo-java-wbs-${index + 1}`, javaInitiativeId, null, work[0], work[1], work[2], work[3], work[4], work[5], index, at, at));

  statements.push(audit(db, actor, "demonstration_workspace_enriched", "baseline_workspace", WORKSPACE_ID, { occurrences: rows.length, managedTopology: true, rationaleRecords: rationaleRecordCount, platforms: platformPlan.length, changeRequests: changePlan.length, initiatives: 1, objectives: objectivePlan.length, requirements: requirementPlan.length, acceptanceCriteria: criterionPlan.length }));
  await db.batch(statements);
  return { occurrences: rows.length, hostProfiles: seenHosts.size, deploymentProfiles: rows.filter((row) => row.productId).length, rationaleRecords: rationaleRecordCount, platforms: platformPlan.length, changeRequests: changePlan.length };
}
