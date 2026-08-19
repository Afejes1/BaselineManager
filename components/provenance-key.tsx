type ProvenanceKeyProps = {
  includeDemonstration?: boolean;
  compact?: boolean;
};

export function ProvenanceKey({ includeDemonstration = false, compact = false }: ProvenanceKeyProps) {
  return (
    <section className={`provenance-key ${compact ? "provenance-key-compact" : ""}`} aria-label="Record source key">
      <div><span className="provenance-mark provenance-reported" /> <strong>Reported baseline</strong><small>From the 24-column workbook</small></div>
      <div><span className="provenance-mark provenance-government" /> <strong>Government assessment</strong><small>Government analysis or managed detail</small></div>
      <div><span className="provenance-mark provenance-external" /> <strong>External reference</strong><small>Supplier or external-system record</small></div>
      {includeDemonstration ? <div><span className="provenance-mark provenance-demo" /> <strong>Demonstration data</strong><small>Not program data</small></div> : null}
    </section>
  );
}
