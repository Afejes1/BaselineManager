"use client";

import { useState } from "react";
import { ViewportModal } from "./viewport-modal";

type Authority = "reported" | "analyst_transcribed" | "migrated_unclassified";

export function NarrativeAuthorityEditor({ label, sourceDescription, governmentSynopsis, authority, saving, onDismiss, onSave }: { label: string; sourceDescription: string | null; governmentSynopsis: string | null; authority: Authority; saving: boolean; onDismiss: () => void; onSave: (value: { sourceDescription: string; governmentSynopsis: string; descriptionAuthority: Authority }) => Promise<void> }) {
  const [draft, setDraft] = useState({ sourceDescription: sourceDescription || "", governmentSynopsis: governmentSynopsis || "", descriptionAuthority: authority });
  const [message, setMessage] = useState("");
  return <ViewportModal className="wide-modal" onDismiss={onDismiss} dismissDisabled={saving} labelledBy="narrative-authority-title">
    <span className="eyebrow">INFORMATION AUTHORITY</span><h2 id="narrative-authority-title">Narratives for {label}</h2>
    <p className="entity-meta">Keep what the source says separate from the Government interpretation used to develop and compare options.</p>
    <div className="information-authority-grid">
      <label className="modal-field"><strong>Source description</strong><small>Imported or transcribed incumbent/source content. This app does not edit the external system.</small><textarea rows={8} value={draft.sourceDescription} onChange={(event) => setDraft({ ...draft, sourceDescription: event.target.value })}/></label>
      <label className="modal-field"><strong>Government synopsis</strong><small>Local Government interpretation. GenAI.mil receives it with a Government-assessment label.</small><textarea rows={8} value={draft.governmentSynopsis} onChange={(event) => setDraft({ ...draft, governmentSynopsis: event.target.value })}/></label>
    </div>
    <label className="modal-field">Source-description authority<select value={draft.descriptionAuthority} onChange={(event) => setDraft({ ...draft, descriptionAuthority: event.target.value as Authority })}><option value="reported">Reported/imported source</option><option value="analyst_transcribed">Analyst transcription of source</option><option value="migrated_unclassified">Migrated · authority not yet classified</option></select></label>
    {draft.descriptionAuthority !== "reported" && !draft.governmentSynopsis.trim() ? <p className="warning-copy">The existing narrative is not verified as an imported source description. Add a Government synopsis or classify the source authority before relying on it.</p> : null}
    {message ? <p className="error-copy">{message}</p> : null}
    <footer><button className="ghost-button" type="button" disabled={saving} onClick={onDismiss}>Cancel</button><button className="primary-button" type="button" disabled={saving} onClick={() => void onSave(draft).catch((error) => setMessage(error instanceof Error ? error.message : "Narratives could not be saved."))}>{saving ? "Saving…" : "Save narratives"}</button></footer>
  </ViewportModal>;
}

