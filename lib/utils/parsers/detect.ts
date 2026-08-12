/**
 * Sniff a CSV/TSV/PDF text blob to determine which report it is.
 *
 * Two families are recognised:
 *
 *  - eCrew ("logbook" / "schedule") — the company's own reports, the app's
 *    recurring import path.
 *  - LogTen Pro ("logten_flights" / "logten_aircraft" / "logten_crew") — a
 *    ONE-TIME migration from another logbook app. LogTen writes one file per
 *    tab, so a full migration is up to three files that have to be told apart
 *    by their header row alone; none of them carries a title line.
 *
 * Detection is header-driven for LogTen because the export has no preamble,
 * no title and no "Generated on" footer — the first line IS the header.
 */

export type DetectedKind =
  | "logbook"
  | "schedule"
  | "logten_flights"
  | "logten_aircraft"
  | "logten_crew"
  | "unknown";

/** The LogTen kinds, so callers can branch on the family in one test. */
const LOGTEN_KINDS = new Set<DetectedKind>([
  "logten_flights",
  "logten_aircraft",
  "logten_crew",
]);

export function isLogtenKind(kind: DetectedKind): boolean {
  return LOGTEN_KINDS.has(kind);
}

export function detectReportType(text: string): DetectedKind {
  if (!text) return "unknown";

  const sample = text.slice(0, 4000);

  // ---- eCrew: title-based detection first (works for both CSV and PDF) ----
  if (sample.includes("Crew Logbook Report")) return "logbook";
  if (sample.includes("Personal Crew Schedule Report")) return "schedule";

  // ---- LogTen Pro, from the header row ----
  const logten = detectLogten(sample);
  if (logten !== "unknown") return logten;

  // ---- eCrew CSV header fallback ----
  if (
    sample.includes("Date,Airport,Time") ||
    sample.includes("Airport,Time,Airport,Time")
  ) {
    return "logbook";
  }
  if (
    /Date\s*,?\s*Duties\s*,?\s*Details/i.test(sample) ||
    sample.includes("Schedule Details")
  ) {
    return "schedule";
  }

  return "unknown";
}

/**
 * LogTen's header row is the whole signature.
 *
 * The Flights tab uses the app's internal property names (`flight_flightDate`,
 * `aircraft_aircraftID`), which nothing else in the world emits — one hit is
 * conclusive. The Aircraft and Address Book tabs use human labels instead, so
 * those need a PAIR of columns to be sure: "Aircraft ID" alone could be any
 * fleet spreadsheet, but "Aircraft ID" next to "Wheel Configuration" is
 * LogTen's aircraft table and nothing else.
 */
function detectLogten(sample: string): DetectedKind {
  const header = (sample.split(/\r?\n/).find((l) => l.trim()) ?? "").toLowerCase();
  if (!header) return "unknown";

  if (header.includes("flight_flightdate") || header.includes("flight_totaltime")) {
    return "logten_flights";
  }

  const has = (label: string) => header.includes(label);

  if (
    has("aircraft id") &&
    (has("wheel configuration") || (has("engine type") && has("tailwheel")))
  ) {
    return "logten_aircraft";
  }

  if (
    has("this is me") &&
    (has("crew quick pick") || has("pax quick pick") || has("default capacity"))
  ) {
    return "logten_crew";
  }

  return "unknown";
}
