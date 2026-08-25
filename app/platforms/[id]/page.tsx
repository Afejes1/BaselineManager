"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "../../../components/app-link";
import { DomainPageShell } from "../../../components/domain-shell";
import { AnalyticsLink } from "../../../components/analytics-link";
import { ObjectRecordsPanel, ObjectTabBar } from "../../../components/object-workspace";
import { ViewportModal } from "../../../components/viewport-modal";
import { AuditHistoryPanel } from "../../../components/governed-object";
import { InfrastructureWorkspace } from "../../../components/infrastructure-workspace";
import { AssistantLauncher } from "../../../components/context-assistant";
import { useWorkspaceContext } from "../../../components/workspace-context";
import { productDisplayName, text } from "../../../lib/baseline-data";
import { useChangePortfolio } from "../../../lib/change-client";
import { savePlatformAction, usePlatformPortfolio } from "../../../lib/platform-client";
import type { PlatformStatus, PlatformType } from "../../../lib/platform-model";
import { PROGRAM_HANDLING_MARKING } from "../../../lib/output-handling";

const requiredParent: Partial<Record<PlatformType, PlatformType>> = { ock: "alou", obk: "ock", pma: "obk" };

export default function PlatformDetailPage() {
  const id = decodeURIComponent(useParams<{ id: string }>().id || "");
  const searchParams = useSearchParams();
  const { portfolio, reload } = usePlatformPortfolio();
  const { portfolio: changes } = useChangePortfolio();
  const { scopedRows, releaseLens } = useWorkspaceContext();
  const infrastructureFocus = searchParams.get("focus") || undefined;
  const releaseQuery = releaseLens ? `?release=${encodeURIComponent(releaseLens)}` : "";
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState(infrastructureFocus ? "infrastructure" : "overview");
  const [notice, setNotice] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [relation, setRelation] = useState({ organizationId: "", relationshipType: "operator", sourceReference: "" });
  const [assignment, setAssignment] = useState({ baselineOccurrenceId: "", assignmentRole: "primary", confidence: "assessed", reviewStatus: "not_reviewed", sourceReference: "", sourceAsOf: "" });
  const [removal, setRemoval] = useState({ assignmentId: "", rationale: "" });
  const platform = portfolio.platforms.find((item) => item.id === id);
  const [edit, setEdit] = useState({ parentId: "", code: "", name: "", platformType: "other" as PlatformType, status: "active" as PlatformStatus, installationLocation: "", countryCode: "", description: "" });

  useEffect(() => {
    setAssignment({ baselineOccurrenceId: "", assignmentRole: "primary", confidence: "assessed", reviewStatus: "not_reviewed", sourceReference: "", sourceAsOf: "" });
    setRemoval({ assignmentId: "", rationale: "" });
  }, [releaseLens]);

  const descendants = useMemo(() => {
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of portfolio.platforms) {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; }
      }
    }
    return ids;
  }, [id, portfolio.platforms]);
  const allDirectAssignments = portfolio.assignments.filter((item) => item.platformId === id);
  const directAssignments = allDirectAssignments.filter((item) => !releaseLens || item.releaseName === releaseLens);
  const subtreeAssignments = portfolio.assignments.filter((item) => descendants.has(item.platformId) && (!releaseLens || item.releaseName === releaseLens));
  const occurrenceIds = new Set(subtreeAssignments.map((item) => item.baselineOccurrenceId));
  const sourceRows = scopedRows.filter((row) => occurrenceIds.has(row.__meta.occurrenceId));
  const effects = changes.effects.filter((effect) => effect.subjectKind === "platform" && descendants.has(effect.subjectId));
  const requestIds = new Set(effects.map((effect) => effect.changeRequestId));
  const requests = changes.requests.filter((request) => requestIds.has(request.id));
  const relationships = portfolio.relationships.filter((item) => descendants.has(item.platformId));
  const products = Array.from(new Set(sourceRows.map(productDisplayName))).sort();
  const releases = Array.from(new Set(sourceRows.map((row) => text(row.ReleaseName)).filter(Boolean))).sort();
  const platformById = useMemo(() => new Map(portfolio.platforms.map((item) => [item.id, item])), [portfolio.platforms]);
  const assignable = releaseLens ? portfolio.occurrenceOptions.filter((item) => item.releaseName === releaseLens) : [];
  const sourceReferenceRequired = assignment.confidence === "assessed" || assignment.confidence === "confirmed";
  const canSaveAssignment = Boolean(releaseLens && assignment.baselineOccurrenceId && (!sourceReferenceRequired || assignment.sourceReference.trim()));

  async function act(body: Record<string, unknown>, message: string) {
    setSaving(true); setNotice("");
    try { await savePlatformAction(body); await reload(); setNotice(message); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "Platform update failed."); }
    finally { setSaving(false); }
  }
  async function linkOrganization() {
    if (!relation.organizationId) return;
    await act({ action: "link_organization", platformId: id, ...relation }, "Organization linked.");
    setRelation({ organizationId: "", relationshipType: "operator", sourceReference: "" });
  }
  async function saveAssignment() {
    if (!canSaveAssignment) return;
    await act({ action: "save_assignment", platformId: id, ...assignment }, "Release-specific Platform mapping saved.");
    setAssignment({ baselineOccurrenceId: "", assignmentRole: "primary", confidence: "assessed", reviewStatus: "not_reviewed", sourceReference: "", sourceAsOf: "" });
  }
  async function removeAssignment() {
    if (!removal.assignmentId || !removal.rationale) return;
    await act({ action: "remove_assignment", ...removal }, "Baseline assignment removed and audited.");
    setRemoval({ assignmentId: "", rationale: "" });
  }
  function openEdit() {
    if (!platform) return;
    setEdit({ parentId: platform.parentId || "", code: platform.code, name: platform.name, platformType: platform.platformType, status: platform.status, installationLocation: platform.installationLocation || "", countryCode: platform.countryCode || "", description: platform.description || "" });
    setEditOpen(true);
  }
  async function saveEdit() {
    await act({ action: "save_platform", id, ...edit, parentId: edit.parentId || null }, "Platform context updated.");
    setEditOpen(false);
  }

  if (!platform) return <DomainPageShell title="Platform not found" contextMode="filter"><article className="domain-card"><Link href={`/platforms${releaseQuery}`}>Return to Platform hierarchy</Link></article></DomainPageShell>;
  const sourcePlatform = platform.isA2OResourcePlatform;
  const sourceOnly = sourcePlatform && !platform.isGovernedPlatform;
  const parent = portfolio.platforms.find((item) => item.id === platform.parentId);
  const parentOptions = portfolio.platforms.filter((item) => item.id !== id && (!requiredParent[edit.platformType] || item.platformType === requiredParent[edit.platformType]));
  const selectedReleaseText = releaseLens ? `Editing release mapping: ${releaseLens}` : `${releases.length} represented releases · select a Release Lens to edit a mapping`;
  const mappingLabel = (platformId: string | null) => platformId ? platformById.get(platformId)?.name || "Unknown Platform" : "Not mapped";

  return <DomainPageShell title={sourceOnly ? `Resource Platform: ${platform.name}` : `${platform.code} · ${platform.name}`} subtitle={sourceOnly ? `A2O Resource Platform · Tier descriptor: ${platform.reportedTierName || "not reported"}` : `${platform.platformType.toUpperCase()} Platform dashboard${sourcePlatform ? " · A2O source linked" : ""}`} releaseScope={selectedReleaseText} contextMode="filter" objectContext={{ kind: "platform", id, label: sourceOnly ? `Resource Platform · ${platform.name}` : `${platform.code} · ${platform.name}` }} actions={<><AssistantLauncher context={{ kind: "platform", id: platform.id, label: sourceOnly ? `Resource Platform · ${platform.name}` : `${platform.code} · ${platform.name}` }} /><Link className="ghost-button" href={`/platforms${releaseQuery}`}>Platforms</Link><AnalyticsLink kind="platform" id={id} /><button className="ghost-button" type="button" onClick={openEdit}>{sourceOnly ? "Establish Government context" : "Edit Platform context"}</button><button className="ghost-button" type="button" onClick={() => setTab("baseline")}>Edit Release mapping</button><button className="ghost-button" type="button" onClick={() => setTab("infrastructure")}>Edit system configuration</button>{releaseLens ? <Link className="primary-button" href={`/platforms/${encodeURIComponent(id)}/topology-manager?release=${encodeURIComponent(releaseLens)}`}>Visual topology manager</Link> : null}<button className="ghost-button" type="button" onClick={() => window.print()}>Print dashboard</button></>}>
    <section className="decision-principle"><strong>{PROGRAM_HANDLING_MARKING}</strong><span>Stable Platform identity, Release-specific mappings, configuration, assessments, and evidence are governed separately. Printed copies are draft and uncontrolled.</span></section>
    <section className="summary"><div className="metric"><span>Products in scope</span><strong>{products.length}</strong><small>{sourceRows.length} assigned baseline records</small></div><div className="metric"><span>Release context</span><strong>{releaseLens || releases.length}</strong><small>{releaseLens ? "Selected Release" : releases.join(" · ") || "No baseline assignments"}</small></div><div className="metric"><span>Direct mappings</span><strong>{directAssignments.length}</strong><small>{directAssignments.filter((item) => item.reviewStatus === "reviewed").length} reviewed</small></div><div className="metric metric-alert"><span>Change Requests</span><strong>{requests.length}</strong><small>{requests.filter((item) => item.decisionStatus === "pending").length} funding decisions pending</small></div></section>
    <section className="contract-strip"><strong>Editing model</strong><span><em>Platform context</em> is the durable Government hierarchy and can be edited here. <em>Baseline assignments</em> are release-specific mappings. <em>System configuration</em> is release-specific infrastructure and installation detail. Imported A2O Resource and Tier values remain traceable source lineage; establishing Government context does not overwrite it.</span></section>
    <ObjectTabBar active={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "infrastructure", label: "System configuration" }, { id: "baseline", label: "Baseline assignments", count: directAssignments.length }, { id: "change", label: "Change & accountability", count: requests.length }, { id: "evidence", label: "Calls & evidence" }, { id: "history", label: "History" }]} />
    {tab === "overview" ? <section className="dashboard-grid"><article className="domain-card"><span className="eyebrow">{sourceOnly ? "A2O SOURCE CONTEXT" : "GOVERNMENT HIERARCHY CONTEXT"}</span><h3>{sourceOnly ? <>Tier descriptor: {platform.reportedTierName || "not reported"}</> : <>{parent ? <Link href={`/platforms/${encodeURIComponent(parent.id)}${releaseQuery}`}>{parent.code} · {parent.name}</Link> : "Program root"} → {platform.code}</>}</h3><p>{platform.description || "Description not recorded."}</p><p className="entity-meta">{sourceOnly ? `Reported Resource: ${platform.name}` : `${platform.installationLocation || "Location not recorded"}${platform.countryCode ? ` · ${platform.countryCode}` : ""}`} · {platform.status}</p>{sourcePlatform && platform.configurationNodeId ? <p className="entity-actions"><Link className="mini-action" href={`/configuration/${encodeURIComponent(platform.configurationNodeId)}${releaseQuery}`}>Review canonical source node</Link></p> : null}</article><article className="domain-card"><span className="eyebrow">WHAT / WHERE / WHEN</span><h3>{products.length} products in the current scope</h3><p>{releaseLens ? `Mapping and configuration shown below are limited to ${releaseLens}.` : releases.length ? `Assigned across ${releases.join(", ")}. Select a Release Lens to make a release-specific change.` : "Assign release records below to establish fielding context."}</p><p className="entity-actions"><button className="primary-button" type="button" onClick={() => setTab("baseline")}>Review Release mappings</button></p></article></section> : null}
    {tab === "infrastructure" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">RELEASE SYSTEM CONFIGURATION</span><h3>{releaseLens ? `${releaseLens} system configuration` : "Select a Release Lens to edit system configuration"}</h3></div>{releaseLens ? <Link className="primary-button" href={`/platforms/${encodeURIComponent(id)}/topology-manager?release=${encodeURIComponent(releaseLens)}`}>Open visual manager</Link> : null}</div>{releaseLens ? <InfrastructureWorkspace platformId={id} initialReleaseName={releaseLens} focus={infrastructureFocus} /> : <article className="domain-card empty-state"><h3>Select a Release Lens</h3><p>Hardware, node state, Product installations, and connections are specific to one Release. Choose the Release in the header, then return here to edit them.</p></article>}</section> : null}
    {tab === "baseline" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">BASELINE ASSIGNMENTS</span><h3>{releaseLens ? `Government mapping for ${releaseLens}` : "Release-specific Platform mappings"}</h3></div><span>{directAssignments.length} mappings in scope</span></div><p className="entity-meta">Select the Release Lens before changing a mapping. You may replace an imported Resource-only primary mapping with an assessed or confirmed Government fielding Platform; the original A2O Resource and Tier stay in source lineage.</p>{!releaseLens ? <div className="contract-strip"><strong>Release required</strong><span>Choose the Release Lens in the header to edit a baseline mapping. The table remains cross-release only for review.</span></div> : null}<div className="domain-table-wrap"><table><thead><tr><th>Release</th><th>Product / baseline key</th><th>Host</th><th>Basis</th><th>Review</th><th>Action</th></tr></thead><tbody>{directAssignments.map((item) => <tr key={item.id}><td>{item.releaseName}</td><td><strong>{item.productName}</strong><small>{item.sourceKey}</small></td><td>{item.hostName}</td><td>{item.confidence}<small>{item.sourceReference || "No reference"}{item.sourceAsOf ? ` · as of ${item.sourceAsOf}` : ""}</small></td><td><span className={`review-mark review-${item.reviewStatus}`}>{item.reviewStatus.replace("_", " ")}</span></td><td>{releaseLens ? <button className="mini-action" type="button" onClick={() => setRemoval({ assignmentId: item.id, rationale: "" })}>Unassign</button> : "—"}</td></tr>)}{!directAssignments.length ? <tr><td colSpan={6} className="empty">No baseline records are mapped to this Platform in the selected scope.</td></tr> : null}</tbody></table></div>{releaseLens ? <><div className="form-grid"><label className="modal-field">Baseline record<select value={assignment.baselineOccurrenceId} onChange={(event) => setAssignment({ ...assignment, baselineOccurrenceId: event.target.value })}><option value="">Choose active record in {releaseLens}</option>{assignable.map((item) => <option value={item.id} key={item.id}>{item.productName} · {item.sourceKey} · {item.placement} · current: {mappingLabel(item.primaryPlatformId)}</option>)}</select></label><label className="modal-field">Assignment role<select value={assignment.assignmentRole} onChange={(event) => setAssignment({ ...assignment, assignmentRole: event.target.value })}><option value="primary">Primary fielding location</option><option value="supporting">Supporting relationship</option></select></label><label className="modal-field">Confidence<select value={assignment.confidence} onChange={(event) => setAssignment({ ...assignment, confidence: event.target.value })}><option value="reported">Reported</option><option value="assessed">Government assessed</option><option value="confirmed">Confirmed</option></select></label><label className="modal-field">Review state<select value={assignment.reviewStatus} onChange={(event) => setAssignment({ ...assignment, reviewStatus: event.target.value })}><option value="not_reviewed">Not reviewed</option><option value="reviewed">Reviewed</option><option value="follow_up">Follow-up</option></select></label><label className="modal-field">Source reference<input required={sourceReferenceRequired} value={assignment.sourceReference} onChange={(event) => setAssignment({ ...assignment, sourceReference: event.target.value })} placeholder={sourceReferenceRequired ? "Required: drawing, MCP, CM record, or call" : "Supporting reference (optional for reported)"} /></label><label className="modal-field">Source as of<input type="date" value={assignment.sourceAsOf} onChange={(event) => setAssignment({ ...assignment, sourceAsOf: event.target.value })} /></label></div><button className="primary-button" type="button" disabled={saving || !canSaveAssignment} onClick={() => void saveAssignment()}>Save Release mapping</button>{sourceReferenceRequired && !assignment.sourceReference.trim() ? <p className="entity-meta">A source reference is required for Government-assessed and confirmed mappings.</p> : null}{removal.assignmentId ? <div className="contract-strip"><strong>Remove assignment</strong><label className="modal-field">Rationale<input value={removal.rationale} onChange={(event) => setRemoval({ ...removal, rationale: event.target.value })} /></label><button className="danger-button" disabled={saving || !removal.rationale} onClick={() => void removeAssignment()}>Confirm unassign</button><button className="ghost-button" type="button" onClick={() => setRemoval({ assignmentId: "", rationale: "" })}>Cancel</button></div> : null}</> : null}</section> : null}
    {tab === "change" ? <><section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">CHANGE IMPACT</span><h3>Funding decisions affecting this Platform subtree</h3></div><Link href={`/changes?subject=platform:${encodeURIComponent(id)}`}>Create or link request</Link></div><div className="domain-list">{requests.map((request) => <article key={request.id} className="domain-card"><span className={`decision-badge decision-${request.decisionStatus}`}>{request.decisionStatus}</span><h3><Link href={`/changes/${encodeURIComponent(request.id)}`}>{request.externalIdentifier} · {request.title}</Link></h3><p>{request.impactSummary || request.summary || "Impact narrative not yet assessed."}</p></article>)}{!requests.length ? <article className="domain-card empty-state"><h3>No Platform-level Change Request effects</h3><p>The baseline is visible; no funding request is linked to this Platform subtree.</p></article> : null}</div></section><section className="domain-section"><h3>Products in this Platform subtree</h3><div className="chip-list">{products.map((product) => <span className="domain-chip" key={product}><strong>{product}</strong><span>{sourceRows.filter((row) => productDisplayName(row) === product).length} records</span></span>)}</div></section><section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">ACCOUNTABILITY</span><h3>Organization relationships</h3></div></div><div className="chip-list">{relationships.map((item) => <Link key={item.id} className="domain-chip" href={`/organizations/${encodeURIComponent(item.organizationName)}`}><strong>{item.organizationName}</strong><span>{item.relationshipType}</span></Link>)}</div><div className="inline-form"><select value={relation.organizationId} onChange={(event) => setRelation({ ...relation, organizationId: event.target.value })}><option value="">Choose organization</option>{portfolio.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={relation.relationshipType} onChange={(event) => setRelation({ ...relation, relationshipType: event.target.value })}>{["owner", "operator", "integrator", "support", "supplier"].map((item) => <option key={item}>{item}</option>)}</select><input value={relation.sourceReference} onChange={(event) => setRelation({ ...relation, sourceReference: event.target.value })} placeholder="Supporting reference" /><button className="primary-button" disabled={saving || !relation.organizationId} onClick={() => void linkOrganization()}>Link organization</button></div></section></> : null}
    {tab === "evidence" ? <ObjectRecordsPanel context={{ kind: "platform", id, label: `${platform.code} · ${platform.name}` }} /> : null}
    {tab === "history" ? <AuditHistoryPanel kind="platform" id={id} label={`${platform.code} · ${platform.name}`} /> : null}
    {editOpen ? <ViewportModal onDismiss={() => setEditOpen(false)} dismissDisabled={saving} labelledBy="platform-edit-title"><span className="eyebrow">GOVERNED PLATFORM CONTEXT</span><h2 id="platform-edit-title">{sourceOnly ? `Establish context for ${platform.name}` : `Edit ${platform.code}`}</h2><p>{sourceOnly ? "This keeps the linked A2O Resource and Tier as source lineage. Set a Government Platform type and, where appropriate, a parent to place this record in the governed fielding hierarchy." : sourcePlatform ? "This Platform is already governed and retains its linked A2O Resource and Tier provenance." : "These fields describe the stable Government Platform hierarchy. Release-specific fielding is edited on the Baseline assignments tab."}</p><div className="form-grid"><label className="modal-field">Type<select value={edit.platformType} onChange={(event) => setEdit({ ...edit, platformType: event.target.value as PlatformType, parentId: "" })}>{["alou", "ock", "obk", "pma", "other"].map((item) => <option value={item} key={item}>{item.toUpperCase()}</option>)}</select></label><label className="modal-field">Parent<select disabled={edit.platformType === "alou"} value={edit.parentId} onChange={(event) => setEdit({ ...edit, parentId: event.target.value })}><option value="">No parent</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label className="modal-field">Code<input value={edit.code} onChange={(event) => setEdit({ ...edit, code: event.target.value })} /></label><label className="modal-field">Name<input value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></label><label className="modal-field">Status<select value={edit.status} onChange={(event) => setEdit({ ...edit, status: event.target.value as PlatformStatus })}><option value="active">Active</option><option value="planned">Planned</option><option value="retired">Retired</option></select></label><label className="modal-field">Country code<input value={edit.countryCode} onChange={(event) => setEdit({ ...edit, countryCode: event.target.value })} /></label></div><label className="modal-field">Installation location<input value={edit.installationLocation} onChange={(event) => setEdit({ ...edit, installationLocation: event.target.value })} /></label><label className="modal-field">Description<textarea rows={3} value={edit.description} onChange={(event) => setEdit({ ...edit, description: event.target.value })} /></label><footer><button className="ghost-button" type="button" onClick={() => setEditOpen(false)}>Cancel</button><button className="primary-button" type="button" disabled={saving} onClick={() => void saveEdit()}>Save Platform context</button></footer></ViewportModal> : null}
    {notice ? <p className={notice.toLowerCase().includes("failed") || notice.toLowerCase().includes("required") ? "error-copy" : "toast"}>{notice}</p> : null}
  </DomainPageShell>;
}
