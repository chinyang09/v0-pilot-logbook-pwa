/**
 * Sniff a CSV/PDF text blob to determine whether it's a Crew Logbook Report,
 * a Personal Crew Schedule Report, or unknown.
 */

export type DetectedKind = "logbook" | "schedule" | "unknown";

export function detectReportType(text: string): DetectedKind {
  if (!text) return "unknown";

  const sample = text.slice(0, 4000);

  // Title-based detection first (works for both CSV and PDF).
  if (sample.includes("Crew Logbook Report")) return "logbook";
  if (sample.includes("Personal Crew Schedule Report")) return "schedule";

  // CSV header fallback.
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
