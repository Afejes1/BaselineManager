import { hashSolutionDecisionBasis } from "./solution-decision-basis.js";

export type SolutionDecisionTransferRow = Record<string, unknown>;

export async function validateSolutionDecisionHistory(rowsByTable: ReadonlyMap<string, SolutionDecisionTransferRow[]>) {
  const decisions = rowsByTable.get("initiative_solution_decision") ?? [];
  const revisions = rowsByTable.get("initiative_solution_decision_revision") ?? [];
  const options = rowsByTable.get("solution_option") ?? [];
  const decisionsById = new Map(decisions.map((row) => [String(row.id || ""), row]));
  const optionsById = new Map(options.map((row) => [String(row.id || ""), row]));
  const revisionsByDecision = new Map<string, SolutionDecisionTransferRow[]>();
  const currentSnapshotFields = ["initiative_id", "selected_option_id", "disposition", "decision_authority", "decision_date", "rationale", "accepted_residual_risk", "basis_snapshot_json", "basis_hash", "created_by_user_id"] as const;
  const completeText = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  const nullish = (value: unknown) => value === null || value === undefined;
  const validateOption = (optionId: unknown, initiativeId: unknown) => {
    const option = optionsById.get(String(optionId || ""));
    return Boolean(option && option.initiative_id === initiativeId);
  };
  const validateSelectedBasis = async (row: SolutionDecisionTransferRow, label: string) => {
    if (!validateOption(row.selected_option_id, row.initiative_id)) throw new Error(`${label} names a solution option outside its Initiative.`);
    if (typeof row.basis_snapshot_json !== "string" || typeof row.basis_hash !== "string") throw new Error(`${label} has an invalid frozen-basis hash.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.basis_snapshot_json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    } catch { throw new Error(`${label} has an invalid frozen-basis snapshot.`); }
    if (await hashSolutionDecisionBasis(parsed) !== row.basis_hash) throw new Error(`${label} has an invalid frozen-basis hash.`);
  };
  for (const revision of revisions) {
    const decisionId = String(revision.decision_id || "");
    const decision = decisionsById.get(decisionId);
    if (!decisionId || !decision || revision.initiative_id !== decision.initiative_id) throw new Error("The workspace package contains an orphaned or cross-Initiative decision revision.");
    const revisionNumber = Number(revision.revision);
    if (!Number.isSafeInteger(revisionNumber) || revisionNumber <= 0 || !completeText(revision.decision_authority) || !completeText(revision.decision_date) || !completeText(revision.rationale) || !completeText(revision.created_at)) throw new Error("An Initiative decision revision is incomplete.");
    revisionsByDecision.set(decisionId, [...(revisionsByDecision.get(decisionId) ?? []), revision]);
    if (revision.disposition === "selected") {
      await validateSelectedBasis(revision, "An Initiative decision revision");
    } else if (revision.disposition === "legacy_unverified") {
      if (!validateOption(revision.selected_option_id, revision.initiative_id) || !nullish(revision.basis_snapshot_json) || !nullish(revision.basis_hash)) throw new Error("A legacy Initiative adjudication must remain explicitly unverified.");
    } else if (["deferred", "no_action"].includes(String(revision.disposition))) {
      if (!nullish(revision.selected_option_id) || !nullish(revision.basis_snapshot_json) || !nullish(revision.basis_hash)) throw new Error("A non-selection Initiative decision revision contains selected-option basis data.");
    } else throw new Error("An Initiative decision revision has an unsupported disposition.");
  }
  for (const decision of decisions) {
    const decisionId = String(decision.id || "");
    const revisionCount = Number(decision.decision_revision);
    if (!decisionId || !Number.isSafeInteger(revisionCount) || revisionCount < 0) throw new Error("An Initiative decision has an invalid revision counter.");
    const history = [...(revisionsByDecision.get(decisionId) ?? [])].sort((left, right) => Number(left.revision) - Number(right.revision));
    if (history.length !== revisionCount || history.some((row, index) => Number(row.revision) !== index + 1)) throw new Error("An Initiative decision package must contain every append-only revision in sequence.");
    if (decision.disposition === "pending") {
      if (["selected_option_id", "decision_authority", "decision_date", "rationale", "accepted_residual_risk", "basis_snapshot_json", "basis_hash"].some((field) => !nullish(decision[field]))) throw new Error("A Pending Initiative adjudication must not contain completed decision metadata.");
      continue;
    }
    if (!["selected", "deferred", "no_action"].includes(String(decision.disposition)) || !completeText(decision.decision_authority) || !completeText(decision.decision_date) || !completeText(decision.rationale)) throw new Error("A current Initiative adjudication is incomplete.");
    if (decision.disposition === "selected") await validateSelectedBasis(decision, "A current Initiative adjudication");
    else if (!nullish(decision.selected_option_id) || !nullish(decision.basis_snapshot_json) || !nullish(decision.basis_hash)) throw new Error("A current non-selection Initiative adjudication contains selected-option basis data.");
    const latest = history.at(-1);
    if (!latest || currentSnapshotFields.some((field) => latest[field] !== decision[field]) || latest.created_at !== decision.updated_at) throw new Error("The current Initiative adjudication does not match its latest immutable revision.");
  }
}
