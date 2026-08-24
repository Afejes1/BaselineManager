"use client";

import Link from "../../../components/app-link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getConfigurationRows, productDisplayName, productIdentityKey, text } from "../../../lib/baseline-data";
import { DomainPageShell } from "../../../components/domain-shell";
import { ObjectRecordsPanel, ObjectTabBar } from "../../../components/object-workspace";
import { MasterEntityEditorDialog } from "../../../components/master-data-editor";
import { AuditHistoryPanel } from "../../../components/governed-object";
import { useWorkspaceContext } from "../../../components/workspace-context";
import { useMasterData } from "../../../lib/master-data-client";
import type { ManagedRecord24 } from "../../../lib/baseline-client";

function decodeId(value: string) { try { return decodeURIComponent(value); } catch { return value; } }

export default function ConfigurationDetailPage() {
  const params = useParams<{ id?: string }>();
  const nodeId = decodeId(params.id ?? "");
  const { scopedRows, releaseLens } = useWorkspaceContext();
  const master = useMasterData();
  const [tab, setTab] = useState("overview");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const record = master.portfolio.configurationNodes.find((item) => item.id === nodeId);
  const configRows = useMemo(() => (record ? scopedRows.filter((row) => row.__meta.configurationNodeId === record.id) : getConfigurationRows(scopedRows, nodeId)) as ManagedRecord24[], [nodeId, record, scopedRows]);
  const filteredRows = useMemo(() => { const normalized = query.trim().toLowerCase(); return !normalized ? configRows : configRows.filter((row) => `${text(row.ReleaseName)} ${text(row.LongName)} ${text(row.ShortName)} ${text(row.HW_Host)} ${text(row.OEM)}`.toLowerCase().includes(normalized)); }, [configRows, query]);
  const releaseNames = Array.from(new Set(configRows.map((row) => text(row.ReleaseName)).filter(Boolean)));
  const productIds = new Set(configRows.map((row) => row.__meta.productId || productIdentityKey(row)));
  const parent = master.portfolio.configurationNodes.find((item) => item.id === record?.parentId);
  const children = master.portfolio.configurationNodes.filter((item) => item.parentId === record?.id);
  const derivedLabel = configRows.length ? `${text(configRows[0].Tier) || "Unassigned"} / ${text(configRows[0].Resource) || "Unassigned"} / ${text(configRows[0].HW_Host) || "Unassigned"}` : nodeId;
  const label = record ? `${record.code ? `${record.code} · ` : ""}${record.name}` : derivedLabel;

  if (!record && !configRows.length) return <DomainPageShell title="Configuration Node not found" subtitle="No canonical node or release-specific placement matches this identifier." contextMode="record"><section className="domain-section"><Link href="/configuration">Return to Configuration Nodes</Link></section></DomainPageShell>;

  return <DomainPageShell title={`Configuration: ${label}`} subtitle={record ? "Canonical technical placement node and release-specific use." : "Release-specific placement derived from baseline records."} releaseScope={releaseLens ? `Release: ${releaseLens} · ${productIds.size} products` : `${productIds.size} products · ${releaseNames.length} releases`} contextMode="filter" objectContext={record ? { kind: "configuration_node", id: record.id, label } : undefined} actions={<><label className="search" style={{ width: "250px" }}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search placements" /></label>{record ? <button className="ghost-button" type="button" onClick={() => setEditing(true)}>Edit Node</button> : null}{releaseLens ? <Link className="ghost-button" href={`/topology?release=${encodeURIComponent(releaseLens)}`}>Edit Release configuration</Link> : null}</>}>
    <section className="summary"><div className="metric"><span>Lifecycle</span><strong>{record?.lifecycleStatus || "Reported"}</strong><small>{record?.nodeType || "Release placement"}</small></div><div className="metric"><span>Products</span><strong>{productIds.size}</strong><small>{configRows.length} baseline records</small></div><div className="metric"><span>Releases</span><strong>{releaseNames.length}</strong><small>{releaseNames.join(" · ") || "No release rows"}</small></div><div className="metric"><span>Hierarchy</span><strong>{children.length}</strong><small>Child nodes</small></div></section>
    <ObjectTabBar active={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "placements", label: "Products & releases", count: configRows.length }, { id: "evidence", label: "Calls & evidence" }, { id: "history", label: "History" }]} />
    {tab === "overview" ? <section className="split-layout"><article className="domain-section"><span className="eyebrow">CANONICAL NODE</span><h3>{label}</h3><p>{record?.description || "This placement has not yet been linked to a governed canonical Configuration Node."}</p><dl className="record-facts"><div><dt>Parent</dt><dd>{parent ? <Link href={`/configuration/${encodeURIComponent(parent.id)}`}>{parent.name}</Link> : "None"}</dd></div><div><dt>Owner</dt><dd>{master.portfolio.organizations.find((item) => item.id === record?.ownerOrganizationId)?.name || "Unassigned"}</dd></div><div><dt>Source</dt><dd>{record?.sourceReference || "Not recorded"}</dd></div></dl></article><article className="domain-section"><span className="eyebrow">CHILD NODES</span><h3>{children.length} governed children</h3>{children.map((item) => <p className="entity-actions" key={item.id}><Link href={`/configuration/${encodeURIComponent(item.id)}`}>{item.code ? `${item.code} · ` : ""}{item.name}</Link></p>)}{!children.length ? <p className="empty">No child nodes.</p> : null}</article></section> : null}
    {tab === "placements" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">RELEASE-SPECIFIC USE</span><h3>Products reported at this node</h3></div><span>{filteredRows.length} records</span></div><div className="domain-table-wrap"><table><thead><tr><th>Release</th><th>Product</th><th>Tier / resource / host</th><th>Capacity</th><th>Supplier</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.__meta.occurrenceId}><td><Link href={`/releases/${encodeURIComponent(row.__meta.releaseId || text(row.ReleaseName))}`}>{text(row.ReleaseName) || "Unassigned"}</Link></td><td><Link href={`/products/${encodeURIComponent(row.__meta.productId || productIdentityKey(row))}`}>{productDisplayName(row)}</Link></td><td>{text(row.Tier) || "—"} / {text(row.Resource) || "—"} / {text(row.HW_Host) || "—"}</td><td>{text(row.HW_CPU_CORES) || "—"} CPU · {text(row["HW_RAM (GB)"]) || "—"} GB</td><td>{text(row.OEM) || "Unassigned"}</td></tr>)}{!filteredRows.length ? <tr><td colSpan={5} className="empty">No baseline records are linked.</td></tr> : null}</tbody></table></div></section> : null}
    {tab === "evidence" && record ? <ObjectRecordsPanel context={{ kind: "configuration_node", id: record.id, label }} /> : null}
    {tab === "history" && record ? <AuditHistoryPanel kind="configuration_node" id={record.id} label={label} /> : null}
    {editing && record ? <MasterEntityEditorDialog kind="configuration_node" record={record as unknown as Record<string, unknown>} portfolio={master.portfolio} onDismiss={() => setEditing(false)} onSaved={() => { setEditing(false); void master.reload(); }} /> : null}
  </DomainPageShell>;
}
