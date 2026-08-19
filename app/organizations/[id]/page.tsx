"use client";

import Link from "../../../components/app-link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  getOrganizationRows,
  text,
  supplierIdentity,
  productIdentityKey,
  productDisplayName,
} from "../../../lib/baseline-data";
import { dataQualityFor } from "../../../lib/baseline-quality";
import { DomainPageShell } from "../../../components/domain-shell";
import { useBaselineWorkspace } from "../../../lib/baseline-client";
import { useChangePortfolio } from "../../../lib/change-client";
import { usePlatformPortfolio } from "../../../lib/platform-client";

function decodeId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function OrganizationDetailPage() {
  const params = useParams<{ id?: string }>();
  const orgId = decodeId(params.id ?? "");
  const { rows } = useBaselineWorkspace();
  const { portfolio: changes } = useChangePortfolio();
  const { portfolio: platforms } = usePlatformPortfolio();
  const [query, setQuery] = useState("");


  const orgRows = useMemo(() => getOrganizationRows(rows, supplierIdentity(orgId)), [rows, orgId]);
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return orgRows;
    return orgRows.filter((row) => {
      const haystack = `${text(row.LongName)} ${text(row.ShortName)} ${text(row.ReleaseName)} ${text(row.Tier)} ${text(row.Resource)} ${text(row.HW_Host)}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [orgRows, query]);

  const metrics = useMemo(() => {
    const releases = new Set(orgRows.map((row) => text(row.ReleaseName)).filter(Boolean));
    const products = new Set(orgRows.map((row) => productIdentityKey(row)));
    const issueCount = orgRows.filter((row) => dataQualityFor(row).level === "issue").length;
    const warningCount = orgRows.filter((row) => dataQualityFor(row).level === "review").length;
    return {
      releases: releases.size,
      products: products.size,
      issueCount,
      warningCount,
    };
  }, [orgRows]);

  const supplierName = orgRows[0]?.OEM ? text(orgRows[0].OEM) : orgId;
  const productIds = new Set(orgRows.map((row) => row.__meta.productId).filter(Boolean));
  const directOrgEffects = changes.effects.filter((effect) => effect.subjectKind === "organization" && effect.subjectLabel.toLowerCase() === supplierName.toLowerCase());
  const productEffects = changes.effects.filter((effect) => effect.subjectKind === "product" && productIds.has(effect.subjectId));
  const requestIds = new Set([...directOrgEffects, ...productEffects].map((effect) => effect.changeRequestId));
  const changeRequests = changes.requests.filter((request) => requestIds.has(request.id));
  const platformRelationships = platforms.relationships.filter((item) => item.organizationName.toLowerCase() === supplierName.toLowerCase());

  if (!orgRows.length) {
    return (
      <DomainPageShell title="Supplier has no rows" subtitle={`No rows found for ${orgId}`} releaseScope="Unassigned">
        <section className="domain-list">
          <article className="domain-card">
            <h3>No rows found</h3>
            <p className="entity-meta">That supplier currently has no retained source rows.</p>
            <p className="entity-actions"><Link href="/organizations">Back to suppliers</Link></p>
          </article>
        </section>
      </DomainPageShell>
    );
  }

  return (
    <DomainPageShell
      title={`Supplier: ${supplierName}`}
      subtitle="OEM and supplier relationship view"
      releaseScope={`${metrics.products} products · ${metrics.releases} releases`}
      actions={(
        <label className="search" style={{ width: "280px" }}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products or placement" />
        </label>
      )}
    >
      <section className="summary">
        <div className="metric"><span>Source rows</span><strong>{orgRows.length}</strong><small>For this supplier</small></div>
        <div className="metric"><span>Products</span><strong>{metrics.products}</strong><small>Across {metrics.releases} releases</small></div>
        <div className="metric"><span>Platforms</span><strong>{platformRelationships.length}</strong><small>Accountability relationships</small></div>
        <div className="metric metric-alert"><span>Change Requests</span><strong>{changeRequests.length}</strong><small>{changeRequests.filter((item) => item.decisionStatus === "pending").length} pending funding decisions</small></div>
      </section>

      <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">ACCOUNTABILITY & CHANGE</span><h3>Where this organization participates</h3></div><Link href="/changes">Funding portfolio</Link></div><div className="chip-list">{platformRelationships.map((relation) => <Link className="domain-chip" key={relation.id} href={`/platforms/${encodeURIComponent(relation.platformId)}`}><strong>{relation.relationshipType}</strong><span>{platforms.platforms.find((item) => item.id === relation.platformId)?.code || relation.platformId}</span></Link>)}</div><div className="domain-list" style={{ marginTop: 14 }}>{changeRequests.map((request) => <article className="domain-card" key={request.id}><span className={`decision-badge decision-${request.decisionStatus}`}>{request.decisionStatus}</span><h3><Link href={`/changes/${encodeURIComponent(request.id)}`}>{request.externalIdentifier} · {request.title}</Link></h3><p>{request.knockOnEffects || request.impactSummary || request.summary || "Impact not yet assessed."}</p></article>)}{!changeRequests.length ? <article className="domain-card empty-state"><h3>No attributed Change Request impact</h3><p>No request is directly linked to this organization or its reported products.</p></article> : null}</div></section>

      <section className="domain-section">
        <h3>Supplier rows</h3>
        <div className="domain-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Release</th>
                <th>Product</th>
                <th>Placement</th>
                <th>Host</th>
                <th>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={`${text(row["#"])}:${text(row.ReleaseName)}:${text(row.Tier)}`}>
                  <td>{text(row.ReleaseName) || "Unassigned"}</td>
                  <td><Link href={`/products/${encodeURIComponent(productIdentityKey(row))}`}>{productDisplayName(row)}</Link></td>
                  <td>{text(row.Tier) || "Unassigned"} · {text(row.Resource) || "Unassigned"}</td>
                  <td className="mono">{text(row.HW_Host) || "Unassigned"}</td>
                  <td>{`${text(row.Containerized) || "—"} · ${text(row["Container Technology"]) || "—"}`}</td>
                </tr>
              ))}
              {!visibleRows.length ? (
                <tr><td colSpan={5} className="empty">No rows match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </DomainPageShell>
  );
}
