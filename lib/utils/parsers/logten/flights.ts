/**
 * LogTen Pro "Flights" tab export → `FlightLog`.
 *
 * The export is ~280 columns of `flight_*`, `aircraft_*` and `aircraftType_*`
 * property names, most of them empty for any given pilot. The mapping that
 * matters:
 *
 *   flight_actualDepartureTime  → outTime      ┐ the four OOOI times, which
 *   flight_takeoffTime          → offTime      │ LogTen keeps in four separate
 *   flight_landingTime          → onTime       │ columns exactly the way the
 *   flight_actualArrivalTime    → inTime       ┘ app does
 *   flight_scheduledDeparture/ArrivalTime → scheduledOut / scheduledIn
 *   flight_totalTime            → blockTime    (out→in)
 *   flight_duration             → flightTime   (off→on)
 *   flight_pic/sic/p1us/dualReceived/dualGiven → the role times
 *   flight_night/crossCountry/actualInstrument/simulatedInstrument/ifr
 *   flight_day|nightTakeoffs|Landings, autolands, holds
 *   flight_selectedApproach1-10 → approaches[] ("1;ILS;20R;WSSS")
 *   flight_selectedCrewPIC/SIC  → picName / sicName, resolved to Personnel
 *   aircraft_aircraftID         → aircraftReg
 *   aircraftType_type           → aircraftType (via the ICAO type map)
 *
 * Three decisions worth stating:
 *
 * **The pilot's own numbers are kept, not recomputed.** Everything LogTen
 * actually populated is written with a matching `manualOverrides` flag, so
 * `recalculateFlightFields` fills in only what the file left blank. The file
 * IS the pilot's existing legal record; recomputing night time from sun
 * position would quietly restate totals they have already certified. Blanks —
 * and this export leaves `flight_night` blank on every row — are computed as
 * normal.
 *
 * **A simulator is recognised structurally**, the same rule the rest of the
 * app uses: no aircraft registration and no route. LogTen's own `flight_type`
 * is an unlabelled enum index and `flight_simulator` is blank on the sim row
 * in the real export, so neither is safe to key on. Sim duration goes to
 * `simulatedInstrumentTime` with `blockTime` left at 00:00, or the session
 * lands in flight-hour totals.
 *
 * **The flight number is taken verbatim.** The eCrew reconciler rewrites
 * numbers into the `TR…` house style because it is reconciling against one
 * airline's roster; a migration carries a whole career, which may include
 * several carriers and none.
 */

import type {
  AdditionalCrew,
  Approach,
  FlightLog,
  FlightLogCreate,
  ManualOverrides,
  PilotRole,
} from "@/types/entities/flight.types";
import type { Personnel } from "@/types/entities/crew.types";
import type { Airport } from "@/types/entities/airport.types";
import { entryTypePatch } from "@/lib/utils/entry-type";
import { normalizeRegistration } from "@/lib/utils/string";
import { normalizeAircraftType } from "../shared/aircraft-type-map";
import { resolveCrewByName } from "../shared/crew-resolver";
import { normalize } from "../shared/name-normalize";
import { bindRows, type LogtenRow } from "./header-map";
import {
  hasTime,
  text,
  toBool,
  toClock,
  toDuration,
  toInt,
  toIsoDate,
  upper,
  type DateOrder,
} from "./values";
import {
  detectTimeReference,
  localToUtc,
  wrappedSpan,
  type TimeReferenceSample,
} from "./time-reference";
import type {
  LogtenFlightOperation,
  LogtenFlightPlan,
  LogtenParseOptions,
} from "./types";
import type { NormalizedDocument } from "../types";

// ============================================================
// Column groups
// ============================================================

/** Crew columns that are neither PIC nor SIC, and the role each maps to. */
const EXTRA_CREW_COLUMNS: Array<{
  aliases: string[];
  role: AdditionalCrew["role"];
}> = [
  { aliases: ["flight_selectedCrewInstructor"], role: "Instructor" },
  { aliases: ["flight_selectedCrewStudent"], role: "Other" },
  { aliases: ["flight_selectedCrewObserver"], role: "Observer" },
  { aliases: ["flight_selectedCrewObserver2"], role: "Observer" },
  { aliases: ["flight_selectedCrewCommander"], role: "Check Airman" },
  { aliases: ["flight_selectedCrewRelief"], role: "Other" },
  { aliases: ["flight_selectedCrewRelief2"], role: "Other" },
  { aliases: ["flight_selectedCrewRelief3"], role: "Other" },
  { aliases: ["flight_selectedCrewRelief4"], role: "Other" },
  { aliases: ["flight_selectedCrewFlightEngineer"], role: "Other" },
];

const APPROACH_COLUMNS = Array.from(
  { length: 10 },
  (_, i) => `flight_selectedApproach${i + 1}`
);

/** LogTen approach type strings → the app's `Approach["type"]` union. */
const APPROACH_TYPES: Array<{ match: RegExp; type: Approach["type"] }> = [
  { match: /^ILS|CAT\s*I{1,3}|GLS|PAR/i, type: "ILS" },
  { match: /^LOC\s*BC|^LOC/i, type: "LOC" },
  { match: /^LDA/i, type: "LDA" },
  { match: /^SDF/i, type: "SDF" },
  { match: /^(RNAV|RNP|LPV|LNAV|VNAV)/i, type: "RNAV" },
  { match: /^GPS/i, type: "GPS" },
  { match: /^VOR/i, type: "VOR" },
  { match: /^NDB/i, type: "NDB" },
  { match: /^(VISUAL|VIS|CIRCL)/i, type: "VISUAL" },
];

/** Precision approaches, for `Approach["category"]`. */
const PRECISION = /^(ILS|GLS|PAR|CAT)/i;

// ============================================================
// Row → raw shape
// ============================================================

interface RawFlight {
  date: string;
  flightNumber: string;
  from: string;
  to: string;
  scheduledOut: string;
  scheduledIn: string;
  out: string;
  off: string;
  on: string;
  in: string;
  blockTime: string;
  flightTime: string;
  nightTime: string;
  crossCountryTime: string;
  actualInstrumentTime: string;
  simulatedInstrumentTime: string;
  simulatorTime: string;
  ifrTime: string;
  picTime: string;
  sicTime: string;
  picusTime: string;
  dualTime: string;
  instructorTime: string;
  dayTakeoffs: number;
  dayLandings: number;
  nightTakeoffs: number;
  nightLandings: number;
  hasToLdgColumns: boolean;
  autolands: number;
  holds: number;
  approaches: Approach[];
  remarks: string;
  picName: string;
  sicName: string;
  extraCrew: Array<{ name: string; role: AdditionalCrew["role"] }>;
  aircraftReg: string;
  aircraftType: string;
  isPF: boolean | null;
  isPicCapacity: boolean;
  isSicCapacity: boolean;
  isPicusCapacity: boolean;
  ipcIcc: boolean;
  sourceLine: number;
}

function readRow(row: LogtenRow, dateOrder: DateOrder): RawFlight {
  const approaches: Approach[] = [];
  for (const column of APPROACH_COLUMNS) {
    const cell = row.get(column);
    if (cell) approaches.push(...parseApproachCell(cell));
  }

  const extraCrew: Array<{ name: string; role: AdditionalCrew["role"] }> = [];
  for (const { aliases, role } of EXTRA_CREW_COLUMNS) {
    const name = row.get(...aliases);
    if (name) extraCrew.push({ name, role });
  }

  return {
    date: toIsoDate(row.get("flight_flightDate", "Date", "Flight Date"), dateOrder),
    flightNumber: upper(row.get("flight_flightNumber", "Flight Number")),
    from: upper(row.get("flight_from", "From", "Departure")),
    to: upper(row.get("flight_to", "To", "Destination")),

    scheduledOut: toClock(row.get("flight_scheduledDepartureTime")),
    scheduledIn: toClock(row.get("flight_scheduledArrivalTime")),
    out: toClock(row.get("flight_actualDepartureTime", "Out")),
    off: toClock(row.get("flight_takeoffTime", "Off")),
    on: toClock(row.get("flight_landingTime", "On")),
    in: toClock(row.get("flight_actualArrivalTime", "In")),

    blockTime: toDuration(row.get("flight_totalTime", "Total Time")),
    flightTime: toDuration(row.get("flight_duration")),
    nightTime: toDuration(row.get("flight_night", "Night")),
    crossCountryTime: toDuration(row.get("flight_crossCountry")),
    actualInstrumentTime: toDuration(row.get("flight_actualInstrument")),
    simulatedInstrumentTime: toDuration(row.get("flight_simulatedInstrument")),
    simulatorTime: toDuration(row.get("flight_simulator")),
    ifrTime: toDuration(row.get("flight_ifr")),

    picTime: toDuration(row.get("flight_pic")),
    sicTime: toDuration(row.get("flight_sic")),
    picusTime: toDuration(row.get("flight_p1us")),
    dualTime: toDuration(row.get("flight_dualReceived")),
    instructorTime: toDuration(row.get("flight_dualGiven")),

    dayTakeoffs: toInt(row.get("flight_dayTakeoffs")),
    dayLandings: toInt(row.get("flight_dayLandings")),
    nightTakeoffs: toInt(row.get("flight_nightTakeoffs")),
    nightLandings: toInt(row.get("flight_nightLandings")),
    hasToLdgColumns: row.has(
      "flight_dayTakeoffs",
      "flight_dayLandings",
      "flight_nightTakeoffs",
      "flight_nightLandings"
    ),
    autolands: toInt(row.get("flight_autolands")),
    holds: toInt(row.get("flight_holds")),
    approaches,

    remarks: row.get("flight_remarks", "Remarks"),
    picName: row.get("flight_selectedCrewPIC"),
    sicName: row.get("flight_selectedCrewSIC"),
    extraCrew,

    aircraftReg: upper(row.get("aircraft_aircraftID", "Aircraft ID")),
    aircraftType: normalizeAircraftType(row.get("aircraftType_type", "Type")),

    isPF: row.has("flight_pilotFlyingCapacity")
      ? toBool(row.get("flight_pilotFlyingCapacity"))
      : null,
    isPicCapacity: toBool(row.get("flight_picCapacity")),
    isSicCapacity: toBool(row.get("flight_sicCapacity")),
    isPicusCapacity: toBool(row.get("flight_underSupervisionCapacity")),
    ipcIcc: toBool(row.get("flight_instrumentProficiencyCheck")),
    sourceLine: row.sourceLine,
  };
}

/**
 * `"1;ILS;20R;WSSS"` → one Approach per count.
 *
 * LogTen packs count, type, runway and airport into one semicolon-delimited
 * cell, and repeats an approach by raising the count rather than adding a
 * column — so "2;ILS;20R;WSSS" is two ILS approaches, not one flown twice.
 * A cell may hold several approaches separated by a newline or a comma.
 */
export function parseApproachCell(cell: string): Approach[] {
  const out: Approach[] = [];
  for (const chunk of text(cell).split(/[\n,]/)) {
    const parts = chunk.split(";").map((p) => text(p));
    if (parts.length === 0 || !parts.some(Boolean)) continue;

    // The count is optional and only ever leads.
    let index = 0;
    let count = 1;
    if (/^\d+$/.test(parts[0])) {
      count = Math.min(Math.max(parseInt(parts[0], 10), 1), 20);
      index = 1;
    }
    const typeText = parts[index] || "";
    if (!typeText) continue;

    const matched = APPROACH_TYPES.find((t) => t.match.test(typeText));
    const runway = parts[index + 1] || "";
    const airport = upper(parts[index + 2] || "");

    for (let n = 0; n < count; n++) {
      out.push({
        id: crypto.randomUUID(),
        type: matched?.type ?? "OTHER",
        category: PRECISION.test(typeText) ? "precision" : "non-precision",
        ...(runway ? { runway } : {}),
        ...(airport ? { airport } : {}),
      });
    }
  }
  return out;
}

/**
 * A sim has no aircraft and no route — the same structural test the rest of
 * the app uses, and deliberately not LogTen's `flight_simulator` column, which
 * is blank on the simulator row of a real export.
 */
function isSimulatorRow(raw: RawFlight): boolean {
  if (hasTime(raw.simulatorTime)) return true;
  return !raw.aircraftReg && (!raw.from || !raw.to);
}

/**
 * Which seat the pilot occupied.
 *
 * The role TIMES are the strongest signal — LogTen fills exactly one of them
 * per flight, and it is the column a licence authority reads. The capacity
 * flags are the fallback for a row where the times were never filled in.
 */
export function derivePilotRole(raw: RawFlight, fallback: PilotRole): PilotRole {
  if (hasTime(raw.picTime)) return "PIC";
  if (hasTime(raw.picusTime)) return "PICUS";
  if (hasTime(raw.instructorTime)) return "Instructor";
  if (hasTime(raw.dualTime)) return "Dual";
  if (hasTime(raw.sicTime)) return "SIC";
  if (raw.isPicCapacity) return "PIC";
  if (raw.isPicusCapacity) return "PICUS";
  if (raw.isSicCapacity) return "SIC";
  return fallback;
}

// ============================================================
// Parser
// ============================================================

export interface ParseLogtenFlightsContext {
  currentUser: Personnel;
  existingPersonnel: Personnel[];
  existingFlights: FlightLog[];
  /** IATA/ICAO code → Airport, from the enrichment chain. */
  airports: Map<string, Airport>;
  /** UTC-offset hours per resolved airport code. */
  offsets: Map<string, number>;
  /** Registration (normalized) → ICAO type, from the Aircraft export. */
  typeByRegistration?: Map<string, string>;
  /**
   * Registration (normalized) → ICAO type, from the shared enrichment chain
   * (local reference DB → server batch → FR24).
   *
   * Third in line, behind the flight row's own type columns and the Aircraft
   * export, because both of those are the pilot's own record of what they flew
   * and a registration can be re-issued to a different type over a career.
   */
  lookupByRegistration?: Map<string, string>;
}

/**
 * Airport codes a flight file references, so the caller can run the shared
 * enrichment chain BEFORE parsing (it needs the network, the parse does not).
 */
export function collectAirportCodes(doc: NormalizedDocument): string[] {
  const bound = bindRows(doc.rows);
  if (!bound) return [];
  const codes = new Set<string>();
  for (const row of bound.dataRows) {
    for (const alias of ["flight_from", "flight_to"]) {
      const code = upper(row.get(alias));
      if (code.length === 3 || code.length === 4) codes.add(code);
    }
  }
  return Array.from(codes);
}

/** Registrations a flight file references. */
export function collectRegistrations(doc: NormalizedDocument): string[] {
  const bound = bindRows(doc.rows);
  if (!bound) return [];
  const regs = new Set<string>();
  for (const row of bound.dataRows) {
    const reg = upper(row.get("aircraft_aircraftID", "Aircraft ID"));
    if (reg) regs.add(reg);
  }
  return Array.from(regs);
}

export function parseLogtenFlights(
  doc: NormalizedDocument,
  ctx: ParseLogtenFlightsContext,
  options: LogtenParseOptions = {}
): LogtenFlightPlan {
  const dateOrder = options.dateOrder ?? "auto";
  const preserve = options.preserveSourceValues !== false;

  const plan: LogtenFlightPlan = {
    operations: [],
    timeReference: "utc",
    timeReferenceConfidence: "assumed",
    timeReferenceEvidence: "",
    dateRange: { start: "", end: "" },
    registrations: [],
    airportCodes: [],
    unresolvedAirports: [],
    untypedRegistrations: [],
    personnelToCreate: [],
    skipped: [],
    warnings: [],
    errors: [],
  };

  const bound = bindRows(doc.rows);
  if (!bound) {
    plan.errors.push({
      line: 0,
      message: "Flights export has no readable header row.",
    });
    return plan;
  }

  // ---- Pass 1: read every row, tolerating anything ----
  const raws: RawFlight[] = [];
  for (const row of bound.dataRows) {
    try {
      const raw = readRow(row, dateOrder);
      if (!raw.date) {
        plan.skipped.push({
          line: row.sourceLine,
          message: "No readable flight date — row skipped.",
          raw: row.raw.join("\t").slice(0, 120),
        });
        continue;
      }
      raws.push(raw);
    } catch (error) {
      plan.errors.push({
        line: row.sourceLine,
        message: error instanceof Error ? error.message : "Failed to read row",
        raw: row.raw.join("\t").slice(0, 120),
      });
    }
  }

  if (raws.length === 0) {
    plan.errors.push({ line: 0, message: "No readable flight rows in the file." });
    return plan;
  }

  // ---- Time reference, decided across the whole file ----
  const samples: TimeReferenceSample[] = [];
  for (const raw of raws) {
    const depOffset = ctx.offsets.get(raw.from);
    const arrOffset = ctx.offsets.get(raw.to);
    if (depOffset == null || arrOffset == null) continue;
    if (!raw.out || !raw.in || !raw.blockTime) continue;
    samples.push({
      outTime: raw.out,
      inTime: raw.in,
      blockTime: raw.blockTime,
      depOffsetHours: depOffset,
      arrOffsetHours: arrOffset,
    });
  }
  const verdict = detectTimeReference(samples, options.timeReference);
  plan.timeReference = verdict.reference;
  plan.timeReferenceConfidence = verdict.confidence;
  plan.timeReferenceEvidence = verdict.evidence;
  if (verdict.confidence === "assumed") {
    plan.warnings.push({
      line: 0,
      message: `${verdict.evidence} If your LogTen was set to local time, re-run the import with the time reference set to local.`,
    });
  }

  // ---- Pass 2: build flights ----
  const crewCache = new Map<string, string>();
  const existingCrew = [...ctx.existingPersonnel];
  for (const person of existingCrew) {
    const key = normalize(person.name);
    if (key) crewCache.set(key, person.id);
  }
  const newPersonnel: Personnel[] = [];

  const registrations = new Set<string>();
  const airportCodes = new Set<string>();
  const unresolved = new Set<string>();
  const untypedRegs = new Set<string>();
  const dates: string[] = [];

  // Existing flights are indexed once; every row is then a map lookup rather
  // than a scan, which is what keeps a 4,000-row migration from being O(n·m).
  const existingIndex = buildFlightIndex(ctx.existingFlights);

  const total = raws.length;
  let done = 0;

  for (const raw of raws) {
    try {
      if (raw.from) airportCodes.add(raw.from);
      if (raw.to) airportCodes.add(raw.to);
      if (raw.aircraftReg) registrations.add(raw.aircraftReg);

      const flight = isSimulatorRow(raw)
        ? buildSimulator(raw, ctx, preserve)
        : buildFlight(raw, ctx, plan, verdict.reference, preserve, {
            crewCache,
            existingCrew,
            newPersonnel,
            unresolved,
            untypedRegs,
          });

      dates.push(flight.date);

      const match = findExistingMatch(existingIndex, flight);
      const label = describe(flight);

      if (!match) {
        plan.operations.push({
          kind: "create",
          flight,
          sourceLine: raw.sourceLine,
          label,
        });
        // Index the new flight too, so a file that repeats a row doesn't
        // create it twice.
        indexPlannedFlight(existingIndex, flight, raw.sourceLine);
        continue;
      }

      const { patch, filledFields } = fillBlanks(match, flight);
      if (filledFields.length === 0) {
        plan.operations.push({
          kind: "skip_duplicate",
          existing: match,
          sourceLine: raw.sourceLine,
          label,
        });
      } else {
        plan.operations.push({
          kind: "update_fill",
          existing: match,
          patch,
          filledFields,
          sourceLine: raw.sourceLine,
          label,
        });
      }
    } catch (error) {
      plan.errors.push({
        line: raw.sourceLine,
        message: error instanceof Error ? error.message : "Failed to map row",
      });
    } finally {
      done++;
      if (done % 100 === 0) {
        options.onProgress?.(
          Math.floor((done / total) * 100),
          "Mapping flights",
          `${done}/${total}`
        );
      }
    }
  }

  dates.sort();
  plan.dateRange = { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" };
  plan.registrations = Array.from(registrations);
  plan.airportCodes = Array.from(airportCodes);
  plan.unresolvedAirports = Array.from(unresolved);
  plan.untypedRegistrations = Array.from(untypedRegs);
  plan.personnelToCreate = newPersonnel;

  if (untypedRegs.size > 0) {
    plan.warnings.push({
      line: 0,
      message: `No aircraft type found for ${Array.from(untypedRegs).join(", ")} — import your LogTen Aircraft export to fill these in.`,
    });
  }

  return plan;
}

// ============================================================
// Row → FlightLogCreate
// ============================================================

interface CrewState {
  crewCache: Map<string, string>;
  existingCrew: Personnel[];
  newPersonnel: Personnel[];
  /** Airport codes no source could resolve. */
  unresolved: Set<string>;
  /** Registrations that ended up with no aircraft type from any source. */
  untypedRegs: Set<string>;
}

function buildFlight(
  raw: RawFlight,
  ctx: ParseLogtenFlightsContext,
  plan: LogtenFlightPlan,
  reference: "utc" | "local",
  preserve: boolean,
  crew: CrewState
): FlightLogCreate {
  const depAirport = ctx.airports.get(raw.from);
  const arrAirport = ctx.airports.get(raw.to);
  if (raw.from && !depAirport) crew.unresolved.add(raw.from);
  if (raw.to && !arrAirport) crew.unresolved.add(raw.to);

  const depOffset = ctx.offsets.get(raw.from) ?? 0;
  const arrOffset = ctx.offsets.get(raw.to) ?? 0;

  // Departure-side times convert on the departure offset, arrival-side on the
  // arrival offset — and the date follows the OUT time, which is the one that
  // can move a day when it converts.
  let date = raw.date;
  let out = raw.out;
  let off = raw.off;
  let on = raw.on;
  let inTime = raw.in;
  let scheduledOut = raw.scheduledOut;
  let scheduledIn = raw.scheduledIn;

  if (reference === "local") {
    if (out) {
      const converted = localToUtc(raw.date, out, depOffset);
      date = converted.date;
      out = converted.time;
    } else if (scheduledOut) {
      const converted = localToUtc(raw.date, scheduledOut, depOffset);
      date = converted.date;
    }
    if (off) off = localToUtc(raw.date, off, depOffset).time;
    if (scheduledOut) {
      scheduledOut = localToUtc(raw.date, scheduledOut, depOffset).time;
    }
    if (on) on = localToUtc(raw.date, on, arrOffset).time;
    if (inTime) inTime = localToUtc(raw.date, inTime, arrOffset).time;
    if (scheduledIn) {
      scheduledIn = localToUtc(raw.date, scheduledIn, arrOffset).time;
    }
  }

  // A block time that disagrees with out→in is worth saying out loud: it means
  // either the times or the total was hand-edited in LogTen, and the app
  // recomputes block from the times.
  if (out && inTime && raw.blockTime) {
    const computed = wrappedSpan(out, inTime);
    const stated = wrappedSpan("00:00", raw.blockTime);
    if (computed >= 0 && stated > 0 && Math.abs(computed - stated) > 2) {
      plan.warnings.push({
        line: raw.sourceLine,
        message: `Recorded block time ${raw.blockTime} doesn't match ${out}→${inTime}; the times were kept.`,
      });
    }
  }

  const picCrew = raw.picName
    ? resolveCrewByName(raw.picName, {
        existingCrew: crew.existingCrew,
        crewCache: crew.crewCache,
        currentUserName: ctx.currentUser.name,
        currentUserId: ctx.currentUser.id,
        newPersonnel: crew.newPersonnel,
      })
    : null;
  const sicCrew = raw.sicName
    ? resolveCrewByName(raw.sicName, {
        existingCrew: crew.existingCrew,
        crewCache: crew.crewCache,
        currentUserName: ctx.currentUser.name,
        currentUserId: ctx.currentUser.id,
        newPersonnel: crew.newPersonnel,
      })
    : null;

  const additionalCrew: AdditionalCrew[] = raw.extraCrew.map(({ name, role }) => {
    const resolved = resolveCrewByName(name, {
      existingCrew: crew.existingCrew,
      crewCache: crew.crewCache,
      currentUserName: ctx.currentUser.name,
      currentUserId: ctx.currentUser.id,
      newPersonnel: crew.newPersonnel,
    });
    return {
      id: resolved.personnelId || undefined,
      name: resolved.resolvedName || name,
      role,
    };
  });

  const fallbackRole: PilotRole = ctx.currentUser.roles?.includes("PIC")
    ? "PIC"
    : "SIC";
  const pilotRole = derivePilotRole(raw, fallbackRole);

  // PF is explicit in LogTen; without the column, a recorded takeoff or
  // landing is the same evidence the eCrew logbook parser uses.
  const pilotFlying =
    raw.isPF ??
    raw.dayTakeoffs + raw.nightTakeoffs + raw.dayLandings + raw.nightLandings > 0;

  const regKey = normalizeRegistration(raw.aircraftReg);
  const aircraftType =
    raw.aircraftType ||
    ctx.typeByRegistration?.get(regKey) ||
    ctx.lookupByRegistration?.get(regKey) ||
    "";
  // A flight left without a type is not an error — the Aircraft export may
  // simply not have been imported yet. The executor back-tags it when that
  // file arrives, which is the other half of the loop.
  if (raw.aircraftReg && !aircraftType) crew.untypedRegs.add(raw.aircraftReg);

  const create: FlightLogCreate = {
    date,
    flightNumber: raw.flightNumber,
    aircraftReg: raw.aircraftReg,
    aircraftType,
    departureIcao: depAirport?.icao || (raw.from.length === 4 ? raw.from : ""),
    departureIata: depAirport?.iata || (raw.from.length === 3 ? raw.from : ""),
    arrivalIcao: arrAirport?.icao || (raw.to.length === 4 ? raw.to : ""),
    arrivalIata: arrAirport?.iata || (raw.to.length === 3 ? raw.to : ""),
    departureTimezone: depOffset,
    arrivalTimezone: arrOffset,
    scheduledOut,
    scheduledIn,
    outTime: out,
    offTime: off,
    onTime: on,
    inTime,
    blockTime: raw.blockTime || "00:00",
    flightTime: raw.flightTime || "00:00",
    nightTime: raw.nightTime || "00:00",
    dayTime: "00:00",
    picId: picCrew?.personnelId ?? "",
    picName: picCrew?.resolvedName ?? raw.picName,
    sicId: sicCrew?.personnelId ?? "",
    sicName: sicCrew?.resolvedName ?? raw.sicName,
    additionalCrew,
    pilotFlying,
    pilotRole,
    picTime: raw.picTime || "00:00",
    sicTime: raw.sicTime || "00:00",
    picusTime: raw.picusTime || "00:00",
    dualTime: raw.dualTime || "00:00",
    instructorTime: raw.instructorTime || "00:00",
    dayTakeoffs: raw.dayTakeoffs,
    dayLandings: raw.dayLandings,
    nightTakeoffs: raw.nightTakeoffs,
    nightLandings: raw.nightLandings,
    autolands: raw.autolands,
    remarks: raw.remarks,
    endorsements: "",
    manualOverrides: preserve ? overridesFor(raw) : {},
    ifrTime: raw.ifrTime || "00:00",
    actualInstrumentTime: raw.actualInstrumentTime || "00:00",
    simulatedInstrumentTime: raw.simulatedInstrumentTime || "00:00",
    crossCountryTime: raw.crossCountryTime || "00:00",
    approaches: raw.approaches,
    holds: raw.holds,
    ipcIcc: raw.ipcIcc,
    importSource: "manual",
    ...entryTypePatch("flight"),
  };

  return create;
}

/**
 * Which fields the file actually stated, so `recalculateFlightFields` leaves
 * them alone and only computes the blanks.
 *
 * A TO/LDG override is set only when the columns carry a non-zero count: a
 * blank or zero is LogTen not recording the split, and the app's sun-position
 * calculation is a better answer than a hard zero.
 */
function overridesFor(raw: RawFlight): ManualOverrides {
  const overrides: ManualOverrides = {};
  if (hasTime(raw.nightTime)) overrides.nightTime = true;
  if (hasTime(raw.ifrTime)) overrides.ifrTime = true;
  if (hasTime(raw.actualInstrumentTime)) overrides.actualInstrumentTime = true;
  if (hasTime(raw.simulatedInstrumentTime)) {
    overrides.simulatedInstrumentTime = true;
  }
  if (hasTime(raw.crossCountryTime)) overrides.crossCountryTime = true;
  // The role times are written as a set — `recalculateFlightFields` gates all
  // five on picTime/sicTime/picusTime together, so flagging one is flagging
  // the group, and a half-flagged group would let it rewrite the rest.
  if (hasTime(raw.picTime) || hasTime(raw.sicTime) || hasTime(raw.picusTime)) {
    overrides.picTime = true;
    overrides.sicTime = true;
    overrides.picusTime = true;
  }
  if (hasTime(raw.dualTime)) overrides.dualTime = true;
  if (hasTime(raw.instructorTime)) overrides.instructorTime = true;

  if (raw.hasToLdgColumns) {
    if (raw.dayTakeoffs > 0 || raw.nightTakeoffs > 0) {
      overrides.dayTakeoffs = true;
      overrides.nightTakeoffs = true;
    }
    if (raw.dayLandings > 0 || raw.nightLandings > 0) {
      overrides.dayLandings = true;
      overrides.nightLandings = true;
    }
  }
  return overrides;
}

/**
 * A simulator session.
 *
 * Duration comes from whichever column LogTen filled — `flight_simulator`,
 * `flight_simulatedInstrument`, or the total time, which is what the real
 * export uses. It lands in `simulatedInstrumentTime` with `blockTime` at
 * 00:00, so the session never reaches flight-hour totals.
 */
function buildSimulator(
  raw: RawFlight,
  ctx: ParseLogtenFlightsContext,
  preserve: boolean
): FlightLogCreate {
  const duration =
    [raw.simulatorTime, raw.simulatedInstrumentTime, raw.blockTime].find(hasTime) ||
    "00:00";

  const sessionCode = upper(
    raw.remarks.slice(0, 24) || raw.flightNumber || "SIM"
  );

  return {
    date: raw.date,
    flightNumber: "",
    aircraftReg: "",
    aircraftType: raw.aircraftType || "SIM",
    departureIcao: "",
    departureIata: "",
    arrivalIcao: "",
    arrivalIata: "",
    departureTimezone: 0,
    arrivalTimezone: 0,
    scheduledOut: "",
    scheduledIn: "",
    outTime: raw.out,
    offTime: "",
    onTime: "",
    inTime: raw.in,
    blockTime: "00:00",
    flightTime: "00:00",
    nightTime: "00:00",
    dayTime: "00:00",
    picId: "",
    picName: raw.picName,
    sicId: ctx.currentUser.id,
    sicName: raw.sicName || "Self",
    additionalCrew: [],
    pilotFlying: raw.isPF ?? false,
    pilotRole: derivePilotRole(raw, "Dual"),
    picTime: "00:00",
    sicTime: "00:00",
    picusTime: "00:00",
    dualTime: "00:00",
    instructorTime: "00:00",
    dayTakeoffs: 0,
    dayLandings: 0,
    nightTakeoffs: 0,
    nightLandings: 0,
    autolands: 0,
    remarks: raw.remarks,
    endorsements: "",
    // Sims have no airports, so the derived-field pass has nothing to work
    // from — pin the two fields it would otherwise blank.
    manualOverrides: preserve
      ? { simulatedInstrumentTime: true, nightTime: true }
      : {},
    ifrTime: "00:00",
    actualInstrumentTime: "00:00",
    simulatedInstrumentTime: duration,
    crossCountryTime: "00:00",
    approaches: raw.approaches,
    holds: raw.holds,
    ipcIcc: raw.ipcIcc,
    importSource: "manual",
    ...entryTypePatch("simulator"),
    simSessionCode: sessionCode,
  };
}

// ============================================================
// Duplicate detection
// ============================================================

type FlightIndex = Map<string, FlightLog[]>;

/**
 * Group existing flights by date, because a date is the one field a migrated
 * row and its counterpart always agree on and it is cheap to key. Everything
 * finer (route, number, out time) is checked within the day's handful of rows.
 */
function buildFlightIndex(flights: FlightLog[]): FlightIndex {
  const index: FlightIndex = new Map();
  for (const flight of flights) {
    const bucket = index.get(flight.date);
    if (bucket) bucket.push(flight);
    else index.set(flight.date, [flight]);
  }
  return index;
}

function indexPlannedFlight(
  index: FlightIndex,
  flight: FlightLogCreate,
  sourceLine: number
): void {
  // A planned create is stored as a FlightLog-shaped stand-in purely so a
  // repeated row in the same file matches it. It is never written back.
  const stub = {
    ...flight,
    id: `planned:${sourceLine}`,
    createdAt: 0,
    syncStatus: "pending" as const,
  } as FlightLog;
  const bucket = index.get(stub.date);
  if (bucket) bucket.push(stub);
  else index.set(stub.date, [stub]);
}

function routeKey(flight: Pick<FlightLog, "departureIcao" | "departureIata" | "arrivalIcao" | "arrivalIata">): string {
  const dep = flight.departureIcao || flight.departureIata || "";
  const arr = flight.arrivalIcao || flight.arrivalIata || "";
  return `${dep}>${arr}`;
}

/**
 * Is this migrated row a flight the logbook already has?
 *
 * Same day, then EITHER the same flight number or the same route — plus, when
 * both sides have an out time, a start within 15 minutes. The tolerance is
 * there because a flight entered by hand and the same flight exported from
 * LogTen routinely differ by a few minutes; the flight-number-or-route gate is
 * what stops the tolerance matching two genuinely different sectors.
 */
function findExistingMatch(
  index: FlightIndex,
  candidate: FlightLogCreate
): FlightLog | null {
  const sameDay = index.get(candidate.date);
  if (!sameDay?.length) return null;

  const candidateSim = candidate.entryType === "simulator";
  const candidateRoute = routeKey(candidate);
  const candidateNumber = candidate.flightNumber.replace(/\s/g, "");

  for (const existing of sameDay) {
    const existingSim = existing.entryType === "simulator" || !!existing.isSimulator;
    if (existingSim !== candidateSim) continue;

    if (candidateSim) {
      // Sims have no route or number to key on: same day plus the same
      // session length is what "the same session" means.
      if (
        existing.simulatedInstrumentTime === candidate.simulatedInstrumentTime ||
        (existing.simSessionCode &&
          existing.simSessionCode === candidate.simSessionCode)
      ) {
        return existing;
      }
      continue;
    }

    const numberMatches =
      !!candidateNumber &&
      existing.flightNumber.replace(/\s/g, "") === candidateNumber;
    const routeMatches =
      candidateRoute !== ">" && routeKey(existing) === candidateRoute;
    if (!numberMatches && !routeMatches) continue;

    if (existing.outTime && candidate.outTime) {
      const delta = Math.abs(wrappedSpan(existing.outTime, candidate.outTime));
      const wrapped = Math.min(delta, 24 * 60 - delta);
      if (wrapped > 15) continue;
    }

    return existing;
  }

  return null;
}

/** Times that mean "not recorded" when they read like this. */
const EMPTY_DURATIONS = new Set(["", "00:00", "0:00"]);

/**
 * What the migrated row can add to a flight already in the logbook: only the
 * fields the existing record leaves blank. Nothing the user has recorded is
 * overwritten — a migration is additive by definition.
 */
function fillBlanks(
  existing: FlightLog,
  incoming: FlightLogCreate
): { patch: Partial<FlightLog>; filledFields: string[] } {
  const patch: Partial<FlightLog> = {};
  const filledFields: string[] = [];

  const textFields: Array<keyof FlightLog> = [
    "flightNumber",
    "aircraftReg",
    "aircraftType",
    "departureIcao",
    "departureIata",
    "arrivalIcao",
    "arrivalIata",
    "scheduledOut",
    "scheduledIn",
    "outTime",
    "offTime",
    "onTime",
    "inTime",
    "picName",
    "sicName",
    "remarks",
  ];
  for (const field of textFields) {
    if (!existing[field] && incoming[field as keyof FlightLogCreate]) {
      (patch as Record<string, unknown>)[field] =
        incoming[field as keyof FlightLogCreate];
      filledFields.push(field as string);
    }
  }

  const durationFields: Array<keyof FlightLog> = [
    "blockTime",
    "flightTime",
    "nightTime",
    "picTime",
    "sicTime",
    "picusTime",
    "dualTime",
    "instructorTime",
    "ifrTime",
    "actualInstrumentTime",
    "simulatedInstrumentTime",
    "crossCountryTime",
  ];
  for (const field of durationFields) {
    const current = String(existing[field] ?? "");
    const next = String(incoming[field as keyof FlightLogCreate] ?? "");
    if (EMPTY_DURATIONS.has(current) && !EMPTY_DURATIONS.has(next)) {
      (patch as Record<string, unknown>)[field] = next;
      filledFields.push(field as string);
    }
  }

  if (!existing.picId && incoming.picId) {
    patch.picId = incoming.picId;
    filledFields.push("picId");
  }
  if (!existing.sicId && incoming.sicId) {
    patch.sicId = incoming.sicId;
    filledFields.push("sicId");
  }
  if (!existing.approaches?.length && incoming.approaches.length) {
    patch.approaches = incoming.approaches;
    filledFields.push("approaches");
  }
  if (!existing.additionalCrew?.length && incoming.additionalCrew.length) {
    patch.additionalCrew = incoming.additionalCrew;
    filledFields.push("additionalCrew");
  }

  // Carry the overrides for whatever was actually filled, or the next
  // recalculation would blank the values just written.
  if (filledFields.length > 0 && incoming.manualOverrides) {
    patch.manualOverrides = {
      ...existing.manualOverrides,
      ...incoming.manualOverrides,
    };
  }

  return { patch, filledFields };
}

/** A one-line description of a row, for the review list. */
function describe(flight: FlightLogCreate): string {
  if (flight.entryType === "simulator") {
    return `${flight.date} · Simulator ${flight.simulatedInstrumentTime}`;
  }
  const route = [
    flight.departureIata || flight.departureIcao,
    flight.arrivalIata || flight.arrivalIcao,
  ]
    .filter(Boolean)
    .join("→");
  return [flight.date, flight.flightNumber, route, flight.aircraftReg]
    .filter(Boolean)
    .join(" · ");
}
