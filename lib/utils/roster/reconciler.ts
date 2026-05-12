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
  // Sun-position-derived suggestion for day/night TO/LDG classification.
  // Only populated when the parser computed a value that DIFFERS from the
  // PDF/CSV. The reconciler surfaces this in the diff note so the user
  // sees "logbook says day, sun says night — which is right?".
  suggestedDayTakeoffs?: number;
  suggestedNightTakeoffs?: number;
  suggestedDayLandings?: number;
  suggestedNightLandings?: number;
  /**
   * Pre-computed day/night context for the TO/LDG diff note. Carries the
   * out/in times in both UTC and local form plus the sun classification
   * at the dep + arr airports so the review modal can show the user WHY
   * the import value looks wrong (without each consumer having to redo
   * the airport + sun lookup itself).
   */
  toLdgContext?: {
    outUtc: string;
    inUtc: string;
    depLocal?: string;       // e.g. "15:24"
    depTzOffset?: number;    // e.g. 7  (UTC+7)
    depSunStatus?: "day" | "night";
    arrLocal?: string;
    arrTzOffset?: number;
    arrSunStatus?: "day" | "night";
  };
}

export interface FieldDiff {
  field: string;
  from: string;
  to: string;
  /**
   * Optional human-readable annotation rendered alongside the from→to
   * arrow in the review modal. Used to surface a sun-position-derived
   * suggestion next to a hand-entered TO/LDG value, etc.
   */
  note?: string;
}

/**
 * Remarks marker appended by the executor when the user has been asked
 * about (and made a decision on) TO/LDG values for a flight. The
 * reconciler treats this as "user already decided; do not re-flag" so
 * subsequent imports don't keep raising the same diff.
 */
export const TOLDG_DECISION_MARKER = "[TO/LDG decision recorded]";

function hasToLdgDecisionMarker(flight: FlightLog): boolean {
  return (flight.remarks || "").includes(TOLDG_DECISION_MARKER);
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
  //
  // When the user has already decided on TO/LDG values for this flight in a
  // previous import (marked in remarks by the executor), we skip these
  // diffs entirely so the same imported row doesn't keep raising the same
  // question every time. The user can still edit the flight manually.
  const skipToLdg = hasToLdgDecisionMarker(flight);
  const numericPairs: Array<
    [keyof FlightLog, keyof ParsedSector, keyof ParsedSector | undefined]
  > = [
    ["dayTakeoffs", "dayTakeoffs", "suggestedDayTakeoffs"],
    ["nightTakeoffs", "nightTakeoffs", "suggestedNightTakeoffs"],
    ["dayLandings", "dayLandings", "suggestedDayLandings"],
    ["nightLandings", "nightLandings", "suggestedNightLandings"],
  ];
  if (!skipToLdg) {
    const ctx = sector.toLdgContext;
    const fmtCtx = ctx
      ? (() => {
          const dep = ctx.depLocal
            ? `${ctx.outUtc}Z / ${ctx.depLocal} local (UTC${ctx.depTzOffset! >= 0 ? "+" : ""}${ctx.depTzOffset})`
            : `${ctx.outUtc}Z`;
          const arr = ctx.arrLocal
            ? `${ctx.inUtc}Z / ${ctx.arrLocal} local (UTC${ctx.arrTzOffset! >= 0 ? "+" : ""}${ctx.arrTzOffset})`
            : `${ctx.inUtc}Z`;
          return {
            takeoff: `OUT ${dep} → sun says ${ctx.depSunStatus ?? "?"} at ${sector.departureIata}`,
            landing: `IN  ${arr} → sun says ${ctx.arrSunStatus ?? "?"} at ${sector.arrivalIata}`,
          };
        })()
      : null;

    for (const [flightField, sectorField, suggestedField] of numericPairs) {
      const incoming = sector[sectorField] as number | undefined;
      if (incoming === undefined) continue;
      const existing = (flight[flightField] as number | undefined) ?? 0;
      if (incoming !== existing) {
        const suggested =
          suggestedField !== undefined
            ? (sector[suggestedField] as number | undefined)
            : undefined;
        const change: FieldDiff = {
          field: flightField as string,
          from: String(existing),
          to: String(incoming),
        };
        // When the sun-position calc disagrees with the logbook value, tell
        // the user — the captain hand-fills this column in eCrew and it's
        // the most common manual-entry mistake we see. We include the
        // out/in times in both UTC and local form plus the sun status at
        // dep and arr so the user can verify without leaving the modal.
        if (fmtCtx) {
          const isTakeoffField =
            flightField === "dayTakeoffs" || flightField === "nightTakeoffs";
          const sideLine = isTakeoffField ? fmtCtx.takeoff : fmtCtx.landing;
          const suggestion =
            suggested !== undefined && suggested !== incoming
              ? `Sun-position calc suggests ${suggested}.`
              : null;
          change.note = suggestion ? `${suggestion} ${sideLine}` : sideLine;
        } else if (suggested !== undefined && suggested !== incoming) {
          change.note = `Sun-position calc suggests ${suggested} for this field.`;
        }
        changes.push(change);
      }
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

  // PIC name + id treatment for the logbook → schedule handshake.
  //
  // The Crew Logbook Report truncates names to 20 chars, while the Schedule
  // Report has the full form. If a re-import resolves a row's PIC against
  // an existing-flight value where the existing is the FULLER form
  // ("Siah Yang Tek, Timothy" vs the logbook's "Siah Yang Tek, Timot"),
  // treat them as the same person and skip the diff. Otherwise we'd
  // downgrade the flight's nicely-resolved full name back to the truncated
  // form on every logbook re-import, and along with it create a duplicate
  // Personnel row.
  const incomingPicName = sector.picResolvedName || "";
  const existingPicName = flight.picName || "";
  const incomingNorm = incomingPicName
    ? incomingPicName.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
  const existingNorm = existingPicName
    ? existingPicName.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";

  const sameNormalizedPerson =
    incomingNorm.length > 0 &&
    existingNorm.length > 0 &&
    (incomingNorm === existingNorm ||
      // Existing is a fuller form of incoming (logbook truncation).
      (existingNorm.length > incomingNorm.length &&
        existingNorm.startsWith(incomingNorm)) ||
      // Incoming is a fuller form of existing (legacy truncated row, schedule
      // came along with the long form).
      (incomingNorm.length > existingNorm.length &&
        incomingNorm.startsWith(existingNorm)));

  if (
    incomingPicName &&
    incomingPicName !== existingPicName &&
    !sameNormalizedPerson
  ) {
    changes.push({
      field: "picName",
      from: existingPicName,
      to: incomingPicName,
    });
  } else if (
    incomingPicName &&
    incomingPicName.length > existingPicName.length &&
    sameNormalizedPerson
  ) {
    // Allow upgrade-only (truncated → full), never downgrade.
    changes.push({
      field: "picName",
      from: existingPicName,
      to: incomingPicName,
    });
  }

  if (
    sector.picPersonnelId &&
    sector.picPersonnelId !== flight.picId &&
    sector.picPersonnelId.length > 0 &&
    !sameNormalizedPerson
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
