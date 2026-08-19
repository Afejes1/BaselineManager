"use client";

import { useCallback, useEffect, useState } from "react";
import type { InitiativeDecisionWorkspace } from "./initiative-decision-model";

export async function fetchInitiativeDecisions() {
  const response = await fetch("/api/initiative-decisions", { cache: "no-store" });
  const payload = await response.json() as InitiativeDecisionWorkspace & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Initiative decision workspace could not be loaded.");
  return payload;
}

export async function saveInitiativeDecision(body: Record<string, unknown>) {
  const response = await fetch("/api/initiative-decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as { error?: string; id?: string };
  if (!response.ok) throw new Error(payload.error || "Initiative decision update could not be saved.");
  return payload;
}

export function useInitiativeDecisions() {
  const [workspace, setWorkspace] = useState<InitiativeDecisionWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    try { setWorkspace(await fetchInitiativeDecisions()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Initiative decision workspace could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const handle = window.setTimeout(() => { void reload(); }, 0); return () => window.clearTimeout(handle); }, [reload]);
  const mutate = useCallback(async (action: string, payload: Record<string, unknown>) => { const result = await saveInitiativeDecision({ action, ...payload }); await reload(); return result; }, [reload]);
  return { workspace, loading, error, reload, mutate };
}
