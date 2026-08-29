import type { InitiativeChangeRelationship, SolutionAssessmentCriterion, SolutionAssessmentRating, SolutionKnockOnClassification, SolutionObjectiveRole, SolutionStepDependencyType, SolutionStepReferenceKind } from "./initiative-decision-model.js";

export const ASSISTANT_SOLUTION_SCHEMA = "assistant-solution-draft-v1" as const;
export type AssistantDiscoveryMode = "portfolio" | "shortlist";
export type AssistantDescriptionAuthority = "reported" | "analyst_transcribed" | "migrated_unclassified";

export type AssistantSolutionCandidate = {
  kind: "change_request" | "objective";
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  governmentSynopsis: string | null;
  authority: AssistantDescriptionAuthority;
  score: number;
  reasons: string[];
  relatedChangeRequestIds: string[];
};

export type AssistantOptionBundle = {
  key: string;
  target: "new_option" | "status_quo";
  title: string;
  summary: string | null;
  projectedOutcome: string | null;
  expectedConsequences: string | null;
  residualRisks: string | null;
  assumptions: string | null;
  changeRequests: Array<{ id: string; relationship: InitiativeChangeRelationship; rationale: string | null }>;
  objectives: Array<{ id: string; role: SolutionObjectiveRole; rationale: string | null }>;
  steps: Array<{ key: string; parentKey: string | null; wbsCode: string | null; title: string; description: string | null; expectedResult: string | null; owner: string | null; planningStart: string | null; planningFinish: string | null; planningEffortHours: number | null; planningEffortBasis: string | null; references: Array<{ kind: SolutionStepReferenceKind; sourceId: string | null; reference: string | null; label: string; rationale: string | null }> }>;
  dependencies: Array<{ predecessorKey: string; successorKey: string; relationship: SolutionStepDependencyType; lagDays: number; rationale: string }>;
  knockOns: Array<{ classification: SolutionKnockOnClassification; affectedKind: string | null; affectedReference: string | null; timing: string | null; likelihood: "low" | "medium" | "high" | "unassessed"; impact: "low" | "medium" | "high" | "unassessed"; confidence: "low" | "medium" | "high" | "unassessed"; narrative: string; mitigation: string | null; sourceReferences: string[] }>;
  assessmentSuggestions: Array<{ criterion: SolutionAssessmentCriterion; rating: SolutionAssessmentRating; confidence: "low" | "medium" | "high" | "unassessed"; narrative: string; sourceReferences: string[] }>;
  gaps: string[];
};

export type AssistantSolutionDraftPayload = {
  schema: typeof ASSISTANT_SOLUTION_SCHEMA;
  answer: string;
  bundles: AssistantOptionBundle[];
  insufficiencies: string[];
};

export type AssistantSolutionGeneration = {
  id: string;
  initiativeId: string;
  revision: number;
  discoveryMode: AssistantDiscoveryMode;
  promptText: string;
  candidateManifest: AssistantSolutionCandidate[];
  groundingFingerprint: string;
  modelName: string;
  payload: AssistantSolutionDraftPayload;
  reviewedPayload: AssistantSolutionDraftPayload | null;
  appliedPayload: Record<string, unknown> | null;
  payloadHash: string;
  status: "generated" | "reviewed" | "partially_applied" | "applied" | "dismissed" | "stale";
  createdAt: string;
  updatedAt: string;
};

const text = (value: unknown, maximum = 4_000) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const nullable = (value: unknown, maximum = 4_000) => text(value, maximum) || null;
const array = (value: unknown, maximum = 80) => Array.isArray(value) ? value.slice(0, maximum) : [];
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T) => values.includes(value as T) ? value as T : fallback;
const date = (value: unknown) => { const result = text(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null; };
const numberOrNull = (value: unknown) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const stringList = (value: unknown, maximum = 30) => array(value, maximum).map((item) => text(item, 500)).filter(Boolean);

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export function parseAssistantSolutionDraft(value: unknown): AssistantSolutionDraftPayload {
  let candidate: unknown = value;
  if (typeof value === "string") {
    const source = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { candidate = JSON.parse(source); } catch { throw new Error("GenAI.mil did not return a valid structured solution draft."); }
  }
  const root = record(candidate);
  const bundles = array(root.bundles, 5).map((raw, index): AssistantOptionBundle | null => {
    const item = record(raw);
    const target = oneOf(item.target, ["new_option", "status_quo"] as const, "new_option");
    const title = text(item.title, 180);
    if (!title) return null;
    const steps = array(item.steps, 60).map((rawStep, stepIndex) => {
      const step = record(rawStep);
      const key = text(step.key, 80) || `step-${stepIndex + 1}`;
      return { key, parentKey: nullable(step.parentKey, 80), wbsCode: nullable(step.wbsCode, 40), title: text(step.title, 240), description: nullable(step.description, 2_000), expectedResult: nullable(step.expectedResult, 1_000), owner: nullable(step.owner, 180), planningStart: date(step.planningStart), planningFinish: date(step.planningFinish), planningEffortHours: numberOrNull(step.planningEffortHours), planningEffortBasis: nullable(step.planningEffortBasis, 600), references: array(step.references, 20).map((rawReference) => { const reference = record(rawReference); return { kind: oneOf(reference.kind, ["change_request","objective","jira","confluence","other"] as const, "other"), sourceId: nullable(reference.sourceId, 240), reference: nullable(reference.reference, 1_000), label: text(reference.label, 240), rationale: nullable(reference.rationale, 800) }; }).filter((reference) => reference.label && (reference.sourceId || reference.reference)) };
    }).filter((step) => step.title);
    return {
      key: text(item.key, 80) || `option-${index + 1}`, target, title,
      summary: nullable(item.summary, 2_000), projectedOutcome: nullable(item.projectedOutcome, 2_000), expectedConsequences: nullable(item.expectedConsequences, 2_000), residualRisks: nullable(item.residualRisks, 2_000), assumptions: nullable(item.assumptions, 2_000),
      changeRequests: array(item.changeRequests, 30).map((rawLink) => { const link = record(rawLink); return { id: text(link.id, 240), relationship: oneOf(link.relationship, ["delivers","enables","constrains","supports"] as const, "delivers"), rationale: nullable(link.rationale, 800) }; }).filter((link) => link.id),
      objectives: array(item.objectives, 80).map((rawLink) => { const link = record(rawLink); return { id: text(link.id, 240), role: oneOf(link.role, ["required","enabling","optional"] as const, "required"), rationale: nullable(link.rationale, 800) }; }).filter((link) => link.id),
      steps,
      dependencies: array(item.dependencies, 100).map((rawDependency) => { const dependency = record(rawDependency); return { predecessorKey: text(dependency.predecessorKey, 80), successorKey: text(dependency.successorKey, 80), relationship: oneOf(dependency.relationship, ["FS","SS","FF","SF"] as const, "FS"), lagDays: Number.isInteger(Number(dependency.lagDays)) ? Number(dependency.lagDays) : 0, rationale: text(dependency.rationale, 800) }; }).filter((dependency) => dependency.predecessorKey && dependency.successorKey && dependency.rationale),
      knockOns: array(item.knockOns, 40).map((rawKnockOn) => { const knockOn = record(rawKnockOn); return { classification: oneOf(knockOn.classification, ["benefit","risk","constraint","dependency","second_order_effect"] as const, "risk"), affectedKind: nullable(knockOn.affectedKind, 120), affectedReference: nullable(knockOn.affectedReference, 500), timing: nullable(knockOn.timing, 240), likelihood: oneOf(knockOn.likelihood, ["low","medium","high","unassessed"] as const, "unassessed"), impact: oneOf(knockOn.impact, ["low","medium","high","unassessed"] as const, "unassessed"), confidence: oneOf(knockOn.confidence, ["low","medium","high","unassessed"] as const, "unassessed"), narrative: text(knockOn.narrative, 2_000), mitigation: nullable(knockOn.mitigation, 1_000), sourceReferences: stringList(knockOn.sourceReferences) }; }).filter((knockOn) => knockOn.narrative),
      assessmentSuggestions: array(item.assessmentSuggestions, 12).map((rawAssessment) => { const assessment = record(rawAssessment); return { criterion: oneOf(assessment.criterion, ["outcome_alignment","delivery_effort","schedule_feasibility","cyber_lifecycle","mission_operational_impact","stakeholder_impact","requirements_acceptance"] as const, "outcome_alignment"), rating: oneOf(assessment.rating, ["favorable","mixed","unfavorable","unassessed"] as const, "unassessed"), confidence: oneOf(assessment.confidence, ["low","medium","high","unassessed"] as const, "unassessed"), narrative: text(assessment.narrative, 2_000), sourceReferences: stringList(assessment.sourceReferences) }; }).filter((assessment) => assessment.narrative),
      gaps: stringList(item.gaps),
    };
  }).filter((bundle): bundle is AssistantOptionBundle => Boolean(bundle));
  if (!bundles.length) throw new Error("GenAI.mil returned no valid option bundle. Refine the Initiative framing or candidate set and try again.");
  if (bundles.filter((bundle) => bundle.target === "status_quo").length > 1) throw new Error("A generated draft may contain only one status-quo analysis bundle.");
  return { schema: ASSISTANT_SOLUTION_SCHEMA, answer: text(root.answer, 12_000) || "Structured option drafts generated for review.", bundles, insufficiencies: stringList(root.insufficiencies, 40) };
}

