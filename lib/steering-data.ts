import { dataQualityFor } from "./baseline-quality";
import {
  getReleases,
  productDisplayName,
  productIdentityKey,
  text,
  type Record24,
} from "./baseline-data";

export const INITIATIVE_STORAGE_KEY = "v3-initiatives";
export const BRIEF_STORAGE_KEY = "v3-briefs";

export type InitiativeStatus = "Draft" | "Active" | "Decision required" | "Closed";
export type WorkPackageStatus = "Planned" | "In progress" | "On hold" | "Complete";
export type EvidenceKind = "Decision" | "Technical note" | "Risk" | "Question";
export type BriefStatus = "Draft" | "Reviewed" | "Published" | "Superseded";

export type WorkPackage = {
  id: string;
  title: string;
  owner: string;
  dueDate: string;
  status: WorkPackageStatus;
  notes: string;
};

export type InitiativeEvidence = {
  id: string;
  author: string;
  kind: EvidenceKind;
  recordedAt: string;
  note: string;
};

export type Initiative = {
  id: string;
  title: string;
  consequence: string;
  owner: string;
  targetDate: string;
  status: InitiativeStatus;
  outcome: string;
  affectedRelease: string;
  affectedProductIds: string[];
  workPackages: WorkPackage[];
  evidence: InitiativeEvidence[];
  createdAt: string;
  updatedAt: string;
};

export type InitiativeSummary = {
  initiative: Initiative;
  sourceRows: number;
  products: number;
  releases: number;
  blockingIssues: number;
  warnings: number;
};

export type Brief = {
  id: string;
  title: string;
  initiativeId: string;
  initiativeTitle: string;
  releaseScope: string;
  status: BriefStatus;
  notes: string;
  sourceRows: number;
  products: number;
  releases: number;
  createdAt: string;
  updatedAt: string;
};

export const briefStatuses: BriefStatus[] = ["Draft", "Reviewed", "Published", "Superseded"];
export const initiativeStatuses: InitiativeStatus[] = ["Draft", "Active", "Decision required", "Closed"];

function toIsoNow() {
  return new Date().toISOString();
}

function identity() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.round(Math.random() * 9999)}`;
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length ? value.trim() : fallback;
}

function asStatus(value: unknown): InitiativeStatus {
  return initiativeStatuses.includes(value as InitiativeStatus) ? value as InitiativeStatus : "Draft";
}

function asBriefStatus(value: unknown): BriefStatus {
  return briefStatuses.includes(value as BriefStatus) ? value as BriefStatus : "Draft";
}

function asWorkPackageStatus(value: unknown): WorkPackageStatus {
  return value === "In progress" || value === "On hold" || value === "Complete" ? value as WorkPackageStatus : "Planned";
}

function asEvidenceKind(value: unknown): EvidenceKind {
  return value === "Technical note" || value === "Risk" || value === "Question" ? value as EvidenceKind : "Decision";
}

function parseEvidence(value: unknown): InitiativeEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const payload = entry as Record<string, unknown>;
      const note = asString(payload.note, "");
      if (!note) return null;
      return {
        id: asString(payload.id, identity()),
        author: asString(payload.author, "Unknown analyst"),
        kind: asEvidenceKind(payload.kind),
        recordedAt: asString(payload.recordedAt, toIsoNow()),
        note,
      };
    })
    .filter((item): item is InitiativeEvidence => Boolean(item));
}

function parseWorkPackages(value: unknown): WorkPackage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const payload = entry as Record<string, unknown>;
      const title = asString(payload.title, "");
      const notes = asString(payload.notes, "");
      if (!title && !notes) return null;
      return {
        id: asString(payload.id, identity()),
        title,
        owner: asString(payload.owner, "Unassigned"),
        dueDate: asString(payload.dueDate, ""),
        status: asWorkPackageStatus(payload.status),
        notes,
      };
    })
    .filter((entry): entry is WorkPackage => Boolean(entry));
}

export function initiativeAffectedRows(rows: Record24[], initiative: Initiative | null): Record24[] {
  if (!initiative) return [];
  return rows.filter((row) => {
    const inRelease = initiative.affectedRelease === "All releases" || text(row.ReleaseName).trim() === initiative.affectedRelease;
    if (!inRelease) return false;
    if (!initiative.affectedProductIds.length) return true;
    return initiative.affectedProductIds.includes(productIdentityKey(row));
  });
}

export function initiativeSummary(rows: Record24[], initiative: Initiative | null): InitiativeSummary {
  const affected = initiativeAffectedRows(rows, initiative);
  if (!initiative) {
    return {
      initiative: null as unknown as Initiative,
      sourceRows: 0,
      products: 0,
      releases: 0,
      blockingIssues: 0,
      warnings: 0,
    };
  }
  if (!affected.length) {
    const releases = initiative.affectedRelease === "All releases" ? getReleases(rows).length : 1;
    return {
      initiative,
      sourceRows: 0,
      products: 0,
      releases,
      blockingIssues: 0,
      warnings: 0,
    };
  }
  return {
    initiative,
    sourceRows: affected.length,
    products: new Set(affected.map((row) => productIdentityKey(row))).size,
    releases: new Set(affected.map((row) => text(row.ReleaseName) || "Unassigned")).size,
    blockingIssues: affected.filter((row) => dataQualityFor(row).level === "issue").length,
    warnings: affected.filter((row) => dataQualityFor(row).level === "review").length,
  };
}

export function getInitiativeSummaries(rows: Record24[], initiatives: Initiative[]): InitiativeSummary[] {
  return initiatives
    .map((initiative) => {
      const affected = initiativeAffectedRows(rows, initiative);
      return {
        initiative,
        sourceRows: affected.length,
        products: new Set(affected.map((row) => productIdentityKey(row))).size,
        releases: new Set(affected.map((row) => text(row.ReleaseName) || "Unassigned")).size,
        blockingIssues: affected.filter((row) => dataQualityFor(row).level === "issue").length,
        warnings: affected.filter((row) => dataQualityFor(row).level === "review").length,
      };
    })
    .sort((left, right) => new Date(right.initiative.updatedAt).getTime() - new Date(left.initiative.updatedAt).getTime());
}

export function getInitiativeReleaseOptions(rows: Record24[]): string[] {
  return ["All releases", ...getReleases(rows)];
}

export function getInitiativeProductOptions(rows: Record24[], release: string): string[] {
  const bucket = new Map<string, string>();
  for (const row of rows) {
    if (release !== "All releases" && text(row.ReleaseName).trim() !== release) continue;
    bucket.set(productIdentityKey(row), productDisplayName(row));
  }
  return [...bucket.entries()].sort((left, right) => left[1].localeCompare(right[1])).map(([id]) => id);
}

export function loadInitiatives(raw?: string | null): Initiative[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const payload = entry as Record<string, unknown>;
        const created = asString(payload.createdAt, toIsoNow());
        return {
          id: asString(payload.id, identity()),
          title: asString(payload.title, "Unnamed initiative"),
          consequence: asString(payload.consequence, ""),
          owner: asString(payload.owner, "Unassigned"),
          targetDate: asString(payload.targetDate, ""),
          status: asStatus(payload.status),
          outcome: asString(payload.outcome, ""),
          affectedRelease: asString(payload.affectedRelease, "All releases"),
          affectedProductIds: asArray(payload.affectedProductIds),
          workPackages: parseWorkPackages(payload.workPackages),
          evidence: parseEvidence(payload.evidence),
          createdAt: asString(payload.createdAt, created),
          updatedAt: asString(payload.updatedAt, created),
        };
      })
      .filter((initiative): initiative is Initiative => Boolean(initiative));
  } catch {
    return [];
  }
}

export function createInitiativeRecord(payload: {
  title: string;
  owner: string;
  consequence: string;
  outcome: string;
  targetDate: string;
  status: InitiativeStatus;
  affectedRelease: string;
  affectedProductIds: string[];
}): Initiative {
  const now = toIsoNow();
  return {
    id: identity(),
    title: asString(payload.title, "Unnamed initiative"),
    owner: asString(payload.owner, "Unassigned"),
    consequence: payload.consequence.trim(),
    outcome: payload.outcome.trim(),
    targetDate: payload.targetDate,
    status: payload.status,
    affectedRelease: payload.affectedRelease,
    affectedProductIds: payload.affectedProductIds,
    workPackages: [],
    evidence: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function makeBriefFromInitiative(rows: Record24[], initiative: Initiative): Brief {
  const affectedRows = initiativeAffectedRows(rows, initiative);
  const rowsByRelease = new Set(affectedRows.map((row) => text(row.ReleaseName) || "Unassigned").filter(Boolean));
  const now = toIsoNow();
  return {
    id: identity(),
    title: `${initiative.title} — Brief`,
    initiativeId: initiative.id,
    initiativeTitle: initiative.title,
    releaseScope: initiative.affectedRelease === "All releases" ? "Cross-release scope" : initiative.affectedRelease,
    status: "Draft",
    notes: `Brief generated from initiative: ${initiative.consequence || "(No consequence provided)"}`,
    sourceRows: affectedRows.length,
    products: new Set(affectedRows.map((row) => productIdentityKey(row))).size,
    releases: rowsByRelease.size || (initiative.affectedRelease === "All releases" ? getReleases(rows).length : 1),
    createdAt: now,
    updatedAt: now,
  };
}

export function briefMarkdown(brief: Brief, initiative: Initiative | null, rows: Record24[]) {
  const affectedRows = initiative ? initiativeAffectedRows(rows, initiative) : [];
  const productNames = [...new Set(affectedRows.map((row) => productDisplayName(row)))];
  const topProducts = productNames.slice(0, 20);
  const issueCount = affectedRows.filter((row) => dataQualityFor(row).level === "issue").length;
  const warningCount = affectedRows.filter((row) => dataQualityFor(row).level === "review").length;

  return `# ${brief.title}\\n\\n` +
    `## Initiative\\n${initiative?.title ?? "(Initiative removed from workspace)"}\\n\\n` +
    `- Owner: ${initiative?.owner ?? "Unassigned"}\\n` +
    `- Target date: ${initiative?.targetDate || "Unspecified"}\\n` +
    `- Status: ${initiative?.status ?? "Unknown"}\\n\\n` +
    `## Brief status\\n- Publication status: ${brief.status}\\n- Updated: ${new Date(brief.updatedAt).toLocaleString()}\\n- Generated source scope: ${brief.releaseScope}\\n\\n` +
    `## Consequence / outcome\\n${initiative?.consequence || "Not provided"}\\n\\n` +
    `**Desired outcome**\\n${initiative?.outcome || "Not provided"}\\n\\n` +
    `## Scope\\n- Source rows: ${brief.sourceRows}\\n- Products: ${brief.products}\\n- Releases: ${brief.releases}\\n- Quality alerts: ${issueCount} blocking, ${warningCount} warnings\\n` +
    `${topProducts.length ? `\\n## Representative products\\n${topProducts.map((name) => `- ${name}`).join("\\n")}\\n` : ""}` +
    `\\n## Evidence\\n${initiative?.evidence?.length ? initiative.evidence
      .slice(0, 12)
      .map((entry) => `- [${entry.kind}] ${entry.author} (${new Date(entry.recordedAt).toLocaleDateString()}): ${entry.note}`)
      .join("\\n") : "No evidence records captured yet."}\\n`;
}

export function loadBriefs(raw?: string | null): Brief[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const payload = entry as Record<string, unknown>;
        const created = asString(payload.createdAt, toIsoNow());
        return {
          id: asString(payload.id, identity()),
          title: asString(payload.title, "Unnamed brief"),
          initiativeId: asString(payload.initiativeId, ""),
          initiativeTitle: asString(payload.initiativeTitle, "Initiative not found"),
          releaseScope: asString(payload.releaseScope, "All releases"),
          status: asBriefStatus(payload.status),
          notes: asString(payload.notes, ""),
          sourceRows: Number(payload.sourceRows) || 0,
          products: Number(payload.products) || 0,
          releases: Number(payload.releases) || 0,
          createdAt: asString(payload.createdAt, created),
          updatedAt: asString(payload.updatedAt, created),
        };
      })
      .filter((brief): brief is Brief => Boolean(brief));
  } catch {
    return [];
  }
}
