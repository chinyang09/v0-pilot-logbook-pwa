/**
 * Which existing flights an import is allowed to MATCH against.
 *
 * This is deliberately NOT the same window as the one the report claims to
 * cover, and conflating the two is what made a January schedule report create
 * a fresh duplicate of the same flight on every single upload.
 *
 * eCrew's "Personal Crew Schedule Report 01/01/2026 - 31/01/2026" carries a row
 * dated **01/02/2026** — the return leg of a duty that started on the 31st,
 * included so the pairing isn't cut in half. The caller filtered the candidate
 * flights to the header's stated range, so the existing 1 February flight was
 * never in the pool; the reconciler saw a sector with no possible match and
 * emitted `create`, which is auto-accepted. Re-importing the report added
 * another copy, and another.
 *
 * So the MATCH window is the union of the stated range and the dates the
 * sectors actually landed on. The DELETE scope stays the stated range — the
 * reconciler re-checks it itself (`dateInRange(flight.date, csvDateRange)`),
 * which is what stops a spilled-over sector turning every unrelated flight on
 * 1 February into a deletion proposal. A report is authoritative for the window
 * it names, and merely *present* outside it.
 */

export interface DateWindow {
  start: string;
  end: string;
}

/**
 * Widen `range` to cover every date in `sectorDates`.
 *
 * An absent range (no header line) falls back to the sectors' own span rather
 * than to an empty string — `"" <= date` is true for every date, so an empty
 * start silently means "everything", and that should be a decision rather than
 * a side effect of string comparison.
 */
export function flightMatchWindow(
  range: DateWindow,
  sectorDates: Iterable<string>
): DateWindow {
  let start = range.start || "";
  let end = range.end || "";

  for (const date of sectorDates) {
    if (!date) continue;
    if (!start || date < start) start = date;
    if (!end || date > end) end = date;
  }

  return { start, end };
}

/** Every date a set of sectors touches, for `flightMatchWindow`. */
export function sectorDates(
  sectors: ReadonlyArray<{ date: string }>
): string[] {
  return sectors.map((s) => s.date).filter(Boolean);
}

/**
 * Is this flight a candidate for matching? An empty window matches everything,
 * which is the "no header line" case — better to consider every flight than to
 * silently consider none.
 */
export function inWindow(date: string, window: DateWindow): boolean {
  if (window.start && date < window.start) return false;
  if (window.end && date > window.end) return false;
  return true;
}
