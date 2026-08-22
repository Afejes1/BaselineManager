"use client";

import Link from "../../../components/app-link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { capabilityIdentity, getCapabilityRows, productDisplayName, productIdentityKey, text } from "../../../lib/baseline-data";
import { DomainPageShell } from "../../../components/domain-shell";
import { AnalyticsLink } from "../../../components/analytics-link";
import { ObjectRecordsPanel, ObjectTabBar } from "../../../components/object-workspace";
import { MasterEntityEditorDialog } from "../../../components/master-data-editor";
import { AuditHistoryPanel } from "../../../components/governed-object";
import { useWorkspaceContext } from "../../../components/workspace-context";
import { useMasterData } from "../../../lib/master-data-client";
import type { ManagedRecord24 } from "../../../lib/baseline-client";

function decodeId(value: string) { try { return decodeURIComponent(value); } catch { return value; } }

export default function CapabilityDetailPage() {
  const params = useParams<{ id?: string }>();
  const routeId = decodeId(params.id ?? "");
  const { rows } = useWorkspaceContext();
  const master = useMasterData();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const record = master.portfolio.capabilities.find((item) => item.id === routeId || capabilityIdentity(item.name) === capabilityIdentity(routeId));
  const capability = record?.name || routeId;
  const capabilityRows = useMemo(() => getCapabilityRows(rows, capability) as ManagedRecord24[], [rows, capability]);
  const visibleRows = useMemo(() => { const normalized = query.trim().toLowerCase(); return !normalized ? capabilityRows : capabilityRows.filter((row) => `${text(row.ReleaseName)} ${text(row.LongName)} ${text(row.ShortName)} ${text(row.OEM)} ${text(row.Resource)}`.toLowerCase().includes(normalized)); }, [capabilityRows, query]);
  const releases = new Set(capabilityRows.map((row) => text(row.ReleaseName)).filter(Boolean));
  const products = new Set(capabilityRows.map((row) => productIdentityKey(row)));
  const parent = master.portfolio.capabilities.find((item) => item.id === record?.parentId);
  const children = master.portfolio.capabilities.filter((item) => item.parentId === record?.id);

  if (!capabilityRows.length && !record) return <DomainPageShell title="Capability not found" subtitle="No canonical Capability or baseline mapping matches this identifier." contextMode="record"><section className="domain-section"><Link href="/capabilities">Return to Capabilities</Link></section></DomainPageShell>;

  return <DomainPageShell title={`Capability: ${capability}`} subtitle="Governed capability identity, hierarchy, product mapping, and evidence." releaseScope={`${products.size} products · ${releases.size} releases`} contextMode="record" objectContext={record ? { kind: "capability", id: record.id, label: capability } : undefined} actions={<><label className="search" style={{ width: "250px" }}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product mappings" /></label><AnalyticsLink kind="capability" id={record?.id || routeId} />{record ? <button className="ghost-button" type="button" onClick={() => setEditing(true)}>Edit Capability</button> : null}</>}>
    <section className="summary"><div className="metric"><span>Lifecycle</span><strong>{record?.lifecycleStatus || "Active"}</strong><small>{record?.code || "Code not recorded"}</small></div><div className="metric"><span>Products</span><strong>{products.size}</strong><small>{capabilityRows.length} baseline records</small></div><div className="metric"><span>Releases</span><strong>{releases.size}</strong><small>Reported positions</small></div><div className="metric"><span>Hierarchy</span><strong>{children.length}</strong><small>Child capabilities</small></div></section>
    <ObjectTabBar active={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "products", label: "Products & releases", count: products.size }, { id: "evidence", label: "Calls & evidence" }, { id: "history", label: "History" }]} />
    {tab === "overview" ? <section className="split-layout"><article className="domain-section"><span className="eyebrow">CANONICAL CAPABILITY</span><h3>{capability}</h3><p>{record?.description || "Capability description not recorded."}</p><dl className="record-facts"><div><dt>Parent</dt><dd>{parent ? <Link href={`/capabilities/${encodeURIComponent(parent.id)}`}>{parent.name}</Link> : "Top level"}</dd></div><div><dt>Source</dt><dd>{record?.sourceReference || "Not recorded"}</dd></div><div><dt>Source as of</dt><dd>{record?.sourceAsOf || "Not recorded"}</dd></div></dl></article><article className="domain-section"><span className="eyebrow">CHILD CAPABILITIES</span><h3>{children.length} governed children</h3>{children.map((item) => <p className="entity-actions" key={item.id}><Link href={`/capabilities/${encodeURIComponent(item.id)}`}>{item.code ? `${item.code} · ` : ""}{item.name}</Link></p>)}{!children.length ? <p className="empty">No child capabilities.</p> : null}</article></section> : null}
    {tab === "products" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">PRODUCT MAPPING</span><h3>Release-specific records reporting this Capability</h3></div><span>{visibleRows.length} records</span></div><div className="domain-table-wrap"><table><thead><tr><th>Product</th><th>Release</th><th>Placement</th><th>Supplier</th><th>Runtime</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={`${text(row["#"])}:${text(row.ReleaseName)}:${text(row.Tier)}`}><td><Link href={`/products/${encodeURIComponent(row.__meta?.productId || productIdentityKey(row))}`}>{productDisplayName(row)}</Link></td><td>{text(row.ReleaseName) || "Unassigned"}</td><td>{text(row.Resource) || "Unassigned"} / {text(row.HW_Host) || "Unassigned"}</td><td><Link href={`/organizations/${encodeURIComponent(text(row.OEM) || "Unassigned")}`}>{text(row.OEM) || "Unassigned"}</Link></td><td>{`${text(row.TechStackType) || "—"} · ${text(row.Containerized) || "—"}`}</td></tr>)}{!visibleRows.length ? <tr><td colSpan={5} className="empty">No release-specific mappings are recorded.</td></tr> : null}</tbody></table></div></section> : null}
    {tab === "evidence" && record ? <ObjectRecordsPanel context={{ kind: "capability", id: record.id, label: capability }} /> : null}
    {tab === "history" && record ? <AuditHistoryPanel kind="capability" id={record.id} label={capability} /> : null}
    {editing && record ? <MasterEntityEditorDialog kind="capability" record={record as unknown as Record<string, unknown>} portfolio={master.portfolio} onDismiss={() => setEditing(false)} onSaved={() => { setEditing(false); void master.reload(); }} /> : null}
  </DomainPageShell>;
}
