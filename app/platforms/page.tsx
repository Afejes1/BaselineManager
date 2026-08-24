"use client";

import { useMemo, useState } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { ViewportModal } from "../../components/viewport-modal";
import { useWorkspaceContext } from "../../components/workspace-context";
import { savePlatformAction, usePlatformPortfolio } from "../../lib/platform-client";
import type { PlatformAssignment, PlatformRecord, PlatformType } from "../../lib/platform-model";

const typeLabel: Record<PlatformType, string> = { alou: "ALOU · Global node", ock: "OCK · Country", obk: "OBK · Squadron / site", pma: "PMA · Laptop / endpoint", other: "Other installation" };
const requiredParent: Partial<Record<PlatformType, PlatformType>> = { ock: "alou", obk: "ock", pma: "obk" };

function platformHref(id: string, releaseLens: string | null) {
  return `/platforms/${encodeURIComponent(id)}${releaseLens ? `?release=${encodeURIComponent(releaseLens)}` : ""}`;
}

function PlatformBranch({ platform, all, assignments, releaseLens, depth = 0 }: { platform: PlatformRecord; all: PlatformRecord[]; assignments: PlatformAssignment[]; releaseLens: string | null; depth?: number }) {
  const children = all.filter((candidate) => candidate.parentId === platform.id);
  const sourcePlatform = platform.isA2OResourcePlatform;
  const direct = assignments.filter((item) => item.platformId === platform.id && (!releaseLens || item.releaseName === releaseLens));
  const products = new Set(direct.map((item) => item.productName)).size;
  return <div className="platform-branch" style={{ "--platform-depth": depth } as React.CSSProperties}>
    <Link className={`platform-node platform-${platform.platformType}`} href={platformHref(platform.id, releaseLens)}>
      <span className="platform-type">{sourcePlatform ? "A2O REPORTED RESOURCE" : platform.platformType.toUpperCase()}</span>
      <strong>{sourcePlatform ? platform.name : `${platform.code} · ${platform.name}`}</strong>
      <small>{sourcePlatform ? `Tier descriptor: ${platform.reportedTierName || "not reported"} · ` : ""}{releaseLens ? `${direct.length} selected-release records · ${products} products` : `${platform.directOccurrenceCount} direct baseline records · ${platform.directProductCount} products`} · {platform.status}</small>
    </Link>
    {children.length ? <div className="platform-children">{children.map((child) => <PlatformBranch key={child.id} platform={child} all={all} assignments={assignments} releaseLens={releaseLens} depth={depth + 1} />)}</div> : null}
  </div>;
}

export default function PlatformsPage() {
  const { portfolio, loading, error, reload } = usePlatformPortfolio();
  const { releaseLens } = useWorkspaceContext();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ code: "", name: "", platformType: "obk" as PlatformType, parentId: "", status: "active", installationLocation: "", countryCode: "", description: "" });
  const sourcePlatforms = useMemo(() => portfolio.platforms.filter((platform) => platform.isA2OResourcePlatform), [portfolio.platforms]);
  const governedRoots = useMemo(() => portfolio.platforms.filter((platform) => !platform.isA2OResourcePlatform && (!platform.parentId || !portfolio.platforms.some((candidate) => candidate.id === platform.parentId))), [portfolio.platforms]);
  const metrics = useMemo(() => ({ a2o: portfolio.platforms.filter((item) => item.isA2OResourcePlatform).length, alou: portfolio.platforms.filter((item) => item.platformType === "alou").length, ock: portfolio.platforms.filter((item) => item.platformType === "ock").length, obk: portfolio.platforms.filter((item) => item.platformType === "obk").length, pma: portfolio.platforms.filter((item) => item.platformType === "pma").length }), [portfolio.platforms]);
  const scopedOccurrenceOptions = useMemo(() => portfolio.occurrenceOptions.filter((item) => !releaseLens || item.releaseName === releaseLens), [portfolio.occurrenceOptions, releaseLens]);
  const platformById = useMemo(() => new Map(portfolio.platforms.map((item) => [item.id, item])), [portfolio.platforms]);
  const needsGovernmentMapping = scopedOccurrenceOptions.filter((item) => !item.primaryPlatformId || platformById.get(item.primaryPlatformId)?.isA2OResourcePlatform).length;
  const parentOptions = portfolio.platforms.filter((item) => !requiredParent[form.platformType] || item.platformType === requiredParent[form.platformType]);

  async function save() {
    setSaving(true); setMessage("");
    try { await savePlatformAction({ action: "save_platform", ...form, parentId: form.parentId || null }); await reload(); setOpen(false); setForm({ code: "", name: "", platformType: "obk", parentId: "", status: "active", installationLocation: "", countryCode: "", description: "" }); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Platform could not be saved."); }
    finally { setSaving(false); }
  }

  return <DomainPageShell title="Platforms" subtitle="Select a Release Lens to review and change fielding mappings. Platform identity and hierarchy are governed across releases." releaseScope={releaseLens ? `Release: ${releaseLens}` : `${portfolio.platforms.length} platform records · all releases`} contextMode="filter" actions={<><Link className="ghost-button" href="/releases">Manage Releases</Link><button className="primary-button" type="button" onClick={() => setOpen(true)}>+ Create governed Platform</button></>}>
    <section className="summary"><div className="metric"><span>A2O Resource Platforms</span><strong>{metrics.a2o}</strong><small>Reported Resource values retained from import</small></div><div className="metric"><span>ALOU / OCK</span><strong>{metrics.alou} / {metrics.ock}</strong><small>Global and country nodes</small></div><div className="metric"><span>OBK / PMA</span><strong>{metrics.obk} / {metrics.pma}</strong><small>Site and endpoint nodes</small></div><div className={`metric ${needsGovernmentMapping ? "metric-alert" : ""}`}><span>{releaseLens ? "Needs Government mapping" : "Reported-resource mappings"}</span><strong>{needsGovernmentMapping}</strong><small>{releaseLens ? "Selected-release records still mapped only to imported Resource" : "Select a Release Lens to review by release"}</small></div></section>
    <section className="contract-strip"><strong>How to work this page</strong><span>1. Select the Release Lens in the header. 2. Open a reported Resource or governed Platform. 3. Edit the stable Platform record, then use <em>Baseline assignments</em> to record the Government mapping for that Release. 4. Use <em>System configuration</em> for release-specific hardware, installation, and connection detail.</span></section>
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">A2O SOURCE PLATFORMS</span><h3>Reported Resource Platforms</h3></div><span>Resource is the reported Platform · Tier is its descriptor</span></div>
      {loading ? <p>Loading Platforms…</p> : error ? <p className="error-copy">{error}</p> : sourcePlatforms.length ? <div className="platform-tree">{sourcePlatforms.map((platform) => <PlatformBranch key={platform.id} platform={platform} all={portfolio.platforms} assignments={portfolio.assignments} releaseLens={releaseLens} />)}</div> : <article className="domain-card empty-state"><h3>No A2O Resource Platforms yet</h3><p>Import an A2O Tech Stack workbook. Every reported Resource will create or update a Platform with its Tier descriptor.</p></article>}
    </section>
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">GOVERNED FIELDING HIERARCHY</span><h3>ALOU, OCK, OBK, and PMA context</h3></div><span>Open a node to edit the Platform, selected-release mappings, and system configuration</span></div>
      {loading || error ? null : governedRoots.length ? <div className="platform-tree">{governedRoots.map((root) => <PlatformBranch key={root.id} platform={root} all={portfolio.platforms} assignments={portfolio.assignments} releaseLens={releaseLens} />)}</div> : <article className="domain-card empty-state"><h3>No governed hierarchy yet</h3><p>Create an ALOU root, then add OCK, OBK, and PMA child nodes when fielding analysis requires it.</p></article>}
    </section>
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">RELEASE PERSPECTIVES</span><h3>As-Is and To-Be roles are governed on each Release</h3></div><Link className="ghost-button" href="/releases">Manage Releases</Link></div><p className="entity-meta">Platform records define where. The selected Release controls the mapping and configuration you are reviewing; Release records define when and whether the baseline is historical, current, target, or reported.</p><div className="chip-list">{portfolio.releaseProfiles.map((profile) => <Link key={profile.id} className="domain-chip" href={`/platforms?release=${encodeURIComponent(profile.releaseName)}`}><strong>{profile.releaseName}</strong><span>{profile.stateRole.replace("_", " ")} · {profile.effectiveDate || "date not set"}</span></Link>)}</div></section>
    {open ? <ViewportModal onDismiss={() => setOpen(false)} dismissDisabled={saving} labelledBy="platform-title"><span className="eyebrow">BASELINE STRUCTURE</span><h2 id="platform-title">Create governed Platform</h2><p>Use this for the Government fielding hierarchy. A2O-reported Resources remain traceable source Platforms; assignments establish the Release-specific Government mapping.</p><div className="form-grid"><label className="modal-field">Type<select value={form.platformType} onChange={(event) => setForm({ ...form, platformType: event.target.value as PlatformType, parentId: "" })}>{Object.entries(typeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="modal-field">Code<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="e.g., OBK-VA-07" /></label><label className="modal-field">Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Installation or node name" /></label><label className="modal-field">Parent<select disabled={form.platformType === "alou"} value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })}><option value="">No parent / root</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label className="modal-field">Location<input value={form.installationLocation} onChange={(event) => setForm({ ...form, installationLocation: event.target.value })} /></label><label className="modal-field">Country code<input value={form.countryCode} maxLength={3} onChange={(event) => setForm({ ...form, countryCode: event.target.value })} /></label></div><label className="modal-field">Description<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>{message ? <p className="error-copy">{message}</p> : null}<footer><button className="ghost-button" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Create Platform"}</button></footer></ViewportModal> : null}
  </DomainPageShell>;
}
