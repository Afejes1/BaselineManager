export const SYNTHETIC_HANDLING_MARKING = "SYNTHETIC DEMONSTRATION DATA — NOT PROGRAM DATA" as const;
export const PROGRAM_HANDLING_MARKING = "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED" as const;

export type OutputHandlingMarking = typeof SYNTHETIC_HANDLING_MARKING | typeof PROGRAM_HANDLING_MARKING;
export type WorkspaceClassification = "SYNTHETIC DEMONSTRATION DATA" | "PROGRAM WORKING DATA";

export const DEMONSTRATION_SOURCE_FILE_NAME = "JSF_V3_Demonstration_Baseline.xlsx" as const;
const DEMONSTRATION_SOURCE_KEY_PREFIX = "DEMO-";

export function sourceNameIsSynthetic(sourceName: string) {
  return sourceName.normalize("NFKC") === DEMONSTRATION_SOURCE_FILE_NAME;
}

export function sourceKeyIsSynthetic(sourceKey: string) {
  return sourceKey.normalize("NFKC").startsWith(DEMONSTRATION_SOURCE_KEY_PREFIX);
}

export function sourceLineageIsSynthetic(lineage: readonly { fileName: string; sourceKey: string; projectionMatchesSource: boolean }[]) {
  return lineage.length > 0 && lineage.every((item) => item.projectionMatchesSource && sourceNameIsSynthetic(item.fileName) && sourceKeyIsSynthetic(item.sourceKey));
}

export function sourceNamesAreSynthetic(sourceNames: readonly string[]) {
  return sourceNames.length > 0 && sourceNames.every(sourceNameIsSynthetic);
}

export function handlingMarkingFromSourceNames(sourceNames: readonly string[], demonstrationRuntimeEnabled = false): OutputHandlingMarking {
  return demonstrationRuntimeEnabled && sourceNamesAreSynthetic(sourceNames) ? SYNTHETIC_HANDLING_MARKING : PROGRAM_HANDLING_MARKING;
}

export function workspaceClassificationFromSourceNames(sourceNames: readonly string[], demonstrationRuntimeEnabled = false): WorkspaceClassification {
  return demonstrationRuntimeEnabled && sourceNamesAreSynthetic(sourceNames) ? "SYNTHETIC DEMONSTRATION DATA" : "PROGRAM WORKING DATA";
}

export function handlingMarkingFromSourceLineage(lineage: readonly { fileName: string; sourceKey: string; projectionMatchesSource: boolean }[], demonstrationRuntimeEnabled = false): OutputHandlingMarking {
  return demonstrationRuntimeEnabled && sourceLineageIsSynthetic(lineage) ? SYNTHETIC_HANDLING_MARKING : PROGRAM_HANDLING_MARKING;
}

export function workspaceClassificationFromSourceLineage(sourceNames: readonly string[], sourceKeys: readonly string[], everyOccurrenceMatchesSource: boolean, demonstrationRuntimeEnabled = false): WorkspaceClassification {
  return demonstrationRuntimeEnabled && sourceNamesAreSynthetic(sourceNames) && sourceKeys.length > 0 && sourceKeys.every(sourceKeyIsSynthetic) && everyOccurrenceMatchesSource
    ? "SYNTHETIC DEMONSTRATION DATA"
    : "PROGRAM WORKING DATA";
}
