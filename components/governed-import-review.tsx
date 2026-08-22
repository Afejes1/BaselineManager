"use client";

import type { GovernedImportItem, ImportDecision, ImportTargetOption } from "../lib/governed-import";
import { importDecision, summarizeImportReview } from "../lib/governed-import";

type Props = {
  items: GovernedImportItem[];
  decisions: Record<string, ImportDecision>;
  targets?: Record<string, string>;
  targetOptions?: ImportTargetOption[];
  targetLabel?: string;
  busy?: boolean;
  applyLabel: string;
  onDecision: (id: string, decision: ImportDecision) => void;
  onTarget?: (id: string, targetId: string) => void;
  onBulkDecision?: (decision: ImportDecision) => void;
  onApply: () => void;
};

export function GovernedImportReview({ items, decisions, targets = {}, targetOptions = [], targetLabel = "Canonical record", busy = false, applyLabel, onDecision, onTarget, onBulkDecision, onApply }: Props) {
  const summary = summarizeImportReview(items, decisions);
  const approvedItems = items.filter((item) => item.disposition !== "blocked" && importDecision(item, decisions) === "approve");
  const resolvedTarget = (item: GovernedImportItem) => Object.prototype.hasOwnProperty.call(targets, item.id) ? targets[item.id] : item.proposedTargetId || "";
  const unresolvedApproved = approvedItems.filter((item) => onTarget && item.targetRequired && !resolvedTarget(item));
  const canApply = approvedItems.length > 0 && unresolvedApproved.length === 0;
  return <section className="domain-section governed-import-review">
    <div className="section-toolbar"><div><span className="eyebrow">ANALYST RECONCILIATION</span><h3>Review every proposed canonical change</h3></div><div className="import-review-actions">{onBulkDecision ? <><button className="ghost-button" type="button" onClick={() => onBulkDecision("approve")}>Approve valid rows</button><button className="ghost-button" type="button" onClick={() => onBulkDecision("skip")}>Skip all</button></> : null}<button className="primary-button" type="button" disabled={busy || !canApply} onClick={onApply}>{busy ? "Applying…" : applyLabel}</button></div></div>
    <p className="entity-meta">Approval applies only the selected source-controlled fields. Existing Government analysis, links, decisions, and review history remain in place.</p>
    <section className="summary import-review-summary"><div className="metric"><span>New</span><strong>{summary.add}</strong></div><div className="metric"><span>Changed</span><strong>{summary.change}</strong></div><div className="metric"><span>Unchanged</span><strong>{summary.unchanged}</strong></div><div className="metric"><span>Blocked</span><strong>{summary.blocked}</strong></div><div className="metric"><span>Approved</span><strong>{summary.approved}</strong></div><div className="metric"><span>Skipped</span><strong>{summary.skipped}</strong></div></section>
    {unresolvedApproved.length ? <p className="error-copy">{unresolvedApproved.length} approved row{unresolvedApproved.length === 1 ? " requires" : "s require"} an identity resolution.</p> : null}
    <div className="domain-table-wrap"><table className="import-review-table"><thead><tr><th>Apply</th><th>Source row</th><th>Proposed action</th>{onTarget ? <th>{targetLabel}</th> : null}<th>Field changes / findings</th></tr></thead><tbody>{items.map((item) => {
      const decision = item.disposition === "blocked" ? "skip" : importDecision(item, decisions);
      const selectedTarget = resolvedTarget(item);
      const availableTargets = item.targetKind ? targetOptions.filter((option) => !option.kind || option.kind === item.targetKind) : [];
      return <tr key={item.id} className={decision === "skip" ? "import-row-skipped" : ""}><td><input type="checkbox" aria-label={`Apply source row ${item.rowNumber}`} disabled={item.disposition === "blocked"} checked={decision === "approve"} onChange={(event) => onDecision(item.id, event.target.checked ? "approve" : "skip")} /></td><td><strong>{item.sourceKey || `Row ${item.rowNumber}`}</strong><small>{item.title}</small>{item.detail ? <small>{item.detail}</small> : null}</td><td><span className={`status-pill status-${item.disposition}`}>{item.disposition}</span><small>Row {item.rowNumber}</small></td>{onTarget ? <td>{item.targetKind ? <><select aria-label={`${targetLabel} for ${item.sourceKey}`} value={selectedTarget} onChange={(event) => onTarget(item.id, event.target.value)}><option value="">{`Leave unlinked to ${item.targetKind.replace(/_/g, " ")}`}</option>{availableTargets.map((option) => <option value={option.id} key={`${option.kind || "target"}-${option.id}`}>{option.label}{option.detail ? ` · ${option.detail}` : ""}</option>)}</select>{item.proposedTargetLabel ? <small>Proposed: {item.proposedTargetLabel}</small> : null}</> : <small>Source observation only. No governed target type is configured.</small>}</td> : null}<td>{item.issues.map((issue) => <small className={issue.startsWith("Warning:") ? "warning-copy" : "error-copy"} key={issue}>{issue}</small>)}{item.changes.length ? <ul className="source-diff-list compact-diff-list">{item.changes.map((change) => <li key={change.field}><strong>{change.field}</strong><del>{change.before || "(blank)"}</del><ins>{change.after || "(blank)"}</ins></li>)}</ul> : !item.issues.length ? <small>No source-controlled fields changed.</small> : null}</td></tr>;
    })}</tbody></table></div>
  </section>;
}
