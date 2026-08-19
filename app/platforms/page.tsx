"use client";

import { useMemo, useState } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { ViewportModal } from "../../components/viewport-modal";
import { savePlatformAction, usePlatformPortfolio } from "../../lib/platform-client";
import type { PlatformRecord, PlatformType } from "../../lib/platform-model";

const typeLabel: Record<PlatformType, string> = { alou: "ALOU · Global node", ock: "OCK · Country", obk: "OBK · Squadron / site", pma: "PMA · Laptop / endpoint", other: "Other installation" };
const requiredParent: Partial<Record<PlatformType, PlatformType>> = { ock: "alou", obk: "ock", pma: "obk" };

function PlatformBranch({ platform, all, depth = 0 }: { platform: PlatformRecord; all: PlatformRecord[]; depth?: number }) {
  const children = all.filter((candidate) => candidate.parentId === platform.id);
  return <div className="platform-branch" style={{ "--platform-depth": depth } as React.CSSProperties}>
    <Link className={`platform-node platform-${platform.platformType}`} href={`/platforms/${encodeURIComponent(platform.id)}`}>
      <span className="platform-type">{platform.platformType.toUpperCase()}</span>
      <strong>{platform.code} · {platform.name}</strong>
      <small>{platform.directOccurrenceCount} direct source rows · {platform.directProductCount} products · {platform.status}</small>
    </Link>
    {children.length ? <div className="platform-children">{children.map((child) => <PlatformBranch key={child.id} platform={child} all={all} depth={depth + 1} />)}</div> : null}
  </div>;
}

export default function PlatformsPage() {
  const { portfolio, loading, error, reload } = usePlatformPortfolio();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ code: "", name: "", platformType: "obk" as PlatformType, parentId: "", status: "active", installationLocation: "", countryCode: "", description: "" });
  const [releaseForm, setReleaseForm] = useState({ releaseId: "", stateRole: "reported", effectiveDate: "", description: "" });
  const roots = useMemo(() => portfolio.platforms.filter((platform) => !platform.parentId || !portfolio.platforms.some((candidate) => candidate.id === platform.parentId)), [portfolio.platforms]);
  const metrics = useMemo(() => ({ alou: portfolio.platforms.filter((item) => item.platformType === "alou").length, ock: portfolio.platforms.filter((item) => item.platformType === "ock").length, obk: portfolio.platforms.filter((item) => item.platformType === "obk").length, pma: portfolio.platforms.filter((item) => item.platformType === "pma").length }), [portfolio.platforms]);
  const unmapped = portfolio.occurrenceOptions.filter((item) => !item.primaryPlatformId).length;
  const parentOptions = portfolio.platforms.filter((item) => !requiredParent[form.platformType] || item.platformType === requiredParent[form.platformType]);

  async function save() {
    setSaving(true); setMessage("");
    try { await savePlatformAction({ action: "save_platform", ...form, parentId: form.parentId || null }); await reload(); setOpen(false); setForm({ code: "", name: "", platformType: "obk", parentId: "", status: "active", installationLocation: "", countryCode: "", description: "" }); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Platform could not be saved."); }
    finally { setSaving(false); }
  }
  async function saveReleaseRole() { if (!releaseForm.releaseId) return; setSaving(true); setMessage(""); try { await savePlatformAction({ action: "save_release_profile", ...releaseForm }); await reload(); setReleaseForm({ releaseId: "", stateRole: "reported", effectiveDate: "", description: "" }); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Release state role could not be saved."); } finally { setSaving(false); } }

  return <DomainPageShell title="Platform Hierarchy" subtitle="Installation context from global node to fielded endpoint." releaseScope={`${portfolio.platforms.length} platform records`} actions={<button className="primary-button" type="button" onClick={() => setOpen(true)}>+ New platform</button>}>
    <section className="summary"><div className="metric"><span>ALOU / OCK</span><strong>{metrics.alou} / {metrics.ock}</strong><small>Global and country nodes</small></div><div className="metric"><span>OBK sites</span><strong>{metrics.obk}</strong><small>Squadron / installation</small></div><div className="metric"><span>PMA endpoints</span><strong>{metrics.pma}</strong><small>Laptops and endpoints</small></div><div className={`metric ${unmapped ? "metric-alert" : ""}`}><span>Unmapped baseline records</span><strong>{unmapped}</strong><small>Require a primary Platform assignment</small></div></section>
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">INSTALLATION HIERARCHY</span><h3>Where the baseline is installed</h3></div><span>Open a node for products, releases, organizations, and Change Request effects</span></div>
      {loading ? <p>Loading hierarchy…</p> : error ? <p className="error-copy">{error}</p> : roots.length ? <div className="platform-tree">{roots.map((root) => <PlatformBranch key={root.id} platform={root} all={portfolio.platforms} />)}</div> : <article className="domain-card empty-state"><h3>No Platform hierarchy yet</h3><p>Create an ALOU root, then add OCK, OBK, and PMA child nodes. The demo loader also creates a complete plausible hierarchy.</p></article>}
    </section>
    <section className="domain-section"><span className="eyebrow">STATE ROLES</span><h3>As-Is and To-Be are release perspectives</h3><p className="entity-meta">This classification supports comparison. It does not approve a technical baseline; funding decisions belong to Change Requests.</p><div className="chip-list">{portfolio.releaseProfiles.map((profile) => <Link key={profile.id} className="domain-chip" href={`/releases/${encodeURIComponent(profile.releaseName)}`}><strong>{profile.releaseName}</strong><span>{profile.stateRole.replace("_", " ")} · {profile.effectiveDate || "date not set"}</span></Link>)}</div><div className="inline-form"><select value={releaseForm.releaseId} onChange={(event) => setReleaseForm({ ...releaseForm, releaseId: event.target.value })}><option value="">Choose release</option>{portfolio.releases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={releaseForm.stateRole} onChange={(event) => setReleaseForm({ ...releaseForm, stateRole: event.target.value })}>{["historical", "as_is", "to_be", "reported"].map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}</select><input type="date" value={releaseForm.effectiveDate} onChange={(event) => setReleaseForm({ ...releaseForm, effectiveDate: event.target.value })} /><button className="primary-button" disabled={saving || !releaseForm.releaseId} onClick={() => void saveReleaseRole()}>Save state role</button></div>{message ? <p className="error-copy">{message}</p> : null}</section>
    {open ? <ViewportModal onDismiss={() => setOpen(false)} dismissDisabled={saving} labelledBy="platform-title"><span className="eyebrow">GOVERNMENT-MANAGED DETAIL</span><h2 id="platform-title">Create Platform</h2><p>Platform describes the installation hierarchy. It does not alter the A2O Tech Stack workbook.</p><div className="form-grid"><label className="modal-field">Type<select value={form.platformType} onChange={(event) => setForm({ ...form, platformType: event.target.value as PlatformType, parentId: "" })}>{Object.entries(typeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="modal-field">Code<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="e.g., OBK-VA-07" /></label><label className="modal-field">Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Installation or node name" /></label><label className="modal-field">Parent<select disabled={form.platformType === "alou"} value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })}><option value="">No parent / root</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label className="modal-field">Location<input value={form.installationLocation} onChange={(event) => setForm({ ...form, installationLocation: event.target.value })} /></label><label className="modal-field">Country code<input value={form.countryCode} maxLength={3} onChange={(event) => setForm({ ...form, countryCode: event.target.value })} /></label></div><label className="modal-field">Description<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>{message ? <p className="error-copy">{message}</p> : null}<footer><button className="ghost-button" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Create platform"}</button></footer></ViewportModal> : null}
  </DomainPageShell>;
}
