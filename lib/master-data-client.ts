"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditEntry, MasterDataPortfolio } from "./master-data-model";

export async function fetchMasterData() {
  const response = await fetch("/api/master-data", { cache: "no-store" });
  const payload = await response.json() as MasterDataPortfolio & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Master data could not be loaded.");
  return payload;
}

export async function saveMasterDataAction(body: Record<string, unknown>) {
  const response = await fetch("/api/master-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as { ok?: boolean; id?: string; error?: string; affectedRecords?: number };
  if (!response.ok) throw new Error(payload.error || "The record could not be saved.");
  return payload;
}

export async function fetchAuditHistory(kind: string, id: string) {
  const parameters = new URLSearchParams({ kind, id });
  const response = await fetch(`/api/master-data/history?${parameters}`, { cache: "no-store" });
  const payload = await response.json() as { entries?: AuditEntry[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "History could not be loaded.");
  return payload.entries || [];
}

export function useMasterData() {
  const [portfolio, setPortfolio] = useState<MasterDataPortfolio>({ releases: [], milestones: [], products: [], organizations: [], capabilities: [], configurationNodes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    try { setPortfolio(await fetchMasterData()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Master data could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const handle = window.setTimeout(() => { void reload(); }, 0); return () => window.clearTimeout(handle); }, [reload]);
  return { portfolio, loading, error, reload };
}
