/**
 * Parse the "Training Details" section of a Personal Crew Schedule Report.
 *
 * That section lists every simulator / training session with richer detail
 * than the schedule table's duty row: the session time, course name, course
 * component, facility, and crew (instructor + trainees). Each entry begins
 * with a "Name: <facility>" line, so we split the section on those markers
 * and pull the fields out of each block, tolerant of the PDF extractor's
 * comma/space token joining and mid-field line wraps.
 *
 * Everything here is best-effort enrichment keyed by date — the schedule
 * duty row (EBT1 / EBT2 …) remains the reliable primary source, so a missed
 * field never drops a simulator session.
 */

import { parseDDMMYYYY } from "./csv-split";

export interface TrainingDetailEntry {
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM in the report's time reference (Local Base for Scoot). */
  startLocal?: string;
  endLocal?: string;
  /** Course component, e.g. "SMCK EBT6 D1". */
  component?: string;
  /** Course name, e.g. "A320 EBT Cycle6". */
  courseName?: string;
  /** Device family, e.g. "A320". */
  deviceType?: string;
  /** Facility name, e.g. "AATC SIM B". */
  facility?: string;
  /** Main instructor's full name. */
  instructorName?: string;
}

/** "0515" → "05:15"; "515" → "05:15". */
function toHHMM(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 4) return undefined;
  const padded = digits.padStart(4, "0");
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

function parseBlock(block: string): TrainingDetailEntry | null {
  // Flattened form (commas/newlines → spaces) for the multi-line fields.
  const flat = block.replace(/[,\n]+/g, " ").replace(/\s+/g, " ").trim();

  // Anchor: date + time range, e.g. "14/05/2026 0515 - 1115".
  const dt = flat.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{3,4})\s*-\s*(\d{3,4})/);
  if (!dt) return null;

  const date = parseDDMMYYYY(dt[1]);
  if (!date) return null;

  const entry: TrainingDetailEntry = {
    date,
    startLocal: toHHMM(dt[2]),
    endLocal: toHHMM(dt[3]),
  };

  // Component sits right after the time: "SMCK EBT6 D1" / "SMTR EBT6 D2".
  const afterTime = flat.slice((dt.index ?? 0) + dt[0].length);
  const comp = afterTime.match(/^\s*([A-Z]{2,6}\s+EBT\d*\s+D\d)/i);
  if (comp) entry.component = comp[1].replace(/\s+/g, " ").trim();

  // Course name + device family: "*A320 EBT Cycle6".
  const course = flat.match(/\*?\s*(A\d{3})\s+(EBT\s*Cycle\s*\d*)/i);
  if (course) {
    entry.deviceType = course[1].toUpperCase();
    entry.courseName = `${course[1].toUpperCase()} ${course[2]
      .replace(/\s+/g, " ")
      .trim()}`;
  }

  // Facility: text after the leading "Name:" up to a field label / crew id.
  const fac = block.match(
    /Name:\s*,?\s*([A-Za-z0-9][A-Za-z0-9 ]*?)(?:\s*(?:Location|Addresses|Phones)\s*:|\s+\d+\s*--|[\n,]|$)/
  );
  if (fac) entry.facility = fac[1].trim();

  // Instructor: first "id -- Name -- Instructor" (not "Instr under …").
  const instr = flat.match(/\d+\s*--\s*([^-]+?)\s*--\s*Instructor\b/);
  if (instr) entry.instructorName = instr[1].trim();

  return entry;
}

export function parseTrainingDetails(
  rawText: string
): Map<string, TrainingDetailEntry> {
  const map = new Map<string, TrainingDetailEntry>();
  if (!rawText) return map;

  const startIdx = rawText.search(/Training Details/i);
  if (startIdx === -1) return map;

  let section = rawText.slice(startIdx);
  const endIdx = section.search(/\bDescriptions\b/);
  if (endIdx !== -1) section = section.slice(0, endIdx);

  // Each entry starts with a facility "Name:" marker.
  const blocks = section.split(/(?=Name:)/).slice(1);
  for (const block of blocks) {
    const entry = parseBlock(block);
    if (entry) map.set(entry.date, entry);
  }
  return map;
}
