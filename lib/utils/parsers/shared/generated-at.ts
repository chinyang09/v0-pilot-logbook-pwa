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
