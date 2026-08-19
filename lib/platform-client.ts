"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlatformPortfolio } from "./platform-model";

export async function fetchPlatformPortfolio() {
  const response = await fetch("/api/platforms", { cache: "no-store" });
  const payload = await response.json() as PlatformPortfolio & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Platform hierarchy could not be loaded.");
  return payload;
}

export async function savePlatformAction(body: Record<string, unknown>) {
  const response = await fetch("/api/platforms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Platform change could not be saved.");
  return payload;
}

export function usePlatformPortfolio() {
  const [portfolio, setPortfolio] = useState<PlatformPortfolio>({ platforms: [], relationships: [], releaseProfiles: [], organizations: [], releases: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    try { setPortfolio(await fetchPlatformPortfolio()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Platform hierarchy could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const handle = window.setTimeout(() => { void reload(); }, 0); return () => window.clearTimeout(handle); }, [reload]);
  return { portfolio, loading, error, reload };
}
