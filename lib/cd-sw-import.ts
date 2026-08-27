import type { InfrastructureNodeType, InstallationRole } from "./topology-model.js";

export const CD_SW_ADAPTER_KEY = "cd_sw_milwaukee";
export const CD_SW_SOURCE_SYSTEM = "Milwaukee Component Deployment Software (CD SW)";

export type CdSwMachine = {
  key: string;
  columnIndex: number;
  columnLabel: string;
  sourceType: string;
  sourceUuid: string;
  name: string;
  code: string;
  nodeType: InfrastructureNodeType;
  issues: string[];
  warnings: string[];
};

export type CdSwSoftwareRow = {
  key: string;
  rowNumber: number;
  componentName: string;
  softwareName: string;
  productName: string;
  version: string;
  description: string;
  vendor: string;
  csci: string;
  sourceType: string;
  trusted: string;
  niap: string;
  verifiedBy: string;
  sourceUuid: string;
  alias: string;
  installationRole: InstallationRole;
  machineKeys: string[];
  issues: string[];
  warnings: string[];
  raw: Record<string, string>;
};

export type CdSwDataset = {
  headerRowNumber: number;
  machineTypeRowNumber: number | null;
  machineUuidRowNumber: number | null;
  machineNameRowNumber: number | null;
  machineCodeRowNumber: number | null;
  machineStartColumn: number;
  machines: CdSwMachine[];
  softwareRows: CdSwSoftwareRow[];
  placementCount: number;
  ignoredMatrixValueCount: number;
  warnings: string[];
};

const MAX_ROWS = 6_000;
const MAX_COLUMNS = 600;
const MAX_CELLS = 1_000_000;
const MAX_PLACEMENTS = 75_000;

export function cleanCdSwCell(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 4_000);
}

export function normalizeCdSwKey(value: unknown) {
  return cleanCdSwCell(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
}

export function spreadsheetColumnLabel(columnIndex: number) {
  let value = columnIndex + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function boundedMatrix(matrix: unknown[][]) {
  if (!Array.isArray(matrix) || !matrix.length) throw new Error("The selected worksheet is empty.");
  if (matrix.length > MAX_ROWS) throw new Error(`The CD SW worksheet exceeds the ${MAX_ROWS.toLocaleString()}-row safety limit.`);
  let cellCount = 0;
  let maxColumns = 0;
  const rows = matrix.map((source) => {
    if (!Array.isArray(source)) throw new Error("The CD SW worksheet contains a malformed row.");
    if (source.length > MAX_COLUMNS) throw new Error(`The CD SW worksheet exceeds the ${MAX_COLUMNS.toLocaleString()}-column safety limit.`);
    cellCount += source.length;
    maxColumns = Math.max(maxColumns, source.length);
    return source.map(cleanCdSwCell);
  });
  if (cellCount > MAX_CELLS) throw new Error(`The CD SW worksheet exceeds the ${MAX_CELLS.toLocaleString()}-cell safety limit.`);
  return { rows, maxColumns };
}

const HEADER_ALIASES = {
  componentName: new Set(["softwarecomponent", "swcomponent", "component"]),
  softwareName: new Set(["softwarename", "applicationname", "productname", "software"]),
  version: new Set(["version", "softwareversion"]),
  description: new Set(["description", "softwaredescription"]),
  vendor: new Set(["vendor", "supplier", "manufacturer"]),
  csci: new Set(["csci"]),
  sourceType: new Set(["type", "softwaretype", "classification"]),
  trusted: new Set(["trusted"]),
  niap: new Set(["niap"]),
  verifiedBy: new Set(["verifiedby", "verified"]),
  sourceUuid: new Set(["uuid", "softwareuuid"]),
  alias: new Set(["alias", "instancename"]),
} as const;

type SoftwareField = keyof typeof HEADER_ALIASES;

function headerMap(row: string[]) {
  const map = new Map<SoftwareField, number>();
  row.forEach((cell, columnIndex) => {
    const key = normalizeCdSwKey(cell);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[SoftwareField, Set<string>]>) {
      if (!map.has(field) && aliases.has(key)) map.set(field, columnIndex);
    }
  });
  return map;
}

function findSoftwareHeader(rows: string[][]) {
  let best: { rowIndex: number; fields: Map<SoftwareField, number>; score: number } | null = null;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const fields = headerMap(row);
    const hasName = fields.has("componentName") || fields.has("softwareName");
    const score = fields.size;
    if (hasName && score >= 4 && (!best || score > best.score)) best = { rowIndex, fields, score };
  }
  if (!best) throw new Error("A CD SW software header row was not found. Expected Software Component/Software Name plus the source metadata columns.");
  return best;
}

function markerPosition(rows: string[][], beforeRow: number, markers: Set<string>) {
  for (let rowIndex = 0; rowIndex < beforeRow; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < rows[rowIndex].length; columnIndex += 1) {
      if (markers.has(normalizeCdSwKey(rows[rowIndex][columnIndex]))) return { rowIndex, columnIndex };
    }
  }
  return null;
}

const NODE_TYPE_VALUES = new Set(["physical", "physicalappliance", "virtualappliance", "virtuallinux", "virtual", "machine", "workstation", "other"]);

function typeRow(rows: string[][], beforeRow: number, machineStart: number) {
  let best: { rowIndex: number; score: number } | null = null;
  for (let rowIndex = 0; rowIndex < beforeRow; rowIndex += 1) {
    const score = rows[rowIndex].slice(machineStart).filter((value) => NODE_TYPE_VALUES.has(normalizeCdSwKey(value))).length;
    if (score > 0 && (!best || score > best.score)) best = { rowIndex, score };
  }
  return best?.rowIndex ?? null;
}

function uuidLike(value: string) {
  return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value.replace(/\s/g, ""));
}

function uuidRow(rows: string[][], beforeRow: number, machineStart: number, markedRow: number | null) {
  if (markedRow != null) return markedRow;
  let best: { rowIndex: number; score: number } | null = null;
  for (let rowIndex = 0; rowIndex < beforeRow; rowIndex += 1) {
    const score = rows[rowIndex].slice(machineStart).filter(uuidLike).length;
    if (score > 0 && (!best || score > best.score)) best = { rowIndex, score };
  }
  return best?.rowIndex ?? null;
}

function nodeType(sourceType: string, name: string): InfrastructureNodeType {
  const source = normalizeCdSwKey(sourceType);
  const label = normalizeCdSwKey(name);
  if (label.includes("switch")) return "network_switch";
  if (label === "ups" || label.includes("uninterruptiblepower")) return "ups";
  if (label.includes("chassis")) return "chassis";
  if (label.includes("blade")) return "blade";
  if (label.includes("storage") || label.includes("san") || label.includes("nas")) return "storage_array";
  if (source === "physicalappliance") return "appliance";
  if (source === "physical" || source === "workstation") return "physical_server";
  if (source === "virtual" || source === "virtuallinux" || source === "virtualappliance" || source === "machine") return "virtual_machine";
  return "other";
}

function installationRole(record: Pick<CdSwSoftwareRow, "productName" | "componentName" | "description" | "sourceType" | "csci">): InstallationRole {
  const value = normalizeCdSwKey(`${record.productName} ${record.componentName} ${record.description} ${record.sourceType} ${record.csci}`);
  if (/windowsserver|redhat|rhel|linux|operatingsystem|\bos\b/.test(value)) return "operating_system";
  if (/vmware|vsphere|esxi|hyperv|hypervisor/.test(value)) return "hypervisor";
  if (/mongodb|oracle|postgres|mysql|sqlserver|database|dbms/.test(value)) return "database";
  if (/kubernetes|rancher|docker|containerd|runtime|java/.test(value)) return "runtime";
  if (/middleware|messagebroker|websphere|tomcat/.test(value)) return "middleware";
  if (/firmware/.test(value)) return "firmware";
  if (/agent|scanner|sensor/.test(value)) return "agent";
  return "application";
}

function isPlacementMarker(value: string) {
  return new Set(["x", "yes", "y", "true", "1", "installed", "present", "✓"]).has(value.trim().toLocaleLowerCase("en-US"));
}

function valueAt(row: string[], fields: Map<SoftwareField, number>, field: SoftwareField) {
  const column = fields.get(field);
  return column == null ? "" : cleanCdSwCell(row[column]);
}

export function parseCdSwMatrix(matrix: unknown[][]): CdSwDataset {
  const { rows, maxColumns } = boundedMatrix(matrix);
  const header = findSoftwareHeader(rows);
  const machineUuidMarker = markerPosition(rows, header.rowIndex, new Set(["machineuuid"]));
  const machineNameMarker = markerPosition(rows, header.rowIndex, new Set(["hostname", "machinename", "serverrole"]));
  const machineCodeMarker = markerPosition(rows, header.rowIndex, new Set(["machineid", "serverid", "id"]));
  const lastSoftwareColumn = Math.max(...header.fields.values());
  const markerColumn = Math.max(machineUuidMarker?.columnIndex ?? -1, machineNameMarker?.columnIndex ?? -1, machineCodeMarker?.columnIndex ?? -1);
  const machineStartColumn = Math.max(lastSoftwareColumn + 1, markerColumn + 1);
  const machineTypeRow = typeRow(rows, header.rowIndex, machineStartColumn);
  const machineUuidRow = uuidRow(rows, header.rowIndex, machineStartColumn, machineUuidMarker?.rowIndex ?? null);
  const machineNameRow = machineNameMarker?.rowIndex ?? (machineUuidRow != null && machineUuidRow + 1 < header.rowIndex ? machineUuidRow + 1 : null);
  const machineCodeRow = machineCodeMarker?.rowIndex ?? (machineNameRow != null && machineNameRow + 1 < header.rowIndex ? machineNameRow + 1 : null);
  const dataRows = rows.slice(header.rowIndex + 1);
  const machineColumns: number[] = [];
  for (let columnIndex = machineStartColumn; columnIndex < maxColumns; columnIndex += 1) {
    const metadata = [machineTypeRow, machineUuidRow, machineNameRow, machineCodeRow].some((rowIndex) => rowIndex != null && cleanCdSwCell(rows[rowIndex]?.[columnIndex]));
    const hasPlacement = dataRows.some((row) => isPlacementMarker(cleanCdSwCell(row[columnIndex])));
    if (metadata || hasPlacement) machineColumns.push(columnIndex);
  }
  if (!machineColumns.length) throw new Error("No CD SW machine columns were found to the right of the software metadata.");

  const machines = machineColumns.map<CdSwMachine>((columnIndex) => {
    const sourceType = machineTypeRow == null ? "" : cleanCdSwCell(rows[machineTypeRow]?.[columnIndex]);
    const sourceUuid = machineUuidRow == null ? "" : cleanCdSwCell(rows[machineUuidRow]?.[columnIndex]).replace(/\s/g, "");
    const name = machineNameRow == null ? "" : cleanCdSwCell(rows[machineNameRow]?.[columnIndex]);
    const code = machineCodeRow == null ? "" : cleanCdSwCell(rows[machineCodeRow]?.[columnIndex]);
    const columnLabel = spreadsheetColumnLabel(columnIndex);
    const key = normalizeCdSwKey(sourceUuid || code || name || `column-${columnLabel}`);
    const issues: string[] = [];
    const warnings: string[] = [];
    if (!name && !code) issues.push(`Machine column ${columnLabel} has neither a name nor an ID.`);
    if (!sourceUuid) warnings.push(`Warning: machine column ${columnLabel} has no source UUID; its ID/code will be used for matching.`);
    if (!sourceType) warnings.push(`Warning: machine column ${columnLabel} has no reported type and will be classified as Other.`);
    else if (!NODE_TYPE_VALUES.has(normalizeCdSwKey(sourceType))) warnings.push(`Warning: reported machine type “${sourceType}” is not recognized and will be classified as Other.`);
    return { key, columnIndex, columnLabel, sourceType, sourceUuid, name: name || code || `Machine ${columnLabel}`, code: code || name || `CDSW-${columnLabel}`, nodeType: nodeType(sourceType, name || code), issues, warnings };
  });
  const duplicateMachineKeys = new Set(machines.filter((machine, index) => machines.findIndex((candidate) => candidate.key === machine.key) !== index).map((machine) => machine.key));
  machines.forEach((machine) => { if (duplicateMachineKeys.has(machine.key)) machine.issues.push(`Machine identity “${machine.sourceUuid || machine.code || machine.name}” appears in more than one column.`); });
  const machineByColumn = new Map(machines.map((machine) => [machine.columnIndex, machine]));

  const softwareRows: CdSwSoftwareRow[] = [];
  let placementCount = 0;
  let ignoredMatrixValueCount = 0;
  rows.slice(header.rowIndex + 1).forEach((row, offset) => {
    const rowNumber = header.rowIndex + offset + 2;
    const componentName = valueAt(row, header.fields, "componentName");
    const softwareName = valueAt(row, header.fields, "softwareName");
    const version = valueAt(row, header.fields, "version");
    const description = valueAt(row, header.fields, "description");
    const vendor = valueAt(row, header.fields, "vendor");
    const csci = valueAt(row, header.fields, "csci");
    const sourceType = valueAt(row, header.fields, "sourceType");
    const trusted = valueAt(row, header.fields, "trusted");
    const niap = valueAt(row, header.fields, "niap");
    const verifiedBy = valueAt(row, header.fields, "verifiedBy");
    const sourceUuid = valueAt(row, header.fields, "sourceUuid").replace(/\s/g, "");
    const alias = valueAt(row, header.fields, "alias");
    const productName = softwareName || componentName || alias;
    const machineKeys: string[] = [];
    machineColumns.forEach((columnIndex) => {
      const marker = cleanCdSwCell(row[columnIndex]);
      if (isPlacementMarker(marker)) {
        machineKeys.push(machineByColumn.get(columnIndex)!.key);
        placementCount += 1;
      } else if (marker) ignoredMatrixValueCount += 1;
    });
    const softwareValues = [...header.fields.values()].some((columnIndex) => cleanCdSwCell(row[columnIndex]));
    if (!softwareValues && !machineKeys.length) return;
    const issues: string[] = [];
    const warnings: string[] = [];
    if (!productName) issues.push(`Source row ${rowNumber} has placements but no Software Name, Software Component, or Alias.`);
    if (!sourceUuid && !alias) warnings.push(`Warning: source row ${rowNumber} has no software UUID or Alias; a composite row identity will be used.`);
    if (!machineKeys.length) warnings.push(`Warning: source row ${rowNumber} has no installation marker; the Product can still be cataloged.`);
    const keyBase = sourceUuid || alias || `${productName}|${componentName}|${version}`;
    const raw = Object.fromEntries((Object.keys(HEADER_ALIASES) as SoftwareField[]).map((field) => [field, valueAt(row, header.fields, field)]));
    const provisional = { key: normalizeCdSwKey(keyBase), rowNumber, componentName, softwareName, productName, version, description, vendor, csci, sourceType, trusted, niap, verifiedBy, sourceUuid, alias, installationRole: "application" as InstallationRole, machineKeys, issues, warnings, raw };
    provisional.installationRole = installationRole(provisional);
    softwareRows.push(provisional);
  });
  const duplicateSoftwareKeys = new Set(softwareRows.filter((record, index) => softwareRows.findIndex((candidate) => candidate.key === record.key) !== index).map((record) => record.key));
  softwareRows.forEach((record) => { if (duplicateSoftwareKeys.has(record.key)) record.issues.push(`Software identity “${record.sourceUuid || record.alias || record.productName}” appears on more than one source row.`); });
  if (placementCount > MAX_PLACEMENTS) throw new Error(`The CD SW worksheet exceeds the ${MAX_PLACEMENTS.toLocaleString()}-placement safety limit.`);
  if (!softwareRows.length) throw new Error("The CD SW worksheet contains no software rows below the detected header.");
  const warnings: string[] = [];
  if (ignoredMatrixValueCount) warnings.push(`${ignoredMatrixValueCount.toLocaleString()} non-empty matrix cell${ignoredMatrixValueCount === 1 ? " was" : "s were"} ignored because only X/Yes/Installed-style markers create placements.`);
  if (machineTypeRow == null) warnings.push("The machine type row was not detected; machine types will require review.");
  return {
    headerRowNumber: header.rowIndex + 1,
    machineTypeRowNumber: machineTypeRow == null ? null : machineTypeRow + 1,
    machineUuidRowNumber: machineUuidRow == null ? null : machineUuidRow + 1,
    machineNameRowNumber: machineNameRow == null ? null : machineNameRow + 1,
    machineCodeRowNumber: machineCodeRow == null ? null : machineCodeRow + 1,
    machineStartColumn,
    machines,
    softwareRows,
    placementCount,
    ignoredMatrixValueCount,
    warnings,
  };
}
