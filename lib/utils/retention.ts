/**
 * The 90-day undo window.
 *
 * Three things in the app are reversible for a while and then permanently
 * are not: an import decision (`lib/utils/roster/import-decisions.ts`), a
 * company value accepted on the discrepancies page, and a deleted flight in
 * the recycle bin. They all run on the same clock, and it is defined once here
 * so a change to the policy is a change in one place.
 *
 * Why 90 days: company reports arrive roughly monthly, so the window spans
 * about three report cycles — long enough to catch a mistake during a
 * quarterly logbook review and put it back, short enough that what is retained
 * stays a handful of rows rather than accumulating for the life of the
 * logbook.
 *
 * The expiry is real. Once the window closes the retained "before" value is
 * deleted, and the change genuinely cannot be undone — that is the point of
 * telling the user how long they have.
 */

export const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Still inside the window (and therefore still reversible). */
export function isWithinRetention(at: number | undefined, now = Date.now()): boolean {
  if (at === undefined) return false;
  return now - at < RETENTION_MS;
}

/** Epoch ms the window closes. */
export function retentionExpiresAt(at: number): number {
  return at + RETENTION_MS;
}

/**
 * Whole days left, rounded up, floored at 0 — so the last partial day still
 * reads "1 day left" rather than "0".
 */
export function retentionDaysLeft(at: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((at + RETENTION_MS - now) / DAY_MS));
}

/** "89 days left" / "1 day left" / "Expired". */
export function retentionLabel(at: number, now = Date.now()): string {
  const days = retentionDaysLeft(at, now);
  if (days === 0) return "Expired";
  return `${days} day${days === 1 ? "" : "s"} left`;
}
