/**
 * Roster Reconciler
 *
 * Given parsed-and-normalized CSV/PDF sectors and the current set of flights
 * in IndexedDB, classify each into an operation:
 *
 *   - create            → no DB match; insert
 *   - skip_identical    → match found, all relevant fields already agree
 *   - skip_stale_report → existing flight was imported from a NEWER report
 *                         than this one — refuse to overwrite
 *   - update_safe       → match found, only safe-bucket fields differ OR
 *                         it's a future flight (auto-applied)
 *   - update_consult    → match found, ≥1 critical-bucket field differs and
 *                         the flight is a past flight without edits
 *                         (user opts in per-row in the review modal)
 *   - edited_conflict   → match found, fields differ, flight has user edits
 *                         (signature / remarks / manual overrides)
 *   - delete_missing    → DB flight inside report range with no match
 *   - skip_non_airline  → DB flight inside range but not a TR-prefixed flight
 *
 *   - update_conflict   → DEPRECATED alias kept for the existing modal/tests
 *                         until the v2 UI ships. Behaves identically to
 *                         update_consult.
 *
 * The reconciler performs NO DB writes. It only classifies. The executor
 * applies the user-approved subset.
 */

import type { FlightLog } from "../../../types/entities/flight.types";
import type { ScheduledCrewMember } from "@/types/entities/roster.types";
import { classifyChanges } from "./classification";

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

  // ------------------------------------------------------------
  // Optional fields populated by the logbook parser / cross-hydration.
  // The executor reads these when present; the schedule-only path leaves
  // them undefined and the executor falls back to the original behavior.
  // ------------------------------------------------------------
  aircraftReg?: string;
  dayTakeoffs?: number;
  nightTakeoffs?: number;
  dayLandings?: number;
  nightLandings?: number;
  blockTime?: string;
  picRawName?: string;
  isUserPic?: boolean;
  picPersonnelId?: string;
  picResolvedName?: string;
  /** Logbook-derived: true when user logged any TO or LDG for this leg. */
  isPilotFlying?: boolean;
  remarks?: string;
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
      kind: "skip_stale_report";
      flight: FlightLog;
      sector: ParsedSector;
      existingGeneratedAt: number;
      reportGeneratedAt: number;
    }
  | {
      kind: "update_safe";
      flight: FlightLog;
      sector: ParsedSector;
      changes: FieldDiff[];
    }
  | {
      kind: "update_consult";
      flight: FlightLog;
      sector: ParsedSector;
      changes: FieldDiff[];
    }
  /**
   * @deprecated kept for the legacy review modal — same semantics as
   *             update_consult. New code should prefer update_consult.
   */
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
  | "has_remarks"
  | "has_manual_overrides";

export interface ReconcileInput {
  sectors: ParsedSector[];
  existingFlights: FlightLog[];
  csvDateRange: { start: string; end: string };
  /**
   * "Generated on..." footer of the report being imported (epoch ms).
   * When provided, the reconciler refuses to update flights whose
   * `reportGeneratedAt` is strictly newer.
   */
  reportGeneratedAt?: number | null;
  /**
   * Today's UTC date in YYYY-MM-DD. Defaulted from `new Date()`. Exposed
   * for tests so they can pin "today".
   */
  todayUtc?: string;
  /**
   * Use legacy `update_conflict` op kind instead of the new
   * `update_safe` / `update_consult` split. Defaults to `true` so existing
   * callers (schedule import handler, v1 review modal, existing tests) keep
   * working without modification. The unified import flow explicitly sets
   * this to `false`.
   */
  useLegacyUpdateConflict?: boolean;
}

// ============================================================
// Constants
// ============================================================

const AIRLINE_FLIGHT_NUMBER_RE = /^TR\d+$/i;
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
 *
 * Order, strongest → weakest:
 *   1. Date + flight number (when both sides have it).
 *   2. Date + departure + arrival IATA (full route).
 *   3. Date + arrival + aircraftReg — covers cases where the existing
 *      flight has a stale departure airport (e.g. XSP vs SIN); arrival is
 *      the disambiguator for a turnaround.
 *   4. Date + departure + aircraftReg — same idea for arrival drift.
 *
 * Importantly, we never fall back to `date + aircraftReg` alone: a same-day
 * turnaround uses one airframe for two legs, so that match would put
 * Leg 1's data onto Leg 2's flight (the bug behind the user's "wrong leg
 * picked for amendment" report).
 */
function findMatch(
  sector: ParsedSector,
  flights: FlightLog[]
): FlightLog | undefined {
  const csvNumeric = normalizeFlightNumber(sector.flightNumber || "");

  if (csvNumeric) {
    const byNumber = flights.find(
      (f) =>
        f.date === sector.date &&
        normalizeFlightNumber(f.flightNumber) === csvNumeric
    );
    if (byNumber) return byNumber;
  }

  const byRoute = flights.find(
    (f) =>
      f.date === sector.date &&
      f.departureIata === sector.departureIata &&
      f.arrivalIata === sector.arrivalIata
  );
  if (byRoute) return byRoute;

  if (sector.aircraftReg) {
    const regUpper = sector.aircraftReg.toUpperCase();

    // (3) Same date + arrival + aircraft → handles legacy rows whose
    // `departureIata` was stored wrong (e.g. "XSP" instead of "SIN").
    if (sector.arrivalIata) {
      const byArrAndReg = flights.find(
        (f) =>
          f.date === sector.date &&
          f.arrivalIata === sector.arrivalIata &&
          (f.aircraftReg || "").toUpperCase() === regUpper
      );
      if (byArrAndReg) return byArrAndReg;
    }

    // (4) Same date + departure + aircraft → covers arrival drift.
    if (sector.departureIata) {
      const byDepAndReg = flights.find(
        (f) =>
          f.date === sector.date &&
          f.departureIata === sector.departureIata &&
          (f.aircraftReg || "").toUpperCase() === regUpper
      );
      if (byDepAndReg) return byDepAndReg;
    }
  }

  return undefined;
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

  if (flight.remarks && !flight.remarks.startsWith("Draft from schedule:")) {
    reasons.push("has_remarks");
  }

  if (
    flight.manualOverrides &&
    Object.keys(flight.manualOverrides).length > 0 &&
    Object.values(flight.manualOverrides).some(Boolean)
  ) {
    reasons.push("has_manual_overrides");
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

  const csvFullFlightNum =
    sector.flightNumber && sector.flightNumber.startsWith("TR")
      ? sector.flightNumber
      : sector.flightNumber
        ? `TR${normalizeFlightNumber(sector.flightNumber)}`
        : "";

  if (
    csvFullFlightNum &&
    normalizeFlightNumber(flight.flightNumber) !==
      normalizeFlightNumber(sector.flightNumber || "")
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

  if (
    sector.aircraftReg &&
    sector.aircraftReg.toUpperCase() !== (flight.aircraftReg || "").toUpperCase()
  ) {
    changes.push({
      field: "aircraftReg",
      from: flight.aircraftReg || "",
      to: sector.aircraftReg.toUpperCase(),
    });
  }

  if (
    sector.departureIata &&
    sector.departureIata !== flight.departureIata
  ) {
    changes.push({
      field: "departureIata",
      from: flight.departureIata || "",
      to: sector.departureIata,
    });
  }

  if (
    sector.arrivalIata &&
    sector.arrivalIata !== flight.arrivalIata
  ) {
    changes.push({
      field: "arrivalIata",
      from: flight.arrivalIata || "",
      to: sector.arrivalIata,
    });
  }

  if (
    sector.isPilotFlying !== undefined &&
    sector.isPilotFlying !== flight.pilotFlying
  ) {
    changes.push({
      field: "pilotFlying",
      from: String(flight.pilotFlying ?? true),
      to: String(sector.isPilotFlying),
    });
  }

  // Logbook fields — only flag when sector carries a non-zero value AND the
  // existing flight differs.
  const numericPairs: Array<
    [keyof FlightLog, keyof ParsedSector]
  > = [
    ["dayTakeoffs", "dayTakeoffs"],
    ["nightTakeoffs", "nightTakeoffs"],
    ["dayLandings", "dayLandings"],
    ["nightLandings", "nightLandings"],
  ];
  for (const [flightField, sectorField] of numericPairs) {
    const incoming = sector[sectorField] as number | undefined;
    if (incoming === undefined) continue;
    const existing = (flight[flightField] as number | undefined) ?? 0;
    if (incoming !== existing) {
      changes.push({
        field: flightField as string,
        from: String(existing),
        to: String(incoming),
      });
    }
  }

  if (
    sector.blockTime &&
    sector.blockTime !== "00:00" &&
    sector.blockTime !== flight.blockTime
  ) {
    changes.push({
      field: "blockTime",
      from: flight.blockTime || "",
      to: sector.blockTime,
    });
  }

  if (
    sector.picResolvedName &&
    sector.picResolvedName !== flight.picName &&
    sector.picResolvedName.length > 0
  ) {
    changes.push({
      field: "picName",
      from: flight.picName || "",
      to: sector.picResolvedName,
    });
  }

  if (
    sector.picPersonnelId &&
    sector.picPersonnelId !== flight.picId &&
    sector.picPersonnelId.length > 0
  ) {
    changes.push({
      field: "picId",
      from: flight.picId || "",
      to: sector.picPersonnelId,
    });
  }

  return changes;
}

// ============================================================
// Today helper
// ============================================================

function todayUtcDate(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

// ============================================================
// Main entry point
// ============================================================

export function reconcileRoster(
  input: ReconcileInput
): ReconcilerOperation[] {
  const {
    sectors,
    existingFlights,
    csvDateRange,
    reportGeneratedAt,
    useLegacyUpdateConflict = true,
  } = input;
  const todayUtc = input.todayUtc || todayUtcDate();
  const operations: ReconcilerOperation[] = [];
  const matchedFlightIds = new Set<string>();

  for (const sector of sectors) {
    const match = findMatch(sector, existingFlights);

    if (!match) {
      operations.push({ kind: "create", sector });
      continue;
    }

    matchedFlightIds.add(match.id);

    // Stale-report gate: if the existing flight came from a NEWER report,
    // refuse to update it. New flights (no match) always go through.
    if (
      reportGeneratedAt &&
      match.reportGeneratedAt &&
      match.reportGeneratedAt > reportGeneratedAt
    ) {
      operations.push({
        kind: "skip_stale_report",
        flight: match,
        sector,
        existingGeneratedAt: match.reportGeneratedAt,
        reportGeneratedAt,
      });
      continue;
    }

    const changes = diffSectorVsFlight(sector, match);
    if (changes.length === 0) {
      operations.push({ kind: "skip_identical", flight: match, sector });
      continue;
    }

    const editReasons = detectEditReasons(match);

    if (useLegacyUpdateConflict) {
      // Legacy two-bucket mode used by the existing schedule import handler
      // until the v2 UI ships.
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
      continue;
    }

    const classification = classifyChanges(match, changes, editReasons, todayUtc);
    switch (classification) {
      case "edited_conflict":
        operations.push({
          kind: "edited_conflict",
          flight: match,
          sector,
          changes,
          editReasons,
        });
        break;
      case "update_consult":
        operations.push({
          kind: "update_consult",
          flight: match,
          sector,
          changes,
        });
        break;
      case "update_safe":
      default:
        operations.push({
          kind: "update_safe",
          flight: match,
          sector,
          changes,
        });
        break;
    }
  }

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
