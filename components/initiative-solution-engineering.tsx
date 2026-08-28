"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "./app-link";
import { objectiveRelatedChangeRequestIds, readable, type InitiativeDecisionBundle, type InitiativeDecisionWorkspace, type SolutionAssessmentCriterion, type SolutionOption, } from "../lib/initiative-decision-model";
import { countUniqueRequirements, deriveSolutionOptionRollup, type NumericRangeRollup } from "../lib/solution-option-rollup";
type Mutate = (action: string, payload: Record<string, unknown>) => Promise<unknown>;
type Draft = Record<string, string>;
const assessmentCriteria: Array<{
    value: SolutionAssessmentCriterion;
    label: string;
    help: string;
}> = [
    { value: "outcome_alignment", label: "Outcome alignment", help: "How fully this alternative reaches the shared Government outcome." },
    { value: "delivery_effort", label: "Delivery effort", help: "Government judgment alongside the sourced Objective estimate—not a replacement for it." },
    { value: "schedule_feasibility", label: "Schedule feasibility", help: "Whether the observed Objective dates and dependencies support the need date." },
    { value: "cyber_lifecycle", label: "Cyber & lifecycle", help: "Security principles, support status, end-of-life exposure, and residual cyber risk." },
    { value: "mission_operational_impact", label: "Mission & operations", help: "Expected mission benefit, disruption, downtime, and operational transition." },
    { value: "stakeholder_impact", label: "Stakeholder impact", help: "Training, engagement, workload, frustration, and adoption effects." },
    { value: "requirements_acceptance", label: "Requirements & acceptance", help: "Tier 3/Tier 4 trace, verification, and acceptance implications." },
];
const blankOption = (): Draft => ({ id: "", title: "", optionType: "candidate", status: "draft", summary: "", projectedOutcome: "", expectedConsequences: "", residualRisks: "", assumptions: "" });
const blankStep = (): Draft => ({ id: "", title: "", description: "", expectedResult: "" });
const blankAssessment = (): Draft => ({ criterion: "outcome_alignment", rating: "unassessed", narrative: "", sourceReference: "", confidence: "unassessed" });
const numberLabel = (value: number | null) => value === null ? "Not sourced" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const moneyLabel = (value: number | null) => value === null ? "Not sourced" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
function rangeLabel(range: NumericRangeRollup, kind: "hours" | "cost" | "points") {
    const format = kind === "cost" ? moneyLabel : numberLabel;
    if (range.low === null && range.likely === null && range.high === null)
        return "Not sourced";
    const suffix = kind === "hours" ? " h" : kind === "points" ? " pts" : "";
    const bound = (label: string, value: number | null, coverage: NumericRangeRollup["lowCoverage"]) => value === null
        ? `${label} not sourced`
        : `${label} ${format(value)}${suffix}${coverage.complete ? "" : ` known partial (${coverage.reported}/${coverage.eligible})`}`;
    return [bound("Low", range.low, range.lowCoverage), bound("Likely", range.likely, range.likelyCoverage), bound("High", range.high, range.highCoverage)].join(" · ");
}
function coverageLabel(range: NumericRangeRollup) {
    if (!range.likelyCoverage.eligible)
        return "No eligible Objectives";
    if (range.lowCoverage.complete && range.likelyCoverage.complete && range.highCoverage.complete)
        return `${range.likelyCoverage.reported}/${range.likelyCoverage.eligible} Objectives on every bound`;
    return `Coverage: low ${range.lowCoverage.reported}/${range.lowCoverage.eligible} · likely ${range.likelyCoverage.reported}/${range.likelyCoverage.eligible} · high ${range.highCoverage.reported}/${range.highCoverage.eligible}`;
}
function likelyLabel(range: NumericRangeRollup, kind: "hours" | "cost" | "points") {
    const format = kind === "cost" ? moneyLabel : numberLabel;
    const value = range.likely;
    if (value === null)
        return "Likely not sourced";
    const suffix = kind === "hours" ? " h" : kind === "points" ? " pts" : "";
    return `Likely ${format(value)}${suffix}${range.likelyCoverage.complete ? "" : ` known partial (${range.likelyCoverage.reported}/${range.likelyCoverage.eligible})`}`;
}
export function InitiativeSolutionEngineering({ workspace, bundle, mutate }: {
    workspace: InitiativeDecisionWorkspace;
    bundle: InitiativeDecisionBundle;
    mutate: Mutate;
}) {
    const [selectedOptionId, setSelectedOptionId] = useState(bundle.solutionOptions.find((option) => option.status !== "retired")?.id || bundle.solutionOptions[0]?.id || "");
    const [optionDraft, setOptionDraft] = useState<Draft>(blankOption());
    const [stepDraft, setStepDraft] = useState<Draft>(blankStep());
    const [changeDraft, setChangeDraft] = useState<Draft>({ changeRequestId: "", relationship: "delivers", rationale: "" });
    const [objectiveDraft, setObjectiveDraft] = useState<Draft>({ objectiveId: "", role: "required", rationale: "" });
    const [assessmentDraft, setAssessmentDraft] = useState<Draft>(blankAssessment());
    const [caseDraft, setCaseDraft] = useState<Draft>({ problemStatement: bundle.initiative.problemStatement || "", desiredOutcome: bundle.initiative.desiredOutcome || "", driversConstraints: bundle.initiative.driversConstraints || "" });
    const [caseDirty, setCaseDirty] = useState(false);
    const [decisionDraft, setDecisionDraft] = useState<Draft>({ disposition: bundle.solutionDecision?.disposition || "pending", selectedOptionId: bundle.solutionDecision?.selectedOptionId || "", decisionAuthority: bundle.solutionDecision?.decisionAuthority || "", decisionDate: bundle.solutionDecision?.decisionDate || "", rationale: bundle.solutionDecision?.rationale || "", acceptedResidualRisk: bundle.solutionDecision?.acceptedResidualRisk || "" });
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");
    const selectedOption = bundle.solutionOptions.find((option) => option.id === selectedOptionId) || null;
    const selectedOptionLocked = Boolean(selectedOption && bundle.solutionDecision?.disposition === "selected" && bundle.solutionDecision.selectedOptionId === selectedOption.id);
    const completedDecisionLocked = Boolean(bundle.solutionDecision && bundle.solutionDecision.disposition !== "pending");
    const decisionBasisIntegrityFailure = bundle.solutionDecision?.disposition === "selected" && bundle.solutionDecision.basisIntegrityValid === false;
    const decisionDispositionOptions = completedDecisionLocked ? [bundle.solutionDecision!.disposition, "pending"] : ["pending", "selected", "deferred", "no_action"];
    const completedDraftMissingMetadata = decisionDraft.disposition !== "pending" && (!decisionDraft.decisionAuthority.trim() || !decisionDraft.decisionDate || !decisionDraft.rationale.trim());
    const decisionHistory = [...bundle.solutionDecisionRevisions].sort((left, right) => right.revision - left.revision);
    const solutionOptionTitles = new Map(bundle.solutionOptions.map((option) => [option.id, option.title]));
    const optionChangeLinks = bundle.solutionChangeRequestLinks.filter((link) => link.optionId === selectedOptionId);
    const optionObjectiveLinks = bundle.solutionObjectiveLinks.filter((link) => link.optionId === selectedOptionId);
    const optionSteps = bundle.solutionSteps.filter((step) => step.optionId === selectedOptionId).sort((left, right) => left.sortOrder - right.sortOrder);
    const optionRequestIds = useMemo(() => new Set(optionChangeLinks.map((link) => link.changeRequestId)), [optionChangeLinks]);
    const availableObjectives = bundle.objectives.filter((objective) => objectiveRelatedChangeRequestIds(objective, bundle.objectiveChangeRequestLinks).some((requestId) => optionRequestIds.has(requestId)));
    const selectedObjectiveIds = new Set(optionObjectiveLinks.map((link) => link.objectiveId));
    useEffect(() => {
        if (!selectedOption)
            return;
        setOptionDraft({ id: selectedOption.id, title: selectedOption.title, optionType: selectedOption.optionType, status: selectedOption.status, summary: selectedOption.summary || "", projectedOutcome: selectedOption.projectedOutcome || "", expectedConsequences: selectedOption.expectedConsequences || "", residualRisks: selectedOption.residualRisks || "", assumptions: selectedOption.assumptions || "" });
    }, [selectedOption]);
    useEffect(() => {
        if (caseDirty)
            return;
        setCaseDraft({ problemStatement: bundle.initiative.problemStatement || "", desiredOutcome: bundle.initiative.desiredOutcome || "", driversConstraints: bundle.initiative.driversConstraints || "" });
    }, [bundle.initiative.problemStatement, bundle.initiative.desiredOutcome, bundle.initiative.driversConstraints, caseDirty]);
    useEffect(() => {
        setDecisionDraft({ disposition: bundle.solutionDecision?.disposition || "pending", selectedOptionId: bundle.solutionDecision?.selectedOptionId || "", decisionAuthority: bundle.solutionDecision?.decisionAuthority || "", decisionDate: bundle.solutionDecision?.decisionDate || "", rationale: bundle.solutionDecision?.rationale || "", acceptedResidualRisk: bundle.solutionDecision?.acceptedResidualRisk || "" });
    }, [bundle.solutionDecision]);
    useEffect(() => {
        const criterion: SolutionAssessmentCriterion = "outcome_alignment";
        const current = bundle.solutionAssessments.find((assessment) => assessment.optionId === selectedOptionId && assessment.criterion === criterion);
        setAssessmentDraft({ criterion, rating: current?.rating || "unassessed", narrative: current?.narrative || "", sourceReference: current?.sourceReference || "", confidence: current?.confidence || "unassessed" });
    }, [selectedOptionId, bundle.solutionAssessments]);
    useEffect(() => {
        if (selectedOptionId === "__new__")
            return;
        if (selectedOptionId && bundle.solutionOptions.some((option) => option.id === selectedOptionId))
            return;
        setSelectedOptionId(bundle.solutionOptions.find((option) => option.status !== "retired")?.id || bundle.solutionOptions[0]?.id || "");
    }, [bundle.solutionOptions, selectedOptionId]);
    async function act(action: string, payload: Record<string, unknown>, message: string) {
        setBusy(true);
        setNotice("");
        try {
            const result = await mutate(action, payload) as {
                id?: string;
            };
            setNotice(message);
            return result;
        }
        catch (reason) {
            setNotice(reason instanceof Error ? reason.message : "The governed update could not be saved.");
            return null;
        }
        finally {
            setBusy(false);
        }
    }
    async function saveCase() {
        const result = await act("save_profile", { initiativeId: bundle.initiative.id, ...bundle.initiative, ...caseDraft }, "Problem, outcome, and known drivers saved.");
        if (result)
            setCaseDirty(false);
    }
    async function saveOption() {
        const result = await act("save_solution_option", { initiativeId: bundle.initiative.id, ...optionDraft }, optionDraft.id ? "Solution option updated." : "Solution option created.");
        if (result?.id)
            setSelectedOptionId(result.id);
    }
    async function addStep() {
        if (!selectedOption)
            return;
        const result = await act("save_solution_step", { optionId: selectedOption.id, ...stepDraft }, stepDraft.id ? "Solution step updated." : "Solution step added.");
        if (result)
            setStepDraft(blankStep());
    }
    async function removeLink(kind: "change" | "objective", id: string, label: string) {
        const rationale = window.prompt(`Why is ${label} being removed from this option?`);
        if (!rationale?.trim() || !selectedOption)
            return;
        await act(kind === "change" ? "remove_solution_change_request" : "remove_solution_objective", { optionId: selectedOption.id, [kind === "change" ? "changeRequestId" : "objectiveId"]: id, rationale }, `${label} removed from this option.`);
    }
    function editAssessment(criterion: SolutionAssessmentCriterion) {
        const current = bundle.solutionAssessments.find((assessment) => assessment.optionId === selectedOptionId && assessment.criterion === criterion);
        setAssessmentDraft({ criterion, rating: current?.rating || "unassessed", narrative: current?.narrative || "", sourceReference: current?.sourceReference || "", confidence: current?.confidence || "unassessed" });
    }
    return <section className="solution-engineering-workspace">
    <aside className="decision-principle"><strong>DECISION MODEL</strong><span>Define one shared Government outcome, compare explicit alternatives, and select only the Change Requests and LM Objectives used by each option. Estimates, dates, dependencies, and affected objects remain derived from those retained records.</span></aside>

    <section className="solution-case-frame">
      <header><div><span className="eyebrow">1 · DECISION CASE</span><h2>Problem → shared outcome</h2></div><small>Government-authored framing</small></header>
      <div className="solution-case-grid">
        <label className="modal-field">Problem statement<textarea rows={4} value={caseDraft.problemStatement} onChange={(event) => { setCaseDirty(true); setCaseDraft({ ...caseDraft, problemStatement: event.target.value }); }} placeholder="Why is the current condition unacceptable?"/><small>A known undesirable condition; not a proposed solution.</small></label>
        <label className="modal-field">Desired outcome<textarea rows={4} value={caseDraft.desiredOutcome} onChange={(event) => { setCaseDirty(true); setCaseDraft({ ...caseDraft, desiredOutcome: event.target.value }); }} placeholder="What Government end state should every option be judged against?"/><small>The shared end state—not an option-specific result.</small></label>
        <label className="modal-field">Known drivers / constraints<textarea rows={4} value={caseDraft.driversConstraints} onChange={(event) => { setCaseDirty(true); setCaseDraft({ ...caseDraft, driversConstraints: event.target.value }); }} placeholder="Known EOL dates, security boundaries, fielding windows, policy, or mission constraints"/><small>Known boundaries. Uncertain adverse events belong in the risk record.</small></label>
      </div>
      <button type="button" className="primary-button" disabled={busy} onClick={() => void saveCase()}>Save decision case</button>
    </section>

    <div className="solution-option-layout">
      <section className="solution-option-register">
        <header><div><span className="eyebrow">2 · ALTERNATIVES</span><h2>Solution options</h2></div><button type="button" className="ghost-button" onClick={() => { setOptionDraft(blankOption()); setSelectedOptionId("__new__"); }}>＋ New option</button></header>
        {bundle.solutionOptions.length ? bundle.solutionOptions.map((option) => <OptionCard key={option.id} option={option} workspace={workspace} selected={option.id === selectedOptionId} decisionSelected={bundle.solutionDecision?.selectedOptionId === option.id && bundle.solutionDecision.disposition === "selected"} onSelect={() => setSelectedOptionId(option.id)}/>) : <p className="empty">No alternatives recorded. Start with the status quo, then add the smallest credible action alternatives.</p>}
      </section>

      <section className="solution-option-editor">
        <header><div><span className="eyebrow">OPTION DEFINITION</span><h2>{optionDraft.id ? "Edit option" : "Create option"}</h2></div>{selectedOption ? <span className={`status-pill status-${selectedOption.status}`}>{readable(selectedOption.status)}</span> : null}</header>
        {selectedOptionLocked ? <p className="solution-lock-note">This selected option is frozen. Return the adjudication to Pending before changing its definition, scope, steps, or assessment.</p> : null}
        <div className="form-grid"><label className="modal-field">Title<input value={optionDraft.title} onChange={(event) => setOptionDraft({ ...optionDraft, title: event.target.value })} placeholder="e.g., Targeted supported-runtime upgrade"/></label><label className="modal-field">Type<select value={optionDraft.optionType} onChange={(event) => setOptionDraft({ ...optionDraft, optionType: event.target.value })}><option value="candidate">Action alternative</option><option value="status_quo">Status quo / no new action</option></select></label><label className="modal-field">Analysis status<select value={optionDraft.status} onChange={(event) => setOptionDraft({ ...optionDraft, status: event.target.value })}>{["draft", "under_review", "recommended", "not_selected", "retired"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label></div>
        <label className="modal-field">Approach summary<textarea rows={3} value={optionDraft.summary} onChange={(event) => setOptionDraft({ ...optionDraft, summary: event.target.value })} placeholder="What this alternative does"/></label>
        <label className="modal-field">Projected option result<textarea rows={3} value={optionDraft.projectedOutcome} onChange={(event) => setOptionDraft({ ...optionDraft, projectedOutcome: event.target.value })} placeholder="How fully this option is expected to reach the shared outcome"/></label>
        <div className="form-grid"><label className="modal-field">Expected consequences<textarea rows={4} value={optionDraft.expectedConsequences} onChange={(event) => setOptionDraft({ ...optionDraft, expectedConsequences: event.target.value })} placeholder="Expected effects of choosing this option"/></label><label className="modal-field">Residual risks<textarea rows={4} value={optionDraft.residualRisks} onChange={(event) => setOptionDraft({ ...optionDraft, residualRisks: event.target.value })} placeholder="Uncertain exposure that remains or is introduced"/></label><label className="modal-field">Assumptions to validate<textarea rows={4} value={optionDraft.assumptions} onChange={(event) => setOptionDraft({ ...optionDraft, assumptions: event.target.value })} placeholder="Unverified propositions used by this analysis"/></label></div>
        <button type="button" className="primary-button" disabled={busy || selectedOptionLocked || !optionDraft.title.trim()} onClick={() => void saveOption()}>{optionDraft.id ? "Save option" : "Create option"}</button>
      </section>
    </div>

    {selectedOption ? <>
      <section className="solution-trace-section">
        <header><div><span className="eyebrow">3 · SOURCE-BACKED SCOPE</span><h2>Selected work for {selectedOption.title}</h2></div><small>Explicit selections only · no automatic Objective expansion</small></header>
        <div className="solution-trace-grid">
          <div className="solution-trace-column"><h3>Change Requests / MCPs</h3><p>Context and funding packages. A CR alone contributes no ROM to the option total.</p>{optionChangeLinks.map((link) => { const request = bundle.changeRequests.find((item) => item.id === link.changeRequestId); return <article key={link.id}><div><Link href={`/changes/${encodeURIComponent(link.changeRequestId)}`}>{request?.externalIdentifier || link.changeRequestId}</Link><span>{readable(link.relationship)}</span></div><p>{request?.title}</p><button type="button" className="text-action" onClick={() => void removeLink("change", link.changeRequestId, request?.externalIdentifier || "this Change Request")}>Remove</button></article>; })}<div className="inline-selection"><select value={changeDraft.changeRequestId} onChange={(event) => setChangeDraft({ ...changeDraft, changeRequestId: event.target.value })}><option value="">Choose linked Initiative CR…</option>{bundle.changeRequests.filter((request) => !optionRequestIds.has(request.id)).map((request) => <option key={request.id} value={request.id}>{request.externalIdentifier} · {request.title}</option>)}</select><select value={changeDraft.relationship} onChange={(event) => setChangeDraft({ ...changeDraft, relationship: event.target.value })}>{["delivers", "enables", "constrains", "supports"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select><input value={changeDraft.rationale} onChange={(event) => setChangeDraft({ ...changeDraft, rationale: event.target.value })} placeholder="Why it belongs in this option"/><button type="button" className="ghost-button" disabled={busy || !changeDraft.changeRequestId} onClick={() => void act("set_solution_change_request", { optionId: selectedOption.id, ...changeDraft }, "Change Request selected for this option.").then((result) => { if (result)
            setChangeDraft({ changeRequestId: "", relationship: "delivers", rationale: "" }); })}>Add</button></div></div>
          <div className="solution-trace-column"><h3>LM Objectives</h3><p>Only required and enabling Objectives enter the core estimate. Optional work is shown separately.</p>{optionObjectiveLinks.map((link) => { const objective = bundle.objectives.find((item) => item.id === link.objectiveId); return <article key={link.id}><div><Link href={`/objectives/${encodeURIComponent(link.objectiveId)}`}>{objective?.externalIdentifier || link.objectiveId}</Link><span>{readable(link.role)}</span></div><p>{objective?.title}</p><button type="button" className="text-action" onClick={() => void removeLink("objective", link.objectiveId, objective?.externalIdentifier || "this Objective")}>Remove</button></article>; })}<div className="inline-selection"><select value={objectiveDraft.objectiveId} onChange={(event) => setObjectiveDraft({ ...objectiveDraft, objectiveId: event.target.value })}><option value="">Choose Objective traced to selected CR…</option>{availableObjectives.filter((objective) => !selectedObjectiveIds.has(objective.id)).map((objective) => <option key={objective.id} value={objective.id}>{objective.externalIdentifier} · {objective.title}</option>)}</select><select value={objectiveDraft.role} onChange={(event) => setObjectiveDraft({ ...objectiveDraft, role: event.target.value })}>{["required", "enabling", "optional"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select><input value={objectiveDraft.rationale} onChange={(event) => setObjectiveDraft({ ...objectiveDraft, rationale: event.target.value })} placeholder="Contribution to this alternative"/><button type="button" className="ghost-button" disabled={busy || !objectiveDraft.objectiveId} onClick={() => void act("set_solution_objective", { optionId: selectedOption.id, ...objectiveDraft }, "Objective selected for this option.").then((result) => { if (result)
            setObjectiveDraft({ objectiveId: "", role: "required", rationale: "" }); })}>Add</button></div></div>
        </div>
      </section>

      <OptionAnalysis workspace={workspace} bundle={bundle} option={selectedOption}/>

      <div className="solution-execution-grid">
        <section className="solution-steps"><header><div><span className="eyebrow">4 · APPROACH STEPS</span><h2>Enumerated solution steps</h2></div></header>{optionSteps.map((step, index) => <article key={step.id}><b>{index + 1}</b><div><strong>{step.title}</strong><p>{step.description || "No description recorded."}</p><small>{step.expectedResult || "Expected result not recorded."}</small></div><button type="button" className="text-action" onClick={() => setStepDraft({ id: step.id, title: step.title, description: step.description || "", expectedResult: step.expectedResult || "" })}>Edit</button></article>)}<div className="step-editor"><input value={stepDraft.title} onChange={(event) => setStepDraft({ ...stepDraft, title: event.target.value })} placeholder="Step title"/><textarea rows={2} value={stepDraft.description} onChange={(event) => setStepDraft({ ...stepDraft, description: event.target.value })} placeholder="What happens"/><textarea rows={2} value={stepDraft.expectedResult} onChange={(event) => setStepDraft({ ...stepDraft, expectedResult: event.target.value })} placeholder="Observable result"/><button type="button" className="ghost-button" disabled={busy || !stepDraft.title.trim()} onClick={() => void addStep()}>{stepDraft.id ? "Update step" : "Add step"}</button></div></section>
        <section className="solution-assessments"><header><div><span className="eyebrow">5 · GOVERNMENT ASSESSMENT</span><h2>Categorical tradeoffs</h2></div><small>No weighted score</small></header>{assessmentCriteria.map((criterion) => { const current = bundle.solutionAssessments.find((assessment) => assessment.optionId === selectedOption.id && assessment.criterion === criterion.value); return <button key={criterion.value} type="button" className="assessment-row" onClick={() => editAssessment(criterion.value)}><span><strong>{criterion.label}</strong><small>{criterion.help}</small></span><b className={`rating-${current?.rating || "unassessed"}`}>{readable(current?.rating || "unassessed")}</b></button>; })}<div className="assessment-editor"><label className="modal-field">Criterion<select value={assessmentDraft.criterion} onChange={(event) => editAssessment(event.target.value as SolutionAssessmentCriterion)}>{assessmentCriteria.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="modal-field">Rating<select value={assessmentDraft.rating} onChange={(event) => setAssessmentDraft({ ...assessmentDraft, rating: event.target.value })}>{["unassessed", "favorable", "mixed", "unfavorable"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label><label className="modal-field">Confidence<select value={assessmentDraft.confidence} onChange={(event) => setAssessmentDraft({ ...assessmentDraft, confidence: event.target.value })}>{["unassessed", "low", "medium", "high"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label><label className="modal-field field-span">Government rationale<textarea rows={3} value={assessmentDraft.narrative} onChange={(event) => setAssessmentDraft({ ...assessmentDraft, narrative: event.target.value })}/></label><label className="modal-field field-span">Supporting reference (optional)<input value={assessmentDraft.sourceReference} onChange={(event) => setAssessmentDraft({ ...assessmentDraft, sourceReference: event.target.value })}/></label><button type="button" className="ghost-button" disabled={busy || assessmentDraft.rating !== "unassessed" && !assessmentDraft.narrative.trim()} onClick={() => void act("save_solution_assessment", { optionId: selectedOption.id, ...assessmentDraft }, "Government option assessment saved.")}>Save assessment</button></div></section>
      </div>
    </> : null}

    <section className="solution-adjudication">
      <header><div><span className="eyebrow">6 · ADJUDICATION</span><h2>Government decision</h2></div><small>Selection is recorded here—not in the source Objective or CR</small></header>
      {bundle.solutionDecision?.disposition === "selected" ? <aside className={bundle.solutionDecision.basisStale ? "solution-decision-drift" : "solution-decision-frozen"}><strong>{decisionBasisIntegrityFailure ? "DECISION BASIS INTEGRITY FAILURE" : bundle.solutionDecision.basisStale ? "SOURCE DRIFT — RE-ADJUDICATION REQUIRED" : `DECISION BASIS FROZEN · REVISION ${bundle.solutionDecision.decisionRevision}`}</strong><span>{decisionBasisIntegrityFailure ? "The current decision, stored snapshot, and immutable revision no longer agree. Do not rely on this adjudication until a steward validates the workspace history." : bundle.solutionDecision.basisStale ? "Current source records no longer match the decision-time basis. Return the adjudication to Pending, review the changed source records, then enter fresh decision metadata to record a new revision." : "The selected alternative is locked. Later source changes are compared with this decision-time basis."}</span></aside> : bundle.solutionDecision?.disposition === "pending" && bundle.solutionDecision.decisionRevision > 0 ? <aside className="solution-decision-frozen"><strong>PRIOR DECISION RETAINED · REVISION {bundle.solutionDecision.decisionRevision}</strong><span>The prior adjudication and its frozen basis remain in immutable history. Enter a complete, fresh adjudication only after the decision case materially changes.</span></aside> : null}
      <div className="form-grid"><label className="modal-field">Disposition<select value={decisionDraft.disposition} onChange={(event) => setDecisionDraft({ disposition: event.target.value, selectedOptionId: "", decisionAuthority: "", decisionDate: "", rationale: "", acceptedResidualRisk: "" })}>{decisionDispositionOptions.map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label><label className="modal-field">Selected option<select disabled={decisionDraft.disposition !== "selected" || completedDecisionLocked} value={decisionDraft.selectedOptionId} onChange={(event) => setDecisionDraft({ ...decisionDraft, selectedOptionId: event.target.value, decisionAuthority: "", decisionDate: "", rationale: "", acceptedResidualRisk: "" })}><option value="">Choose option…</option>{bundle.solutionOptions.filter((option) => option.status !== "retired" && option.status !== "not_selected").map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label><label className="modal-field">Decision authority<input disabled={decisionDraft.disposition === "pending" || completedDecisionLocked} value={decisionDraft.decisionAuthority} onChange={(event) => setDecisionDraft({ ...decisionDraft, decisionAuthority: event.target.value })}/></label><label className="modal-field">Decision date<input disabled={decisionDraft.disposition === "pending" || completedDecisionLocked} type="date" value={decisionDraft.decisionDate} onChange={(event) => setDecisionDraft({ ...decisionDraft, decisionDate: event.target.value })}/></label><label className="modal-field field-span">Rationale<textarea disabled={decisionDraft.disposition === "pending" || completedDecisionLocked} rows={3} value={decisionDraft.rationale} onChange={(event) => setDecisionDraft({ ...decisionDraft, rationale: event.target.value })}/></label><label className="modal-field field-span">Accepted residual risk<textarea disabled={decisionDraft.disposition === "pending" || completedDecisionLocked} rows={3} value={decisionDraft.acceptedResidualRisk} onChange={(event) => setDecisionDraft({ ...decisionDraft, acceptedResidualRisk: event.target.value })}/></label></div><button type="button" className="primary-button" disabled={busy || completedDecisionLocked && decisionDraft.disposition !== "pending" || completedDraftMissingMetadata || decisionDraft.disposition === "selected" && !decisionDraft.selectedOptionId} onClick={() => void act("save_solution_decision", { initiativeId: bundle.initiative.id, ...decisionDraft }, decisionDraft.disposition === "pending" && completedDecisionLocked ? "Adjudication returned to Pending; prior revisions remain retained." : "Government solution decision saved.")}>{decisionDraft.disposition === "pending" && completedDecisionLocked ? "Return to Pending" : "Save adjudication"}</button>
      {decisionHistory.length ? <section className="solution-decision-history" aria-label="Adjudication history"><header><div><span className="eyebrow">IMMUTABLE RECORD</span><h3>Adjudication history</h3></div><small>{decisionHistory.length} retained revision{decisionHistory.length === 1 ? "" : "s"}</small></header>{decisionHistory.map((revision, index) => { const legacy = revision.disposition === "legacy_unverified"; const basisStatus = legacy ? "Legacy record · no frozen basis" : revision.disposition === "selected" ? revision.basisIntegrityValid === true ? "Frozen basis verified" : "Basis integrity failure" : "No selected-option basis"; return <details key={revision.id} className={legacy ? "solution-decision-revision solution-decision-revision-legacy" : "solution-decision-revision"} open={index === 0}><summary><b>REV {revision.revision}</b><span>{readable(revision.disposition)}</span><strong>{revision.selectedOptionId ? solutionOptionTitles.get(revision.selectedOptionId) || revision.selectedOptionId : "No option selected"}</strong><time>{revision.decisionDate}</time></summary><div className="solution-decision-revision-body"><dl><div><dt>Authority</dt><dd>{revision.decisionAuthority}</dd></div><div><dt>Basis integrity</dt><dd className={revision.disposition === "selected" && revision.basisIntegrityValid !== true ? "decision-integrity-failed" : ""}>{basisStatus}</dd></div><div className="revision-wide"><dt>Rationale</dt><dd>{revision.rationale}</dd></div><div className="revision-wide"><dt>Accepted residual risk</dt><dd>{revision.acceptedResidualRisk || "None recorded."}</dd></div>{revision.basisHash ? <div className="revision-wide"><dt>Frozen basis hash</dt><dd><code title={revision.basisHash}>{revision.basisHash}</code></dd></div> : null}</dl>{legacy ? <p>This decision predates frozen decision-basis records. Its authority, date, selection, rationale, and residual risk are retained as unverified history; re-adjudicate from Pending to create a verified revision.</p> : null}</div></details>; })}</section> : null}
    </section>
    {notice ? <p className="solution-notice" role="status">{notice}</p> : null}
  </section>;
}
function OptionCard({ option, workspace, selected, decisionSelected, onSelect }: {
    option: SolutionOption;
    workspace: InitiativeDecisionWorkspace;
    selected: boolean;
    decisionSelected: boolean;
    onSelect: () => void;
}) {
    const rollup = deriveSolutionOptionRollup(workspace, option.id);
    return <button type="button" className={`solution-option-card${selected ? " solution-option-active" : ""}`} onClick={onSelect}><div><span>{option.optionType === "status_quo" ? "STATUS QUO" : "ACTION ALTERNATIVE"}</span>{decisionSelected ? <b>SELECTED</b> : <b>{readable(option.status)}</b>}</div><strong>{option.title}</strong><p>{option.summary || "Approach not yet described."}</p><small>{rollup?.coreObjectiveIds.length || 0} core Objectives · {rollup?.optionalObjectiveIds.length || 0} optional · {likelyLabel(rollup?.incumbent.hours || emptyRange(), "hours")}</small></button>;
}
function OptionAnalysis({ workspace, bundle, option }: {
    workspace: InitiativeDecisionWorkspace;
    bundle: InitiativeDecisionBundle;
    option: SolutionOption;
}) {
    const rollup = deriveSolutionOptionRollup(workspace, option.id);
    if (!rollup)
        return null;
    const requirementCount = countUniqueRequirements(workspace, rollup.coreObjectiveIds);
    const criteria = bundle.criteria.filter((criterion) => rollup.coreObjectiveIds.includes(criterion.objectiveId));
    return <section className="solution-derived-analysis">
      <header><div><span className="eyebrow">DERIVED QUANTITATIVE VIEW</span><h2>What the selected records currently say</h2></div><small>Low / likely / high · incomplete bounds labeled · no invented values</small></header>
      <div className="solution-metric-grid">
        <article><span>Lockheed planning hours</span><strong>{rangeLabel(rollup.incumbent.hours, "hours")}</strong><small>{coverageLabel(rollup.incumbent.hours)} · points converted only when an Objective has no direct-hour bounds</small></article>
        <article><span>Lockheed cost</span><strong>{rangeLabel(rollup.incumbent.cost, "cost")}</strong><small>{coverageLabel(rollup.incumbent.cost)} · retained incumbent claim</small></article>
        <article><span>Lockheed ROM points</span><strong>{rangeLabel(rollup.incumbent.romPoints, "points")}</strong><small>{coverageLabel(rollup.incumbent.romPoints)} · retained source values</small></article>
        <article><span>Government hours</span><strong>{rangeLabel(rollup.government.hours, "hours")}</strong><small>{coverageLabel(rollup.government.hours)} · kept separate from incumbent claims</small></article>
        <article><span>Government cost</span><strong>{rangeLabel(rollup.government.cost, "cost")}</strong><small>{coverageLabel(rollup.government.cost)}</small></article>
        <article><span>Independent hours</span><strong>{rangeLabel(rollup.independent.hours, "hours")}</strong><small>{coverageLabel(rollup.independent.hours)} · independent estimate source only</small></article>
        <article><span>Independent cost</span><strong>{rangeLabel(rollup.independent.cost, "cost")}</strong><small>{coverageLabel(rollup.independent.cost)}</small></article>
        <article><span>Observed Objective window</span><strong>{rollup.schedule.earliestPlannedStart || "Not set"} → {rollup.schedule.latestPlannedFinish || "Not set"}</strong><small>{rollup.schedule.startCoverage.reported}/{rollup.schedule.startCoverage.eligible} starts · {rollup.schedule.finishCoverage.reported}/{rollup.schedule.finishCoverage.eligible} finishes · not a critical path</small></article>
        <article><span>Dependencies</span><strong>{rollup.dependencies.internal.length} internal · {rollup.dependencies.inbound.length} inbound · {rollup.dependencies.outbound.length} outbound</strong><small>CR relationships and active Objective gates only · authority retained · no schedule dates inferred</small></article>
        <article><span>Trace and scope</span><strong>{rollup.scope.affectedObjectCount} affected objects</strong><small>{rollup.scope.effectCount} attributed effects · {requirementCount} unique requirements · {criteria.filter((item) => item.tier === "tier_3").length} Tier 3 · {criteria.filter((item) => item.tier === "tier_4").length} Tier 4</small></article>
      </div>
      {rollup.optionalObjectiveIds.length ? <aside className="solution-optional-rollup"><strong>OPTIONAL ADD-ON · excluded from core totals</strong><span>{rollup.optionalObjectiveIds.length} Objective{rollup.optionalObjectiveIds.length === 1 ? "" : "s"} · Lockheed {likelyLabel(rollup.optional.incumbent.hours, "hours")} · Government {likelyLabel(rollup.optional.government.hours, "hours")} · Independent {likelyLabel(rollup.optional.independent.hours, "hours")}</span></aside> : null}
      {rollup.scope.affectedObjects.length ? <div className="solution-object-list">{rollup.scope.affectedObjects.map((item) => <span key={`${item.kind}:${item.id}`}>{readable(item.kind)} · {item.label}</span>)}</div> : null}
      {rollup.warnings.length ? <div className="solution-warnings">{rollup.warnings.map((warning) => <p key={warning}>! {warning}</p>)}</div> : null}
      <p className="solution-calculation-note">Conversion: {numberLabel(rollup.conversion.hoursPerPoint)} Government planning hours per Lockheed ROM point. {rollup.conversion.rationale || "No conversion rationale recorded."}</p>
    </section>;
}
function emptyRange(): NumericRangeRollup {
    const coverage = { eligible: 0, reported: 0, missingObjectiveIds: [], complete: false };
    return { low: null, likely: null, high: null, lowCoverage: coverage, likelyCoverage: coverage, highCoverage: coverage };
}
