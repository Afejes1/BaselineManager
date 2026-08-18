"use client";

import { useCallback, useEffect, useState } from "react";
import type { Portfolio } from "./governance-model";

export async function fetchPortfolio(): Promise<Portfolio> {
  const response = await fetch("/api/governance", { cache: "no-store" });
  const payload = await response.json() as Portfolio & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The governance workspace could not be loaded.");
  return payload;
}

export function useGovernancePortfolio() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchPortfolio();
      setPortfolio(next);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The governance workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const handle = window.setTimeout(() => { void reload(); }, 0); return () => window.clearTimeout(handle); }, [reload]);

  const mutate = useCallback(async (action: string, payload: Record<string, unknown>) => {
    const response = await fetch("/api/governance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "The governance update could not be saved.");
    await reload();
    return result;
  }, [reload]);

  return { portfolio, loading, error, reload, mutate };
}
