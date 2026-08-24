export const informationOrigins = ["incumbent", "government", "independent", "joint", "unclassified"] as const;
export type InformationOrigin = typeof informationOrigins[number];

export const informationOriginLabels: Record<InformationOrigin, string> = {
  incumbent: "Supplier-reported",
  government: "Government-recorded",
  independent: "Independent analysis",
  joint: "Joint record",
  unclassified: "Origin not classified",
};

export const claimStatusLabels: Record<"reported" | "assessed" | "confirmed", string> = {
  reported: "Source claim",
  assessed: "Government assessment",
  confirmed: "Confirmed technical effect",
};

export const informationStatusSummary = "Source claims record what was supplied. Government assessment records analysis. A Government decision requires a named authority, date, and rationale. A sealed file proves retained bytes, not acceptance.";

export function informationOriginLabel(value: string | null | undefined) {
  return informationOriginLabels[value as InformationOrigin] || informationOriginLabels.unclassified;
}

export function claimStatusLabel(value: "reported" | "assessed" | "confirmed") {
  return claimStatusLabels[value];
}
