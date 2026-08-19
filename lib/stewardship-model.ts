export type CanonicalKind = "product" | "organization" | "configuration_node";

export type CanonicalEntity = {
  id: string;
  kind: CanonicalKind;
  name: string;
  secondary: string | null;
  referenceCount: number;
};

export type CanonicalAlias = {
  id: string;
  entityKind: CanonicalKind;
  entityId: string;
  entityName: string;
  alias: string;
  namespace: string;
  sourceReference: string | null;
  status: "proposed" | "accepted" | "rejected" | "retired";
  reviewedAt: string | null;
};

export type MergeEvent = {
  id: string;
  entityKind: CanonicalKind;
  sourceEntityId: string;
  targetEntityId: string;
  sourceName: string;
  targetName: string;
  rationale: string;
  sourceReference: string | null;
  mergedAt: string;
};

export type StewardshipPortfolio = {
  entities: CanonicalEntity[];
  aliases: CanonicalAlias[];
  merges: MergeEvent[];
};
