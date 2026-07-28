/**
 * Pairing an imported sector with the flight it actually is.
 *
 * The naive approach — walk the sectors, take the first unclaimed flight that
 * matches on date + route — is wrong whenever a day repeats a route, because
 * the answer then depends entirely on the order the two lists happen to be in.
 * A four-leg SIN→PEN→SIN→PEN→SIN day with the report ascending by time and the
 * stored flights descending pairs EVERY leg with the wrong one, and the import
 * proposes swapping all their times.
 *
 * So pairing is decided globally instead: score every plausible pair, sort by
 * score, and claim greedily from the sorted list. An exact time agreement
 * (score 0) is taken before anything else, whatever order the inputs arrive
 * in, and each side is used at most once.
 */

/** Minutes between two HH:MM clock times, wrapping at midnight (0–720). */
export function minutesApart(
  a: string | undefined,
  b: string | undefined
): number | null {
  if (!a || !b) return null;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };
  const ma = toMin(a);
  const mb = toMin(b);
  if (ma === null || mb === null) return null;
  const raw = Math.abs(ma - mb);
  return raw > 720 ? 1440 - raw : raw;
}

/**
 * How far apart one endpoint (departure or arrival) is, comparing whichever
 * times both sides actually carry.
 *
 * Actual-vs-actual and scheduled-vs-scheduled are both tried, and the better
 * agreement wins — a report row carrying only a scheduled time still pairs
 * correctly against a flight that has flown, and vice versa. `null` means
 * neither side offered a comparable time.
 */
export function endpointDelta(
  sectorActual: string | undefined,
  sectorScheduled: string | undefined,
  flightActual: string | undefined,
  flightScheduled: string | undefined
): number | null {
  const options = [
    minutesApart(sectorActual, flightActual),
    minutesApart(sectorScheduled, flightScheduled),
    minutesApart(sectorActual ?? sectorScheduled, flightActual ?? flightScheduled),
  ].filter((n): n is number => n !== null);
  return options.length > 0 ? Math.min(...options) : null;
}

export interface ScoredPair {
  /** Index into the left-hand list (sectors). */
  left: number;
  /** Index into the right-hand list (flights). */
  right: number;
  /** Lower is a better pairing. */
  cost: number;
}

/**
 * Claim pairs cheapest-first, each index used at most once.
 *
 * Ties break on the indices so the result is deterministic regardless of the
 * order pairs were generated in — the whole point of the exercise.
 */
export function assignByCost(pairs: ScoredPair[]): Map<number, number> {
  const sorted = [...pairs].sort(
    (a, b) => a.cost - b.cost || a.left - b.left || a.right - b.right
  );
  const usedLeft = new Set<number>();
  const usedRight = new Set<number>();
  const assignment = new Map<number, number>();

  for (const pair of sorted) {
    if (usedLeft.has(pair.left) || usedRight.has(pair.right)) continue;
    usedLeft.add(pair.left);
    usedRight.add(pair.right);
    assignment.set(pair.left, pair.right);
  }

  return assignment;
}
