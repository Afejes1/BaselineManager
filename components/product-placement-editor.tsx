"use client";

import { useMemo, useState } from "react";
import Link from "./app-link";
import { ViewportModal } from "./viewport-modal";
import type { InfrastructurePortfolio, InfrastructureProductInstallation } from "../lib/topology-model";

const roles = ["operating_system", "hypervisor", "application", "middleware", "database", "runtime", "firmware", "agent", "other"] as const;
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

type PlacementForm = {
  releaseId: string;
  platformId: string;
  nodeStateId: string;
  baselineOccurrenceId: string;
  installationRole: string;
  instanceName: string;
  version: string;
  deploymentStatus: string;
  confidence: string;
  sourceReference: string;
  sourceAsOf: string;
  notes: string;
};

export function ProductPlacementEditor({
  productId,
  productName,
  portfolio,
  installation,
  mutate,
  onDismiss,
}: {
  productId: string;
  productName: string;
  portfolio: InfrastructurePortfolio;
  installation?: InfrastructureProductInstallation;
  mutate: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  onDismiss: () => void;
}) {
  const configuredReleaseIds = useMemo(() => [...new Set(portfolio.states.filter((item) => item.lifecycleStatus !== "absent").map((item) => item.releaseId))], [portfolio.states]);
  const initialReleaseId = installation?.releaseId || configuredReleaseIds.at(-1) || portfolio.releases.at(-1)?.id || "";
  const [form, setForm] = useState<PlacementForm>({
    releaseId: initialReleaseId,
    platformId: installation?.platformId || "",
    nodeStateId: installation?.nodeStateId || "",
    baselineOccurrenceId: installation?.baselineOccurrenceId || "",
    installationRole: installation?.installationRole || "application",
    instanceName: installation?.instanceName || "",
    version: installation?.version || "",
    deploymentStatus: installation?.deploymentStatus || "installed",
    confidence: installation?.confidence || "assessed",
    sourceReference: installation?.sourceReference || "",
    sourceAsOf: installation?.sourceAsOf || "",
    notes: installation?.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removalRationale, setRemovalRationale] = useState("");
  const release = portfolio.releases.find((item) => item.id === form.releaseId);
  const platform = portfolio.platforms.find((item) => item.id === form.platformId);
  const stateById = new Map(portfolio.states.map((item) => [item.id, item]));
  const nodeById = new Map(portfolio.nodes.map((item) => [item.id, item]));
  const platformOptions = [...portfolio.platforms]
    .sort((left, right) => `${left.code} ${left.name}`.localeCompare(`${right.code} ${right.name}`, undefined, { numeric: true }));
  const nodeOptions = portfolio.states
    .filter((item) => item.releaseId === form.releaseId && item.platformId === form.platformId && item.lifecycleStatus !== "absent")
    .sort((left, right) => {
      const leftNode = nodeById.get(left.infrastructureNodeId); const rightNode = nodeById.get(right.infrastructureNodeId);
      return `${leftNode?.nodeType || ""} ${leftNode?.code || ""}`.localeCompare(`${rightNode?.nodeType || ""} ${rightNode?.code || ""}`, undefined, { numeric: true });
    });
  const occurrenceOptions = portfolio.occurrenceOptions.filter((item) => item.releaseId === form.releaseId && (!item.productId || item.productId === productId));
  const selectedState = stateById.get(form.nodeStateId);
  const selectedNode = selectedState ? nodeById.get(selectedState.infrastructureNodeId) : undefined;
  const parentState = selectedState?.parentStateId ? stateById.get(selectedState.parentStateId) : undefined;
  const parentNode = parentState ? nodeById.get(parentState.infrastructureNodeId) : undefined;

  const changeRelease = (releaseId: string) => setForm((current) => ({ ...current, releaseId, platformId: "", nodeStateId: "", baselineOccurrenceId: "" }));
  const changePlatform = (platformId: string) => setForm((current) => ({ ...current, platformId, nodeStateId: "", baselineOccurrenceId: "" }));

  async function save() {
    if (!form.nodeStateId) { setMessage("Choose the governed infrastructure node or VM where this Product runs."); return; }
    setSaving(true); setMessage("");
    try {
      await mutate("save_infrastructure_installation", { id: installation?.id || "", productId, nodeStateId: form.nodeStateId, baselineOccurrenceId: form.baselineOccurrenceId, installationRole: form.installationRole, instanceName: form.instanceName, version: form.version, deploymentStatus: form.deploymentStatus, confidence: form.confidence, sourceReference: form.sourceReference, sourceAsOf: form.sourceAsOf, notes: form.notes });
      onDismiss();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The Product placement could not be saved."); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!installation || !removalRationale.trim()) return;
    setSaving(true); setMessage("");
    try { await mutate("remove_infrastructure_installation", { id: installation.id, rationale: removalRationale }); onDismiss(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The Product placement could not be removed."); }
    finally { setSaving(false); }
  }

  if (removing && installation) return <ViewportModal onDismiss={onDismiss} dismissDisabled={saving} labelledBy="product-placement-remove-title"><span className="eyebrow">AUDITED REMOVAL</span><h2 id="product-placement-remove-title">Remove {productName} placement?</h2><p>This removes the governed installation link. The Product, Platform, infrastructure node, Release, and audit history remain.</p><label className="modal-field">Removal rationale<textarea rows={4} value={removalRationale} onChange={(event) => setRemovalRationale(event.target.value)} placeholder="Why is this placement no longer valid?" /></label>{message ? <p className="error-copy">{message}</p> : null}<footer><button type="button" className="ghost-button" disabled={saving} onClick={() => setRemoving(false)}>Back</button><button type="button" className="danger-button" disabled={saving || !removalRationale.trim()} onClick={() => void remove()}>{saving ? "Removing…" : "Remove placement"}</button></footer></ViewportModal>;

  return <ViewportModal onDismiss={onDismiss} dismissDisabled={saving} labelledBy="product-placement-title" className="wide-modal product-placement-modal">
    <div className="section-toolbar"><div><span className="eyebrow">GOVERNED PRODUCT PLACEMENT</span><h2 id="product-placement-title">{installation ? "Edit or move" : "Place"} {productName}</h2></div><span className="record-type">{installation ? "Existing installation" : "New installation"}</span></div>
    <aside className="contract-strip"><strong>Placement rule</strong><span>Choose the Release, Platform, and exact infrastructure node or VM. A Product cannot be left on a Platform without an execution node because that would make deployment analysis ambiguous. Moving an existing placement updates the same audited record.</span></aside>
    <div className="form-grid">
      <label className="modal-field">Product<input value={productName} readOnly /></label>
      <label className="modal-field">Release<select value={form.releaseId} onChange={(event) => changeRelease(event.target.value)}><option value="">Choose Release</option>{portfolio.releases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="modal-field">Platform<select value={form.platformId} disabled={!form.releaseId} onChange={(event) => changePlatform(event.target.value)}><option value="">Choose Platform</option>{platformOptions.map((item) => { const nodeCount = portfolio.states.filter((state) => state.releaseId === form.releaseId && state.platformId === item.id && state.lifecycleStatus !== "absent").length; return <option key={item.id} value={item.id}>{item.code} · {item.name} · {nodeCount ? `${nodeCount} node${nodeCount === 1 ? "" : "s"}` : "no nodes in Release"}</option>; })}</select></label>
      <label className="modal-field">Infrastructure node / VM<select value={form.nodeStateId} disabled={!form.platformId} onChange={(event) => setForm({ ...form, nodeStateId: event.target.value, baselineOccurrenceId: "" })}><option value="">Choose node or VM</option>{nodeOptions.map((state) => { const node = nodeById.get(state.infrastructureNodeId); const parent = state.parentStateId ? stateById.get(state.parentStateId) : undefined; const parentIdentity = parent ? nodeById.get(parent.infrastructureNodeId) : undefined; return <option key={state.id} value={state.id}>{node?.code || "Unknown"} · {node?.name || "Identity missing"} · {readable(node?.nodeType || "node")}{parentIdentity ? ` · on ${parentIdentity.code}` : ""}</option>; })}</select></label>
      <label className="modal-field">Installation role<select value={form.installationRole} onChange={(event) => setForm({ ...form, installationRole: event.target.value })}>{roles.map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label>
      <label className="modal-field">Version<input value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} /></label>
      <label className="modal-field">Instance name<input value={form.instanceName} onChange={(event) => setForm({ ...form, instanceName: event.target.value })} placeholder={form.installationRole === "application" ? "Service / workload / container identity" : "Only when multiple instances exist"} /></label>
      <label className="modal-field">Deployment status<select value={form.deploymentStatus} onChange={(event) => setForm({ ...form, deploymentStatus: event.target.value })}>{["planned", "installed", "retired", "absent"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label>
      <label className="modal-field">Evidence confidence<select value={form.confidence} onChange={(event) => setForm({ ...form, confidence: event.target.value })}>{["reported", "assessed", "confirmed"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label>
      <label className="modal-field">Linked baseline record<select value={form.baselineOccurrenceId} disabled={!form.releaseId} onChange={(event) => setForm({ ...form, baselineOccurrenceId: event.target.value })}><option value="">No imported row link</option>{occurrenceOptions.map((item) => <option key={item.id} value={item.id}>{item.sourceKey}</option>)}</select></label>
      <label className="modal-field">Source as of<input type="date" value={form.sourceAsOf} onChange={(event) => setForm({ ...form, sourceAsOf: event.target.value })} /></label>
    </div>
    {form.releaseId && !platformOptions.length ? <aside className="decision-principle"><strong>No governed Platforms are available</strong><span>Create the Platform before placing this Product.</span><Link className="ghost-button" href="/platforms">Open Platforms</Link></aside> : null}
    {form.platformId && !nodeOptions.length ? <aside className="decision-principle"><strong>No infrastructure node exists for this Platform and Release</strong><span>Add the physical node or VM first. The Product placement will then have an exact, analyzable execution location.</span>{platform && release ? <Link className="ghost-button" href={`/platforms/${encodeURIComponent(platform.id)}/topology-manager?release=${encodeURIComponent(release.name)}`}>Open Platform visual manager</Link> : null}</aside> : null}
    {selectedState && selectedNode ? <dl className="placement-route-summary"><div><dt>Selected path</dt><dd>{release?.name || "Unknown Release"} → {platform ? `${platform.code} · ${platform.name}` : "Unknown Platform"} → {selectedNode.code} · {selectedNode.name}</dd></div><div><dt>Host / parent</dt><dd>{parentNode ? `${parentNode.code} · ${parentNode.name}` : "Platform root"}</dd></div><div><dt>Capacity</dt><dd>{selectedState.cpuCores ?? "—"} CPU · {selectedState.memoryGb ?? "—"} GB RAM · {selectedState.storageGb ?? "—"} GB storage</dd></div></dl> : null}
    <label className="modal-field">Supporting reference<input value={form.sourceReference} onChange={(event) => setForm({ ...form, sourceReference: event.target.value })} /></label>
    <label className="modal-field">Notes<textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
    {message ? <p className="error-copy">{message}</p> : null}
    <footer>{installation ? <button type="button" className="danger-button" disabled={saving} onClick={() => setRemoving(true)}>Remove placement</button> : null}<button type="button" className="ghost-button" disabled={saving} onClick={onDismiss}>Cancel</button><button type="button" className="primary-button" disabled={saving || !form.nodeStateId} onClick={() => void save()}>{saving ? "Saving…" : installation ? "Save placement / move" : "Add placement"}</button></footer>
  </ViewportModal>;
}
