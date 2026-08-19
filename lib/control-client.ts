"use client";
import { useEffect, useState } from "react";
import type { ControlSnapshot } from "./control-model";
export function useControlSnapshot() {
  const [snapshot, setSnapshot] = useState<ControlSnapshot | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => { const handle = window.setTimeout(() => { void (async () => { try { const response = await fetch("/api/control", { cache: "no-store" }); const data = await response.json() as ControlSnapshot & { error?: string }; if (!response.ok) throw new Error(data.error || "Control data is unavailable."); setSnapshot(data); } catch (reason) { setError(reason instanceof Error ? reason.message : "Control data is unavailable."); } finally { setLoading(false); } })(); }, 0); return () => window.clearTimeout(handle); }, []);
  return { snapshot, error, loading };
}
