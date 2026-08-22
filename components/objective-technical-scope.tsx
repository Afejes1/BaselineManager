"use client";

import { useState, type FormEvent } from "react";
import Link from "./app-link";
import { SearchPicker } from "./search-picker";
import { objectiveRelatedChangeRequestIds, readable, type IncumbentObjective, type InitiativeDecisionWorkspace } from "../lib/initiative-decision-model";

type Props = {
  objective: IncumbentObjective;
  workspace: InitiativeDecisionWorkspace;
  saving: boolean;
  save: (event: FormEvent, action: string, payload: Record<string, unknown>, message: string, reset?: () => void) => void;
};

const emptyDependency = { dependentChangeRequestId: "", relationship: "requires", status: "proposed", rationale: "", sourceReference: "", sourceAsOf: "", evidenceReference: "" };
const emptyAttribution = { changeEffectId: "", attribution: "primary", confidence: "medium", rationale: "", sourceReference: "", sourceAsOf: "", evidenceReference: "" };

function subjectHref(kind: string | undefined, id: string | undefined) {
  if (!id) return null;
  if (kind === "product") return `/products/${encodeURIComponent(id)}`;
  if (kind === "platform") return `/platforms/${encodeURIComponent(id)}`;
  if (kind === "configuration_node") return `/configuration/${encodeURIComponent(id)}`;
  if (kind === "occurrence") return `/occurrences/${encodeURIComponent(id)}`;
  if (kind === "release") return `/releases/${encodeURIComponent(id)}`;
  if (kind === "organization") return `/organizations/${encodeURIComponent(id)}`;
  return null;
}

export function ObjectiveTechnicalScope({ objective, workspace, saving, save }: Props) {
  const [dependency, setDependency] = useState({ ...emptyDependency });
  const [attribution, setAttribution] = useState({ ...emptyAttribution });
  const owner = workspace.changes.requests.find((item) => item.id === objective.changeRequestId);
  const linkedRequestIds = objectiveRelatedChangeRequestIds(objective, workspace.objectiveChangeRequestLinks);
  const linkedRequests = workspace.changes.requests.filter((item) => linkedRequestIds.includes(item.id));
  const dependencies = (workspace.objectiveDependencies || []).filter((item) => item.prerequisiteObjectiveId === objective.id);
  const attributions = (workspace.objectiveEffectAttributions || []).filter((item) => item.objectiveId === objective.id);
  const linkedEffects = workspace.changes.effects.filter((item) => linkedRequestIds.includes(item.changeRequestId));
  const dependencyCandidates = workspace.changes.requests
    .filter((item) => !linkedRequestIds.includes(item.id))
    .map((item) => ({
      id: item.id,
      label: `${item.externalIdentifier} · ${item.title}`,
      detail: [item.typeCode, item.requestedReleaseName || "No target release", item.externalOwner || "Owner not reported"].join(" · "),
      status: `${item.referenceStatus} reference · ${item.decisionStatus}`,
    }));

  return <div className="dashboard-grid">
    <section className="domain-section">
      <div className="section-toolbar">
        <div><span className="eyebrow">TECHNICAL EFFECT ATTRIBUTION</span><h3>Technical changes delivered by this Objective</h3></div>
        <span>{attributions.length} attributed effects</span>
      </div>
      <p className="entity-meta">This is a hard link: Objective → accountable or reported Change Request → recorded technical effect → canonical object or working baseline record. The Objective is not release-scoped; release impacts are stored on the linked effect.</p>
      <div className="domain-list">
        {attributions.map((item) => {
          const effect = workspace.changes.effects.find((candidate) => candidate.id === item.changeEffectId);
          const href = subjectHref(effect?.subjectKind, effect?.subjectId);
          return <article className="domain-card" key={item.id}>
            <div className="section-toolbar"><div><span className="record-type">LINKED {readable(effect?.subjectKind || "object")}</span><strong>{href ? <Link href={href}>{effect?.subjectLabel || item.changeEffectId}</Link> : effect?.subjectLabel || item.changeEffectId}</strong></div><span className={`status-pill status-${item.attribution}`}>{readable(item.attribution)}</span></div>
            <p><span className={`effect-action effect-${effect?.action || "modify"}`}>{readable(effect?.action || "modify")}</span> {effect?.aspect || "Technical effect"}</p>
            <p>{effect?.currentValue || "Not reported"} → {effect?.targetValue || "Not reported"}</p>
            <p>{item.rationale}</p>
            <p className="entity-meta">Release impact: {effect?.fromReleaseName || "Current / not specified"} → {effect?.toReleaseName || "Target / not specified"}</p>
            <p className="entity-actions">{href ? <Link href={href}>Open linked {readable(effect?.subjectKind || "object")} →</Link> : null}</p>
            <small>{readable(item.confidence)} confidence · {item.sourceReference || item.evidenceReference || "Supporting reference not recorded"}</small>
          </article>;
        })}
        {!attributions.length ? <p className="empty">No technical effects have been attributed to this Objective.</p> : null}
      </div>
      <details className="governed-editor">
        <summary>Attribute a linked Change Request technical effect</summary>
        <form onSubmit={(event) => save(event, "save_objective_effect_attribution", { objectiveId: objective.id, ...attribution }, "Technical effect attribution recorded.", () => setAttribution({ ...emptyAttribution }))}>
          <p className="entity-meta">Select an effect from an accountable or reported Change Request. Product, Platform, and working baseline record links are selected on the Change Request effect; they cannot be typed here.</p>
          <div className="form-grid">
            <label className="modal-field">Technical effect<select required value={attribution.changeEffectId} onChange={(event) => setAttribution({ ...attribution, changeEffectId: event.target.value })}><option value="">Choose effect</option>{linkedEffects.map((item) => <option value={item.id} key={item.id}>{readable(item.subjectKind)} · {readable(item.action)} · {item.subjectLabel} · {item.aspect}</option>)}</select></label>
            <label className="modal-field">Contribution<select value={attribution.attribution} onChange={(event) => setAttribution({ ...attribution, attribution: event.target.value })}><option value="primary">Primary</option><option value="contributing">Contributing</option><option value="uncertain">Uncertain</option></select></label>
            <label className="modal-field">Confidence<select value={attribution.confidence} onChange={(event) => setAttribution({ ...attribution, confidence: event.target.value })}>{["unassessed", "low", "medium", "high"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="modal-field">Source as of<input type="date" value={attribution.sourceAsOf} onChange={(event) => setAttribution({ ...attribution, sourceAsOf: event.target.value })} /></label>
          </div>
          <label className="modal-field">Attribution rationale<textarea required rows={3} value={attribution.rationale} onChange={(event) => setAttribution({ ...attribution, rationale: event.target.value })} /></label>
          <div className="form-grid"><label className="modal-field">Source reference<input value={attribution.sourceReference} onChange={(event) => setAttribution({ ...attribution, sourceReference: event.target.value })} /></label><label className="modal-field">Evidence reference<input value={attribution.evidenceReference} onChange={(event) => setAttribution({ ...attribution, evidenceReference: event.target.value })} /></label></div>
          <button className="primary-button" disabled={saving || !linkedRequests.length}>Record attribution</button>
        </form>
      </details>
    </section>

    <section className="domain-section">
      <div className="section-toolbar"><div><span className="eyebrow">CROSS-PACKAGE DEPENDENCIES</span><h3>Change Requests that depend on this Objective</h3></div><span>{dependencies.length} precise dependencies</span></div>
      <p className="entity-meta">A dependency does not change accountability. {owner?.externalIdentifier || "No accountable Change Request"} is shown separately from reported source references.</p>
      <div className="domain-table-wrap"><table><thead><tr><th>Dependent Change Request</th><th>Relationship</th><th>State</th><th>Basis</th></tr></thead><tbody>
        {dependencies.map((item) => {
          const dependent = workspace.changes.requests.find((candidate) => candidate.id === item.dependentChangeRequestId);
          return <tr key={item.id}><td><Link href={`/changes/${encodeURIComponent(item.dependentChangeRequestId)}`}>{dependent?.externalIdentifier || item.dependentChangeRequestId}</Link><small>{dependent?.title}</small></td><td>{readable(item.relationship)}</td><td><span className={`status-pill status-${item.status}`}>{readable(item.status)}</span></td><td>{item.rationale}<small>{item.sourceReference || item.evidenceReference || "Basis not referenced"}</small></td></tr>;
        })}
        {!dependencies.length ? <tr><td colSpan={4} className="empty">No other Change Request depends on this Objective.</td></tr> : null}
      </tbody></table></div>
      <details className="governed-editor">
        <summary>Record a Change Request dependency</summary>
        <form onSubmit={(event) => save(event, "save_objective_dependency", { prerequisiteObjectiveId: objective.id, ...dependency }, "Objective dependency recorded.", () => setDependency({ ...emptyDependency }))}>
          <div className="form-grid">
            <SearchPicker label="Dependent Change Request" items={dependencyCandidates} value={dependency.dependentChangeRequestId} onChange={(dependentChangeRequestId) => setDependency({ ...dependency, dependentChangeRequestId })} placeholder="Search MCP, DSOR, title, release, or owner" emptyLabel="No matching Change Request" help="Select the Change Request that depends on this Objective. This does not change Objective ownership." maxResults={12} />
            <label className="modal-field">Relationship<select value={dependency.relationship} onChange={(event) => setDependency({ ...dependency, relationship: event.target.value })}>{["requires", "enables", "blocks", "consumes"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="modal-field">Governance state<select value={dependency.status} onChange={(event) => setDependency({ ...dependency, status: event.target.value })}>{["proposed", "accepted", "rejected", "retired"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="modal-field">Source as of<input type="date" value={dependency.sourceAsOf} onChange={(event) => setDependency({ ...dependency, sourceAsOf: event.target.value })} /></label>
          </div>
          <label className="modal-field">Dependency rationale<textarea required rows={3} value={dependency.rationale} onChange={(event) => setDependency({ ...dependency, rationale: event.target.value })} /></label>
          <div className="form-grid"><label className="modal-field">Source reference<input value={dependency.sourceReference} onChange={(event) => setDependency({ ...dependency, sourceReference: event.target.value })} /></label><label className="modal-field">Evidence reference<input value={dependency.evidenceReference} onChange={(event) => setDependency({ ...dependency, evidenceReference: event.target.value })} /></label></div>
          <button className="primary-button" disabled={saving || !dependency.dependentChangeRequestId || !dependency.rationale.trim()}>Record dependency</button>
        </form>
      </details>
    </section>
  </div>;
}
