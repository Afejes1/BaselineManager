type ProvenanceKeyProps = {
  includeDemonstration?: boolean;
  compact?: boolean;
};

export function ProvenanceKey({ includeDemonstration = false, compact = false }: ProvenanceKeyProps) {
  return (
    <section className={`provenance-key ${compact ? "provenance-key-compact" : ""}`} aria-label="Data status key">
      <div><span className="provenance-mark provenance-reported" /> <strong>Working baseline</strong><small>Current contractor-maintained analytical data</small></div>
      <div><span className="provenance-mark provenance-government" /> <strong>Supporting evidence</strong><small>LM, Government, call, document, or analyst reference</small></div>
      <div><span className="provenance-mark provenance-external" /> <strong>External record</strong><small>Record managed in another system</small></div>
      {includeDemonstration ? <div><span className="provenance-mark provenance-demo" /> <strong>Demonstration data</strong><small>Not program data</small></div> : null}
    </section>
  );
}
