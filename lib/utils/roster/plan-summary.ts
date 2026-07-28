/**
 * Shared helpers for turning reconciler operations into a review-ready plan:
 * default per-row acceptance flags and the summary counts. Previously these
 * two switch statements were copy-pasted across the schedule parser and both
 * branches of the unified import button (and drifted). One definition now.
 */

import type { ReconcilerOperation } from "./reconciler";

/** Op kinds that are safe to apply without the user opting in per row. */
const DEFAULT_ACCEPTED_KINDS = new Set<ReconcilerOperation["kind"]>([
  "create",
  "skip_identical",
  "skip_non_airline",
  "skip_stale_report",
  "update_safe",
]);

export type AcceptedOperation<T extends ReconcilerOperation = ReconcilerOperation> =
  T & { accepted: boolean };

/** Attach the default acceptance flag to each operation. */
export function applyDefaultAcceptance(
  operations: ReconcilerOperation[]
): AcceptedOperation[] {
  return operations.map((op) => ({
    ...op,
    accepted: DEFAULT_ACCEPTED_KINDS.has(op.kind),
  }));
}

export interface PlanSummary {
  toCreate: number;
  toUpdate: number;
  toDelete: number;
  identical: number;
  ignored: number;
  staleSkipped: number;
}

/** Count operations into the review-modal summary buckets. */
export function summarizeOperations(
  operations: Array<{ kind: ReconcilerOperation["kind"] }>
): PlanSummary {
  const summary: PlanSummary = {
    toCreate: 0,
    toUpdate: 0,
    toDelete: 0,
    identical: 0,
    ignored: 0,
    staleSkipped: 0,
  };
  for (const op of operations) {
    switch (op.kind) {
      case "create":
        summary.toCreate++;
        break;
      case "update_conflict":
      case "edited_conflict":
      case "update_safe":
      case "update_consult":
        summary.toUpdate++;
        break;
      case "delete_missing":
        summary.toDelete++;
        break;
      case "skip_identical":
      // A decided row changes nothing unless the user ticks it, so it counts
      // as unchanged in the pre-review summary.
      case "skip_decided":
        summary.identical++;
        break;
      case "skip_non_airline":
        summary.ignored++;
        break;
      case "skip_stale_report":
        summary.staleSkipped++;
        break;
    }
  }
  return summary;
}
