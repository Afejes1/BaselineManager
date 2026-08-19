"use client";

import { useEffect, useState } from "react";
import { fetchAuditHistory } from "../lib/master-data-client";
import type { AuditEntry } from "../lib/master-data-model";

function payload(value: string | null) {
  if (!value) return "No structured values recorded.";
  try {
    const object = JSON.parse(value) as Record<string, unknown>;
    return Object.entries(object).filter(([, item]) => item !== null && item !== "" && item !== undefined).slice(0, 8).map(([key, item]) => `${key.replaceAll("_", " ")}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join(" · ");
  } catch { return value; }
}

export function AuditHistoryPanel({ kind, id, label }: { kind: string; id: string; label: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetchAuditHistory(kind, id).then((items) => { if (active) { setEntries(items); setError(""); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "History could not be loaded."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, kind]);
  return <section className="domain-section"><div className="section-toolbar"><div><span className="eyebrow">AUDIT HISTORY</span><h3>Governed changes to {label}</h3></div><span>{entries.length} events</span></div>{loading ? <p className="empty">Loading history…</p> : error ? <p className="error-copy">{error}</p> : <div className="audit-timeline">{entries.map((entry) => <article className="audit-entry" key={entry.id}><div><strong>{entry.action.replaceAll("_", " ")}</strong><small>{new Date(entry.createdAt).toLocaleString()} · {entry.actorId}</small></div><p>{payload(entry.afterPayload)}</p></article>)}{!entries.length ? <p className="empty">No governed changes have been recorded for this object.</p> : null}</div>}</section>;
}
