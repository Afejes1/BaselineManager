"use client";

import Link from "../../../components/app-link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { productIdentityKey, text, type Record24 } from "../../../lib/baseline-data";
import { dataQualityFor } from "../../../lib/baseline-quality";
import { DomainPageShell } from "../../../components/domain-shell";
import { AnalyticsLink } from "../../../components/analytics-link";
import { ObjectRecordsPanel, ObjectTabBar, type ObjectContext } from "../../../components/object-workspace";
import { useWorkspaceContext } from "../../../components/workspace-context";
import { useChangePortfolio } from "../../../lib/change-client";
import { usePlatformPortfolio } from "../../../lib/platform-client";
import { useTopologyExtensions } from "../../../lib/topology-client";
import { useInitiativeDecisions } from "../../../lib/initiative-decision-client";
import { useGovernancePortfolio } from "../../../lib/governance-client";
import type { ManagedRecord24 } from "../../../lib/baseline-client";
import { useMasterData } from "../../../lib/master-data-client";
import { MasterEntityEditorDialog } from "../../../components/master-data-editor";
import { AuditHistoryPanel } from "../../../components/governed-object";

function decodeId(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
function unique(values: string[]) { return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); }

function summarizeRows(rows: Record24[]) {
  const releases = unique(rows.map((row) => text(row.ReleaseName)));
  const tiers = unique(rows.map((row) => text(row.Tier)));
  const hosts = unique(rows.map((row) => text(row.HW_Host)));
  const resources = unique(rows.map((row) => text(row.Resource)));
  const issueCount = rows.filter((row) => dataQualityFor(row).level === "issue").length;
  const warningCount = rows.filter((row) => dataQualityFor(row).level === "review").length;
  return { releases, tiers, hosts, resources, issueCount, warningCount };
}

export default function ProductDetailPage() {
  const params = useParams<{ id?: string }>();
  const productId = decodeId(params.id ?? "");
  const { rows } = useWorkspaceContext();
  const { portfolio: changes } = useChangePortfolio();
  const { portfolio: platformPortfolio } = usePlatformPortfolio();
  const { extensions: topology } = useTopologyExtensions();
  const { workspace: decisionWorkspace } = useInitiativeDecisions();
  const { portfolio: governance } = useGovernancePortfolio();
  const master = useMasterData();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);

  const masterProduct = master.portfolio.products.find((item) => item.id === productId || productIdentityKey({ LongName: item.canonicalName } as Record24) === productId);
  const productRows = useMemo(() => rows.filter((row) => row.__meta.productId === masterProduct?.id || productIdentityKey(row) === productId) as ManagedRecord24[], [masterProduct?.id, productId, rows]);
  const { releases: baselineReleases, tiers, hosts, resources, issueCount, warningCount } = useMemo(() => summarizeRows(productRows), [productRows]);
  const canonical = masterProduct?.canonicalName || (productRows[0] ? text(productRows[0].LongName || productRows[0].ShortName || "Unnamed product") : "Product not found");
  const canonicalProductId = masterProduct?.id || productRows.find((row) => row.__meta.productId)?.__meta.productId || "";
  const infrastructureInstallations = topology.infrastructure.installations.filter((item) => item.productId === canonicalProductId && item.deploymentStatus !== "absent");
  const infrastructureStateIds = new Set(infrastructureInstallations.map((item) => item.nodeStateId));
  const infrastructureConnections = topology.infrastructure.connections.filter((item) => infrastructureStateIds.has(item.sourceNodeStateId) || infrastructureStateIds.has(item.targetNodeStateId));
  const infrastructureStateById = new Map(topology.infrastructure.states.map((item) => [item.id, item]));
  const infrastructureNodeById = new Map(topology.infrastructure.nodes.map((item) => [item.id, item]));
  const infrastructurePlatformById = new Map(topology.infrastructure.platforms.map((item) => [item.id, item]));
  const infrastructureReleaseById = new Map(topology.infrastructure.releases.map((item) => [item.id, item]));
  const releases = unique([...baselineReleases, ...infrastructureInstallations.map((item) => infrastructureReleaseById.get(item.releaseId)?.name || "")]);
  const ownerOrganization = master.portfolio.organizations.find((item) => item.id === masterProduct?.ownerOrganizationId);
  const supplier = ownerOrganization?.name || text(productRows[0]?.OEM || "Unassigned");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(() => !normalizedQuery ? productRows : productRows.filter((row) => `${text(row.ReleaseName)} ${text(row.Tier)} ${text(row.Resource)} ${text(row.HW_Host)} ${text(row["SW Language"])} ${text(row["Container Technology"])} ${text(row.OEM)}`.toLowerCase().includes(normalizedQuery)), [productRows, normalizedQuery]);
  const canonicalProductIds = new Set(productRows.map((row) => row.__meta.productId).filter(Boolean));
  if (canonicalProductId) canonicalProductIds.add(canonicalProductId);
  const changeEffects = changes.effects.filter((effect) => effect.subjectKind === "product" && canonicalProductIds.has(effect.subjectId));
  const changeRequestIds = new Set(changeEffects.map((effect) => effect.changeRequestId));
  const changeRequests = changes.requests.filter((request) => changeRequestIds.has(request.id));
  const effectIds = new Set(changeEffects.map((effect) => effect.id));
  const objectiveIds = new Set((decisionWorkspace?.objectiveEffectAttributions || []).filter((item) => effectIds.has(item.changeEffectId)).map((item) => item.objectiveId));
  const objectives = (decisionWorkspace?.objectives || []).filter((item) => objectiveIds.has(item.id) || Boolean(item.changeRequestId && changeRequestIds.has(item.changeRequestId)));
  const initiativeIds = new Set((decisionWorkspace?.links || []).filter((item) => changeRequestIds.has(item.changeRequestId)).map((item) => item.initiativeId));
  const initiatives = (decisionWorkspace?.initiatives || []).filter((item) => initiativeIds.has(item.id));
  const workPackages = (governance?.workPackages || []).filter((item) => item.objectiveLinks.some((link) => objectiveIds.has(link.objectiveId)));
  const platformByOccurrence = new Map(platformPortfolio.assignments.filter((item) => item.assignmentRole === "primary").map((item) => [item.baselineOccurrenceId, platformPortfolio.platforms.find((platform) => platform.id === item.platformId)]));
  const productPlatforms = Array.from(new Map([...productRows.map((row) => platformByOccurrence.get(row.__meta.occurrenceId)).filter(Boolean), ...infrastructureInstallations.map((item) => infrastructurePlatformById.get(item.platformId)).filter(Boolean)].map((platform) => [platform!.id, platform!])).values());
  const capabilities = unique(productRows.map((row) => text(row["Technical Capability Satisfied by this SW/Tech - Notes"])));
  const classifications = unique(productRows.map((row) => text(row["Software Type"])));
  const runtimeProfiles = unique(productRows.map((row) => [text(row.Containerized), text(row["Container Technology"]), text(row["Container Type"])].filter(Boolean).join(" · ")));
  const objectContext: ObjectContext | undefined = canonicalProductId ? { kind: "product", id: canonicalProductId, label: canonical } : undefined;
  if (!productRows.length && !masterProduct) return <DomainPageShell title="Product not found" subtitle="No canonical Product or working baseline records match this identifier." contextMode="record"><section className="domain-section"><Link href="/products">Return to Products</Link></section></DomainPageShell>;

  return <DomainPageShell title={`Product: ${canonical}`} subtitle="Canonical identity, Release fielding history, deployments, decisions, delivery, and evidence." releaseScope={releases.length ? `${productRows.length} baseline records · ${infrastructureInstallations.length} governed installations · ${releases.length} Releases` : "Not fielded in a Release"} contextMode="record" objectContext={objectContext} actions={<><label className="search" style={{ width: "260px" }}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search placements" /></label><AnalyticsLink kind="product" id={canonicalProductId || productId} />{masterProduct ? <Link className="ghost-button" href="/stewardship">Merge duplicate</Link> : null}{masterProduct ? <button className="ghost-button" type="button" onClick={() => setEditing(true)}>Edit Product</button> : null}</>}>
    <section className="summary"><div className="metric"><span>Release positions</span><strong>{releases.length}</strong><small>{productRows.length} baseline records · {infrastructureInstallations.length} governed installations</small></div><div className="metric"><span>Platforms</span><strong>{productPlatforms.length}</strong><small>{productRows.length ? `${tiers.length} tiers · ${resources.length} resources · ${hosts.length} baseline hosts` : infrastructureInstallations.length ? "Derived from governed installation links" : "No fielding recorded"}</small></div><div className="metric"><span>Supplier</span><strong>{supplier || "Unassigned"}</strong><small>{classifications.join(" · ") || "Classification not recorded"}</small></div><div className="metric metric-alert"><span>Change Requests</span><strong>{changeRequests.length}</strong><small>{changeRequests.filter((item) => item.decisionStatus === "pending").length} funding decisions pending</small></div></section>
    <ObjectTabBar active={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "baseline", label: "Release history", count: productRows.length }, { id: "installations", label: "System configuration", count: infrastructureInstallations.length }, { id: "delivery", label: "Change & delivery", count: changeRequests.length + objectives.length }, { id: "evidence", label: "Calls & evidence" }, { id: "history", label: "History" }]} />

    {tab === "overview" ? <><section className="dashboard-grid"><article className="domain-card"><span className="eyebrow">CANONICAL PRODUCT</span><h3>{masterProduct?.shortName || text(productRows[0]?.ShortName) || canonical}</h3><div className="record-facts"><div><dt>Canonical name</dt><dd>{canonical}</dd></div><div><dt>Lifecycle</dt><dd>{masterProduct?.lifecycleStatus || "active"}</dd></div><div><dt>Product type</dt><dd>{masterProduct?.productType || unique(productRows.map((row) => text(row.TechStackType))).join(" · ") || "Not recorded"}</dd></div><div><dt>Software classification</dt><dd>{masterProduct?.softwareClassification || classifications.join(" · ") || "Not recorded"}</dd></div><div><dt>Evidence reference</dt><dd>{masterProduct?.sourceReference || "Not recorded"}</dd></div></div><p>{masterProduct?.description || "Canonical Product description not recorded."}</p></article><article className="domain-card"><span className="eyebrow">RELEASE FIELDING</span><h3>{productRows.length ? runtimeProfiles.join(" / ") || "Runtime not reported in baseline records" : infrastructureInstallations.length ? `${infrastructureInstallations.length} governed installations` : "Not fielded in a Release"}</h3><p>{productRows.length ? `${issueCount} blocking findings · ${warningCount} warnings across all Release records.` : infrastructureInstallations.length ? "Release-specific versions, roles, nodes, and Platforms are recorded in System configuration." : "This catalog Product has no deployment, runtime, capacity, or baseline-quality status until a Release position is created."}</p><p className="entity-meta">Canonical Product edits do not silently rewrite retained Release baseline values or Release-specific installations.</p><p className="entity-actions"><Link className="mini-action" href={`/?fieldProduct=${encodeURIComponent(canonicalProductId || productId)}`}>{productRows.length ? "Open baseline grid" : "Create baseline Release record"}</Link>{infrastructureInstallations.length ? <button className="mini-action" type="button" onClick={() => setTab("installations")}>Open System configuration</button> : null}</p></article></section>
      <section className="domain-section"><h3>Related objects</h3><div className="chip-list"><Link href={`/organizations/${encodeURIComponent(supplier)}`} className="domain-chip"><strong>Supplier</strong><span>{supplier || "Unassigned"}</span></Link>{releases.map((release) => <Link key={release} href={`/releases/${encodeURIComponent(release)}`} className="domain-chip"><strong>Release</strong><span>{release}</span></Link>)}{productPlatforms.map((platform) => <Link key={platform.id} href={`/platforms/${encodeURIComponent(platform.id)}`} className="domain-chip"><strong>Platform</strong><span>{platform.code} · {platform.name}</span></Link>)}{capabilities.map((capability) => <Link key={capability} href={`/capabilities/${encodeURIComponent(capability)}`} className="domain-chip"><strong>Capability</strong><span>{capability}</span></Link>)}</div></section></> : null}

    {tab === "baseline" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">RELEASE HISTORY</span><h3>One working baseline record per reported release position</h3></div><span>{visibleRows.length} shown</span></div><div className="domain-table-wrap"><table><thead><tr><th>Release</th><th>Placement</th><th>Host</th><th>Capacity</th><th>Language</th><th>Runtime</th><th>Record</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.__meta.occurrenceId}><td><Link href={`/releases/${encodeURIComponent(text(row.ReleaseName))}`}>{text(row.ReleaseName) || "Unassigned"}</Link></td><td>{text(row.Tier) || "Unassigned"}<small>{text(row.Resource) || "Unassigned"}</small></td><td className="mono">{text(row.HW_Host) || "Unassigned"}</td><td>{text(row["HW_Storage_Type"]) || "—"} / {text(row["HW_Storage (GB)"]) || "—"} GB<small>{text(row.HW_CPU_CORES) || "—"} CPU · {text(row["HW_RAM (GB)"]) || "—"} GB RAM</small></td><td>{text(row["SW Language"]) || "—"}</td><td>{[text(row.Containerized), text(row["Container Technology"]), text(row["Container Type"])].filter(Boolean).join(" · ") || "—"}</td><td><Link href={`/occurrences/${encodeURIComponent(row.__meta.occurrenceId)}`}>Record reference</Link></td></tr>)}{!visibleRows.length ? <tr><td colSpan={7} className="empty">No records match the search.</td></tr> : null}</tbody></table></div></section> : null}

    {tab === "installations" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">GOVERNED INSTALLATIONS</span><h3>Where this Product is installed by Release</h3></div><Link className="mini-action" href="/topology">Open deployment topology →</Link></div><p className="entity-meta">This is the normalized system configuration. Operating systems, hypervisors, applications, and supporting software use the same canonical Product catalog. Select a Platform or node to edit its identity and Release state.</p><div className="domain-table-wrap"><table><thead><tr><th>Release</th><th>Platform</th><th>Infrastructure node</th><th>Node state / capacity</th><th>Product installation</th><th>Baseline record</th></tr></thead><tbody>{infrastructureInstallations.map((installation) => {
      const state = infrastructureStateById.get(installation.nodeStateId);
      const node = state ? infrastructureNodeById.get(state.infrastructureNodeId) : undefined;
      const platform = infrastructurePlatformById.get(installation.platformId);
      const release = infrastructureReleaseById.get(installation.releaseId);
      const focus = encodeURIComponent(`infrastructure_installation:${installation.id}`);
      const platformHref = platform && release ? `/platforms/${encodeURIComponent(platform.id)}?release=${encodeURIComponent(release.name)}&focus=${focus}` : "";
      const capacity = state ? [`${state.cpuCores ?? "—"} CPU`, `${state.memoryGb ?? "—"} GB RAM`, `${state.storageGb ?? "—"} GB storage`].join(" · ") : "Not recorded";
      return <tr key={installation.id}><td>{release ? <Link href={`/releases/${encodeURIComponent(release.name)}?tab=topology&focus=${focus}`}>{release.name}</Link> : "Unknown Release"}</td><td>{platform ? <Link href={platformHref}>{platform.code} · {platform.name}</Link> : "Unknown Platform"}</td><td>{node && platformHref ? <Link href={platformHref}><strong>{node.code}</strong><small>{node.name}</small><small>{node.nodeType.replaceAll("_", " ")} · {node.hardwareProductName || node.manufacturerName || "hardware identity not recorded"}</small><small>{[node.assetTag, node.serialNumber].filter(Boolean).join(" · ") || "asset identity not recorded"}</small></Link> : <><strong>{node?.code || "Unknown node"}</strong><small>{node?.name || "Identity not found"}</small></>}</td><td>{state ? `${state.lifecycleStatus.replaceAll("_", " ")} · ${state.operatingState.replaceAll("_", " ")}` : "Not recorded"}<small>{capacity}</small><small>{state?.storageType || "storage medium not recorded"}{state?.fileSystem ? ` · ${state.fileSystem}` : ""}</small><small>{state ? `${state.confidence} confidence` : "confidence not recorded"}</small></td><td>{installation.installationRole.replaceAll("_", " ")}<small>{installation.version || "Version not recorded"}{installation.instanceName ? ` · ${installation.instanceName}` : ""}</small><small>{installation.deploymentStatus.replaceAll("_", " ")} · {installation.confidence} confidence</small></td><td>{installation.baselineOccurrenceId ? <Link href={`/occurrences/${encodeURIComponent(installation.baselineOccurrenceId)}`}>{installation.sourceKey || "Open record"}</Link> : "No baseline-row link"}</td></tr>;
    })}{!infrastructureInstallations.length ? <tr><td colSpan={6} className="empty">No governed infrastructure placement is recorded for this Product. Add it from the applicable Platform Release configuration.</td></tr> : null}</tbody></table></div><div className="section-toolbar" style={{ marginTop: 24 }}><div><span className="eyebrow">NODE CONNECTIONS</span><h3>Network, storage, power, cluster, and management relationships</h3></div><span>{infrastructureConnections.length} linked</span></div><div className="domain-table-wrap"><table><thead><tr><th>Release</th><th>Type</th><th>From</th><th>To</th><th>Status / capacity</th><th>Platform</th></tr></thead><tbody>{infrastructureConnections.map((connection) => {
      const sourceState = infrastructureStateById.get(connection.sourceNodeStateId); const targetState = infrastructureStateById.get(connection.targetNodeStateId);
      const sourceNode = sourceState ? infrastructureNodeById.get(sourceState.infrastructureNodeId) : undefined; const targetNode = targetState ? infrastructureNodeById.get(targetState.infrastructureNodeId) : undefined;
      const release = infrastructureReleaseById.get(connection.releaseId); const platform = infrastructurePlatformById.get(connection.platformId); const focus = encodeURIComponent(`infrastructure_connection:${connection.id}`);
      const href = platform && release ? `/platforms/${encodeURIComponent(platform.id)}?release=${encodeURIComponent(release.name)}&focus=${focus}` : "/topology";
      return <tr key={connection.id}><td>{release?.name || "Unknown Release"}</td><td>{connection.connectionType.replaceAll("_", " ")}<small>{connection.label || "No label"}</small></td><td>{sourceNode?.code || "Unknown node"}</td><td>{targetNode?.code || "Unknown node"}</td><td>{connection.status.replaceAll("_", " ")}<small>{connection.capacityMbps == null ? "Capacity not recorded" : `${connection.capacityMbps.toLocaleString()} Mbps`}</small></td><td><Link href={href}>{platform ? `${platform.code} · ${platform.name}` : "Open topology"}</Link></td></tr>;
    })}{!infrastructureConnections.length ? <tr><td colSpan={6} className="empty">No governed connections touch this Product's installed nodes.</td></tr> : null}</tbody></table></div></section> : null}

    {tab === "delivery" ? <><section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">CHANGE IMPACT</span><h3>Government funding decisions affecting this product</h3></div><Link href="/changes">Open Change Request portfolio</Link></div><div className="domain-list">{changeRequests.map((request) => <article className="domain-card" key={request.id}><span className={`decision-badge decision-${request.decisionStatus}`}>{request.decisionStatus}</span><h3><Link href={`/changes/${encodeURIComponent(request.id)}`}>{request.externalIdentifier} · {request.title}</Link></h3><p>{request.impactSummary || request.summary || "Impact not yet assessed."}</p><p className="entity-meta">{request.governmentPriority} priority · {request.requestedReleaseName || "target release unassigned"}</p></article>)}{!changeRequests.length ? <article className="domain-card empty-state"><h3>No linked Change Requests</h3><p>No funding request currently changes this product.</p></article> : null}</div></section>
      <section className="split-layout"><article className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">LM DELIVERY</span><h3>Objectives affecting this product</h3></div><span>{objectives.length}</span></div>{objectives.map((objective) => <p className="entity-actions" key={objective.id}><Link href={`/objectives/${encodeURIComponent(objective.id)}`}>{objective.externalIdentifier} · {objective.title}</Link><span className={`status-pill status-${objective.status}`}>{objective.status.replaceAll("_", " ")}</span></p>)}{!objectives.length ? <p className="empty">No LM Objective is attributed to this product.</p> : null}</article><article className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">GOVERNMENT ANALYSIS</span><h3>Initiatives and WBS packages</h3></div><span>{workPackages.length} work packages</span></div>{initiatives.map((initiative) => <p className="entity-actions" key={initiative.id}><Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>{initiative.title}</Link></p>)}{workPackages.map((work) => <p className="entity-actions" key={work.id}><Link href={`/delivery/${encodeURIComponent(work.id)}`}>{work.wbsCode} · {work.title}</Link><span className={`status-pill status-${work.status}`}>{work.status.replaceAll("_", " ")}</span></p>)}{!initiatives.length && !workPackages.length ? <p className="empty">No Initiative or Government work package is linked through the affected Objectives.</p> : null}</article></section></> : null}

    {tab === "evidence" && objectContext ? <ObjectRecordsPanel context={objectContext} /> : null}
    {tab === "history" && canonicalProductId ? <AuditHistoryPanel kind="product" id={canonicalProductId} label={canonical} /> : null}
    {editing && masterProduct ? <MasterEntityEditorDialog kind="product" record={masterProduct as unknown as Record<string, unknown>} portfolio={master.portfolio} onDismiss={() => setEditing(false)} onSaved={() => { setEditing(false); void master.reload(); }} /> : null}
  </DomainPageShell>;
}
