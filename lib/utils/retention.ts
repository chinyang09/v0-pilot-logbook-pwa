/**
 * The undo windows.
 *
 * Several things in the app are reversible for a while and then permanently
 * are not, and they run on two clocks:
 *
 * - `RETENTION_MS` (**90 days**) — an import decision
 *   (`lib/utils/roster/import-decisions.ts`) and a company value accepted on
 *   the discrepancies page. Company reports arrive roughly monthly, so this
 *   spans about three report cycles: long enough to catch a mistake during a
 *   quarterly logbook review and put it back.
 * - `DELETED_RETENTION_MS` (**30 days**) — anything the user DELETED, held in
 *   Recently Deleted. A deletion is an act, not a difference between two
 *   records: you know within days whether you meant it, and holding every
 *   deleted flight, aircraft and crew member for a quarter turns a safety net
 *   into an archive.
 *
 * They were one number for a while, which is why the helpers below take the
 * window as an argument rather than closing over a constant — a caller states
 * which clock it is on, and there is nowhere for the two to drift apart.
 *
 * The expiry is real. Once a window closes the retained value is destroyed and
 * the change genuinely cannot be undone — which is why the UI states how long
 * is left rather than implying the row is safe.
 */

export const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Recently Deleted. See the note above on why this is shorter. */
export const DELETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Still inside the window (and therefore still reversible).
 *
 * Accepts null as well as undefined: a stamp that has been CLEARED is written
 * as null rather than undefined so the clear survives the sync push (see
 * `FlightLog.deletedAt`), and both mean "no clock running".
 */
export function isWithinRetention(
  at: number | null | undefined,
  now = Date.now(),
  window = RETENTION_MS
): boolean {
  if (at == null) return false;
  return now - at < window;
}

/** Epoch ms the window closes. */
export function retentionExpiresAt(at: number, window = RETENTION_MS): number {
  return at + window;
}

/**
 * Whole days left, rounded up, floored at 0 — so the last partial day still
 * reads "1 day left" rather than "0".
 */
export function retentionDaysLeft(
  at: number,
  now = Date.now(),
  window = RETENTION_MS
): number {
  return Math.max(0, Math.ceil((at + window - now) / DAY_MS));
}

/** "29 days left" / "1 day left" / "Expired". */
export function retentionLabel(
  at: number,
  now = Date.now(),
  window = RETENTION_MS
): string {
  const days = retentionDaysLeft(at, now, window);
  if (days === 0) return "Expired";
  return `${days} day${days === 1 ? "" : "s"} left`;
}
