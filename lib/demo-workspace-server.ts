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
      sr.source_key,sr.short_name,sr.containerized,r.name AS release_name,n.name AS host_name
    FROM baseline_occurrence bo
    JOIN source_row_24 sr ON sr.id=bo.source_row_id
    JOIN source_package sp ON sp.id=sr.source_package_id
    JOIN release r ON r.id=bo.release_id
    JOIN configuration_node n ON n.id=bo.configuration_node_id
    WHERE bo.program_id=? AND bo.workspace_id=?
    ORDER BY sr.row_number ASC
  `).bind(PROGRAM_ID, WORKSPACE_ID).all<{
    occurrence_id: string; release_id: string; configuration_node_id: string; product_id: string | null;
    source_key: string | null; short_name: string | null; containerized: string | null; release_name: string; host_name: string;
  }>();

  const rows: DemoOccurrence[] = occurrences.results.map((row) => ({
    occurrenceId: row.occurrence_id, releaseId: row.release_id, configurationNodeId: row.configuration_node_id, productId: row.product_id,
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
        .bind(`demo-host-${row.releaseId}-${row.configurationNodeId}`, PROGRAM_ID, row.releaseId, row.configurationNodeId, host.installationLocation, host.facilityOrEnclave, host.equipmentRack, host.hardwareBlade, host.virtualizationPlatform, "Synthetic demo enrichment", "Demo-only managed topology detail. It is not part of the 24-column XLSX export.", actor.id, at, at));
    }
    if (!row.productId) continue;
    const deployment = deploymentDetails(row);
    statements.push(db.prepare("INSERT INTO managed_deployment_profile (id,program_id,baseline_occurrence_id,release_id,configuration_node_id,product_id,virtual_machine,container_instance,application_version,installation_identifier,deployment_role,source_reference,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(baseline_occurrence_id) DO UPDATE SET virtual_machine=excluded.virtual_machine,container_instance=excluded.container_instance,application_version=excluded.application_version,installation_identifier=excluded.installation_identifier,deployment_role=excluded.deployment_role,source_reference=excluded.source_reference,notes=excluded.notes,updated_at=excluded.updated_at")
      .bind(`demo-deployment-${row.occurrenceId}`, PROGRAM_ID, row.occurrenceId, row.releaseId, row.configurationNodeId, row.productId, deployment.virtualMachine, deployment.containerInstance, deployment.applicationVersion, deployment.installationIdentifier, deployment.deploymentRole, "Synthetic demo enrichment", "Demo-only managed deployment detail. It is not part of the 24-column XLSX export.", actor.id, at, at));
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

  statements.push(audit(db, actor, "demonstration_workspace_enriched", "baseline_workspace", WORKSPACE_ID, { occurrences: rows.length, managedTopology: true, rationaleRecords: rationaleRecordCount }));
  await db.batch(statements);
  return { occurrences: rows.length, hostProfiles: seenHosts.size, deploymentProfiles: rows.filter((row) => row.productId).length, rationaleRecords: rationaleRecordCount };
}
