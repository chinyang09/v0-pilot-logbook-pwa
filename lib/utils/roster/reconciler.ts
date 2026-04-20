/**
 * Roster Reconciler
 *
 * Given parsed-and-normalized CSV sectors and the current set of flights in
 * IndexedDB, classify each into an operation:
 *
 *   - create          → CSV sector with no match; new flight to be inserted
 *   - skip_identical  → match found and all relevant fields already agree
 *   - update_conflict → match found, fields differ, flight looks unedited
 *   - edited_conflict → match found, fields differ, flight has user edits
 *                       (user must choose per-flight whether to overwrite)
 *   - delete_missing  → DB flight within CSV date range, matches airline
 *                       pattern (TR###), and has no matching sector in CSV
 *   - skip_non_airline → DB flight within CSV date range but flight number
 *                       doesn't match airline pattern — ignored silently
 *
 * The reconciler performs NO DB writes. It only classifies. The executor
 * applies the user-approved subset of operations.
 */

import type { FlightLog } from "../../../types/entities/flight.types";
import type { ScheduledCrewMember } from "@/types/entities/roster.types";

// ============================================================
// Public types
// ============================================================

export interface ParsedSector {
  /** UTC date of the OUT time in YYYY-MM-DD (post-normalization). */
  date: string;
  /** Flight number as written in CSV ("638" or "TR638"). */
  flightNumber: string;
  /** Aircraft type code (e.g., "32N", "32Q"). */
  aircraftType: string;
  departureIata: string;
  arrivalIata: string;
  /** UTC HH:MM. Present when CSV has scheduled times. */
  scheduledOut?: string;
  scheduledIn?: string;
  /** UTC HH:MM. Present when CSV row uses 'A' prefix (actuals). */
  actualOut?: string;
  actualIn?: string;
  /** Line number in source CSV — for error reporting. */
  sourceLine: number;
  /** Crew from the CSV row — CPT/PIC and FO. */
  crew?: ScheduledCrewMember[];
}

export interface FieldDiff {
  field: string;
  from: string;
  to: string;
}

export type ReconcilerOperation =
  | { kind: "create"; sector: ParsedSector }
  | { kind: "skip_identical"; flight: FlightLog; sector: ParsedSector }
  | {
      kind: "update_conflict";
      flight: FlightLog;
      sector: ParsedSector;
      changes: FieldDiff[];
    }
  | {
      kind: "edited_conflict";
      flight: FlightLog;
      sector: ParsedSector;
      changes: FieldDiff[];
      editReasons: EditReason[];
    }
  | {
      kind: "delete_missing";
      flight: FlightLog;
      reason: "missing_from_roster";
    }
  | { kind: "skip_non_airline"; flight: FlightLog };

export type EditReason =
  | "has_signature"
  | "user_modified_after_sync"
  | "has_remarks";

export interface ReconcileInput {
  sectors: ParsedSector[];
  existingFlights: FlightLog[];
  csvDateRange: { start: string; end: string };
}

// ============================================================
// Constants
// ============================================================

const AIRLINE_FLIGHT_NUMBER_RE = /^TR\d+$/i;
/**
 * How much clock skew between createdAt and updatedAt we tolerate before
 * calling a flight "edited". A freshly-inserted flight may get a near-instant
 * updatedAt bump from a downstream recompute; anything beyond this window
 * almost certainly represents a deliberate user action.
 */
const EDIT_DETECTION_BUFFER_MS = 60_000;

// ============================================================
// Matching helpers
// ============================================================

function normalizeFlightNumber(fn: string): string {
  return fn.replace(/\D/g, "");
}

function isAirlineFlight(flightNumber: string): boolean {
  return AIRLINE_FLIGHT_NUMBER_RE.test(flightNumber.trim());
}

function dateInRange(
  date: string,
  range: { start: string; end: string }
): boolean {
  return date >= range.start && date <= range.end;
}

/**
 * Find the best match for a parsed sector in the existing flights.
 * Primary: same date + same numeric flight number.
 * Fallback: same date + same route (dep/arr IATA).
 */
function findMatch(
  sector: ParsedSector,
  flights: FlightLog[]
): FlightLog | undefined {
  const csvNumeric = normalizeFlightNumber(sector.flightNumber);

  const byNumber = flights.find(
    (f) =>
      f.date === sector.date &&
      normalizeFlightNumber(f.flightNumber) === csvNumeric
  );
  if (byNumber) return byNumber;

  return flights.find(
    (f) =>
      f.date === sector.date &&
      f.departureIata === sector.departureIata &&
      f.arrivalIata === sector.arrivalIata
  );
}

// ============================================================
// Edit detection
// ============================================================

function detectEditReasons(flight: FlightLog): EditReason[] {
  const reasons: EditReason[] = [];

  if (flight.signature) {
    reasons.push("has_signature");
  }

  if (
    flight.lastSyncedAt &&
    flight.updatedAt &&
    flight.updatedAt - flight.lastSyncedAt > EDIT_DETECTION_BUFFER_MS
  ) {
    reasons.push("user_modified_after_sync");
  }

  // Freeform text that couldn't have come from the schedule CSV
  if (flight.remarks && !flight.remarks.startsWith("Draft from schedule:")) {
    reasons.push("has_remarks");
  }

  return reasons;
}

// ============================================================
// Field comparison
// ============================================================

function diffSectorVsFlight(
  sector: ParsedSector,
  flight: FlightLog
): FieldDiff[] {
  const changes: FieldDiff[] = [];

  const csvFullFlightNum = sector.flightNumber.startsWith("TR")
    ? sector.flightNumber
    : `TR${normalizeFlightNumber(sector.flightNumber)}`;

  if (
    normalizeFlightNumber(flight.flightNumber) !==
    normalizeFlightNumber(sector.flightNumber)
  ) {
    changes.push({
      field: "flightNumber",
      from: flight.flightNumber,
      to: csvFullFlightNum,
    });
  }

  if (sector.scheduledOut && sector.scheduledOut !== flight.scheduledOut) {
    changes.push({
      field: "scheduledOut",
      from: flight.scheduledOut || "",
      to: sector.scheduledOut,
    });
  }
  if (sector.scheduledIn && sector.scheduledIn !== flight.scheduledIn) {
    changes.push({
      field: "scheduledIn",
      from: flight.scheduledIn || "",
      to: sector.scheduledIn,
    });
  }

  // Actual times only flag a diff when the CSV has an 'A' value AND it
  // disagrees with what's stored. CSV-without-actuals vs DB-with-actuals is
  // the normal "future-roster vs flown" case and is not a conflict.
  if (sector.actualOut && sector.actualOut !== flight.outTime) {
    changes.push({
      field: "outTime",
      from: flight.outTime || "",
      to: sector.actualOut,
    });
  }
  if (sector.actualIn && sector.actualIn !== flight.inTime) {
    changes.push({
      field: "inTime",
      from: flight.inTime || "",
      to: sector.actualIn,
    });
  }

  if (
    sector.aircraftType &&
    sector.aircraftType !== flight.aircraftType &&
    flight.aircraftType
  ) {
    changes.push({
      field: "aircraftType",
      from: flight.aircraftType,
      to: sector.aircraftType,
    });
  }

  return changes;
}

// ============================================================
// Main entry point
// ============================================================

export function reconcileRoster(
  input: ReconcileInput
): ReconcilerOperation[] {
  const { sectors, existingFlights, csvDateRange } = input;
  const operations: ReconcilerOperation[] = [];
  const matchedFlightIds = new Set<string>();

  // Pass 1: classify each CSV sector
  for (const sector of sectors) {
    const match = findMatch(sector, existingFlights);

    if (!match) {
      operations.push({ kind: "create", sector });
      continue;
    }

    matchedFlightIds.add(match.id);

    const changes = diffSectorVsFlight(sector, match);
    if (changes.length === 0) {
      operations.push({ kind: "skip_identical", flight: match, sector });
      continue;
    }

    const editReasons = detectEditReasons(match);
    if (editReasons.length > 0) {
      operations.push({
        kind: "edited_conflict",
        flight: match,
        sector,
        changes,
        editReasons,
      });
    } else {
      operations.push({
        kind: "update_conflict",
        flight: match,
        sector,
        changes,
      });
    }
  }

  // Pass 2: find DB flights inside the CSV range that weren't matched
  for (const flight of existingFlights) {
    if (matchedFlightIds.has(flight.id)) continue;
    if (!dateInRange(flight.date, csvDateRange)) continue;

    if (isAirlineFlight(flight.flightNumber)) {
      operations.push({
        kind: "delete_missing",
        flight,
        reason: "missing_from_roster",
      });
    } else {
      operations.push({ kind: "skip_non_airline", flight });
    }
  }

  return operations;
}
