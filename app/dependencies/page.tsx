"use client";

import { DependencyBoard } from "../../components/dependency-board";
import { DomainPageShell } from "../../components/domain-shell";

export default function DependenciesPage() {
  return <DomainPageShell title="Dependency Board" subtitle="Release and timeline planning with traceable cross-level dependency strings" releaseScope="Cross-release delivery portfolio" contextMode="portfolio"><DependencyBoard /></DomainPageShell>;
}
