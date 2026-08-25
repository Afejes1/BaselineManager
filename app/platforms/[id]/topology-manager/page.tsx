"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "../../../../components/app-link";
import { DomainPageShell } from "../../../../components/domain-shell";
import { InfrastructureWorkspace } from "../../../../components/infrastructure-workspace";
import { usePlatformPortfolio } from "../../../../lib/platform-client";
import { PROGRAM_HANDLING_MARKING } from "../../../../lib/output-handling";

export default function PlatformTopologyManagerPage() {
  const platformId = decodeURIComponent(useParams<{ id: string }>().id || "");
  const releaseName = useSearchParams().get("release") || "";
  const { portfolio, loading, error } = usePlatformPortfolio();
  const platform = portfolio.platforms.find((item) => item.id === platformId);
  const backHref = `/platforms/${encodeURIComponent(platformId)}${releaseName ? `?release=${encodeURIComponent(releaseName)}` : ""}`;

  return <DomainPageShell
    title={platform ? `${platform.code} · Visual topology manager` : "Visual topology manager"}
    subtitle="Click-to-manage physical nodes, virtual machines, Product workloads, and infrastructure relationships"
    releaseScope={releaseName || "Select a Release Lens"}
    contextMode="filter"
    objectContext={platform ? { kind: "platform", id: platform.id, label: `${platform.code} · ${platform.name}` } : undefined}
    breadcrumb={[{ label: "Platforms", href: "/platforms" }, { label: platform?.code || "Platform", href: backHref }, { label: "Visual topology manager" }]}
    actions={<><Link className="ghost-button" href={backHref}>Return to Platform</Link></>}
  >
    <section className="decision-principle"><strong>{PROGRAM_HANDLING_MARKING}</strong><span>This is an alternate editing view over the same governed local records and audit controls. It does not call an external topology, discovery, or diagram service.</span></section>
    {loading ? <section className="domain-section"><p className="empty">Loading Platform context…</p></section>
      : error ? <section className="domain-section"><p className="error-copy">{error}</p></section>
      : !platform ? <section className="domain-section empty-state"><h3>Platform not found</h3><p>Return to the Platform hierarchy and choose a governed Platform.</p></section>
      : !releaseName ? <section className="domain-section empty-state"><h3>Select a Release Lens</h3><p>Infrastructure placement, capacity, Product installations, and connections are Release-specific. Select a Release in the header, then use this manager.</p><Link className="ghost-button" href={backHref}>Return to Platform</Link></section>
      : <section className="domain-section topology-manager-page"><div className="section-toolbar"><div><span className="eyebrow">ALTERNATE CONFIGURATION WORKSPACE</span><h2>{platform.name}</h2></div><span className="status-pill">Same governed records</span></div><InfrastructureWorkspace platformId={platformId} initialReleaseName={releaseName} initialView="visual" syncReleaseToUrl /></section>}
  </DomainPageShell>;
}
