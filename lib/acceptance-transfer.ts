export type AcceptanceTransferRow = Record<string, unknown>;

export type AcceptanceCompatibilityAdjustment = {
  entityKind: "acceptance_signoff" | "acceptance_criterion";
  entityId: string;
  reason: "missing_evidence" | "quarantined_evidence" | "unsupported_passed_criterion";
};

export type AcceptanceCompatibilitySummary = {
  detachedEvidenceSignoffs: number;
  demotedCompletedSignoffs: number;
  demotedPassedCriteria: number;
  samples: AcceptanceCompatibilityAdjustment[];
};

const completedDecision = (value: unknown) => value === "accepted" || value === "waived";
const text = (value: unknown) => typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
const sampleLimit = 50;

export function acceptanceCompatibilityAdjustmentCount(summary: AcceptanceCompatibilitySummary) {
  return summary.detachedEvidenceSignoffs + summary.demotedCompletedSignoffs + summary.demotedPassedCriteria;
}

/**
 * Enforce the acceptance invariants that the destination database applies.
 *
 * Current packages are exact, self-verified backups and therefore fail closed.
 * Older signed packages may predate governed evidence constraints; those rows
 * are changed in memory before restore and the caller records the returned
 * summary in destination audit history.
 */
export function enforceAcceptanceTransferInvariants(input: {
  criteria: AcceptanceTransferRow[];
  signoffs: AcceptanceTransferRow[];
  evidenceDocumentIds: ReadonlySet<string>;
  quarantinedDocumentIds: ReadonlySet<string>;
  currentPackage: boolean;
}): AcceptanceCompatibilitySummary {
  const summary: AcceptanceCompatibilitySummary = {
    detachedEvidenceSignoffs: 0,
    demotedCompletedSignoffs: 0,
    demotedPassedCriteria: 0,
    samples: [],
  };
  const addSample = (adjustment: AcceptanceCompatibilityAdjustment) => {
    if (summary.samples.length < sampleLimit) summary.samples.push(adjustment);
  };

  for (const signoff of input.signoffs) {
    const signoffId = text(signoff.id) || "unknown-signoff";
    const rawEvidenceId = signoff.evidence_document_id;
    if (rawEvidenceId === null || rawEvidenceId === undefined) continue;
    const evidenceId = text(rawEvidenceId);
    const missing = !evidenceId || !input.evidenceDocumentIds.has(evidenceId);
    const quarantined = Boolean(evidenceId) && input.quarantinedDocumentIds.has(evidenceId);

    if (missing) {
      if (input.currentPackage) throw new Error(`Acceptance sign-off ${signoffId} references evidence that is not present in the package.`);
      signoff.evidence_document_id = null;
      summary.detachedEvidenceSignoffs += 1;
      addSample({ entityKind: "acceptance_signoff", entityId: signoffId, reason: "missing_evidence" });
    }

    if (completedDecision(signoff.decision) && (missing || quarantined)) {
      if (input.currentPackage) {
        throw new Error(`Acceptance sign-off ${signoffId} uses a supporting document that fails the current evidence policy.`);
      }
      signoff.decision = "pending";
      signoff.decided_at = null;
      summary.demotedCompletedSignoffs += 1;
      addSample({ entityKind: "acceptance_signoff", entityId: signoffId, reason: missing ? "missing_evidence" : "quarantined_evidence" });
    }
  }

  const signoffsByCriterion = new Map<string, AcceptanceTransferRow[]>();
  for (const signoff of input.signoffs) {
    const criterionId = text(signoff.criterion_id);
    if (criterionId) signoffsByCriterion.set(criterionId, [...(signoffsByCriterion.get(criterionId) || []), signoff]);
  }
  for (const criterion of input.criteria) {
    if (criterion.status !== "passed" || text(criterion.evidence_reference)) continue;
    const criterionId = text(criterion.id) || "unknown-criterion";
    const supported = (signoffsByCriterion.get(criterionId) || []).some((signoff) => {
      const evidenceId = text(signoff.evidence_document_id);
      return completedDecision(signoff.decision)
        && Boolean(evidenceId)
        && input.evidenceDocumentIds.has(evidenceId)
        && !input.quarantinedDocumentIds.has(evidenceId);
    });
    if (supported) continue;
    if (input.currentPackage) throw new Error(`Passed acceptance criterion ${criterionId} does not retain current governed evidence support.`);
    criterion.status = "in_verification";
    summary.demotedPassedCriteria += 1;
    addSample({ entityKind: "acceptance_criterion", entityId: criterionId, reason: "unsupported_passed_criterion" });
  }

  return summary;
}
