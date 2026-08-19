"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { releaseOf } from "../lib/baseline-scope";
import { useBaselineWorkspace, type ManagedRecord24 } from "../lib/baseline-client";

type WorkspaceContextValue = ReturnType<typeof useBaselineWorkspace> & {
  releases: string[];
  releaseLens: string | null;
  scopedRows: ManagedRecord24[];
  setReleaseLens: (release: string | null) => void;
  clearReleaseLens: () => void;
};

type ContextMode = "filter" | "browse" | "comparison" | "portfolio" | "record";

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function releaseName(row: ManagedRecord24) {
  return releaseOf(row).trim();
}

export function WorkspaceContextProvider({ children }: { children: ReactNode }) {
  const baseline = useBaselineWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRelease = searchParams.get("release");
  const releases = useMemo(() => Array.from(new Set(baseline.rows.map(releaseName))).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })), [baseline.rows]);
  const releaseLens = requestedRelease && releases.includes(requestedRelease) ? requestedRelease : null;
  const scopedRows = useMemo(() => releaseLens ? baseline.rows.filter((row) => releaseName(row) === releaseLens) : baseline.rows, [baseline.rows, releaseLens]);

  const setReleaseLens = useCallback((release: string | null) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (release) nextParams.set("release", release);
    else nextParams.delete("release");
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    ...baseline,
    releases,
    releaseLens,
    scopedRows,
    setReleaseLens,
    clearReleaseLens: () => setReleaseLens(null),
  }), [baseline, releases, releaseLens, scopedRows, setReleaseLens]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceContextProvider is required.");
  return context;
}

export function WorkspaceContextControl({ mode = "filter", recordRelease }: { mode?: ContextMode; recordRelease?: string }) {
  const { releases, releaseLens, setReleaseLens, clearReleaseLens, loading } = useWorkspaceContext();
  const lensLabel = releaseLens || "All releases";

  if (mode === "comparison") return <div className="workspace-context-control workspace-context-readout"><span>Workspace context</span><strong>Release comparison</strong><small>Set From and To in this view</small></div>;
  if (mode === "portfolio") return <div className="workspace-context-control workspace-context-readout"><span>Workspace context</span><strong>Cross-release portfolio</strong><small>Release lens retained: {lensLabel}</small></div>;
  if (mode === "record") return <div className="workspace-context-control workspace-context-readout"><span>Record context</span><strong>{recordRelease || "All linked releases"}</strong><small>Evidence history is not filtered</small></div>;

  return <label className="workspace-context-control">
    <span>Release lens</span>
    <select value={releaseLens || ""} onChange={(event) => setReleaseLens(event.target.value || null)} aria-label="Release lens" disabled={loading && !releases.length}>
      <option value="">All releases</option>
      {releases.map((release) => <option key={release} value={release}>{release}</option>)}
    </select>
    {releaseLens ? <button type="button" onClick={clearReleaseLens}>Clear</button> : <small>{mode === "browse" ? "Highlights the selected release" : "Active baseline"}</small>}
  </label>;
}

export type { ContextMode };
