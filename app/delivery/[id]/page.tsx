"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "../../../components/app-link";
import { DomainPageShell } from "../../../components/domain-shell";
import { ObjectRecordsPanel, ObjectTabBar } from "../../../components/object-workspace";
import { useGovernancePortfolio } from "../../../lib/governance-client";
import { displayStatus } from "../../../lib/governance-model";
import { useInitiativeDecisions } from "../../../lib/initiative-decision-client";
import { useChangePortfolio } from "../../../lib/change-client";

const dateLabel = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString() : "Not scheduled";

export default function WorkPackagePage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params.id || ""));
  const governance = useGovernancePortfolio();
  const decisions = useInitiativeDecisions();
  const changes = useChangePortfolio();
  const [tab, setTab] = useState("overview");
  const portfolio = governance.portfolio;
  const workspace = decisions.workspace;
  const workPackage = portfolio?.workPackages.find((item) => item.id === id);
  const initiative = portfolio?.initiatives.find((item) => item.id === workPackage?.initiativeId);
  const parent = portfolio?.workPackages.find((item) => item.id === workPackage?.parentId);
  const children = (portfolio?.workPackages || []).filter((item) => item.parentId === id);
  const objectives = (workspace?.objectives || []).filter((objective) => workPackage?.objectiveLinks.some((link) => link.objectiveId === objective.id));
  const changeRequest = changes.portfolio.requests.find((item) => item.id === workPackage?.changeRequestId)
    || changes.portfolio.requests.find((item) => objectives.some((objective) => objective.changeRequestId === item.id));
  const inbound = (portfolio?.workPackageDependencies || []).filter((item) => item.successorWorkPackageId === id);
  const outbound = (portfolio?.workPackageDependencies || []).filter((item) => item.predecessorWorkPackageId === id);
  const packageById = useMemo(() => new Map((portfolio?.workPackages || []).map((item) => [item.id, item])), [portfolio?.workPackages]);

  if (governance.loading || decisions.loading || changes.loading) return <DomainPageShell title="Government work package" subtitle="Loading WBS record…" releaseScope="Loading"><p>Loading work package…</p></DomainPageShell>;
  if (governance.error || decisions.error || changes.error || !portfolio || !workspace) return <DomainPageShell title="Government work package" subtitle="WBS record unavailable." releaseScope="Unavailable"><p className="error-copy">{governance.error || decisions.error || changes.error}</p></DomainPageShell>;
  if (!workPackage) return <DomainPageShell title="Government work package not found" subtitle="The requested WBS record does not exist." releaseScope="Not found" actions={<Link className="ghost-button" href="/delivery">Return to WBS</Link>}><p className="empty">No work package matches this identifier.</p></DomainPageShell>;

  const context = { kind: "work_package" as const, id: workPackage.id, label: `${workPackage.wbsCode} · ${workPackage.title}` };
  return <DomainPageShell title={`${workPackage.wbsCode} · ${workPackage.title}`} subtitle="Government-owned delivery work package" releaseScope={initiative?.title || "Initiative not assigned"} contextMode="portfolio" objectContext={context} actions={<Link className="ghost-button" href="/delivery">WBS hierarchy</Link>}>
    <section className="summary"><div className="metric"><span>Status</span><strong>{displayStatus(workPackage.status)}</strong><small>{displayStatus(workPackage.workType)}</small></div><div className="metric"><span>Owner</span><strong>{workPackage.owner || "Unassigned"}</strong><small>Government accountable party</small></div><div className="metric"><span>Window</span><strong>{dateLabel(workPackage.plannedStart)}</strong><small>Finish {dateLabel(workPackage.dueDate)}</small></div><div className="metric"><span>Objective links</span><strong>{workPackage.objectiveLinks.length}</strong><small>{inbound.length + outbound.length} schedule dependencies</small></div></section>
    <ObjectTabBar active={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "relationships", label: "Relationships", count: objectives.length + children.length + (parent ? 1 : 0) }, { id: "schedule", label: "Schedule logic", count: inbound.length + outbound.length }, { id: "evidence", label: "Calls & evidence" }]} />
    {tab === "overview" ? <section className="split-layout"><article className="domain-section"><span className="eyebrow">DEFINITION OF DONE</span><h3>Completion standard</h3><p>{workPackage.definitionOfDone || "No completion standard is recorded."}</p><dl className="record-facts"><div><dt>Progress basis</dt><dd>{workPackage.progressBasis || "Not recorded"}</dd></div><div><dt>Actual start / finish</dt><dd>{dateLabel(workPackage.actualStart)} → {dateLabel(workPackage.actualFinish)}</dd></div><div><dt>Notes</dt><dd>{workPackage.notes || "None"}</dd></div></dl></article><article className="domain-section"><span className="eyebrow">AUTHORITY</span><h3>What this record means</h3><p>This is Government analyst work required to support a decision, assess delivery, or verify an outcome. It is not an LM delivery Objective and does not replace the incumbent schedule.</p>{initiative ? <p><strong>Initiative:</strong> <Link href={`/initiatives/${encodeURIComponent(initiative.id)}`}>{initiative.title}</Link></p> : null}{changeRequest ? <p><strong>Related Change Request:</strong> <Link href={`/changes/${encodeURIComponent(changeRequest.id)}`}>{changeRequest.externalIdentifier} · {changeRequest.title}</Link></p> : null}</article></section> : null}
    {tab === "relationships" ? <section className="split-layout"><article className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">WBS DECOMPOSITION</span><h3>Parent and child packages</h3></div><span>{children.length} children</span></div>{parent ? <p><strong>Parent:</strong> <Link href={`/delivery/${encodeURIComponent(parent.id)}`}>{parent.wbsCode} · {parent.title}</Link></p> : <p>Top-level package under the Initiative.</p>}<div className="domain-list">{children.map((item) => <Link className="domain-card" href={`/delivery/${encodeURIComponent(item.id)}`} key={item.id}><span className="record-type">{item.wbsCode} · {displayStatus(item.status)}</span><h3>{item.title}</h3><p>{item.definitionOfDone || "Definition of done not recorded."}</p></Link>)}{!children.length ? <p className="empty">No child work packages.</p> : null}</div></article><article className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">SUPPLIER TRACEABILITY</span><h3>LM Objectives supported or verified</h3></div><span>{objectives.length} linked</span></div>{objectives.map((objective) => { const link = workPackage.objectiveLinks.find((item) => item.objectiveId === objective.id); return <Link className="domain-card" href={`/objectives/${encodeURIComponent(objective.id)}`} key={objective.id}><span className="record-type">{displayStatus(link?.relationship || "linked")}</span><h3>{objective.externalIdentifier} · {objective.title}</h3><p>{link?.rationale || "Rationale not recorded."}</p></Link>; })}{!objectives.length ? <p className="empty">No LM Objective link. This may be valid for internal decision-support work.</p> : null}</article></section> : null}
    {tab === "schedule" ? <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">SCHEDULE LOGIC</span><h3>Accepted and proposed dependency edges</h3></div><span>{inbound.length} inbound · {outbound.length} outbound</span></div><div className="domain-table-wrap"><table><thead><tr><th>Direction</th><th>Package</th><th>Logic</th><th>State</th><th>Basis</th></tr></thead><tbody>{inbound.map((edge) => { const item = packageById.get(edge.predecessorWorkPackageId); return <tr key={edge.id}><td>Predecessor</td><td>{item ? <Link href={`/delivery/${encodeURIComponent(item.id)}`}>{item.wbsCode} · {item.title}</Link> : edge.predecessorWorkPackageId}</td><td>{edge.relationship}{edge.lagDays ? ` + ${edge.lagDays}d` : ""}</td><td>{displayStatus(edge.status)}</td><td>{edge.rationale}<small>{edge.sourceReference || "Source not recorded"}</small></td></tr>; })}{outbound.map((edge) => { const item = packageById.get(edge.successorWorkPackageId); return <tr key={edge.id}><td>Successor</td><td>{item ? <Link href={`/delivery/${encodeURIComponent(item.id)}`}>{item.wbsCode} · {item.title}</Link> : edge.successorWorkPackageId}</td><td>{edge.relationship}{edge.lagDays ? ` + ${edge.lagDays}d` : ""}</td><td>{displayStatus(edge.status)}</td><td>{edge.rationale}<small>{edge.sourceReference || "Source not recorded"}</small></td></tr>; })}{!inbound.length && !outbound.length ? <tr><td colSpan={5} className="empty">No schedule dependency is recorded for this package.</td></tr> : null}</tbody></table></div></section> : null}
    {tab === "evidence" ? <ObjectRecordsPanel context={context} /> : null}
  </DomainPageShell>;
}
