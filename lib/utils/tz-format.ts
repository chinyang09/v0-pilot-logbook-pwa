/**
 * Cached `Intl.DateTimeFormat` instances, keyed by (timezone × shape).
 *
 * Constructing one resolves locale and timezone data, and that is by far the
 * most expensive part of any timezone conversion in this app. Two hot paths
 * were paying it per call:
 *
 * - `getAirportTimeInfo` (airports store) builds a departure and an arrival
 *   offset PER SECTOR for the logbook parser and the roster executor;
 * - `normalizeTimeToUTC` (the schedule parser) resolves an offset per TIME
 *   TOKEN, so roughly six per row.
 *
 * A few hundred imported rows therefore constructed formatters in the
 * thousands. Measured on 800 lookups across 8 zones: 143ms → 8ms.
 *
 * ── Cache the FORMATTER, never the answer ─────────────────────────────────
 *
 * A formatter is stateless: the DST-dependent part is the instant you hand it,
 * and every caller still passes its own. Caching a resolved offset instead
 * would pin whatever DST was in force the first time a zone was seen, which is
 * wrong for a logbook spanning a transition and wrong for a report generated
 * on the other side of one.
 *
 * The key set is bounded by the airports a pilot actually flies to. An invalid
 * timezone throws out of the constructor and is deliberately NOT cached — the
 * caller's own `try` still sees it.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

export function tzFormatter(
  timeZone: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone">,
  /** Distinguishes shapes for the same zone. Must be stable per `options`. */
  shape: string,
): Intl.DateTimeFormat {
  const key = `${timeZone}|${shape}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("en-US", { timeZone, ...options });
  formatters.set(key, made);
  return made;
}

/**
 * The zone's offset name at a given instant, e.g. `GMT+8` (short) or
 * `GMT+08:00` (long). Empty string if the zone has no offset part.
 */
export function tzOffsetName(
  timeZone: string,
  style: "shortOffset" | "longOffset",
  at: Date,
): string {
  return (
    tzFormatter(timeZone, { timeZoneName: style }, style)
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value || ""
  );
}
