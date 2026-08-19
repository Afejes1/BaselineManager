"use client";
import { useCallback, useEffect, useState } from "react";
import type { StewardshipPortfolio } from "./stewardship-model";

export function useStewardshipPortfolio() {
  const [portfolio, setPortfolio] = useState<StewardshipPortfolio>({ entities: [], aliases: [], merges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => { setLoading(true); try { const response = await fetch("/api/stewardship", { cache: "no-store" }); const data = await response.json() as StewardshipPortfolio & { error?: string }; if (!response.ok) throw new Error(data.error || "Identity data is unavailable."); setPortfolio(data); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Identity data is unavailable."); } finally { setLoading(false); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => void reload(), 0); return () => window.clearTimeout(timer); }, [reload]);
  const mutate = useCallback(async (body: Record<string, unknown>) => { const response = await fetch("/api/stewardship", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || "Identity update failed."); await reload(); }, [reload]);
  return { portfolio, loading, error, mutate, reload };
}
