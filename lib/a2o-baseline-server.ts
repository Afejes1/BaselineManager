import {
  TECHNICAL_BASELINE_COLUMNS,
  type CellValue,
  type TechnicalBaselineColumn,
} from "./technical-baseline-contract";

export const BASELINE_PROGRAM_ID = "program-jsf";
export const BASELINE_WORKSPACE_ID = "workspace-jsf-current";

export type A2ORow = Record<TechnicalBaselineColumn, CellValue>;
export type AssembledBaselineRecord = {
  occurrenceId: string;
  sourceRowId: string | null;
  revision: number;
  materializationStatus: string;
  lifecycleStatus: "active" | "voided";
  lifecycleReason: string | null;
  voidedAt: string | null;
  voidedByUserId: string | null;
  baseline: { name: string | null; maturity: string | null; asOf: string | null };
  source: { fileName: string | null; sourceKey: string | null; row: A2ORow | null };
  releaseId: string | null;
  productId: string | null;
  configurationNodeId: string | null;
  deploymentId: string | null;
  row: A2ORow;
};

type RecordRow = {
  occurrence_id: string; source_row_id: string | null; revision: number; materialization_status: string;
  lifecycle_status: "active" | "voided"; lifecycle_reason: string | null; voided_at: string | null; voided_by_user_id: string | null;
  projection_payload: string | null; baseline_name: string | null; baseline_maturity: string | null; baseline_as_of: string | null;
  source_file_name: string | null; release_id: string | null; release_name: string | null; product_id: string | null;
  product_name: string | null; product_short_name: string | null; product_type: string | null; software_classification: string | null;
  configuration_node_id: string | null; node_name: string | null; node_type: string | null;
  parent_name: string | null; parent_type: string | null; grandparent_name: string | null; grandparent_type: string | null;
  deployment_id: string | null; node_state_source_row_id: string | null; storage_type: string | null; storage_gb: number | null; cpu_cores: number | null; ram_gb: number | null;
  deployment_state_source_row_id: string | null; language: string | null; containerized: string | null; container_technology: string | null; container_type: string | null;
  supplier_name: string | null; extension_source_key: string | null; extension_notes: string | null; extension_capability_notes: string | null;
  extension_notes_1: string | null; extension_notes_2: string | null; extension_notes_3: string | null; extension_notes_4: string | null;
  snapshot_source_key: string | null; source_payload: string | null;
};

const text = (value: unknown) => value == null ? "" : String(value);
const emptyRow = (): A2ORow => Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, ""])) as A2ORow;

export function asA2ORow(value: unknown): A2ORow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !TECHNICAL_BASELINE_COLUMNS.includes(key as TechnicalBaselineColumn))) return null;
  const row = emptyRow();
  for (const column of TECHNICAL_BASELINE_COLUMNS) {
    const cell = candidate[column];
    if (cell !== undefined && cell !== null && typeof cell !== "string" && typeof cell !== "number" && typeof cell !== "boolean") return null;
    row[column] = cell as CellValue;
  }
  return row;
}

function legacyProjection(payload: string | null): A2ORow {
  try { return asA2ORow(JSON.parse(payload || "")) || emptyRow(); } catch { return emptyRow(); }
}

function governedText(value: string | null, fallback: CellValue) {
  const governed = text(value).trim();
  // "Unassigned" is an application navigation bucket, not an A2O fact.
  // Preserve the actual imported blank/value instead of exporting the bucket.
  return !governed || governed.toLocaleLowerCase("en-US") === "unassigned" ? fallback : governed;
}

function nodeNames(record: RecordRow) {
  const nodes = [
    { type: record.node_type, name: record.node_name },
    { type: record.parent_type, name: record.parent_name },
    { type: record.grandparent_type, name: record.grandparent_name },
  ];
  return {
    tier: text(nodes.find((node) => node.type === "tier")?.name),
    resource: text(nodes.find((node) => node.type === "resource")?.name),
    host: text(nodes.find((node) => node.type === "host")?.name),
  };
}

/**
 * The exact A2O exchange projection is assembled from governed tables.  A
 * denormalized source may, however, contain two distinct source occurrences
 * at one normalized Product/host placement. In that case the shared node or
 * deployment state records can represent only one of those source rows. Use
 * the retained occurrence projection for the other row so XLSX export and the
 * grid do not silently substitute a neighbour's reported values.
 */
export function assembleA2ORow(record: RecordRow): A2ORow {
  const fallback = legacyProjection(record.projection_payload);
  const nodes = nodeNames(record);
  const useOccurrenceNodeValues = Boolean(record.source_row_id && record.node_state_source_row_id && record.source_row_id !== record.node_state_source_row_id);
  const useOccurrenceDeploymentValues = Boolean(record.source_row_id && record.deployment_state_source_row_id && record.source_row_id !== record.deployment_state_source_row_id);
  const nodeValue = (governed: CellValue, source: CellValue) => useOccurrenceNodeValues ? source : governed ?? source;
  const deploymentValue = (governed: CellValue, source: CellValue) => useOccurrenceDeploymentValues ? source : governed ?? source;
  return {
    "#": record.extension_source_key ?? record.snapshot_source_key ?? fallback["#"],
    ReleaseName: governedText(record.release_name, fallback.ReleaseName),
    Tier: governedText(nodes.tier || null, fallback.Tier),
    Resource: governedText(nodes.resource || null, fallback.Resource),
    TechStackType: record.product_type ?? fallback.TechStackType,
    ShortName: record.product_short_name ?? fallback.ShortName,
    HW_Host: governedText(nodes.host || null, fallback.HW_Host),
    HW_Storage_Type: nodeValue(record.storage_type, fallback.HW_Storage_Type),
    "HW_Storage (GB)": nodeValue(record.storage_gb, fallback["HW_Storage (GB)"]),
    HW_CPU_CORES: nodeValue(record.cpu_cores, fallback.HW_CPU_CORES),
    "HW_RAM (GB)": nodeValue(record.ram_gb, fallback["HW_RAM (GB)"]),
    "SW Language": deploymentValue(record.language, fallback["SW Language"]),
    "Software Type": record.software_classification ?? fallback["Software Type"],
    OEM: record.supplier_name ?? fallback.OEM,
    Containerized: deploymentValue(record.containerized, fallback.Containerized),
    "Container Technology": deploymentValue(record.container_technology, fallback["Container Technology"]),
    "Container Type": deploymentValue(record.container_type, fallback["Container Type"]),
    LongName: record.product_name ?? fallback.LongName,
    Notes: record.extension_notes ?? fallback.Notes,
    "Technical Capability Satisfied by this SW/Tech - Notes": record.extension_capability_notes ?? fallback["Technical Capability Satisfied by this SW/Tech - Notes"],
    "Notes.1": record.extension_notes_1 ?? fallback["Notes.1"],
    "Notes.2": record.extension_notes_2 ?? fallback["Notes.2"],
    "Notes.3": record.extension_notes_3 ?? fallback["Notes.3"],
    "Notes.4": record.extension_notes_4 ?? fallback["Notes.4"],
  };
}

export function assemblySelect(includeVoided = false) {
  return `SELECT
    bo.id AS occurrence_id, bo.source_row_id, bo.revision, bo.materialization_status, bo.lifecycle_status, bo.lifecycle_reason, bo.voided_at, bo.voided_by_user_id, bo.projection_payload,
    cb.name AS baseline_name, cb.maturity AS baseline_maturity, cb.as_of AS baseline_as_of,
    sp.file_name AS source_file_name, r.id AS release_id, r.name AS release_name,
    p.id AS product_id, p.canonical_name AS product_name, p.short_name AS product_short_name, p.product_type, p.software_classification,
    cn.id AS configuration_node_id, cn.name AS node_name, cn.node_type, parent.name AS parent_name, parent.node_type AS parent_type, grandparent.name AS grandparent_name, grandparent.node_type AS grandparent_type,
    d.id AS deployment_id, bns.source_row_id AS node_state_source_row_id, bns.storage_type, bns.storage_gb, bns.cpu_cores, bns.ram_gb,
    bds.source_row_id AS deployment_state_source_row_id, bds.language, bds.containerized, bds.container_technology, bds.container_type,
    supplier.name AS supplier_name,
    ext.source_key AS extension_source_key, ext.notes AS extension_notes, ext.capability_notes AS extension_capability_notes, ext.notes_1 AS extension_notes_1, ext.notes_2 AS extension_notes_2, ext.notes_3 AS extension_notes_3, ext.notes_4 AS extension_notes_4,
    sr.source_key AS snapshot_source_key, sr.raw_payload AS source_payload
    FROM baseline_occurrence bo
    LEFT JOIN configuration_baseline cb ON cb.id=bo.baseline_id
    LEFT JOIN release r ON r.id=bo.release_id
    LEFT JOIN product p ON p.id=bo.product_id
    LEFT JOIN configuration_node cn ON cn.id=bo.configuration_node_id
    LEFT JOIN configuration_node parent ON parent.id=cn.parent_id
    LEFT JOIN configuration_node grandparent ON grandparent.id=parent.parent_id
    LEFT JOIN deployment d ON d.id=bo.deployment_id
    LEFT JOIN baseline_node_state bns ON bns.baseline_id=bo.baseline_id AND bns.configuration_node_id=bo.configuration_node_id
    LEFT JOIN baseline_deployment_state bds ON bds.baseline_id=bo.baseline_id AND bds.deployment_id=bo.deployment_id
    LEFT JOIN baseline_record_extension ext ON ext.baseline_occurrence_id=bo.id
    LEFT JOIN source_row_24 sr ON sr.id=bo.source_row_id
    LEFT JOIN source_package sp ON sp.id=sr.source_package_id
    LEFT JOIN organization supplier ON supplier.id=(SELECT ps.organization_id FROM product_supplier ps WHERE ps.product_id=p.id AND ps.supplier_role='supplier' ORDER BY ps.created_at ASC LIMIT 1)
    WHERE bo.workspace_id=? ${includeVoided ? "" : "AND bo.lifecycle_status='active'"}
    `;
}

export function assembledBaselineRecordsFromDatabaseRows(rows: readonly Record<string, unknown>[]) {
  return (rows as unknown as RecordRow[]).map((record) => ({
    occurrenceId: record.occurrence_id, sourceRowId: record.source_row_id, revision: record.revision,
    materializationStatus: record.materialization_status, lifecycleStatus: record.lifecycle_status,
    lifecycleReason: record.lifecycle_reason, voidedAt: record.voided_at, voidedByUserId: record.voided_by_user_id,
    baseline: { name: record.baseline_name, maturity: record.baseline_maturity, asOf: record.baseline_as_of },
    source: { fileName: record.source_file_name, sourceKey: record.snapshot_source_key, row: (() => { try { return asA2ORow(JSON.parse(record.source_payload || "")); } catch { return null; } })() }, releaseId: record.release_id, productId: record.product_id,
    configurationNodeId: record.configuration_node_id, deploymentId: record.deployment_id, row: assembleA2ORow(record),
  })) as AssembledBaselineRecord[];
}

export async function readAssembledBaselineRecords(db: D1Database, options: { includeVoided?: boolean; ids?: string[] } = {}) {
  const ids = options.ids || [];
  const whereIds = ids.length ? " AND bo.id IN (SELECT value FROM json_each(?))" : "";
  const sql = assemblySelect(options.includeVoided) + whereIds + " ORDER BY bo.created_at ASC";
  const result = await db.prepare(sql).bind(BASELINE_WORKSPACE_ID, ...(ids.length ? [JSON.stringify(ids)] : [])).all<RecordRow>();
  return assembledBaselineRecordsFromDatabaseRows(result.results as unknown as Record<string, unknown>[]);
}

export function assembledRecordMatchesSource(record: AssembledBaselineRecord) {
  return Boolean(record.source.row) && TECHNICAL_BASELINE_COLUMNS.every((column) => Object.is(record.row[column], record.source.row?.[column]));
}

export const normalized = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export const textCell = (value: CellValue) => value == null ? null : String(value);
export const numberCell = (value: CellValue) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function recordRequiresReview(row: A2ORow) {
  return !normalized(row.ReleaseName) || (!normalized(row.LongName) && !normalized(row.ShortName) && !normalized(row.HW_Host));
}
