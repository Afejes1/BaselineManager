"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "../../components/app-link";
import { DomainPageShell } from "../../components/domain-shell";
import { SafeMarkdown } from "../../components/safe-markdown";
import { assistantContextHref, type AssistantContextKind, type AssistantScratchpadEntry } from "../../lib/assistant-model";

const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function AnalysisLibraryPage() {
  const [entries, setEntries] = useState<AssistantScratchpadEntry[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssistantContextKind | "all">("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/assistant?scope=library", { cache: "no-store" });
      const payload = await response.json() as { scratchpad?: AssistantScratchpadEntry[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "AI Analysis could not be loaded.");
      setEntries(payload.scratchpad || []); setMessage("");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "AI Analysis could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const kinds = useMemo(() => [...new Set(entries.map((entry) => entry.contextKind))].sort(), [entries]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => kind === "all" || entry.contextKind === kind).filter((entry) => !needle || `${entry.title} ${entry.contextLabel} ${entry.promptText} ${entry.responseText}`.toLowerCase().includes(needle));
  }, [entries, kind, query]);

  async function remove(entry: AssistantScratchpadEntry) {
    if (!window.confirm(`Remove saved AI analysis "${entry.title}"? This does not change source evidence, assessments, or decisions.`)) return;
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete_scratchpad", entryId: entry.id }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The saved analysis could not be removed.");
      await load();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The saved analysis could not be removed."); }
  }

  return <DomainPageShell title="AI Analysis" subtitle="AI Analysis register · saved, context-grounded GenAI.mil work products" releaseScope={`${entries.length} saved analyses`} contextMode="portfolio" actions={<><label className="search analysis-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved analysis" /></label><select value={kind} onChange={(event) => setKind(event.target.value as AssistantContextKind | "all")}><option value="all">All record types</option>{kinds.map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></>}>
    <aside className="decision-principle"><strong>Analysis workspace—not evidence</strong><span>These are the answers you explicitly saved from record-level assistant sessions. They remain separate from imported source evidence, Government assessments, and adjudicated decisions until you use a normal governed workflow.</span></aside>
    {message ? <p className="assistant-message" role="status">{message}</p> : null}
    {loading ? <section className="domain-section"><p className="empty">Loading saved AI analysis…</p></section> : visible.length ? <section className="analysis-library">{visible.map((entry) => <article className="analysis-library-card" key={entry.id}>
      <header><div><span className="record-type">{readable(entry.contextKind)}</span><h2>{entry.title}</h2><p>{entry.contextLabel}</p></div><div><small>{entry.modelName || "Model not recorded"}</small><time>{new Date(entry.createdAt).toLocaleString()}</time></div></header>
      <details><summary>Question and grounding</summary><div className="analysis-question"><strong>Question</strong><p>{entry.promptText}</p><strong>Grounding boundary</strong><p>{entry.groundingSummary}</p></div></details>
      <SafeMarkdown content={entry.responseText} className="analysis-library-response" />
      <footer><Link className="ghost-button" href={assistantContextHref({ kind: entry.contextKind, id: entry.contextId })}>Open source context</Link><button className="text-action" type="button" onClick={() => void remove(entry)}>Remove saved analysis</button></footer>
    </article>)}</section> : <section className="domain-section empty-state"><h3>No saved analysis matches this view</h3><p>Open a supported record, choose Ask GenAI.mil, and use Save analysis scratchpad. It will appear here.</p></section>}
  </DomainPageShell>;
}
