import { claimStatusLabel, informationOriginLabel, informationStatusSummary } from "../lib/information-status";

type ProvenanceKeyProps = {
  includeDemonstration?: boolean;
  compact?: boolean;
};

export function ProvenanceKey({ includeDemonstration = false, compact = false }: ProvenanceKeyProps) {
  return (
    <section className={`provenance-key ${compact ? "provenance-key-compact" : ""}`} aria-label="Information status key">
      <div><span className="provenance-mark provenance-reported" /> <strong>Source claim</strong><small>What a source reported; not a Government conclusion.</small></div>
      <div><span className="provenance-mark provenance-government" /> <strong>Government assessment</strong><small>Government or independent analysis; not a decision.</small></div>
      <div><span className="provenance-mark provenance-decision" /> <strong>Government decision</strong><small>Requires named authority, date, and rationale.</small></div>
      <div><span className="provenance-mark provenance-verification" /> <strong>Verification / acceptance</strong><small>Evidence plus criterion or sign-off; an integrity seal alone is not acceptance.</small></div>
      {includeDemonstration ? <div><span className="provenance-mark provenance-demo" /> <strong>Demonstration data</strong><small>Not program data</small></div> : null}
    </section>
  );
}

export function InformationOriginBadge({ value }: { value: string | null | undefined }) {
  return <span className="information-status-badge information-origin">{informationOriginLabel(value)}</span>;
}

export function ClaimStatusBadge({ value }: { value: "reported" | "assessed" | "confirmed" }) {
  return <span className={`information-status-badge information-${value}`}>{claimStatusLabel(value)}</span>;
}

export function InformationStatusClarifier() {
  return <p className="provenance-clarifier"><strong>How to read this record:</strong> {informationStatusSummary}</p>;
}
