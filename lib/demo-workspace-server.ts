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
  recordType: "technical_note" | "technical_call" | "decision";
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
    id: "demo-record-mcp-r6-mps", externalReference: "DEMO-ANALYSIS-MCP-061", recordType: "technical_note", title: "Mission Planning Service relocation assessment", status: "in_review", occurredAt: "2026-04-15",
    summary: "Synthetic contractor assessment supporting DEMO-MCP-061. The Change Request remains the authoritative external work reference.", decisionAsk: "Confirm the assessed Release 6 deployment consequence.", impact: "Moves the service and changes its reported storage, CPU, and memory values.", sourceKey: "DEMO-R6-001",
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
      COALESCE(ext.source_key,sr.source_key) AS source_key,p.short_name,bds.containerized,r.name AS release_name,n.name AS host_name,
      (SELECT ps.organization_id FROM product_supplier ps WHERE ps.product_id=p.id AND ps.supplier_role='supplier' ORDER BY ps.organization_id LIMIT 1) AS supplier_organization_id
    FROM baseline_occurrence bo
    LEFT JOIN baseline_record_extension ext ON ext.baseline_occurrence_id=bo.id
    LEFT JOIN source_row_24 sr ON sr.id=bo.source_row_id
    JOIN release r ON r.id=bo.release_id
    JOIN configuration_node n ON n.id=bo.configuration_node_id
    LEFT JOIN product p ON p.id=bo.product_id
    LEFT JOIN baseline_deployment_state bds ON bds.baseline_id=bo.baseline_id AND bds.deployment_id=bo.deployment_id
    WHERE bo.program_id=? AND bo.workspace_id=? AND bo.lifecycle_status='active'
    ORDER BY sr.row_number ASC
  `).bind(PROGRAM_ID, WORKSPACE_ID).all<{
    occurrence_id: string; release_id: string; configuration_node_id: string; product_id: string | null;
    source_key: string | null; short_name: string | null; containerized: string | null; release_name: string; host_name: string; supplier_organization_id: string | null;
  }>();

  const rows: DemoOccurrence[] = occurrences.results.map((row) => ({
    occurrenceId: row.occurrence_id, releaseId: row.release_id, configurationNodeId: row.configuration_node_id, productId: row.product_id, organizationId: row.supplier_organization_id,
    sourceKey: row.source_key || "", shortName: row.short_name, containerized: row.containerized, releaseName: row.release_name, hostName: row.host_name,
  }));
  if (!rows.length || rows.some((row) => !row.sourceKey.startsWith(DEMO_PREFIX))) {
    throw new Error("Load the synthetic demonstration baseline before adding its managed details.");
  }
  const isDemoPackage = await db.prepare("SELECT COUNT(*) AS count FROM source_package WHERE file_name=? AND program_id=?").bind(DEMO_FILE_NAME, PROGRAM_ID).first<{ count: number }>();
  if (!Number(isDemoPackage?.count)) throw new Error("The active workspace is not the synthetic demonstration baseline.");

  const at = now();
  // Demonstration enrichment is intentionally repeatable. Several governed
  // graphs are replaced in one D1 batch; defer FK evaluation until the batch
  // has restored every child and parent so a previously enriched workspace
  // can be refreshed without temporarily violating an immediate constraint.
  const statements: D1PreparedStatement[] = [db.prepare("PRAGMA defer_foreign_keys=ON")];
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
    if (anchor) statements.push(db.prepare("INSERT INTO platform_baseline_assignment (id,program_id,platform_id,baseline_occurrence_id,release_id,assignment_role,confidence,review_status,source_reference,source_as_of,reviewed_by_user_id,reviewed_at,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_occurrence_id,assignment_role) DO UPDATE SET platform_id=excluded.platform_id,release_id=excluded.release_id,confidence=excluded.confidence,review_status=excluded.review_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,reviewed_by_user_id=excluded.reviewed_by_user_id,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at")
      .bind(`demo-platform-assignment-${platform.id}-${anchor.occurrenceId}`, PROGRAM_ID, platform.id, anchor.occurrenceId, anchor.releaseId, "primary", "confirmed", "reviewed", "Synthetic demonstration assignment", "2026-08-18", actor.id, at, actor.id, at, at));
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

  // Governed infrastructure demonstration.  Identities persist across the
  // three Releases; parent placement, capacity, connections, and installed
  // Product versions are recorded per Release.  The same Windows Server
  // Product is deliberately installed once on bare metal and again on VMs.
  const infrastructureManufacturers = [
    ["demo-org-apc", "APC by Schneider Electric", "supplier"],
    ["demo-org-cisco", "Cisco Systems", "supplier"],
    ["demo-org-dell", "Dell Technologies", "supplier"],
  ] as const;
  for (const organization of infrastructureManufacturers) statements.push(db.prepare("INSERT INTO organization (id,program_id,name,normalized_name,organization_type,description,lifecycle_status,source_reference,source_as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,organization_type=excluded.organization_type,description=excluded.description,lifecycle_status=excluded.lifecycle_status,updated_at=excluded.updated_at")
    .bind(organization[0], PROGRAM_ID, organization[1], organization[1].toLowerCase(), organization[2], "Synthetic manufacturer Organization used by the governed infrastructure demonstration.", "active", "DEMO://INFRASTRUCTURE/MANUFACTURER", "2026-08-22", at, at));

  const infrastructureProducts = [
    ["demo-product-windows-server-2019", "Windows Server 2019", "WS2019", "Operating system", "COTS"],
    ["demo-product-windows-11-enterprise", "Windows 11 Enterprise", "Windows 11", "Operating system", "COTS"],
    ["demo-product-rhel-9", "Red Hat Enterprise Linux 9", "RHEL9", "Operating system", "COTS"],
    ["demo-product-vsphere-8", "VMware vSphere Hypervisor 8", "vSphere 8", "Hypervisor", "COTS"],
    ["demo-product-smart-ups-srt", "APC Smart-UPS SRT", "Smart-UPS SRT", "Hardware model", "COTS"],
    ["demo-product-catalyst-9300", "Cisco Catalyst 9300", "Catalyst 9300", "Hardware model", "COTS"],
    ["demo-product-poweredge-mx7000", "Dell PowerEdge MX7000", "PowerEdge MX7000", "Hardware model", "COTS"],
    ["demo-product-poweredge-mx740c", "Dell PowerEdge MX740c", "PowerEdge MX740c", "Hardware model", "COTS"],
    ["demo-product-latitude-5430-rugged", "Dell Latitude 5430 Rugged", "Latitude 5430", "Hardware model", "COTS"],
  ] as const;
  for (const product of infrastructureProducts) statements.push(db.prepare("INSERT INTO product (id,program_id,canonical_name,normalized_name,short_name,product_type,software_classification,owner_organization_id,description,lifecycle_status,source_reference,source_as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name,normalized_name=excluded.normalized_name,short_name=excluded.short_name,product_type=excluded.product_type,software_classification=excluded.software_classification,description=excluded.description,lifecycle_status=excluded.lifecycle_status,updated_at=excluded.updated_at")
    .bind(product[0], PROGRAM_ID, product[1], product[1].toLowerCase(), product[2], product[3], product[4], null, "Synthetic catalog Product used by the governed infrastructure demonstration.", "active", "DEMO://INFRASTRUCTURE/CATALOG", "2026-08-22", at, at));

  const infrastructureNodes = [
    ["demo-infra-ups-va", "demo-platform-obk-va", "ups", "UPS-VA-01", "Mission systems UPS", "demo-org-apc", "demo-product-smart-ups-srt"],
    ["demo-infra-switch-va", "demo-platform-obk-va", "network_switch", "SW-VA-CORE-01", "Mission systems core switch", "demo-org-cisco", "demo-product-catalyst-9300"],
    ["demo-infra-chassis-va", "demo-platform-obk-va", "chassis", "CH-VA-01", "Mission systems compute chassis", "demo-org-dell", "demo-product-poweredge-mx7000"],
    ["demo-infra-blade-baremetal", "demo-platform-obk-va", "blade", "BLD-VA-01", "Bare-metal services blade", "demo-org-dell", "demo-product-poweredge-mx740c"],
    ["demo-infra-blade-virtual", "demo-platform-obk-va", "blade", "BLD-VA-02", "Virtual services blade", "demo-org-dell", "demo-product-poweredge-mx740c"],
    ["demo-infra-vm-mps", "demo-platform-obk-va", "virtual_machine", "VM-MPS", "Mission Planning Service VM", null, null],
    ["demo-infra-vm-tls", "demo-platform-obk-va", "virtual_machine", "VM-TLS", "Threat Library Service VM", null, null],
    ["demo-infra-drive-mps", "demo-platform-obk-va", "logical_drive", "DRV-MPS-D", "Mission Planning data drive", null, null],
    ["demo-infra-drive-tls", "demo-platform-obk-va", "logical_drive", "DRV-TLS-D", "Threat Library data drive", null, null],
    ["demo-infra-pma-mps", "demo-platform-pma-mps", "physical_server", "PMA-PLN-01-HW", "Mission planning laptop", "demo-org-dell", "demo-product-latitude-5430-rugged"],
    ["demo-infra-pma-ops", "demo-platform-pma-ops", "physical_server", "PMA-OPS-04-HW", "Operations console laptop", "demo-org-dell", "demo-product-latitude-5430-rugged"],
  ] as const;
  for (const node of infrastructureNodes) statements.push(db.prepare("INSERT INTO infrastructure_node (id,program_id,platform_id,node_type,code,normalized_code,name,normalized_name,manufacturer_organization_id,hardware_product_id,asset_tag,serial_number,lifecycle_status,description,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET node_type=excluded.node_type,code=excluded.code,normalized_code=excluded.normalized_code,name=excluded.name,normalized_name=excluded.normalized_name,manufacturer_organization_id=excluded.manufacturer_organization_id,hardware_product_id=excluded.hardware_product_id,asset_tag=excluded.asset_tag,lifecycle_status=excluded.lifecycle_status,description=excluded.description,updated_at=excluded.updated_at")
    .bind(node[0], PROGRAM_ID, node[1], node[2], node[3], node[3].toLowerCase(), node[4], node[4].toLowerCase(), node[5], node[6], `DEMO-${node[3]}`, null, "active", "Synthetic infrastructure identity. Not program data.", actor.id, at, at));

  const releaseConfigurations = [
    { releaseId: r5, suffix: "r5", status: "operational", bladeCpu: 16, bladeRam: 64, mpsCpu: 8, mpsRam: 32, mpsStorage: 180, tlsCpu: 4, tlsRam: 16, tlsStorage: 120, hypervisor: "7.0", windows: "2019", linux: "9.1" },
    { releaseId: r6, suffix: "r6", status: "operational", bladeCpu: 24, bladeRam: 96, mpsCpu: 12, mpsRam: 48, mpsStorage: 240, tlsCpu: 8, tlsRam: 24, tlsStorage: 160, hypervisor: "8.0 U2", windows: "2019 CU-2026-04", linux: "9.3" },
    { releaseId: r7, suffix: "r7", status: "unknown", bladeCpu: 32, bladeRam: 128, mpsCpu: 12, mpsRam: 64, mpsStorage: 300, tlsCpu: 8, tlsRam: 32, tlsStorage: 220, hypervisor: "8.0 U3", windows: "2019 CU-2026-08", linux: "9.4" },
  ];
  const stateId = (suffix: string, key: string) => `demo-infra-state-${suffix}-${key}`;
  for (const release of releaseConfigurations) {
    if (!release.releaseId) continue;
    const statePlan = [
      ["ups", "demo-infra-ups-va", null, null, null, null, null, null, null],
      ["switch", "demo-infra-switch-va", null, null, null, null, null, null, null],
      ["chassis", "demo-infra-chassis-va", null, null, null, null, null, null, null],
      ["bare", "demo-infra-blade-baremetal", "chassis", release.bladeCpu, release.bladeRam, 1000, "SSD", null, null],
      ["virtual", "demo-infra-blade-virtual", "chassis", release.bladeCpu, release.bladeRam, 2000, "SAN", null, null],
      ["vm-mps", "demo-infra-vm-mps", "virtual", release.mpsCpu, release.mpsRam, release.mpsStorage, "SSD", null, null],
      ["vm-tls", "demo-infra-vm-tls", "virtual", release.tlsCpu, release.tlsRam, release.tlsStorage, "SSD", null, null],
      ["drive-mps", "demo-infra-drive-mps", "vm-mps", null, null, release.mpsStorage, "SSD", "D:", "NTFS"],
      ["drive-tls", "demo-infra-drive-tls", "vm-tls", null, null, release.tlsStorage, "SSD", "/data", "XFS"],
    ] as const;
    for (const state of statePlan) statements.push(db.prepare("INSERT INTO release_infrastructure_node (id,program_id,release_id,platform_id,infrastructure_node_id,parent_state_id,lifecycle_status,operating_state,cpu_cores,memory_gb,storage_gb,storage_medium_id,storage_type,drive_letter,file_system_value_id,file_system,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_state_id=excluded.parent_state_id,lifecycle_status=excluded.lifecycle_status,operating_state=excluded.operating_state,cpu_cores=excluded.cpu_cores,memory_gb=excluded.memory_gb,storage_gb=excluded.storage_gb,storage_medium_id=excluded.storage_medium_id,storage_type=excluded.storage_type,drive_letter=excluded.drive_letter,file_system_value_id=excluded.file_system_value_id,file_system=excluded.file_system,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(stateId(release.suffix, state[0]), PROGRAM_ID, release.releaseId, "demo-platform-obk-va", state[1], state[2] ? stateId(release.suffix, state[2]) : null, "active", release.status, state[3], state[4], state[5], state[6] ? `infra-storage-${state[6].toLowerCase()}` : null, state[6], state[7], state[8] ? `infra-fs-${state[8].toLowerCase()}` : null, state[8], "DEMO://INFRASTRUCTURE/CONFIGURATION", "2026-08-22", "Synthetic complete Release configuration.", actor.id, at, at));
    const installationPlan = [
      ["bare-os", "bare", "demo-product-windows-server-2019", "operating_system", release.windows, null],
      ["hypervisor", "virtual", "demo-product-vsphere-8", "hypervisor", release.hypervisor, null],
      ["mps-os", "vm-mps", "demo-product-windows-server-2019", "operating_system", release.windows, null],
      ["tls-os", "vm-tls", "demo-product-rhel-9", "operating_system", release.linux, null],
    ] as const;
    const sourceMps = rows.find((row) => row.releaseId === release.releaseId && row.shortName === "MPS");
    const sourceTls = rows.find((row) => row.releaseId === release.releaseId && row.shortName === "TLS");
    const appInstallations = [
      sourceMps?.productId ? ["mps-app", "vm-mps", sourceMps.productId, "application", versions[sourceMps.sourceKey] || null, sourceMps.occurrenceId] : null,
      sourceTls?.productId ? ["tls-app", "vm-tls", sourceTls.productId, "application", versions[sourceTls.sourceKey] || null, sourceTls.occurrenceId] : null,
    ].filter((item): item is [string,string,string,string,string | null,string] => Boolean(item));
    for (const installation of [...installationPlan, ...appInstallations]) statements.push(db.prepare("INSERT INTO infrastructure_product_installation (id,program_id,release_id,platform_id,node_state_id,product_id,baseline_occurrence_id,installation_role,instance_name,normalized_instance_name,version,deployment_status,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET node_state_id=excluded.node_state_id,product_id=excluded.product_id,baseline_occurrence_id=excluded.baseline_occurrence_id,installation_role=excluded.installation_role,version=excluded.version,deployment_status=excluded.deployment_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(`demo-infra-install-${release.suffix}-${installation[0]}`, PROGRAM_ID, release.releaseId, "demo-platform-obk-va", stateId(release.suffix, installation[1]), installation[2], installation[5], installation[3], null, "", installation[4], "installed", "DEMO://INFRASTRUCTURE/INSTALLATION", "2026-08-22", "Synthetic governed Product installation.", actor.id, at, at));
    for (const connection of [
      ["power", "ups", "chassis", "Protected chassis feed", null],
      ["network", "switch", "bare", "Bare-metal service uplink", 10000],
      ["network", "switch", "virtual", "Virtual services uplink", 25000],
      ["management", "virtual", "vm-mps", "Hypervisor management", null],
      ["management", "virtual", "vm-tls", "Hypervisor management", null],
    ] as const) statements.push(db.prepare("INSERT INTO infrastructure_connection (id,program_id,release_id,platform_id,source_node_state_id,target_node_state_id,connection_type,label,status,capacity_mbps,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_node_state_id=excluded.source_node_state_id,target_node_state_id=excluded.target_node_state_id,connection_type=excluded.connection_type,label=excluded.label,status=excluded.status,capacity_mbps=excluded.capacity_mbps,updated_at=excluded.updated_at")
      .bind(`demo-infra-connection-${release.suffix}-${connection[0]}-${connection[1]}-${connection[2]}`, PROGRAM_ID, release.releaseId, "demo-platform-obk-va", stateId(release.suffix, connection[1]), stateId(release.suffix, connection[2]), connection[0], connection[3], "active", connection[4], "DEMO://INFRASTRUCTURE/CONNECTION", "2026-08-22", "Synthetic connection used for topology testing.", actor.id, at, at));
  }

  // Release 7 laptop endpoints prove that one Product can have server-side
  // and client-side placements without duplicating its canonical identity.
  if (r7) {
    const endpointPlan = [
      ["pma-mps", "demo-platform-pma-mps", "demo-infra-pma-mps", "Mission planning analyst endpoint", 8, 32, 512],
      ["pma-ops", "demo-platform-pma-ops", "demo-infra-pma-ops", "Operations console analyst endpoint", 8, 32, 512],
    ] as const;
    for (const endpoint of endpointPlan) statements.push(db.prepare("INSERT INTO release_infrastructure_node (id,program_id,release_id,platform_id,infrastructure_node_id,parent_state_id,lifecycle_status,operating_state,cpu_cores,memory_gb,storage_gb,storage_medium_id,storage_type,drive_letter,file_system_value_id,file_system,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lifecycle_status=excluded.lifecycle_status,operating_state=excluded.operating_state,cpu_cores=excluded.cpu_cores,memory_gb=excluded.memory_gb,storage_gb=excluded.storage_gb,storage_medium_id=excluded.storage_medium_id,storage_type=excluded.storage_type,drive_letter=excluded.drive_letter,file_system_value_id=excluded.file_system_value_id,file_system=excluded.file_system,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(stateId("r7", endpoint[0]), PROGRAM_ID, r7, endpoint[1], endpoint[2], null, "active", "operational", endpoint[4], endpoint[5], endpoint[6], "infra-storage-nvme", "NVME", "C:", "infra-fs-ntfs", "NTFS", "DEMO://INFRASTRUCTURE/ENDPOINT", "2026-08-22", endpoint[3], actor.id, at, at));
    const mpsProductId = rows.find((row) => row.releaseId === r7 && row.shortName === "MPS")?.productId;
    const operationsProductId = rows.find((row) => row.releaseId === r7 && row.shortName === "OC")?.productId;
    const endpointInstallations = [
      ["pma-mps-os", "pma-mps", "demo-platform-pma-mps", "demo-product-windows-11-enterprise", "operating_system", "23H2"],
      ["pma-ops-os", "pma-ops", "demo-platform-pma-ops", "demo-product-windows-11-enterprise", "operating_system", "23H2"],
      mpsProductId ? ["pma-mps-app", "pma-mps", "demo-platform-pma-mps", mpsProductId, "application", "3.0.0"] : null,
      operationsProductId ? ["pma-ops-app", "pma-ops", "demo-platform-pma-ops", operationsProductId, "application", "3.0.0"] : null,
    ].filter((item): item is [string, string, string, string, string, string] => Boolean(item));
    for (const installation of endpointInstallations) statements.push(db.prepare("INSERT INTO infrastructure_product_installation (id,program_id,release_id,platform_id,node_state_id,product_id,baseline_occurrence_id,installation_role,instance_name,normalized_instance_name,version,deployment_status,source_reference,source_as_of,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET node_state_id=excluded.node_state_id,product_id=excluded.product_id,installation_role=excluded.installation_role,version=excluded.version,deployment_status=excluded.deployment_status,source_reference=excluded.source_reference,source_as_of=excluded.source_as_of,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(`demo-infra-install-r7-${installation[0]}`, PROGRAM_ID, r7, installation[2], stateId("r7", installation[1]), installation[3], null, installation[4], null, "", installation[5], "installed", "DEMO://INFRASTRUCTURE/ENDPOINT-INSTALLATION", "2026-08-22", "Synthetic endpoint Product installation.", actor.id, at, at));
  }
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
  statements.push(db.prepare("DELETE FROM objective_effect_attribution WHERE objective_id LIKE 'demo-objective-%'"));
  statements.push(db.prepare("DELETE FROM change_request_objective_dependency WHERE prerequisite_objective_id LIKE 'demo-objective-%' OR dependent_change_request_id LIKE 'demo-change-%'"));
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
  const effectIdsByRequest = new Map<string, string[]>();
  for (const effect of effectPlan) if (effect[2]) {
    const effectId = `demo-effect-${++effectIndex}`;
    effectIdsByRequest.set(effect[0], [...(effectIdsByRequest.get(effect[0]) || []), effectId]);
    statements.push(db.prepare("INSERT INTO change_effect (id,change_request_id,subject_kind,subject_id,action,aspect,from_release_id,to_release_id,current_value,target_value,consequence,rationale,confidence,source_occurrence_id,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(effectId, effect[0], effect[1], effect[2], effect[3], effect[4], effect[5], effect[6], effect[7], effect[8], effect[9], "Synthetic impact assessment for smoke testing.", "assessed", null, actor.id, at, at));
  }

  for (const dependency of [
    ["demo-dependency-hardening-mps", "demo-change-hardening", "demo-change-mps", "enables", "Hardened shared platform enables the relocation.", "Relocation proceeds with an unverified shared-platform security boundary."],
    ["demo-dependency-hardening-tls", "demo-change-hardening", "demo-change-tls", "requires", "Threat-data relocation requires the hardened platform.", "Threat-data relocation slips or accepts an unresolved cyber risk."],
    ["demo-dependency-tls-eis", "demo-change-tls", "demo-change-eis", "enables", "Resilient threat data improves analytics completeness.", "Execution analytics operate with incomplete or stale threat data."],
    ["demo-dependency-eis-gateway", "demo-change-eis", "demo-change-gateway", "requires", "Leadership analytics validates the target interchange state before retirement.", "The legacy gateway may be retired before target interchange performance is demonstrated."],
    ["demo-dependency-java-inventory-upgrade", "demo-change-java-inventory", "demo-change-java-upgrade", "enables", "Authoritative inventory and SBOM evidence bound the Java upgrade scope and estimate.", "Upgrade scope, estimate, and residual Java exposure remain unbounded."],
    ["demo-dependency-java-upgrade-acceptance", "demo-change-java-upgrade", "demo-change-java-acceptance", "enables", "The upgraded build must be available before mission and system acceptance can complete.", "Acceptance cannot establish mission or system performance for the modernized build."],
  ] as const) statements.push(db.prepare("INSERT INTO change_dependency (id,predecessor_request_id,successor_request_id,dependency_type,rationale,consequence_if_unmet,owner,confidence,source_reference,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(dependency[0], dependency[1], dependency[2], dependency[3], dependency[4], dependency[5], "Government Mission Systems Architecture (synthetic)", "assessed", `DEMO://DEPENDENCY/${dependency[0]}`, "2026-08-20", actor.id, at, at));

  // A single deep Initiative scenario exercises the entire decision chain:
  // leadership outcome → Government funding units → incumbent technical work
  // → requirement trace → acceptance evidence and sign-off. Every claim is
  // synthetic and source-labelled so it cannot be mistaken for program fact.
  const javaInitiativeId = "demo-initiative-java8";
  const javaObjectiveIds = ["demo-objective-java-inventory", "demo-objective-java-upgrade", "demo-objective-java-acceptance"];
  statements.push(db.prepare("DELETE FROM work_package_dependency WHERE predecessor_work_package_id LIKE 'demo-java-wbs-%' OR successor_work_package_id LIKE 'demo-java-wbs-%'"));
  statements.push(db.prepare("DELETE FROM work_package_objective WHERE work_package_id IN (SELECT id FROM work_package WHERE initiative_id=?)").bind(javaInitiativeId));
  statements.push(db.prepare("DELETE FROM work_package WHERE initiative_id=?").bind(javaInitiativeId));
  statements.push(db.prepare("DELETE FROM acceptance_signoff WHERE criterion_id IN (SELECT id FROM acceptance_criterion WHERE objective_id IN (?,?,?))").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM acceptance_criterion WHERE objective_id IN (?,?,?)").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM objective_requirement WHERE objective_id IN (?,?,?)").bind(...javaObjectiveIds));
  // 0013 may have migrated these earlier Java demonstration requirements with
  // `migrated-requirement-*` IDs. Remove only those predecessors here; the
  // other scenario requirements are cleaned in their own dependency order.
  statements.push(db.prepare("DELETE FROM requirement WHERE id IN ('demo-requirement-sbom','demo-requirement-runtime','demo-requirement-mission','demo-requirement-interface') OR (program_id=? AND source_system='Synthetic authoritative requirements repository' AND external_identifier IN ('DEMO-REQ-CM-031','DEMO-REQ-CYB-104','DEMO-REQ-MIS-220','DEMO-REQ-INT-118'))").bind(PROGRAM_ID));
  // Remove pre-0013 demonstration traces left by an older demo load.
  statements.push(db.prepare("DELETE FROM requirement_trace WHERE objective_id IN (?,?,?)").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM objective_estimate WHERE objective_id IN (?,?,?)").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM objective_source_row WHERE objective_id IN (?,?,?)").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM objective_source_package WHERE external_system='Synthetic incumbent objective register' AND NOT EXISTS (SELECT 1 FROM objective_source_row WHERE objective_source_row.source_package_id=objective_source_package.id)"));
  statements.push(db.prepare("DELETE FROM initiative_milestone WHERE initiative_id=?").bind(javaInitiativeId));
  statements.push(db.prepare("DELETE FROM change_request_objective_dependency WHERE prerequisite_objective_id IN (?,?,?)").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM objective_change_request_link WHERE objective_id IN (?,?,?)").bind(...javaObjectiveIds));
  // Daily supplier observations are immutable. A demo reload may remove a
  // governed synthetic Objective, but it must not destroy or partially prune
  // the linked external feed history; clear only the optional reconciliation.
  statements.push(db.prepare("UPDATE lm_objective_feed_subject SET canonical_objective_id=NULL,updated_at=? WHERE canonical_objective_id IN (?,?,?)").bind(at, ...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM incumbent_objective WHERE id IN (?,?,?)").bind(...javaObjectiveIds));
  statements.push(db.prepare("DELETE FROM initiative_change_request WHERE initiative_id=?").bind(javaInitiativeId));
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
  for (const [id, dependentRequestId, prerequisiteObjectiveId, relationship, rationale] of [
    ["demo-objective-dependency-inventory-upgrade", "demo-change-java-upgrade", javaObjectiveIds[0], "requires", "The Java upgrade funding package requires an accepted runtime and SBOM inventory before scope and estimate can be treated as bounded."],
    ["demo-objective-dependency-upgrade-acceptance", "demo-change-java-acceptance", javaObjectiveIds[1], "requires", "Mission and system acceptance requires the modernized application build to be available for verification."],
  ] as const) statements.push(db.prepare("INSERT INTO change_request_objective_dependency (id,dependent_change_request_id,prerequisite_objective_id,relationship,status,rationale,source_reference,source_as_of,evidence_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, dependentRequestId, prerequisiteObjectiveId, relationship, "accepted", rationale, "DEMO://DEPENDENCY-REGISTER/JAVA8", "2026-08-18", null, actor.id, at, at));
  for (const [objectiveId, requestId, rationale] of [
    [javaObjectiveIds[0], "demo-change-java-inventory", "Inventory work provides the installation-level evidence for the in-scope runtime and SBOM claim."],
    [javaObjectiveIds[1], "demo-change-java-upgrade", "This Objective is the primary delivery mechanism for the in-scope application runtime transition."],
    [javaObjectiveIds[2], "demo-change-java-acceptance", "This Objective produces the Tier 3 and Tier 4 evidence needed to accept the technical effect."],
  ] as const) {
    for (const effectId of effectIdsByRequest.get(requestId) || []) {
      statements.push(db.prepare("INSERT INTO objective_effect_attribution (id,objective_id,change_effect_id,attribution,rationale,source_reference,source_as_of,evidence_reference,confidence,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(`demo-attribution-${objectiveId}-${effectId}`, objectiveId, effectId, "primary", rationale, "DEMO://OBJECTIVE-EFFECT-MAP/JAVA8", "2026-08-18", null, "high", actor.id, at, at));
    }
  }
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
  for (const requirement of requirementPlan) {
    const [requirementId, objectiveId, externalIdentifier, title, sourceSystem, sourceLocator, sourceAsOf, changeAction, beforeText, afterText, rationale, disposition] = requirement;
    const objectiveRequirementId = requirementId.replace("demo-requirement-", "demo-objective-requirement-");
    statements.push(
      db.prepare("INSERT INTO requirement (id,program_id,external_identifier,title,source_system,source_locator,source_as_of,current_text,lifecycle_status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(requirementId, PROGRAM_ID, externalIdentifier, title, sourceSystem, sourceLocator, sourceAsOf, afterText || beforeText, changeAction === "retire" ? "retired" : "active", actor.id, at, at),
      db.prepare("INSERT INTO objective_requirement (id,objective_id,requirement_id,version_label,change_action,before_text,after_text,rationale,disposition,source_reference,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(objectiveRequirementId, objectiveId, requirementId, "1", changeAction, beforeText, afterText, rationale, disposition, sourceLocator, sourceAsOf, actor.id, at, at),
    );
  }
  const criterionPlan = [
    ["demo-criterion-sbom", javaObjectiveIds[0], "demo-objective-requirement-sbom", "tier_4", "DEMO-T4-CM-01", "Every in-scope fielded build has a signed machine-readable SBOM that identifies its runtime distribution and version.", "inspection", "passed", "2026-08-18", "2026-08-18", "DEMO://EVIDENCE/SBOM-INVENTORY-2026-08-18"],
    ["demo-criterion-runtime", javaObjectiveIds[1], "demo-objective-requirement-runtime", "tier_4", "DEMO-T4-CYB-02", "Automated scan and installation inspection find no executable Java 8 runtime in either in-scope Release 7 product deployment.", "test", "ready", "2027-02-26", null, null],
    ["demo-criterion-mission", javaObjectiveIds[2], "demo-objective-requirement-mission", "tier_3", "DEMO-T3-MIS-01", "Representative mission planning completes the approved mission thread within its governed performance envelope using Release 7 threat data.", "demonstration", "draft", "2027-04-16", null, null],
    ["demo-criterion-regression", javaObjectiveIds[2], null, "tier_4", "DEMO-T4-SYS-03", "The Release 7 regression suite completes with no unresolved Severity 1 or Severity 2 defect attributable to the runtime modernization.", "test", "draft", "2027-04-30", null, null],
    ["demo-criterion-rollback", javaObjectiveIds[2], null, "tier_4", "DEMO-T4-FLD-04", "The fielding team restores the approved prior baseline within the governed rollback window using the signed deployment package.", "demonstration", "draft", "2027-05-14", null, null],
  ] as const;
  for (const criterion of criterionPlan) {
    const [criterionId, objectiveId, objectiveRequirementId, tier, code, statement, verificationMethod, status, plannedDate, actualDate, evidenceReference] = criterion;
    statements.push(db.prepare("INSERT INTO acceptance_criterion (id,objective_id,requirement_trace_id,objective_requirement_id,tier,code,statement,verification_method,status,planned_date,actual_date,evidence_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(criterionId, objectiveId, null, objectiveRequirementId, tier, code, statement, verificationMethod, status, plannedDate, actualDate, evidenceReference, actor.id, at, at));
  }
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
    ["J8-WP-01", javaObjectiveIds[1], "demo-change-java-upgrade", "Challenge incumbent estimate basis and reconcile reference-class actuals", "Government cost / engineering analysis", "2026-08-20", "2026-09-05", "in_progress", "Publish a documented low/likely/high Government assessment and list unresolved assumptions.", "Government estimate snapshot and documented variance explanation recorded."],
    ["J8-WP-02", javaObjectiveIds[1], "demo-change-java-upgrade", "Reconcile DEMO-REQ-INT-118 with requirements authority", "Government requirements lead", "2026-08-22", "2026-09-30", "on_hold", "Obtain authoritative interface text and map it to verification evidence.", "Authoritative requirement text is linked and its verification method is accepted."],
    ["J8-WP-03", javaObjectiveIds[2], "demo-change-java-acceptance", "Name Tier 3 and Tier 4 acceptance authorities", "Government test and evaluation lead", "2026-08-25", "2026-09-15", "planned", "Confirm accountable roles and required evidence before funding the acceptance request.", "Named Tier 3 and Tier 4 authorities acknowledge their criteria and sign-off roles."],
    ["J8-WP-04", javaObjectiveIds[1], "demo-change-java-upgrade", "Prepare Colonel decision brief and funding recommendation", "Government baseline steward", "2026-09-01", "2026-09-12", "in_progress", "Present as-is/to-be, options, estimate variance, consequences, dependencies, and explicit decision ask.", "Decision paper states the funding ask, consequences, dependencies, estimate range, and recommendation."],
  ].entries()) {
    const workPackageId = `demo-java-wbs-${index + 1}`;
    const workType = index === 0 ? "analysis" : index === 1 ? "coordination" : index === 2 ? "verification" : "decision_support";
    const relationship = index === 0 ? "assesses" : index === 1 ? "coordinates" : index === 2 ? "verifies" : "supports";
    statements.push(db.prepare("INSERT INTO work_package (id,initiative_id,change_request_id,objective_id,parent_id,wbs_code,title,owner,planned_start,due_date,status,work_type,definition_of_done,progress_basis,notes,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(workPackageId, javaInitiativeId, null, null, null, work[0], work[3], work[4], work[5], work[6], work[7], workType, work[9], "Status is supported by the linked estimate, requirement, or briefing artifact.", work[8], index, at, at));
    statements.push(db.prepare("INSERT INTO work_package_objective (id,work_package_id,objective_id,relationship,rationale,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(`demo-java-wbs-objective-${index + 1}`, workPackageId, work[1], relationship, "Synthetic Government work-to-incumbent Objective association.", actor.id, at, at));
  }
  for (const dependency of [
    ["demo-wbs-dependency-estimate-brief", "demo-java-wbs-1", "demo-java-wbs-4", "FS", 0, "accepted", "The leadership recommendation requires the independent estimate variance assessment.", "DEMO://WBS-LOGIC/JAVA8"],
    ["demo-wbs-dependency-requirement-brief", "demo-java-wbs-2", "demo-java-wbs-4", "FS", 0, "proposed", "The final brief should incorporate the authoritative interface requirement disposition.", "DEMO://WBS-LOGIC/JAVA8"],
    ["demo-wbs-dependency-authority-fielding", "demo-java-wbs-3", "demo-java-wbs-4", "SS", 0, "accepted", "Acceptance authority identification must begin before the decision package is finalized.", "DEMO://WBS-LOGIC/JAVA8"],
  ] as const) statements.push(db.prepare("INSERT INTO work_package_dependency (id,predecessor_work_package_id,successor_work_package_id,relationship,lag_days,status,rationale,source_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...dependency, actor.id, at, at));

  // Two additional decision scenarios give analysts a useful report set: one
  // pending funding decision and one active initiative with a deliberate
  // deferment. They use the same governed objects as the rest of the demo;
  // no synthetic row is a special report-only fixture.
  const resilienceInitiativeId = "demo-initiative-service-resilience";
  const analyticsInitiativeId = "demo-initiative-operations-analytics";
  const supplementalObjectiveIds = [
    "demo-objective-platform-hardening",
    "demo-objective-mps-relocation",
    "demo-objective-tls-resilience",
    "demo-objective-eis-delivery",
    "demo-objective-gateway-retirement",
  ] as const;
  const supplementalInitiativeIds = [resilienceInitiativeId, analyticsInitiativeId] as const;

  statements.push(db.prepare("DELETE FROM work_package_dependency WHERE predecessor_work_package_id LIKE 'demo-resilience-wbs-%' OR successor_work_package_id LIKE 'demo-resilience-wbs-%' OR predecessor_work_package_id LIKE 'demo-analytics-wbs-%' OR successor_work_package_id LIKE 'demo-analytics-wbs-%'"));
  statements.push(db.prepare("DELETE FROM work_package_objective WHERE work_package_id IN (SELECT id FROM work_package WHERE initiative_id IN (?,?))").bind(...supplementalInitiativeIds));
  statements.push(db.prepare("DELETE FROM work_package WHERE initiative_id IN (?,?)").bind(...supplementalInitiativeIds));
  statements.push(db.prepare("DELETE FROM acceptance_signoff WHERE criterion_id IN (SELECT id FROM acceptance_criterion WHERE objective_id IN (?,?,?,?,?))").bind(...supplementalObjectiveIds));
  statements.push(db.prepare("DELETE FROM acceptance_criterion WHERE objective_id IN (?,?,?,?,?)").bind(...supplementalObjectiveIds));
  statements.push(db.prepare("DELETE FROM objective_requirement WHERE objective_id IN (?,?,?,?,?)").bind(...supplementalObjectiveIds));
  statements.push(db.prepare("DELETE FROM requirement WHERE id LIKE 'demo-requirement-resilience-%' OR id LIKE 'demo-requirement-analytics-%'"));
  statements.push(db.prepare("DELETE FROM requirement_trace WHERE objective_id IN (?,?,?,?,?)").bind(...supplementalObjectiveIds));
  statements.push(db.prepare("DELETE FROM objective_estimate WHERE objective_id IN (?,?,?,?,?)").bind(...supplementalObjectiveIds));
  statements.push(db.prepare("DELETE FROM initiative_milestone WHERE initiative_id IN (?,?)").bind(...supplementalInitiativeIds));
  statements.push(db.prepare("DELETE FROM change_request_objective_dependency WHERE prerequisite_objective_id IN (?,?,?,?,?)").bind(...supplementalObjectiveIds));
  statements.push(db.prepare("DELETE FROM objective_change_request_link WHERE objective_id IN (?,?,?,?,?)").bind(...supplementalObjectiveIds));
  statements.push(db.prepare("UPDATE lm_objective_feed_subject SET canonical_objective_id=NULL,updated_at=? WHERE canonical_objective_id IN (?,?,?,?,?)").bind(at, ...supplementalObjectiveIds));
  statements.push(db.prepare("DELETE FROM incumbent_objective WHERE id IN (?,?,?,?,?)").bind(...supplementalObjectiveIds));
  statements.push(db.prepare("DELETE FROM initiative_change_request WHERE initiative_id IN (?,?)").bind(...supplementalInitiativeIds));
  statements.push(db.prepare("DELETE FROM initiative_scope WHERE initiative_id IN (?,?)").bind(...supplementalInitiativeIds));

  const supplementalInitiatives = [
    [
      resilienceInitiativeId, r7, "Field resilient mission services", "field resilient mission services", "decision_required", "high", "Government Service Delivery Cell (synthetic)", "2027-03-15",
      "If funding is delayed, Mission Planning Service and Threat Library Service retain constrained capacity and their planned Release 7 positions are not available for fielding.",
      "Field two capacity-validated mission services on a hardened shared platform with verified recovery and deployment evidence.",
      "Fund DEMO-MCP-061 and DEMO-DSOR-062 after confirming the shared hardening prerequisite remains funded and the residual capacity scope is bounded.",
      "Release 5 reports both services on smaller nodes. Release 6 introduces capacity and host changes, but the Release 7 fielding sequence remains dependent on shared platform hardening.",
      "Release 7 fields Mission Planning Service and Threat Library Service with approved shared controls, confirmed deployment positions, and recovery evidence.",
      "Shared hardening accepted; both service deployments confirmed; required capacity values verified; recovery evidence accepted; no unapproved release-to-release move.",
      "Colonel Scott · synthetic demonstration", "2026-10-10",
    ],
    [
      analyticsInitiativeId, r7, "Establish execution analytics and retire duplicate gateway", "establish execution analytics and retire duplicate gateway", "active", "medium", "Government Operations Analysis Cell (synthetic)", "2027-04-30",
      "If the gateway is retired before partner certification, interchange continuity is at risk. If execution analytics is delayed, leadership continues to rely on manual consolidation.",
      "Field Execution Insights Service while retaining the Data Gateway until partner certification evidence supports a controlled retirement decision.",
      "Continue funded DEMO-MCP-071. Maintain the DEMO-DSOR-072 deferment until partner certification and analytics validation are complete.",
      "Release 7 introduces Execution Insights Service, while Data Gateway remains the existing interchange position pending partner certification.",
      "Leadership receives an auditable execution view; Data Gateway is retired only after partner validation is recorded and accepted.",
      "Execution Insights Service fielded; leadership report validated; partner certification recorded; Data Gateway retirement decision made against evidence.",
      "Operations decision forum · synthetic demonstration", "2026-11-14",
    ],
  ] as const;
  for (const initiative of supplementalInitiatives) statements.push(db.prepare("INSERT INTO initiative (id,program_id,primary_release_id,title,normalized_title,status,priority,owner,target_date,consequence,desired_outcome,decision_ask,as_is_statement,to_be_statement,success_measures,briefing_audience,decision_needed_by,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET primary_release_id=excluded.primary_release_id,title=excluded.title,normalized_title=excluded.normalized_title,status=excluded.status,priority=excluded.priority,owner=excluded.owner,target_date=excluded.target_date,consequence=excluded.consequence,desired_outcome=excluded.desired_outcome,decision_ask=excluded.decision_ask,as_is_statement=excluded.as_is_statement,to_be_statement=excluded.to_be_statement,success_measures=excluded.success_measures,briefing_audience=excluded.briefing_audience,decision_needed_by=excluded.decision_needed_by,updated_at=excluded.updated_at")
    .bind(initiative[0], PROGRAM_ID, ...initiative.slice(1), actor.id, at, at));

  const productFor = (sourceKey: string) => rows.find((row) => row.sourceKey === sourceKey)?.productId || null;
  for (const [id, initiativeId, productId, label] of [
    ["demo-resilience-scope-mps", resilienceInitiativeId, productFor("DEMO-R7-001"), "Mission Planning Service"],
    ["demo-resilience-scope-tls", resilienceInitiativeId, productFor("DEMO-R7-002"), "Threat Library Service"],
    ["demo-analytics-scope-eis", analyticsInitiativeId, productFor("DEMO-R7-006"), "Execution Insights Service"],
    ["demo-analytics-scope-gateway", analyticsInitiativeId, productFor("DEMO-R6-003"), "Data Gateway"],
  ] as const) if (productId) statements.push(db.prepare("INSERT INTO initiative_scope (id,initiative_id,scope_kind,scope_id,display_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id, initiativeId, "product", productId, label, at, at));

  for (const [id, initiativeId, changeRequestId, relationship, contributionSummary, sortOrder] of [
    ["demo-resilience-link-1", resilienceInitiativeId, "demo-change-hardening", "enables", "Provides the common hardened platform required before service fielding.", 0],
    ["demo-resilience-link-2", resilienceInitiativeId, "demo-change-mps", "delivers", "Moves and increases Mission Planning Service capacity.", 1],
    ["demo-resilience-link-3", resilienceInitiativeId, "demo-change-tls", "delivers", "Builds threat-data capacity and the Release 7 deployment position.", 2],
    ["demo-analytics-link-1", analyticsInitiativeId, "demo-change-eis", "delivers", "Fields the analytics product used for auditable leadership reporting.", 0],
    ["demo-analytics-link-2", analyticsInitiativeId, "demo-change-gateway", "constrains", "Retirement remains deferred until partner certification and analytics validation are complete.", 1],
  ] as const) statements.push(db.prepare("INSERT INTO initiative_change_request (id,initiative_id,change_request_id,relationship,contribution_summary,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id, initiativeId, changeRequestId, relationship, contributionSummary, sortOrder, at, at));

  const supplementalObjectives = [
    ["demo-objective-platform-hardening", "demo-change-hardening", "DEMO-OBJ-PLT-01", "Harden shared platform controls", "Apply approved certificate, configuration, and shared runtime controls required by dependent service deployments.", "Incumbent platform infrastructure team (synthetic)", "complete", "2026-07-01", "2026-08-28", "2026-07-02", "2026-08-26", "DEMO://OBJECTIVES/PLT-01"],
    ["demo-objective-mps-relocation", "demo-change-mps", "DEMO-OBJ-PLT-02", "Relocate Mission Planning Service and verify capacity", "Move Mission Planning Service to the planned position, apply the approved capacity baseline, and document rollback.", "Incumbent mission applications IPT (synthetic)", "planned", "2026-10-01", "2027-01-31", null, null, "DEMO://OBJECTIVES/PLT-02"],
    ["demo-objective-tls-resilience", "demo-change-tls", "DEMO-OBJ-PLT-03", "Field resilient threat-data service", "Scale and relocate Threat Library Service, validate recovery, and demonstrate threat-data availability at the target position.", "Incumbent integration services IPT (synthetic)", "blocked", "2026-10-15", "2027-03-15", null, null, "DEMO://OBJECTIVES/PLT-03"],
    ["demo-objective-eis-delivery", "demo-change-eis", "DEMO-OBJ-OPS-01", "Field Execution Insights Service", "Deploy the analytics service, establish its data inputs, and validate the leadership execution report.", "Incumbent operations applications team (synthetic)", "in_progress", "2026-09-01", "2027-02-13", "2026-09-03", null, "DEMO://OBJECTIVES/OPS-01"],
    ["demo-objective-gateway-retirement", "demo-change-gateway", "DEMO-OBJ-OPS-02", "Validate partner readiness for Data Gateway retirement", "Collect partner certification evidence and recommend retain, retire, or rephase the legacy Data Gateway position.", "Incumbent interoperability team (synthetic)", "blocked", "2026-10-01", "2027-04-30", null, null, "DEMO://OBJECTIVES/OPS-02"],
  ] as const;
  for (const objective of supplementalObjectives) statements.push(db.prepare("INSERT INTO incumbent_objective (id,program_id,change_request_id,external_system,external_identifier,title,summary,technical_owner,status,planned_start,planned_finish,actual_start,actual_finish,source_locator,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(objective[0], PROGRAM_ID, objective[1], "Synthetic incumbent objective register", ...objective.slice(2), "2026-08-20", actor.id, at, at));

  for (const [id, dependentChangeRequestId, prerequisiteObjectiveId, relationship, status, rationale] of [
    ["demo-objective-dependency-hardening-mps", "demo-change-mps", "demo-objective-platform-hardening", "requires", "accepted", "Mission Planning Service relocation cannot field before shared controls are accepted."],
    ["demo-objective-dependency-hardening-tls", "demo-change-tls", "demo-objective-platform-hardening", "requires", "accepted", "Threat-data fielding requires the hardened shared platform."],
    ["demo-objective-dependency-eis-gateway", "demo-change-gateway", "demo-objective-eis-delivery", "requires", "proposed", "Gateway retirement requires the new analytics view to validate operational coverage."],
  ] as const) statements.push(db.prepare("INSERT INTO change_request_objective_dependency (id,dependent_change_request_id,prerequisite_objective_id,relationship,status,rationale,source_reference,source_as_of,evidence_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, dependentChangeRequestId, prerequisiteObjectiveId, relationship, status, rationale, "DEMO://DEPENDENCY-REGISTER/PORTFOLIO", "2026-08-20", null, actor.id, at, at));

  for (const [objectiveId, requestId, rationale] of [
    ["demo-objective-platform-hardening", "demo-change-hardening", "This Objective delivers the common platform prerequisite."],
    ["demo-objective-mps-relocation", "demo-change-mps", "This Objective is the supplier delivery path for the Mission Planning Service change."],
    ["demo-objective-tls-resilience", "demo-change-tls", "This Objective is the supplier delivery path for the Threat Library Service change."],
    ["demo-objective-eis-delivery", "demo-change-eis", "This Objective fields the leadership analytics capability."],
    ["demo-objective-gateway-retirement", "demo-change-gateway", "This Objective supplies the partner-readiness evidence for the gateway decision."],
  ] as const) for (const effectId of effectIdsByRequest.get(requestId) || []) statements.push(db.prepare("INSERT INTO objective_effect_attribution (id,objective_id,change_effect_id,attribution,rationale,source_reference,source_as_of,evidence_reference,confidence,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(`demo-attribution-${objectiveId}-${effectId}`, objectiveId, effectId, "primary", rationale, "DEMO://OBJECTIVE-EFFECT-MAP/PORTFOLIO", "2026-08-20", null, "high", actor.id, at, at));

  const supplementalRequirements = [
    ["demo-requirement-resilience-controls", "demo-objective-platform-hardening", "DEMO-REQ-PLT-041", "Apply approved shared controls", "Synthetic authoritative requirements repository", "DEMO://REQUIREMENTS/PLT-041", "2026-08-20", "verify", "Shared controls are configured by local practice.", "Shared platform services shall use the approved certificate and runtime control profile before dependent application fielding.", "Provides a verifiable prerequisite for dependent Change Requests.", "verified"],
    ["demo-requirement-resilience-mps", "demo-objective-mps-relocation", "DEMO-REQ-PLT-072", "Provide Mission Planning Service capacity", "Synthetic authoritative requirements repository", "DEMO://REQUIREMENTS/PLT-072", "2026-08-20", "modify", "Mission Planning Service capacity is sized for the Release 5 position.", "Mission Planning Service shall meet the approved Release 7 storage, CPU, and memory capacity baseline and document rollback.", "Makes the capacity uplift testable at the fielded position.", "traced"],
    ["demo-requirement-resilience-tls", "demo-objective-tls-resilience", "DEMO-REQ-OPS-115", "Recover threat-data service", "Synthetic authoritative requirements repository", "DEMO://REQUIREMENTS/OPS-115", "2026-08-20", "add", null, "Threat Library Service shall recover to the approved service level after a planned failover exercise at the Release 7 position.", "Defines the recovery evidence needed for resilient fielding.", "analysis_needed"],
    ["demo-requirement-analytics-report", "demo-objective-eis-delivery", "DEMO-REQ-OPS-207", "Produce auditable execution reporting", "Synthetic authoritative requirements repository", "DEMO://REQUIREMENTS/OPS-207", "2026-08-20", "add", null, "Execution Insights Service shall produce a release-filterable report that identifies what is fielded, where it is fielded, and which Change Requests govern material changes.", "Defines the operational reporting outcome.", "traced"],
    ["demo-requirement-analytics-gateway", "demo-objective-gateway-retirement", "DEMO-REQ-INT-205", "Preserve partner interchange before retirement", "Synthetic authoritative requirements repository", "DEMO://REQUIREMENTS/INT-205", "2026-08-20", "verify", "Partner interchange certification is not linked to the retirement decision.", "Data Gateway shall not be retired until partner interchange certification and analytics validation are recorded against the decision.", "Prevents retirement based solely on a schedule assumption.", "identified"],
  ] as const;
  for (const requirement of supplementalRequirements) {
    const [requirementId, objectiveId, externalIdentifier, title, sourceSystem, sourceLocator, sourceAsOf, changeAction, beforeText, afterText, rationale, disposition] = requirement;
    const objectiveRequirementId = requirementId.replace("demo-requirement-", "demo-objective-requirement-");
    statements.push(
      db.prepare("INSERT INTO requirement (id,program_id,external_identifier,title,source_system,source_locator,source_as_of,current_text,lifecycle_status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(requirementId, PROGRAM_ID, externalIdentifier, title, sourceSystem, sourceLocator, sourceAsOf, afterText || beforeText, changeAction === "retire" ? "retired" : "active", actor.id, at, at),
      db.prepare("INSERT INTO objective_requirement (id,objective_id,requirement_id,version_label,change_action,before_text,after_text,rationale,disposition,source_reference,source_as_of,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(objectiveRequirementId, objectiveId, requirementId, "1", changeAction, beforeText, afterText, rationale, disposition, sourceLocator, sourceAsOf, actor.id, at, at),
    );
  }

  const supplementalCriteria = [
    ["demo-criterion-resilience-controls", "demo-objective-platform-hardening", "demo-objective-requirement-resilience-controls", "tier_4", "DEMO-T4-PLT-01", "Shared platform certificate and runtime controls are inspected against the approved profile before dependent service fielding.", "inspection", "passed", "2026-08-28", "2026-08-26", "DEMO://EVIDENCE/PLATFORM-CONTROLS-2026-08-26"],
    ["demo-criterion-resilience-mps", "demo-objective-mps-relocation", "demo-objective-requirement-resilience-mps", "tier_3", "DEMO-T3-PLT-02", "Mission Planning Service demonstrates the approved Release 7 capacity baseline and documented rollback at the proposed position.", "demonstration", "ready", "2027-01-31", null, null],
    ["demo-criterion-resilience-tls", "demo-objective-tls-resilience", "demo-objective-requirement-resilience-tls", "tier_4", "DEMO-T4-OPS-03", "Threat Library Service recovery exercise meets the approved service-level objective at the Release 7 position.", "test", "draft", "2027-03-15", null, null],
    ["demo-criterion-analytics-report", "demo-objective-eis-delivery", "demo-objective-requirement-analytics-report", "tier_4", "DEMO-T4-OPS-04", "Execution Insights Service report reconciles fielded products, locations, releases, and governing Change Requests for the Release 7 demonstration set.", "demonstration", "ready", "2027-02-13", null, null],
    ["demo-criterion-analytics-gateway", "demo-objective-gateway-retirement", "demo-objective-requirement-analytics-gateway", "tier_3", "DEMO-T3-INT-05", "Partner certification and analytics validation are accepted before Data Gateway retirement is recommended.", "review", "draft", "2027-04-30", null, null],
  ] as const;
  for (const criterion of supplementalCriteria) {
    const [criterionId, objectiveId, objectiveRequirementId, tier, code, statement, verificationMethod, status, plannedDate, actualDate, evidenceReference] = criterion;
    statements.push(db.prepare("INSERT INTO acceptance_criterion (id,objective_id,requirement_trace_id,objective_requirement_id,tier,code,statement,verification_method,status,planned_date,actual_date,evidence_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(criterionId, objectiveId, null, objectiveRequirementId, tier, code, statement, verificationMethod, status, plannedDate, actualDate, evidenceReference, actor.id, at, at));
  }
  for (const signoff of [
    ["demo-signoff-resilience-controls", "demo-criterion-resilience-controls", "Government platform acceptance authority", "Synthetic platform authority", "accepted", "2026-08-26", "Accepted after inspection of the shared synthetic control profile.", null],
    ["demo-signoff-analytics-report", "demo-criterion-analytics-report", "Government operations reporting authority", null, "pending", null, null, null],
  ] as const) statements.push(db.prepare("INSERT INTO acceptance_signoff (id,criterion_id,signoff_role,signer,decision,decided_at,rationale,evidence_document_id,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...signoff, actor.id, at, at));

  for (const estimate of [
    ["demo-estimate-mps-inc", "demo-objective-mps-relocation", "incumbent", 14000, 19000, 27000, 4100000, 5600000, 8000000, "Synthetic incumbent relocation and capacity estimate.", "Assumes shared hardening is complete and a single fielding window is available.", "DEMO://ESTIMATES/PLT-02/INC", "2026-08-18", "medium"],
    ["demo-estimate-mps-gov", "demo-objective-mps-relocation", "government", 6200, 9800, 15000, 1800000, 3000000, 4700000, "Synthetic Government reference-class estimate based on one service move and documented capacity change.", "Excludes common hardening because it is funded separately under DEMO-MCP-060.", "DEMO://ESTIMATES/PLT-02/GOV", "2026-08-20", "medium"],
    ["demo-estimate-eis-inc", "demo-objective-eis-delivery", "incumbent", 7800, 11200, 16800, 2300000, 3300000, 4900000, "Synthetic supplier estimate for analytics service delivery and data-load integration.", "Assumes existing Operations Squadron hosting remains available.", "DEMO://ESTIMATES/OPS-01/INC", "2026-08-18", "medium"],
  ] as const) statements.push(db.prepare("INSERT INTO objective_estimate (id,objective_id,estimate_source,hours_low,hours_likely,hours_high,cost_low,cost_likely,cost_high,basis,assumptions,source_reference,as_of,confidence,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...estimate, actor.id, at, at));

  for (const [id, initiativeId, changeRequestId, objectiveId, title, type, plannedDate, actualDate, status, consequence, owner, sortOrder] of [
    ["demo-milestone-resilience-decision", resilienceInitiativeId, "demo-change-mps", null, "Funding decision for service resilience", "decision", "2026-10-10", null, "planned", "Service fielding remains unsequenced and capacity changes retain no funded delivery path.", "Colonel Scott · synthetic demonstration", 0],
    ["demo-milestone-resilience-capacity", resilienceInitiativeId, "demo-change-mps", "demo-objective-mps-relocation", "Mission Planning Service capacity demonstration", "verification", "2027-01-31", null, "planned", "Mission Planning Service cannot enter the Release 7 acceptance window.", "Government mission systems lead", 1],
    ["demo-milestone-resilience-recovery", resilienceInitiativeId, "demo-change-tls", "demo-objective-tls-resilience", "Threat-data recovery exercise", "verification", "2027-03-15", null, "at_risk", "Threat-data resilience remains an unverified assertion and fielding recommendation is blocked.", "Government integration lead", 2],
    ["demo-milestone-analytics-delivery", analyticsInitiativeId, "demo-change-eis", "demo-objective-eis-delivery", "Execution Insights Service report demonstration", "delivery", "2027-02-13", null, "planned", "Leadership reporting remains manual and cannot be reconciled to the governed baseline.", "Government operations analysis lead", 0],
    ["demo-milestone-analytics-certification", analyticsInitiativeId, "demo-change-gateway", "demo-objective-gateway-retirement", "Partner certification and gateway decision", "decision", "2027-04-30", null, "at_risk", "Gateway retirement remains deferred and duplicate sustainment continues.", "Government interoperability authority", 1],
  ] as const) statements.push(db.prepare("INSERT INTO initiative_milestone (id,initiative_id,change_request_id,objective_id,title,milestone_type,planned_date,actual_date,status,consequence_if_missed,owner,sort_order,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, initiativeId, changeRequestId, objectiveId, title, type, plannedDate, actualDate, status, consequence, owner, sortOrder, actor.id, at, at));

  for (const [id, initiativeId, wbsCode, title, owner, plannedStart, dueDate, status, workType, objectiveId, relationship, notes, definitionOfDone, sortOrder] of [
    ["demo-resilience-wbs-1", resilienceInitiativeId, "RS-WP-01", "Validate independent capacity assessment", "Government cost / engineering analysis", "2026-08-25", "2026-10-03", "in_progress", "analysis", "demo-objective-mps-relocation", "assesses", "Compare incumbent and Government capacity estimates before funding.", "Independent capacity range and documented assumptions are available for the funding decision.", 0],
    ["demo-resilience-wbs-2", resilienceInitiativeId, "RS-WP-02", "Confirm shared platform readiness", "Government platform lead", "2026-08-25", "2026-09-18", "complete", "verification", "demo-objective-platform-hardening", "verifies", "Verify the funded shared hardening prerequisite and evidence package.", "Approved control profile and acceptance evidence are linked to the prerequisite objective.", 1],
    ["demo-resilience-wbs-3", resilienceInitiativeId, "RS-WP-03", "Reconcile threat-data recovery evidence", "Government integration lead", "2026-09-15", "2027-03-15", "on_hold", "coordination", "demo-objective-tls-resilience", "coordinates", "Define the recovery scenario, evidence set, and accountable acceptance authority.", "Recovery criterion, evidence method, and acceptance authority are recorded.", 2],
    ["demo-analytics-wbs-1", analyticsInitiativeId, "AN-WP-01", "Validate leadership execution report", "Government operations analysis lead", "2026-09-10", "2027-02-13", "in_progress", "verification", "demo-objective-eis-delivery", "verifies", "Validate that the report reconciles what, where, when, and governing Change Requests.", "A leadership user confirms the report is traceable to governed baseline and decision records.", 0],
    ["demo-analytics-wbs-2", analyticsInitiativeId, "AN-WP-02", "Maintain gateway deferment evidence", "Government interoperability authority", "2026-10-01", "2027-04-30", "planned", "decision_support", "demo-objective-gateway-retirement", "supports", "Track partner certification and analytics validation before recommending retirement.", "Retain, retire, or rephase recommendation cites partner certification evidence and the current decision record.", 1],
  ] as const) {
    statements.push(db.prepare("INSERT INTO work_package (id,initiative_id,change_request_id,objective_id,parent_id,wbs_code,title,owner,planned_start,due_date,status,work_type,definition_of_done,progress_basis,notes,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, initiativeId, null, null, null, wbsCode, title, owner, plannedStart, dueDate, status, workType, definitionOfDone, "Status is supported by an objective, requirement, acceptance record, or decision artifact.", notes, sortOrder, at, at));
    statements.push(db.prepare("INSERT INTO work_package_objective (id,work_package_id,objective_id,relationship,rationale,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(`${id}-objective`, id, objectiveId, relationship, "Synthetic Government work-to-incumbent Objective association.", actor.id, at, at));
  }
  for (const dependency of [
    ["demo-wbs-dependency-resilience-controls-capacity", "demo-resilience-wbs-2", "demo-resilience-wbs-1", "FS", 0, "accepted", "The capacity funding assessment uses the accepted shared-control prerequisite.", "DEMO://WBS-LOGIC/RESILIENCE"],
    ["demo-wbs-dependency-resilience-capacity-recovery", "demo-resilience-wbs-1", "demo-resilience-wbs-3", "FS", 0, "proposed", "Recovery evidence must reflect the funded service position and capacity baseline.", "DEMO://WBS-LOGIC/RESILIENCE"],
    ["demo-wbs-dependency-analytics-report-retirement", "demo-analytics-wbs-1", "demo-analytics-wbs-2", "FS", 0, "accepted", "Gateway retirement recommendation requires the analytics report to validate the target operating picture.", "DEMO://WBS-LOGIC/ANALYTICS"],
  ] as const) statements.push(db.prepare("INSERT INTO work_package_dependency (id,predecessor_work_package_id,successor_work_package_id,relationship,lag_days,status,rationale,source_reference,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...dependency, actor.id, at, at));

  statements.push(audit(db, actor, "demonstration_workspace_enriched", "baseline_workspace", WORKSPACE_ID, { occurrences: rows.length, governedInfrastructure: true, infrastructureNodes: infrastructureNodes.length, releaseConfigurations: releaseConfigurations.length, managedTopology: true, rationaleRecords: rationaleRecordCount, platforms: platformPlan.length, changeRequests: changePlan.length, initiatives: 3, objectives: objectivePlan.length + supplementalObjectives.length, requirements: requirementPlan.length + supplementalRequirements.length, acceptanceCriteria: criterionPlan.length + supplementalCriteria.length }));
  await db.batch(statements);
  return { occurrences: rows.length, hostProfiles: seenHosts.size, deploymentProfiles: rows.filter((row) => row.productId).length, infrastructureNodes: infrastructureNodes.length, releaseConfigurations: releaseConfigurations.length, rationaleRecords: rationaleRecordCount, platforms: platformPlan.length, changeRequests: changePlan.length };
}
