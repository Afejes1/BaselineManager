"use client";

import { useCallback, useEffect, useState } from "react";
import { TECHNICAL_BASELINE_COLUMNS, type TechnicalBaselineColumn } from "./technical-baseline-contract";
import type { Cell, Record24 } from "./baseline-data";

export type BaselineRecordMeta = {
  occurrenceId: string;
  sourceRowId: string;
  revision: number;
  materializationStatus: string;
  lifecycleStatus: "active" | "voided";
  lifecycleReason: string | null;
  voidedAt: string | null;
  voidedByUserId: string | null;
  baseline: { name: string | null; maturity: string | null; asOf: string | null };
  source: { fileName: string | null };
  releaseId: string | null;
  productId: string | null;
  configurationNodeId: string | null;
  deploymentId: string | null;
};

export type ManagedRecord24 = Record24 & { __meta: BaselineRecordMeta };
export type BaselineWorkspace = { id: string; label: string };
type ApiResponse = { workspace?: BaselineWorkspace; records?: Array<BaselineRecordMeta & { row: Record24 }>; error?: string };

export function projectionOf(row: Record24): Record24 {
  return Object.fromEntries(TECHNICAL_BASELINE_COLUMNS.map((column) => [column, row[column] as Cell])) as Record24;
}

export function managedRows(payload: ApiResponse): ManagedRecord24[] {
  return (payload.records ?? []).map((record) => ({ ...projectionOf(record.row), __meta: {
    occurrenceId: record.occurrenceId,
    sourceRowId: record.sourceRowId,
    revision: record.revision,
    materializationStatus: record.materializationStatus,
    lifecycleStatus: record.lifecycleStatus,
    lifecycleReason: record.lifecycleReason,
    voidedAt: record.voidedAt,
    voidedByUserId: record.voidedByUserId,
    baseline: record.baseline,
    source: record.source,
    releaseId: record.releaseId,
    productId: record.productId,
    configurationNodeId: record.configurationNodeId,
    deploymentId: record.deploymentId,
  } }));
}

export async function fetchBaselineWorkspace(includeVoided = false): Promise<{ workspace: BaselineWorkspace | null; rows: ManagedRecord24[] }> {
  const response = await fetch(`/api/baseline${includeVoided ? "?includeVoided=true" : ""}`, { cache: "no-store" });
  const payload = await response.json() as ApiResponse;
  if (!response.ok) throw new Error(payload.error || "The working baseline workspace could not be loaded.");
  return { workspace: payload.workspace ?? null, rows: managedRows(payload) };
}

export function useBaselineWorkspace(options: { includeVoided?: boolean } = {}) {
  const [rows, setRows] = useState<ManagedRecord24[]>([]);
  const [workspace, setWorkspace] = useState<BaselineWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchBaselineWorkspace(Boolean(options.includeVoided));
      setRows(next.rows);
      setWorkspace(next.workspace);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The working baseline workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [options.includeVoided]);

  useEffect(() => {
    const handle = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(handle);
  }, [reload]);

  return { rows, setRows, workspace, loading, error, reload };
}

export type { TechnicalBaselineColumn };
