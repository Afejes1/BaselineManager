"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "../../../components/app-link";
import { DomainPageShell } from "../../../components/domain-shell";
import { useBaselineWorkspace } from "../../../lib/baseline-client";
import { productDisplayName, text } from "../../../lib/baseline-data";
import { useChangePortfolio } from "../../../lib/change-client";
import { savePlatformAction, usePlatformPortfolio } from "../../../lib/platform-client";

export default function PlatformDetailPage() {
  const id = decodeURIComponent(useParams<{ id: string }>().id || "");
  const { portfolio, reload } = usePlatformPortfolio();
  const { portfolio: changes } = useChangePortfolio();
  const { rows } = useBaselineWorkspace();
  const [saving, setSaving] = useState(false);
  const [relation, setRelation] = useState({ organizationId: "", relationshipType: "operator", sourceReference: "" });
  const platform = portfolio.platforms.find((item) => item.id === id);
  const descendants = useMemo(() => { const ids = new Set([id]); let changed = true; while (changed) { changed = false; for (const item of portfolio.platforms) if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; } } return ids; }, [id, portfolio.platforms]);
  const nodeIds = useMemo(() => new Set(portfolio.platforms.filter((item) => descendants.has(item.id)).map((item) => item.configurationNodeId).filter(Boolean)), [descendants, portfolio.platforms]);
  const sourceRows = rows.filter((row) => row.__meta.configurationNodeId && nodeIds.has(row.__meta.configurationNodeId));
  const effects = changes.effects.filter((effect) => effect.subjectKind === "platform" && descendants.has(effect.subjectId));
  const requestIds = new Set(effects.map((effect) => effect.changeRequestId));
  const requests = changes.requests.filter((request) => requestIds.has(request.id));
  const relationships = portfolio.relationships.filter((item) => descendants.has(item.platformId));
  const products = Array.from(new Set(sourceRows.map(productDisplayName))).sort();
  const releases = Array.from(new Set(sourceRows.map((row) => text(row.ReleaseName)).filter(Boolean))).sort();
  async function linkOrganization() { if (!relation.organizationId) return; setSaving(true); try { await savePlatformAction({ action: "link_organization", platformId: id, ...relation }); await reload(); setRelation({ organizationId: "", relationshipType: "operator", sourceReference: "" }); } finally { setSaving(false); } }
  if (!platform) return <DomainPageShell title="Platform not found"><article className="domain-card"><Link href="/platforms">Return to Platform hierarchy</Link></article></DomainPageShell>;
  const parent = portfolio.platforms.find((item) => item.id === platform.parentId);
  return <DomainPageShell title={`${platform.code} · ${platform.name}`} subtitle={`${platform.platformType.toUpperCase()} Platform dashboard`} releaseScope={`${releases.length} releases`} actions={<><Link className="ghost-button" href="/platforms">Hierarchy</Link><button className="ghost-button" type="button" onClick={() => window.print()}>Print dashboard</button></>}>
    <section className="summary"><div className="metric"><span>Products in subtree</span><strong>{products.length}</strong><small>{sourceRows.length} retained source rows</small></div><div className="metric"><span>Releases represented</span><strong>{releases.length}</strong><small>{releases.join(" · ") || "No source linkage"}</small></div><div className="metric"><span>Organizations</span><strong>{relationships.length}</strong><small>Owner / operator / support links</small></div><div className="metric metric-alert"><span>Change Requests</span><strong>{requests.length}</strong><small>{requests.filter((item) => item.decisionStatus === "pending").length} funding decisions pending</small></div></section>
    <section className="dashboard-grid"><article className="domain-card"><span className="eyebrow">HIERARCHY CONTEXT</span><h3>{parent ? <Link href={`/platforms/${encodeURIComponent(parent.id)}`}>{parent.code} · {parent.name}</Link> : "Program root"} → {platform.code}</h3><p>{platform.description || "Description not recorded."}</p><p className="entity-meta">{platform.installationLocation || "Location not recorded"}{platform.countryCode ? ` · ${platform.countryCode}` : ""} · {platform.status}</p></article><article className="domain-card"><span className="eyebrow">WHAT / WHERE / WHEN</span><h3>{products.length} products at {platform.code}</h3><p>{releases.length ? `Reported across ${releases.join(", ")}.` : "Link this Platform to a configuration node to show baseline records."}</p><p className="entity-actions"><Link href="/reports">Open leadership reports</Link></p></article></section>
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">CHANGE IMPACT</span><h3>Funding decisions affecting this Platform subtree</h3></div><Link href={`/changes?subject=platform:${encodeURIComponent(id)}`}>Create or link request</Link></div><div className="domain-list">{requests.map((request) => <article key={request.id} className="domain-card"><span className={`decision-badge decision-${request.decisionStatus}`}>{request.decisionStatus}</span><h3><Link href={`/changes/${encodeURIComponent(request.id)}`}>{request.externalIdentifier} · {request.title}</Link></h3><p>{request.impactSummary || request.summary || "Impact narrative not yet assessed."}</p></article>)}{!requests.length ? <article className="domain-card empty-state"><h3>No Platform-level Change Request effects</h3><p>The baseline is still visible; no funding request has been linked to this Platform subtree.</p></article> : null}</div></section>
    <section className="domain-section"><h3>Products and source evidence</h3><div className="chip-list">{products.map((product) => <span className="domain-chip" key={product}><strong>{product}</strong><span>{sourceRows.filter((row) => productDisplayName(row) === product).length} rows</span></span>)}</div></section>
    <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">ACCOUNTABILITY</span><h3>Organization relationships</h3></div></div><div className="chip-list">{relationships.map((item) => <Link key={item.id} className="domain-chip" href={`/organizations/${encodeURIComponent(item.organizationName)}`}><strong>{item.organizationName}</strong><span>{item.relationshipType}</span></Link>)}</div><div className="inline-form"><select value={relation.organizationId} onChange={(event) => setRelation({ ...relation, organizationId: event.target.value })}><option value="">Choose organization</option>{portfolio.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={relation.relationshipType} onChange={(event) => setRelation({ ...relation, relationshipType: event.target.value })}>{["owner", "operator", "integrator", "support", "supplier"].map((item) => <option key={item}>{item}</option>)}</select><input value={relation.sourceReference} onChange={(event) => setRelation({ ...relation, sourceReference: event.target.value })} placeholder="Supporting reference" /><button className="primary-button" disabled={saving || !relation.organizationId} onClick={() => void linkOrganization()}>Link organization</button></div></section>
  </DomainPageShell>;
}
