"use client";

import { useCallback, useEffect, useState } from "react";
import type { InitiativeDecisionWorkspace } from "./initiative-decision-model";

export function useSolutionEngineering(initiativeId?: string) {
  const [workspace, setWorkspace] = useState<InitiativeDecisionWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const query = initiativeId ? `?initiativeId=${encodeURIComponent(initiativeId)}` : "";
      const response = await fetch(`/api/solution-engineering${query}`, { cache: "no-store" });
      const payload = await response.json() as InitiativeDecisionWorkspace & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Solution Engineering could not be loaded.");
      setWorkspace(payload); setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Solution Engineering could not be loaded.");
    } finally { setLoading(false); }
  }, [initiativeId]);
  useEffect(() => { void reload(); }, [reload]);
  const mutate = useCallback(async (action: string, payload: Record<string, unknown>) => {
    const response = await fetch("/api/solution-engineering", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
    const result = await response.json() as { error?: string; id?: string };
    if (!response.ok) throw new Error(result.error || "The Solution Engineering update could not be saved.");
    await reload();
    return result;
  }, [reload]);
  return { workspace, loading, error, reload, mutate };
}
