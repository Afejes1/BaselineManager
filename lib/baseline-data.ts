import { TECHNICAL_BASELINE_COLUMNS, type TechnicalBaselineColumn } from "./technical-baseline-contract";
import { dataQualityFor } from "./baseline-quality";
import { releaseOf, tierOf } from "./baseline-scope";

export const BASELINE_STORAGE_KEY = "v3-baseline-draft";

export type Cell = string | number | boolean | null | undefined;
export type Record24 = Record<TechnicalBaselineColumn, Cell>;
export type ImportDraft = { fileName: string; sheetName: string; rows: Record24[] };
export type ReviewStatus = "not_reviewed" | "reviewed" | "follow_up";
export type ManualReview = { status: ReviewStatus; reviewedAt: string | null; note?: string | null };

export const detailTabs = [
  { id: "record", label: "Record" },
  { id: "quality", label: "Quality" },
  { id: "review", label: "Review" },
  { id: "occurrences", label: "Occurrences" },
  { id: "normalized", label: "Normalized" },
] as const;

export const sampleRows: Record24[] = [
  makeRow({ "#":"000082", ReleaseName:"30P05", Tier:"Mission Systems", Resource:"ALIS Core", TechStackType:"Platform Service", ShortName:"ODIN", HW_Host:"VM-APP-010", "HW_Storage_Type":"SSD", "HW_Storage (GB)":720, HW_CPU_CORES:12, "HW_RAM (GB)":48, "SW Language":"Java", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", "Container Type":"Service", LongName:"Operational Data Integrated Network", Notes:"Prior-release reported placement." }),
  makeRow({ "#":"000083", ReleaseName:"30P05", Tier:"Mission Systems", Resource:"ALIS Core", TechStackType:"Data Service", ShortName:"DataSvc", HW_Host:"VM-DB-003", "HW_Storage_Type":"SSD", "HW_Storage (GB)":1000, HW_CPU_CORES:10, "HW_RAM (GB)":40, "SW Language":"C#", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", "Container Type":"Service", LongName:"Maintenance Data Service" }),
  makeRow({ "#":"000119", ReleaseName:"30P05", Tier:"Training", Resource:"Courseware", TechStackType:"Web Application", ShortName:"TMS", HW_Host:"VM-WEB-018", "HW_Storage_Type":"SAN", "HW_Storage (GB)":300, HW_CPU_CORES:8, "HW_RAM (GB)":24, "SW Language":"TypeScript", "Software Type":"GOTS", OEM:"Government", Containerized:"No", LongName:"Training Management System" }),
  makeRow({ "#":"000184", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"ALIS Core", TechStackType:"Platform Service", ShortName:"ODIN", HW_Host:"VM-APP-012", "HW_Storage_Type":"SSD", "HW_Storage (GB)":850, HW_CPU_CORES:16, "HW_RAM (GB)":64, "SW Language":"Java", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", "Container Type":"Service", LongName:"Operational Data Integrated Network" }),
  makeRow({ "#":"000185", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"ALIS Core", TechStackType:"Data Service", ShortName:"DataSvc", HW_Host:"VM-DB-004", "HW_Storage_Type":"SSD", "HW_Storage (GB)":1200, HW_CPU_CORES:12, "HW_RAM (GB)":48, "SW Language":"C#", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", "Container Type":"Service", LongName:"Maintenance Data Service", Notes:"Confirm authoritative OEM designation." }),
  makeRow({ "#":"000219", ReleaseName:"30P06", Tier:"Training", Resource:"Courseware", TechStackType:"Web Application", ShortName:"TMS", HW_Host:"VM-WEB-022", "HW_Storage_Type":"SAN", "HW_Storage (GB)":350, HW_CPU_CORES:8, "HW_RAM (GB)":24, "SW Language":"TypeScript", "Software Type":"GOTS", OEM:"Government", Containerized:"No", LongName:"Training Management System" }),
  makeRow({ "#":"000241", ReleaseName:"30P06", Tier:"Logistics", Resource:"Supply Chain", TechStackType:"Business Service", ShortName:"SPS", HW_Host:"BLD-07-N03", "HW_Storage_Type":"", "HW_Storage (GB)":500, HW_CPU_CORES:8, "HW_RAM (GB)":32, "SW Language":"Java", "Software Type":"COTS", OEM:"COTS Vendor", Containerized:"Yes", "Container Technology":"Docker", LongName:"Spare Parts Service", Notes:"Storage type is unresolved." }),
  makeRow({ "#":"000258", ReleaseName:"30P06", Tier:"Mission Systems", Resource:"Flight Data", TechStackType:"Custom Software", ShortName:"FDP", HW_Host:"VM-API-031", "HW_Storage_Type":"SSD", "HW_Storage (GB)":640, HW_CPU_CORES:24, "HW_RAM (GB)":96, "SW Language":"C++", "Software Type":"Custom", OEM:"Lockheed Martin", Containerized:"Yes", "Container Technology":"Kubernetes", LongName:"Flight Data Processor" }),
  makeRow({ "#":"000276", ReleaseName:"30P06", Tier:"Cyber", Resource:"Identity", TechStackType:"COTS", ShortName:"IDAM", HW_Host:"VM-IAM-002", "HW_Storage_Type":"SAN", "HW_Storage (GB)":280, HW_CPU_CORES:8, "HW_RAM (GB)":32, "SW Language":"Java", "Software Type":"COTS", OEM:"OEM Partner", Containerized:"No", LongName:"Identity and Access Manager", "Technical Capability Satisfied by this SW/Tech - Notes":"Identity assurance" }),
];

function makeRow(values: Partial<Record24>): Record24 {
  return { ...blankRecord(), ...values };
}

export function blankRecord(): Record24 {
  return Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, ""])) as Record24;
}

export function toSlug(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "unnamed";
}

export const text = (value: Cell) => value == null ? "" : String(value);

export function loadRowsFromStorage(raw?: string | null): Record24[] {
  if (!raw) return [...sampleRows];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...sampleRows];
    return parsed.map((item) => {
      const row = blankRecord();
      if (item && typeof item === "object") {
        for (const column of TECHNICAL_BASELINE_COLUMNS) {
          const value = (item as Record<string, unknown>)[column];
          if (value === null || value === undefined) continue;
          row[column] = value as Cell;
        }
      }
      return row;
    });
  } catch {
    return [...sampleRows];
  }
}

export function productDisplayName(row: Record24): string {
  return text(row.LongName).trim() || text(row.ShortName).trim() || "Unnamed product";
}

export function productIdentityKey(row: Record24, fallbackIndex?: number): string {
  const longName = text(row.LongName).trim();
  const shortName = text(row.ShortName).trim();
  const sourceKey = text(row["#"]).trim();
  const keySource = toSlug(longName || shortName || sourceKey || String(fallbackIndex ?? ""));
  const aliasPart = shortName ? `::${toSlug(shortName)}` : "";
  return `${keySource}${aliasPart}`;
}

export function supplierIdentity(supplier: string): string {
  return toSlug(supplier || "unassigned");
}

export function capabilityIdentity(capability: string): string {
  return toSlug(capability || "unspecified");
}

export function configNodeIdentity(row: Record24): string {
  return `${toSlug(text(row.ReleaseName) || "unassigned")}|${toSlug(text(row.Tier) || "unassigned")}|${toSlug(text(row.Resource) || "unassigned")}|${toSlug(text(row.HW_Host) || "unassigned")}`;
}

export type ReleaseSummary = {
  release: string;
  rows: number;
  products: number;
  tiers: number;
  issues: number;
  warnings: number;
  hosts: number;
};

export type ProductSummary = {
  id: string;
  canonical: string;
  shortName: string;
  supplier: string;
  rowCount: number;
  releases: string[];
  tiers: number;
  issueCount: number;
  warningCount: number;
  rows: Record24[];
};

export type ConfigNodeSummary = {
  id: string;
  release: string;
  tier: string;
  resource: string;
  host: string;
  rowCount: number;
  productCount: number;
  rows: Record24[];
};

export type OrganizationSummary = {
  id: string;
  name: string;
  rowCount: number;
  productCount: number;
  releases: string[];
  rows: Record24[];
};

export type CapabilitySummary = {
  id: string;
  name: string;
  rowCount: number;
  productCount: number;
  rows: Record24[];
};

export type ConfigReleaseNode = {
  release: string;
  previousRelease?: string;
  changeType: "new" | "removed" | "continued" | "modified";
  counts: {
    current: number;
    previous: number;
  };
};

const stableSort = (value: string) => value.toLowerCase();

export function getReleases(rows: Record24[]): string[] {
  return Array.from(new Set(rows.map((row) => text(releaseOf(row)) || "Unassigned")).values()).sort((left, right) => stableSort(left).localeCompare(stableSort(right), undefined, { numeric: true }));
}

export function getReleaseSummary(rows: Record24[], release: string): ReleaseSummary | null {
  const inScope = rows.filter((row) => text(releaseOf(row)) === release);
  if (!inScope.length) return null;
  const products = new Set(inScope.map((row) => productIdentityKey(row)));
  const tiers = new Set(inScope.map((row) => text(tierOf(row))));
  const hosts = new Set(inScope.map((row) => text(row.HW_Host) || "Unassigned"));
  const issueCount = inScope.filter((row) => dataQualityFor(row).level === "issue").length;
  const warningCount = inScope.filter((row) => dataQualityFor(row).level === "review").length;
  return {
    release,
    rows: inScope.length,
    products: products.size,
    tiers: tiers.size,
    issues: issueCount,
    warnings: warningCount,
    hosts: hosts.size,
  };
}

export function getReleaseSummaries(rows: Record24[]): ReleaseSummary[] {
  const buckets = new Map<string, Record24[]>();
  for (const row of rows) {
    const release = text(releaseOf(row)) || "Unassigned";
    const existing = buckets.get(release);
    if (existing) existing.push(row);
    else buckets.set(release, [row]);
  }
  const summaries: ReleaseSummary[] = [];
  for (const [release, releaseRows] of buckets) {
    const products = new Set(releaseRows.map((row) => productIdentityKey(row)));
    const tiers = new Set(releaseRows.map((row) => text(tierOf(row))));
    const hosts = new Set(releaseRows.map((row) => text(row.HW_Host) || "Unassigned"));
    summaries.push({
      release,
      rows: releaseRows.length,
      products: products.size,
      tiers: tiers.size,
      issues: releaseRows.filter((row) => dataQualityFor(row).level === "issue").length,
      warnings: releaseRows.filter((row) => dataQualityFor(row).level === "review").length,
      hosts: hosts.size,
    });
  }
  return summaries.sort((left, right) => stableSort(left.release).localeCompare(stableSort(right.release), undefined, { numeric: true }));
}

export function getProductSummaries(rows: Record24[]): ProductSummary[] {
  const products = new Map<string, ProductSummary>();
  let index = 0;
  for (const row of rows) {
    const id = productIdentityKey(row, index++);
    const summary = products.get(id);
    const currentRelease = text(releaseOf(row));
    const issueCount = dataQualityFor(row).level === "issue" ? 1 : 0;
    const warningCount = dataQualityFor(row).level === "review" ? 1 : 0;
    if (!summary) {
      products.set(id, {
        id,
        canonical: productDisplayName(row),
        shortName: text(row.ShortName).trim(),
        supplier: text(row.OEM).trim() || "Unassigned",
        rowCount: 1,
        releases: currentRelease ? [currentRelease] : [],
        tiers: 1,
        issueCount,
        warningCount,
        rows: [row],
      });
    } else {
      summary.rowCount += 1;
      if (currentRelease && !summary.releases.includes(currentRelease)) summary.releases.push(currentRelease);
      summary.tiers = new Set([...summary.rows.map((item) => text(tierOf(item))), text(tierOf(row))]).size;
      summary.issueCount += issueCount;
      summary.warningCount += warningCount;
      summary.rows.push(row);
      summary.shortName = summary.shortName || text(row.ShortName).trim();
      summary.supplier = summary.supplier || text(row.OEM).trim() || "Unassigned";
      summary.canonical = summary.canonical || productDisplayName(row);
    }
  }
  return [...products.values()].sort((left, right) => left.canonical.localeCompare(right.canonical));
}

export function getProductRows(rows: Record24[], productId: string): Record24[] {
  return rows.filter((row) => productIdentityKey(row) === productId);
}

export function getConfigurationNodeSummaries(rows: Record24[]): ConfigNodeSummary[] {
  const nodes = new Map<string, ConfigNodeSummary>();
  for (const row of rows) {
    const id = configNodeIdentity(row);
    const existing = nodes.get(id);
    const release = text(releaseOf(row)) || "Unassigned";
    const tier = text(tierOf(row)) || "Unassigned";
    const resource = text(row.Resource).trim() || "Unassigned";
    const host = text(row.HW_Host).trim() || "Unassigned";
    if (!existing) {
      nodes.set(id, {
        id,
        release,
        tier,
        resource,
        host,
        rowCount: 1,
        productCount: 1,
        rows: [row],
      });
    } else {
      existing.rowCount += 1;
      existing.rows.push(row);
      const currentProducts = new Set(existing.rows.map((item) => productIdentityKey(item)));
      existing.productCount = currentProducts.size;
    }
  }
  return [...nodes.values()].sort((left, right) => {
    const byRelease = stableSort(left.release).localeCompare(stableSort(right.release), undefined, { numeric: true });
    if (byRelease !== 0) return byRelease;
    const byTier = stableSort(left.tier).localeCompare(stableSort(right.tier));
    if (byTier !== 0) return byTier;
    const byResource = stableSort(left.resource).localeCompare(stableSort(right.resource));
    if (byResource !== 0) return byResource;
    return stableSort(left.host).localeCompare(stableSort(right.host));
  });
}

export function getConfigurationRows(rows: Record24[], nodeId: string): Record24[] {
  return rows.filter((row) => configNodeIdentity(row) === nodeId);
}

export function getOrganizationSummaries(rows: Record24[]): OrganizationSummary[] {
  const suppliers = new Map<string, OrganizationSummary>();
  for (const row of rows) {
    const name = text(row.OEM).trim() || "Unassigned";
    const id = supplierIdentity(name);
    const release = text(releaseOf(row));
    const existing = suppliers.get(id);
    if (!existing) {
      suppliers.set(id, {
        id,
        name,
        rowCount: 1,
        productCount: 1,
        releases: release ? [release] : [],
        rows: [row],
      });
    } else {
      existing.rowCount += 1;
      existing.rows.push(row);
      const products = new Set(existing.rows.map((item) => productIdentityKey(item)));
      existing.productCount = products.size;
      if (release && !existing.releases.includes(release)) existing.releases.push(release);
    }
  }
  return [...suppliers.values()].sort((left, right) => stableSort(left.name).localeCompare(stableSort(right.name)));
}

export function getOrganizationRows(rows: Record24[], orgId: string): Record24[] {
  const organization = decodeURIComponent(orgId);
  return rows.filter((row) => supplierIdentity(text(row.OEM).trim()) === supplierIdentity(organization));
}

export function getCapabilitySummaries(rows: Record24[]): CapabilitySummary[] {
  const caps = new Map<string, CapabilitySummary>();
  for (const row of rows) {
    const name = text(row["Technical Capability Satisfied by this SW/Tech - Notes"]).trim() || "Unspecified";
    const id = capabilityIdentity(name);
    const existing = caps.get(id);
    if (!existing) {
      caps.set(id, {
        id,
        name,
        rowCount: 1,
        productCount: 1,
        rows: [row],
      });
    } else {
      existing.rowCount += 1;
      existing.rows.push(row);
      const products = new Set(existing.rows.map((item) => productIdentityKey(item)));
      existing.productCount = products.size;
    }
  }
  return [...caps.values()].sort((left, right) => stableSort(left.name).localeCompare(stableSort(right.name)));
}

export function getCapabilityRows(rows: Record24[], capabilityId: string): Record24[] {
  const normalized = decodeURIComponent(capabilityId);
  return rows.filter((row) => capabilityIdentity(text(row["Technical Capability Satisfied by this SW/Tech - Notes"]).trim() || "Unspecified") === capabilityIdentity(normalized));
}

export function releaseComparisonSummary(rows: Record24[], release: string): { previous?: string; added: string[]; removed: string[] } {
  const releases = getReleases(rows);
  const ordered = releases.sort((left, right) => stableSort(left).localeCompare(stableSort(right), undefined, { numeric: true }));
  const currentIndex = ordered.indexOf(release);
  if (currentIndex <= 0) {
    return { previous: undefined, added: [], removed: [] };
  }
  const previousRelease = ordered[currentIndex - 1];
  const currentProducts = new Set(rows.filter((row) => text(releaseOf(row)) === release).map((row) => productIdentityKey(row)));
  const previousProducts = new Set(rows.filter((row) => text(releaseOf(row)) === previousRelease).map((row) => productIdentityKey(row)));
  const added = [...currentProducts].filter((productId) => !previousProducts.has(productId));
  const removed = [...previousProducts].filter((productId) => !currentProducts.has(productId));
  return { previous: previousRelease, added, removed };
}

export function getProductReleaseHistory(productRows: Record24[]): { release: string; rows: Record24[] }[] {
  const byRelease = new Map<string, Record24[]>();
  for (const row of productRows) {
    const release = text(releaseOf(row));
    if (!release) continue;
    const current = byRelease.get(release);
    if (current) current.push(row);
    else byRelease.set(release, [row]);
  }
  return [...byRelease.entries()]
    .map(([release, releaseRows]) => ({ release, rows: releaseRows }))
    .sort((left, right) => stableSort(left.release).localeCompare(stableSort(right.release), undefined, { numeric: true }));
}

export function compareReleaseChanges(rowsByRelease: { release: string; rows: Record24[] }[]): { release: string; addedFields: string[]; hostDelta: number; productDelta: number }[] {
  const diffs: { release: string; addedFields: string[]; hostDelta: number; productDelta: number }[] = [];
  for (let i = 0; i < rowsByRelease.length; i++) {
    if (i === 0) {
      diffs.push({ release: rowsByRelease[i].release, addedFields: ["Initial baseline"], hostDelta: rowsByRelease[i].rows.length, productDelta: new Set(rowsByRelease[i].rows.map((row) => productIdentityKey(row))).size });
      continue;
    }
    const current = rowsByRelease[i];
    const previous = rowsByRelease[i - 1];
    const currentSet = new Set(current.rows.map((row) => productIdentityKey(row)));
    const previousSet = new Set(previous.rows.map((row) => productIdentityKey(row)));
    const fields: string[] = [];

    const currentHostSet = new Set(current.rows.map((row) => text(row.HW_Host) || "Unassigned"));
    const previousHostSet = new Set(previous.rows.map((row) => text(row.HW_Host) || "Unassigned"));

    if (currentSet.size > previousSet.size) fields.push("More products than prior release");
    if (currentSet.size < previousSet.size) fields.push("Fewer products than prior release");
    if (currentHostSet.size > previousHostSet.size) fields.push("Expanded host coverage");
    if (currentHostSet.size < previousHostSet.size) fields.push("Consolidated host coverage");

    const hostDelta = currentHostSet.size - previousHostSet.size;
    const productDelta = currentSet.size - previousSet.size;
    diffs.push({
      release: current.release,
      addedFields: fields.length ? fields : ["No obvious aggregate change"],
      hostDelta,
      productDelta,
    });
  }
  return diffs;
}
