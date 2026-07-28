/**
 * Import decision memory — what the user already said about a field, so a
 * re-uploaded report doesn't re-ask, while leaving the door open to change
 * their mind later.
 *
 * Two directions are remembered per field:
 *
 * - `declined` — the report proposed this value and the user said no. A later
 *   report proposing the SAME value is filtered out silently. A DIFFERENT
 *   value still surfaces (the memory is about a decision, not a permanent mute
 *   on the field).
 * - `replaced` — the user accepted a change that overwrote their own value.
 *   The overwritten value is kept so they can put it back if they decide the
 *   company was wrong after all.
 *
 * Both expire after `IMPORT_DECISION_RETENTION_MS`. Reverting is never
 * automatic: an expired `declined` simply means the question can be asked
 * again, and a live `replaced` is only restored if the user ticks it in the
 * review modal's "Earlier decisions" tab.
 */

import type { FlightLog } from "@/types/entities/flight.types";

/**
 * How long a decision (and any value it overwrote) is kept.
 *
 * 90 days. Company reports arrive roughly monthly, so this spans about three
 * report cycles — long enough to notice a mistake during a quarterly logbook
 * review and undo it, short enough that the map stays a handful of entries on
 * a handful of flights rather than accumulating for the life of the logbook.
 * Entries are pruned on every write, so nothing lingers past the window.
 */
export const IMPORT_DECISION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface ImportDecision {
  /** Report value the user turned down. */
  declined?: string;
  /** The user's own value that an accepted change overwrote. */
  replaced?: string;
  /** When the decision was made (epoch ms) — drives the retention window. */
  at: number;
}

export type ImportDecisions = Record<string, ImportDecision>;

export function isLive(
  decision: ImportDecision | undefined,
  now = Date.now()
): decision is ImportDecision {
  return !!decision && now - decision.at < IMPORT_DECISION_RETENTION_MS;
}

/** Decisions still inside the retention window, or undefined if none are. */
export function liveDecisions(
  flight: Pick<FlightLog, "importDecisions">,
  now = Date.now()
): ImportDecisions | undefined {
  const all = flight.importDecisions;
  if (!all) return undefined;
  const out: ImportDecisions = {};
  let any = false;
  for (const [field, decision] of Object.entries(all)) {
    if (!isLive(decision, now)) continue;
    out[field] = decision;
    any = true;
  }
  return any ? out : undefined;
}

/**
 * Merge new decisions into a flight's map and drop expired ones.
 *
 * Returns the next map, or `null` when nothing changed (so a caller can skip
 * the write entirely). An empty result is returned as `{}` rather than null
 * when it is a real change — that clears a stale map.
 */
export function mergeDecisions(
  flight: Pick<FlightLog, "importDecisions">,
  updates: Array<{ field: string; declined?: string; replaced?: string }>,
  now = Date.now()
): ImportDecisions | null {
  const existing = flight.importDecisions ?? {};
  const next: ImportDecisions = {};
  let changed = false;

  // Carry forward everything still inside the window.
  for (const [field, decision] of Object.entries(existing)) {
    if (isLive(decision, now)) next[field] = decision;
    else changed = true;
  }

  for (const update of updates) {
    const prev = next[update.field];
    const merged: ImportDecision = {
      // A new decision supersedes the old one for the same direction, but
      // keeps the other direction (a field can have been declined once and
      // overwritten another time).
      declined: update.declined ?? prev?.declined,
      replaced: update.replaced ?? prev?.replaced,
      at: now,
    };
    if (merged.declined === undefined) delete merged.declined;
    if (merged.replaced === undefined) delete merged.replaced;
    if (
      prev &&
      prev.declined === merged.declined &&
      prev.replaced === merged.replaced
    ) {
      // Same decision as before — refresh its timestamp so an ongoing "no"
      // doesn't age out while the user keeps re-uploading the report.
      next[update.field] = { ...prev, at: now };
      changed = true;
      continue;
    }
    next[update.field] = merged;
    changed = true;
  }

  return changed ? next : null;
}

/** Drop a field's memory entirely — used when the user reverses a decision. */
export function clearDecisions(
  flight: Pick<FlightLog, "importDecisions">,
  fields: string[],
  now = Date.now()
): ImportDecisions | null {
  const existing = flight.importDecisions;
  if (!existing) return null;
  const next: ImportDecisions = {};
  let changed = false;
  for (const [field, decision] of Object.entries(existing)) {
    if (fields.includes(field)) {
      changed = true;
      continue;
    }
    if (isLive(decision, now)) next[field] = decision;
    else changed = true;
  }
  return changed ? next : null;
}
