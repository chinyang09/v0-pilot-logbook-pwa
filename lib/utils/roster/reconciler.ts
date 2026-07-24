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
  /**
   * Optional ICAO codes resolved during sector normalization. The schedule
   * parser populates these from the airport DB lookup it already does for
   * timezone resolution, so the review modal can render airport codes
   * according to the user's display preference (ICAO / IATA / both).
   */
  departureIcao?: string;
  arrivalIcao?: string;
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
    /** UTC HH:MM of civil twilight crossings at the dep airport on `date`. */
    depSunriseUtc?: string | null;
    depSunsetUtc?: string | null;
    arrLocal?: string;
    arrTzOffset?: number;
    arrSunStatus?: "day" | "night";
    arrSunriseUtc?: string | null;
    arrSunsetUtc?: string | null;
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

function formatSunBounds(
  sunriseUtc: string | null | undefined,
  sunsetUtc: string | null | undefined
): string {
  if (!sunriseUtc && !sunsetUtc) return "";
  const parts: string[] = [];
  if (sunriseUtc) parts.push(`sunrise ${sunriseUtc}Z`);
  if (sunsetUtc) parts.push(`sunset ${sunsetUtc}Z`);
  return `(${parts.join(", ")})`;
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
   * Logged-in user — used to resolve "Self" crew seats and to diff the
   * FULL crew (PIC + SIC) on updates, not just the logbook-derived PIC.
   * When omitted, crew diffing falls back to the logbook-resolved PIC only
   * (the legacy behavior the reconciler unit tests exercise).
   */
  currentUser?: CurrentUserCrew;
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
// Crew assignment (shared between create-hydration and update-diff)
// ============================================================

/** Minimal current-user shape needed to resolve "Self" crew seats. */
export interface CurrentUserCrew {
  id: string;
  crewId?: string;
}

export interface SectorCrewAssignment {
  picId: string;
  picName: string;
  sicId: string;
  sicName: string;
  /** True when the logged-in user is the captain on this sector. */
  isSelfCPT: boolean;
  /** True when the logged-in user is the first officer on this sector. */
  isSelfFO: boolean;
}

/**
 * Resolve the PIC + SIC seats for a sector against the current user.
 *
 * This is the SINGLE source of truth for how a parsed sector's crew maps
 * onto a FlightLog's picId/picName/sicId/sicName. Both the executor
 * (create hydration) and the reconciler (update diff) call it so a freshly
 * created flight and a re-imported update resolve crew identically — that
 * idempotency is what stops the "crew only sticks if I delete the flight
 * first" bug (schedule re-imports never diffed SIC / non-PIC crew before).
 *
 * Schedule sectors carry `crew` (CPT/FO with full names + crewIds);
 * logbook-only sectors carry `picResolvedName` / `picPersonnelId` /
 * `isUserPic`. Either shape resolves here.
 */
export function deriveSectorCrew(
  sector: ParsedSector,
  currentUser: CurrentUserCrew
): SectorCrewAssignment {
  const captain = sector.crew?.find((c) => c.role === "CPT" || c.role === "PIC");
  const fo = sector.crew?.find((c) => c.role === "FO");
  const isSelfCPT = Boolean(
    captain && currentUser.crewId && captain.crewId === currentUser.crewId
  );
  const isSelfFO = Boolean(
    fo && currentUser.crewId && fo.crewId === currentUser.crewId
  );

  let picId = captain?.personnelId || sector.picPersonnelId || "";
  let picName = captain?.name || sector.picResolvedName || "";
  let sicId = fo?.personnelId || "";
  let sicName = fo?.name || "";

  if (isSelfCPT) {
    picId = currentUser.id;
    picName = "Self";
  } else if (sector.isUserPic && !captain) {
    // Logbook-only sector where we know the user is PIC.
    picId = currentUser.id;
    picName = "Self";
  }
  if (isSelfFO) {
    sicId = currentUser.id;
    sicName = "Self";
  } else if (sector.isUserPic === false && !fo) {
    // Logbook says someone else was PIC — the current user is SIC.
    sicId = currentUser.id;
    sicName = "Self";
  }

  return { picId, picName, sicId, sicName, isSelfCPT, isSelfFO };
}

/** Alphanumeric-only lowercase form for tolerant crew-name comparison. */
function normPersonName(s: string): string {
  return s ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

/**
 * Two crew names refer to the same person when their normalized forms are
 * equal OR one is a prefix of the other (the Crew Logbook Report truncates
 * names to 20 chars; the Schedule Report carries the full form).
 */
function isSamePersonName(a: string, b: string): boolean {
  const na = normPersonName(a);
  const nb = normPersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > nb.length && na.startsWith(nb)) return true;
  if (nb.length > na.length && nb.startsWith(na)) return true;
  return false;
}

/**
 * Diff one crew seat (name + id). Emits an upgrade-only, never-downgrade
 * change:
 *   - different person (or existing seat empty) → replace name + id
 *   - same person, incoming is the fuller (un-truncated) form → upgrade
 *   - same person, incoming shorter/equal → keep existing (no downgrade)
 * The id is only rewritten when the name is rewritten, so a truncated
 * re-import never re-points a flight at a stale/duplicate Personnel row.
 */
function diffCrewSeat(
  nameField: keyof FlightLog,
  idField: keyof FlightLog,
  existingName: string,
  existingId: string,
  incomingName: string,
  incomingId: string,
  changes: FieldDiff[]
): void {
  if (!incomingName) return;
  if (incomingName === existingName) return;

  const same = isSamePersonName(incomingName, existingName);
  let nameChanged = false;

  if (!same) {
    changes.push({ field: nameField as string, from: existingName, to: incomingName });
    nameChanged = true;
  } else if (incomingName.length > existingName.length) {
    changes.push({ field: nameField as string, from: existingName, to: incomingName });
    nameChanged = true;
  }

  if (nameChanged && incomingId && incomingId !== existingId) {
    changes.push({ field: idField as string, from: existingId, to: incomingId });
  }
}

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
  flight: FlightLog,
  currentUser?: CurrentUserCrew
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
          const depBounds = formatSunBounds(
            ctx.depSunriseUtc,
            ctx.depSunsetUtc
          );
          const arrBounds = formatSunBounds(
            ctx.arrSunriseUtc,
            ctx.arrSunsetUtc
          );
          return {
            takeoff:
              `OUT ${dep} → sun says ${ctx.depSunStatus ?? "?"} at ` +
              `${sector.departureIata}${depBounds ? ` ${depBounds}` : ""}`,
            landing:
              `IN  ${arr} → sun says ${ctx.arrSunStatus ?? "?"} at ` +
              `${sector.arrivalIata}${arrBounds ? ` ${arrBounds}` : ""}`,
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

  // Crew (PIC + SIC) — the logbook→schedule truncation handshake.
  //
  // The Crew Logbook Report truncates names to 20 chars, while the Schedule
  // Report carries the full form. `deriveSectorCrew` resolves both the
  // captain and first-officer seats identically to the create path, so a
  // schedule re-import now UPDATES crew on an existing flight (previously
  // only PIC was ever diffed, so SIC / cabin never stuck unless the user
  // deleted the flight and let it re-create). `diffCrewSeat` upgrades a
  // truncated name to the full form but never downgrades, and never
  // re-points the id unless the name itself changed.
  const incomingCrew = currentUser
    ? deriveSectorCrew(sector, currentUser)
    : {
        // Legacy path (no current user): logbook-resolved PIC only.
        picId: sector.picPersonnelId || "",
        picName: sector.picResolvedName || "",
        sicId: "",
        sicName: "",
      };

  diffCrewSeat(
    "picName",
    "picId",
    flight.picName || "",
    flight.picId || "",
    incomingCrew.picName || "",
    incomingCrew.picId || "",
    changes
  );
  diffCrewSeat(
    "sicName",
    "sicId",
    flight.sicName || "",
    flight.sicId || "",
    incomingCrew.sicName || "",
    incomingCrew.sicId || "",
    changes
  );

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
    currentUser,
  } = input;
  const todayUtc = input.todayUtc || todayUtcDate();
  const operations: ReconcilerOperation[] = [];
  const matchedFlightIds = new Set<string>();

  for (const sector of sectors) {
    // Exclude flights already claimed by an earlier sector so two same-route
    // legs on one day (e.g. SIN→BKK twice) each bind to a distinct flight
    // instead of both matching — then clobbering — the first one.
    const match = findMatch(
      sector,
      existingFlights.filter((f) => !matchedFlightIds.has(f.id))
    );

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

    const changes = diffSectorVsFlight(sector, match, currentUser);
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
