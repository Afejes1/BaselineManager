"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChangePortfolio } from "./change-model";

export async function fetchChangePortfolio() {
  const response = await fetch("/api/changes", { cache: "no-store" });
  const payload = await response.json() as ChangePortfolio & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Change Request portfolio could not be loaded.");
  return payload;
}

export async function saveChangeAction(body: Record<string, unknown>) {
  const response = await fetch("/api/changes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as { error?: string; id?: string };
  if (!response.ok) throw new Error(payload.error || "Change Request update could not be saved.");
  return payload;
}

export function useChangePortfolio() {
  const [portfolio, setPortfolio] = useState<ChangePortfolio>({ types: [], requests: [], effects: [], dependencies: [], releases: [], subjects: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    try { setPortfolio(await fetchChangePortfolio()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Change Request portfolio could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const handle = window.setTimeout(() => { void reload(); }, 0); return () => window.clearTimeout(handle); }, [reload]);
  return { portfolio, loading, error, reload };
}
