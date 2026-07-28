/**
 * Parse the "Generated on ..." footer that ecrew exports include in both
 * Crew Logbook Report and Personal Crew Schedule Report.
 *
 * Format observed:
 *   "Generated on  May 09, 2026 02:48"
 *   "Generated on  May 09, 2026 03:31"
 *
 * Note the double space after "on" — the regex tolerates any whitespace.
 *
 * Returns epoch ms in UTC, or null if the footer is absent or unparseable.
 */

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const FOOTER_RE =
  /Generated on\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})/;

export function parseGeneratedAt(text: string): number | null {
  if (!text) return null;
  const match = text.match(FOOTER_RE);
  if (!match) return null;

  const [, monthName, day, year, hour, minute] = match;
  const monthIndex = MONTH_MAP[monthName.toLowerCase()];
  if (monthIndex === undefined) return null;

  const epoch = Date.UTC(
    parseInt(year, 10),
    monthIndex,
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10)
  );
  return Number.isFinite(epoch) ? epoch : null;
}

/**
 * UTC calendar date (YYYY-MM-DD) of the report snapshot — the boundary
 * between flown and planned rows. Falls back to "now" when the footer is
 * absent.
 */
export function reportBoundaryDateIso(generatedAtMs: number | null): string {
  const d = generatedAtMs != null ? new Date(generatedAtMs) : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * A dated row is "planned" (not yet flown) when it falls strictly AFTER the
 * report's generation date: the snapshot cannot carry actual times, block, or
 * takeoff/landing counts for a flight that hasn't happened. Used to stop the
 * logbook parser hydrating future roster sectors as if they were flown.
 */
export function isPlannedDate(
  dateIso: string,
  generatedAtMs: number | null
): boolean {
  if (!dateIso) return false;
  return dateIso > reportBoundaryDateIso(generatedAtMs);
}
