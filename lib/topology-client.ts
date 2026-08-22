"use client";

import { useCallback, useEffect, useState } from "react";
import type { TopologyExtensions } from "./topology-model";

export async function fetchTopologyExtensions(releaseId?: string) {
  const url = releaseId ? `/api/topology?releaseId=${encodeURIComponent(releaseId)}` : "/api/topology";
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json() as TopologyExtensions & { error?: string };
  if (!response.ok) throw new Error(body.error || "Topology extensions could not be loaded.");
  return body;
}

export function useTopologyExtensions(releaseId?: string) {
  const [extensions, setExtensions] = useState<TopologyExtensions>({ hostProfiles: [], deploymentProfiles: [], infrastructure: { nodes: [], states: [], installations: [], connections: [], platforms: [], releases: [], products: [], organizations: [], occurrenceOptions: [] } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    try { setExtensions(await fetchTopologyExtensions(releaseId)); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Topology extensions could not be loaded."); }
    finally { setLoading(false); }
  }, [releaseId]);
  useEffect(() => { const handle = window.setTimeout(() => { void reload(); }, 0); return () => window.clearTimeout(handle); }, [reload]);
  const mutate = useCallback(async (action: string, payload: Record<string, unknown>) => {
    const response = await fetch("/api/topology", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
    const body = await response.json() as { error?: string; id?: string };
    if (!response.ok) throw new Error(body.error || "Topology extension could not be saved.");
    await reload();
    return body;
  }, [reload]);
  return { extensions, loading, error, reload, mutate };
}
