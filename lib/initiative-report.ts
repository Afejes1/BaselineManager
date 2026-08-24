import type { EvidenceDocument, BriefSnapshot } from "./governance-model.js";
import type { InitiativeAssessment, InitiativeDecisionBundle } from "./initiative-decision-model.js";
import { objectiveIsRelatedToChangeRequest, readable, tierLabel } from "./initiative-decision-model.js";
import { estimateVariance } from "./initiative-readiness.js";
import { evidenceDocumentHref } from "./evidence-references.js";
import { informationOriginLabel, informationStatusSummary } from "./information-status.js";

export type InitiativeReportInput = {
  title: string;
  generatedAt: string;
  dataLastChangedAt: string;
  bundle: InitiativeDecisionBundle;
  assessment: InitiativeAssessment;
  documents: EvidenceDocument[];
  baseline: BriefSnapshot;
};

const markdownText = (input: string) => input
  .normalize("NFKC")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/([\\`*_[\]{}<>#+!|])/g, "\\$1");
const value = (input: string | null | undefined, fallback = "Not recorded") => input?.trim() ? markdownText(input) : fallback;
const date = (input: string | null | undefined) => input && /^\d{4}-\d{2}-\d{2}/.test(input) ? input.slice(0, 10) : "Not set";
const number = (input: number | null | undefined) => input === null || input === undefined ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(input);
const money = (input: number | null | undefined) => input === null || input === undefined ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(input);

export function buildInitiativeReportMarkdown(input: InitiativeReportInput) {
  const { title: rawTitle, generatedAt, dataLastChangedAt, bundle, assessment, documents, baseline: rawBaseline } = input;
  const baseline = { ...rawBaseline, releaseName: value(rawBaseline.releaseName) };
  const title = `${value(rawTitle, "Initiative leadership report")}\n\n> **${baseline.handlingMarking || "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED"}**`;
  const initiative = bundle.initiative;
  const variance = estimateVariance(bundle);
  const sourcedEstimate = (estimate: { estimateSource: string; hoursLikely: number | null; costLikely: number | null; romPointsLikely?: number | null; asOf: string; confidence: string }) => estimate.romPointsLikely !== null && estimate.romPointsLikely !== undefined
    ? `${readable(estimate.estimateSource)} Lockheed ROM ${number(estimate.romPointsLikely)} points → ${number(estimate.romPointsLikely * variance.romHoursPerPoint)} planning h (${number(variance.romHoursPerPoint)} h/point; ${date(estimate.asOf)}, ${readable(estimate.confidence)})`
    : `${readable(estimate.estimateSource)} ${number(estimate.hoursLikely)} h / ${money(estimate.costLikely)} (${date(estimate.asOf)}, ${readable(estimate.confidence)})`;
  const requestIds = new Set(bundle.changeRequests.map((request) => request.id));
  const requestById = new Map(bundle.changes.requests.map((request) => [request.id, request]));
  const objectiveById = new Map(bundle.objectives.map((objective) => [objective.id, objective]));
  const effectById = new Map(bundle.changes.effects.map((effect) => [effect.id, effect]));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  let changeRequests = bundle.changeRequests.length ? bundle.changeRequests.map((request) => {
    const objectives = bundle.objectives.filter((objective) => objectiveIsRelatedToChangeRequest(objective, request.id, bundle.objectiveChangeRequestLinks));
    return `- ${value(request.externalIdentifier, "Unidentified request")} — ${value(request.title)}; decision: ${readable(request.decisionStatus)}; target: ${value(request.requestedReleaseName, "not set")}; Objectives: ${objectives.length}; impact: ${value(request.impactSummary || request.summary, "not assessed")}`;
  }).join("\n") : "- No Change Requests are linked.";
  let objectives = bundle.objectives.length ? bundle.objectives.map((objective) => {
    const latest = [...objective.estimates].sort((left, right) => `${right.asOf}|${right.createdAt}`.localeCompare(`${left.asOf}|${left.createdAt}`));
    const estimates = latest.length ? latest.map(sourcedEstimate).join("; ") : "no sourced estimate";
    return `- ${value(objective.externalIdentifier, "Unidentified objective")} — ${value(objective.title)}; ${readable(objective.status)}; owner: ${value(objective.technicalOwner, "unassigned")}; plan: ${date(objective.plannedStart)} to ${date(objective.plannedFinish)}; ${estimates}`;
  }).join("\n") : "- No technical Objectives are linked.";
  const requirements = bundle.requirements.length ? bundle.requirements.map((requirement) => `- ${value(requirement.externalIdentifier, "Unidentified requirement")} — ${value(requirement.title)}; ${readable(requirement.changeAction)}; trace: ${readable(requirement.traceStatus)}; source: ${value(requirement.sourceLocator)}`).join("\n") : "- No requirement traces are linked.";
  const criteria = bundle.criteria.length ? bundle.criteria.map((criterion) => {
    const signoffs = criterion.signoffs.length ? criterion.signoffs.map((signoff) => { const document = signoff.evidenceDocumentId ? documentById.get(signoff.evidenceDocumentId) : null; return `${value(signoff.signoffRole, "Unspecified role")}: ${readable(signoff.decision)}${signoff.signer ? ` by ${value(signoff.signer)}` : ""}${document ? `; evidence: [${value(document.fileName, "document")}](${evidenceDocumentHref(document.id)})` : signoff.evidenceDocumentId ? `; evidence document ${value(signoff.evidenceDocumentId)}` : ""}`; }).join("; ") : "no sign-off";
    return `- ${tierLabel(criterion.tier)} ${value(criterion.code)} — ${value(criterion.statement)}; ${readable(criterion.status)}; ${value(criterion.evidenceReference, "evidence pending")}; ${signoffs}`;
  }).join("\n") : "- No acceptance criteria are linked.";
  const milestones = bundle.milestones.length ? bundle.milestones.map((milestone) => `- ${date(milestone.plannedDate)} — ${value(milestone.title)}; ${readable(milestone.status)}; owner: ${value(milestone.owner, "unassigned")}${milestone.consequenceIfMissed ? `; if missed: ${value(milestone.consequenceIfMissed)}` : ""}`).join("\n") : "- No milestones are recorded.";
  const findings = assessment.findings.length ? assessment.findings.map((finding) => `- ${readable(finding.severity)} — ${value(finding.title)}: ${value(finding.detail)}`).join("\n") : "- No automated evidence-chain gaps were detected.";
  let evidence = documents.length ? documents.map((document) => `- [${value(document.fileName, "document")}](${evidenceDocumentHref(document.id)})${document.description ? ` — ${value(document.description)}` : ""}; document ID: ${value(document.id)}; attached ${date(document.createdAt)}`).join("\n") : "- No supporting documents are attached to this Initiative.";
  const linkedRecords = baseline.linkedRecords.length ? baseline.linkedRecords.map((record) => `- ${readable(record.type)} — ${value(record.title)}; ${readable(record.status)}; ${informationOriginLabel(record.informationOrigin)}${record.adjudicationAuthority ? `; decision authority: ${value(record.adjudicationAuthority)}${record.adjudicatedAt ? ` (${date(record.adjudicatedAt)})` : ""}` : ""}`).join("\n") : "- No linked calls, decisions, risks, questions, or technical notes are recorded.";
  const changeDependencies = bundle.changes.dependencies.filter((dependency) => requestIds.has(dependency.predecessorRequestId) || requestIds.has(dependency.successorRequestId));
  const dependencyAnalysis = changeDependencies.length ? changeDependencies.map((dependency) => `- ${value(requestById.get(dependency.successorRequestId)?.externalIdentifier || dependency.successorRequestId)} ${readable(dependency.dependencyType)} ${value(requestById.get(dependency.predecessorRequestId)?.externalIdentifier || dependency.predecessorRequestId)}; basis: ${value(dependency.rationale)}; if unmet: ${value(dependency.consequenceIfUnmet)}`).join("\n") : "- No Change Request dependencies are recorded for this Initiative.";
  const affectedObjects = bundle.changes.effects.filter((effect) => requestIds.has(effect.changeRequestId)).map((effect) => `- ${value(requestById.get(effect.changeRequestId)?.externalIdentifier || effect.changeRequestId)}: ${readable(effect.action)} ${readable(effect.subjectKind)} ${value(effect.subjectLabel)}; ${value(effect.currentValue, "current state not recorded")} → ${value(effect.targetValue, "target state not recorded")}; ${value(effect.consequence, "consequence not assessed")}`).join("\n") || "- No affected baseline objects are linked.";
  const objectiveDependencies = (bundle.objectiveDependencies ?? []).map((dependency) => `- ${value(requestById.get(dependency.dependentChangeRequestId)?.externalIdentifier || dependency.dependentChangeRequestId)} ${readable(dependency.relationship)} ${value(objectiveById.get(dependency.prerequisiteObjectiveId)?.externalIdentifier || dependency.prerequisiteObjectiveId)}; ${readable(dependency.status)}; ${value(dependency.rationale)}`).join("\n") || "- No Objective prerequisites are recorded.";
  const attributions = (bundle.objectiveEffectAttributions ?? []).map((attribution) => { const effect = effectById.get(attribution.changeEffectId); return `- ${value(objectiveById.get(attribution.objectiveId)?.externalIdentifier || attribution.objectiveId)}: ${readable(attribution.attribution)} responsibility for ${value(effect?.subjectLabel || attribution.changeEffectId)}; ${value(attribution.rationale)}; ${readable(attribution.confidence)} confidence`; }).join("\n") || "- No Objective-to-effect attributions are recorded.";
  changeRequests += `\n\n### Dependency and affected-object analysis\n${dependencyAnalysis}\n\n${affectedObjects}`;
  objectives += `\n\n### Objective prerequisites and effect attribution\n${objectiveDependencies}\n\n${attributions}`;
  evidence += `\n\n## Linked calls, decisions, and risks\n${linkedRecords}`;
  objectives = `- Lockheed-reported ROM points: ${number(variance.incumbentRomPoints)}; Initiative planning conversion: ${number(variance.romHoursPerPoint)} labor h per point${initiative.romConversionRationale ? `; basis: ${value(initiative.romConversionRationale)}` : ""}\n\nLockheed source ROM points remain source claims. Converted hours are an Initiative-level Government planning assumption, not an incumbent labor-hour commitment.\n\n${objectives}`;
  const products = baseline.productNames.length ? baseline.productNames.map((name) => `- ${value(name)}`).join("\n") : "- No Product is explicitly affected by the linked Change Requests.";

  return `# ${title}\n\nGenerated: ${generatedAt}\n\nData last changed: ${dataLastChangedAt}\n\n## Information status\n${informationStatusSummary}\n\n## Leadership decision\n${value(initiative.decisionAsk, "Decision ask not yet recorded.")}\n\n- Audience: ${value(initiative.briefingAudience, "not set")}\n- Decision needed by: ${date(initiative.decisionNeededBy)}\n- Accountable owner: ${value(initiative.owner, "unassigned")}\n- Outcome target: ${date(initiative.targetDate)}\n\n## As-Is\n${value(initiative.asIsStatement, "Current state is not yet substantiated.")}\n\n## To-Be / desired outcome\n${value(initiative.toBeStatement || initiative.desiredOutcome, "Target state is not yet defined.")}\n\n## Consequence if deferred\n${value(initiative.consequence)}\n\n## Decision readiness\n- Score: ${assessment.score}% (${readable(assessment.stage)})\n- Blockers: ${assessment.blockers}\n- Warnings: ${assessment.warnings}\n- Decisions pending: ${assessment.decisionsPending}\n- Requirements traced: ${assessment.requirementsTraced}/${bundle.requirements.length}\n- Criteria accepted: ${assessment.criteriaPassed}/${bundle.criteria.length}\n\n${findings}\n\n## Change Requests\n${changeRequests}\n\n## Technical Objectives and estimates\n- Incumbent likely total: ${number(variance.incumbentHours)} h / ${money(variance.incumbentCost)}\n- Government or independent likely total: ${number(variance.assessedHours)} h / ${money(variance.assessedCost)}\n\n${objectives}\n\n## Requirement trace\n${requirements}\n\n## Acceptance evidence\n${criteria}\n\n## Delivery milestones\n${milestones}\n\n## Supporting documents\n${evidence}\n\n## Derived technical scope snapshot\n- Release context (effect transition / CR delivery target): ${baseline.releaseName}\n- Explicitly linked baseline records: ${baseline.sourceRows}\n- Explicitly affected Products: ${baseline.products}\n- Releases represented: ${baseline.releases}\n- Explicit records needing review: ${baseline.reviewRows}\n\n${products}\n\n## Success measures\n${value(initiative.successMeasures, "Measurable success conditions are not recorded.")}\n`;
}
