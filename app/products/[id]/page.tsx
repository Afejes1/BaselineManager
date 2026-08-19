"use client";

import Link from "../../../components/app-link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  getProductRows,
  text,
  type Record24,
} from "../../../lib/baseline-data";
import { dataQualityFor } from "../../../lib/baseline-quality";
import { DomainPageShell } from "../../../components/domain-shell";
import { useWorkspaceContext } from "../../../components/workspace-context";
import { useChangePortfolio } from "../../../lib/change-client";
import { usePlatformPortfolio } from "../../../lib/platform-client";

function decodeId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function summarizeRows(rows: Record24[]) {
  const releases = Array.from(new Set(rows.map((row) => text(row.ReleaseName)).filter(Boolean))).sort();
  const tiers = Array.from(new Set(rows.map((row) => text(row.Tier)).filter(Boolean))).sort();
  const hosts = Array.from(new Set(rows.map((row) => text(row.HW_Host)).filter(Boolean))).sort();
  const resources = Array.from(new Set(rows.map((row) => text(row.Resource)).filter(Boolean))).sort();
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
  const [query, setQuery] = useState("");


  const productRows = useMemo(() => getProductRows(rows, productId), [rows, productId]);
  const { releases, tiers, hosts, resources } = useMemo(() => summarizeRows(productRows), [productRows]);
  const canonical = productRows[0] ? text(productRows[0].LongName || productRows[0].ShortName || "Unnamed product") : "Product not found";
  const supplier = text(productRows[0]?.OEM || "Unassigned");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!normalizedQuery) return productRows;
    return productRows.filter((row) => {
      const haystack = `${text(row.ReleaseName)} ${text(row.Tier)} ${text(row.Resource)} ${text(row.HW_Host)} ${text(row["SW Language"])} ${text(row["Container Technology"])} ${text(row.OEM)}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [productRows, normalizedQuery]);

  const metrics = {
    releases: releases.length,
    tiers: tiers.length,
    resources: resources.length,
    hosts: hosts.length,
  };
  const canonicalProductIds = new Set(productRows.map((row) => row.__meta.productId).filter(Boolean));
  const changeEffects = changes.effects.filter((effect) => effect.subjectKind === "product" && canonicalProductIds.has(effect.subjectId));
  const changeRequestIds = new Set(changeEffects.map((effect) => effect.changeRequestId));
  const changeRequests = changes.requests.filter((request) => changeRequestIds.has(request.id));
  const platformByOccurrence = new Map(platformPortfolio.assignments.filter((item) => item.assignmentRole === "primary").map((item) => [item.baselineOccurrenceId, platformPortfolio.platforms.find((platform) => platform.id === item.platformId)]));
  const productPlatforms = Array.from(new Map(productRows.map((row) => platformByOccurrence.get(row.__meta.occurrenceId)).filter(Boolean).map((platform) => [platform!.id, platform!])).values());

  return (
    <DomainPageShell
      title={`Product: ${canonical}`}
      subtitle="Product baseline, release history, and related decisions"
      releaseScope={`${productRows.length || 0} reported rows`}
      contextMode="record"
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search placements or release rows" />
        </label>
      )}
    >
      <section className="summary">
        <div className="metric">
          <span>Source rows</span>
          <strong>{productRows.length}</strong>
          <small>Across {metrics.releases} releases</small>
        </div>
        <div className="metric"><span>Platform context</span><strong>{productPlatforms.length}</strong><small>{metrics.tiers} tiers · {metrics.resources} resources · {metrics.hosts} hosts</small></div>
        <div className="metric"><span>Supplier</span><strong>{supplier || "Unassigned"}</strong><small>Primary source owner</small></div>
        <div className="metric metric-alert"><span>Change Requests</span><strong>{changeRequests.length}</strong><small>{changeRequests.filter((item) => item.decisionStatus === "pending").length} funding decisions pending</small></div>
      </section>

      <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">CHANGE IMPACT</span><h3>Government funding decisions affecting this product</h3></div><Link href="/changes">Open Change Request portfolio</Link></div><div className="domain-list">{changeRequests.map((request) => <article className="domain-card" key={request.id}><span className={`decision-badge decision-${request.decisionStatus}`}>{request.decisionStatus}</span><h3><Link href={`/changes/${encodeURIComponent(request.id)}`}>{request.externalIdentifier} · {request.title}</Link></h3><p>{request.impactSummary || request.summary || "Impact not yet assessed."}</p><p className="entity-meta">{request.governmentPriority} priority · {request.requestedReleaseName || "target release unassigned"}</p></article>)}{!changeRequests.length ? <article className="domain-card empty-state"><h3>No linked Change Requests</h3><p>This product is represented in the baseline, but no funding request currently changes it.</p></article> : null}</div></section>

      <section className="domain-section">
        <h3>Cross-domain links</h3>
        <div className="chip-list">
          <Link href={`/organizations/${encodeURIComponent(supplier)}`} className="domain-chip"><strong>Supplier</strong><span>{supplier || "Unassigned"}</span></Link>
          {releases.map((release) => <Link key={release} href={`/releases/${encodeURIComponent(release)}`} className="domain-chip"><strong>Release</strong><span>{release}</span></Link>)}
          {productPlatforms.map((platform) => <Link key={platform.id} href={`/platforms/${encodeURIComponent(platform.id)}`} className="domain-chip"><strong>Platform</strong><span>{platform.code} · {platform.name}</span></Link>)}
        </div>
      </section>

      <section className="domain-section">
        <h3>Working baseline records</h3>
        <section className="domain-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Release</th>
                <th>Tier</th>
                <th>Resource</th>
                <th>Host</th>
                <th>Storage</th>
                <th>Language</th>
                <th>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={`${String(row.ReleaseName)}:${String(row["#"])}`}>
                  <td>{text(row.ReleaseName) || "Unassigned"}</td>
                  <td>{text(row.Tier) || "Unassigned"}</td>
                  <td>{text(row.Resource) || "Unassigned"}</td>
                  <td className="mono">{text(row.HW_Host) || "Unassigned"}</td>
                  <td>{`${text(row["HW_Storage_Type"]) || "—"}${text(row["HW_Storage (GB)"]) ? ` / ${text(row["HW_Storage (GB)"])}` : ""}`}</td>
                  <td>{text(row["SW Language"]) || "—"}</td>
                  <td>{`${text(row.Containerized) || "—"} · ${text(row["Container Technology"]) || "—"}`}</td>
                </tr>
              ))}
              {!visibleRows.length ? (
                <tr><td colSpan={7} className="empty">{productRows.length ? "No records match your search." : "No baseline records are attached to this product."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </section>
    </DomainPageShell>
  );
}
