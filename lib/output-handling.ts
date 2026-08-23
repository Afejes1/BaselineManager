export const SYNTHETIC_HANDLING_MARKING = "SYNTHETIC DEMONSTRATION DATA — NOT PROGRAM DATA" as const;
export const PROGRAM_HANDLING_MARKING = "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED" as const;

export type OutputHandlingMarking = typeof SYNTHETIC_HANDLING_MARKING | typeof PROGRAM_HANDLING_MARKING;
export type WorkspaceClassification = "SYNTHETIC DEMONSTRATION DATA" | "PROGRAM WORKING DATA";

const syntheticSourcePattern = /(?:^|[^a-z0-9])(?:demo(?:nstration)?|synthetic)(?:[^a-z0-9]|$)/i;

export function sourceNamesAreSynthetic(sourceNames: readonly string[]) {
  return sourceNames.length > 0 && sourceNames.every((name) => syntheticSourcePattern.test(name.normalize("NFKC")));
}

export function handlingMarkingFromSourceNames(sourceNames: readonly string[]): OutputHandlingMarking {
  return sourceNamesAreSynthetic(sourceNames) ? SYNTHETIC_HANDLING_MARKING : PROGRAM_HANDLING_MARKING;
}

export function workspaceClassificationFromSourceNames(sourceNames: readonly string[]): WorkspaceClassification {
  return sourceNamesAreSynthetic(sourceNames) ? "SYNTHETIC DEMONSTRATION DATA" : "PROGRAM WORKING DATA";
}
