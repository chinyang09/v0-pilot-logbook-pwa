/**
 * Flight calculation utilities
 * Handles automatic calculation of derived fields
 */

import { calculateDuration, subtractHHMM, isValidHHMM, hhmmToMinutes } from "./time"
import { isNight, calculateNightTimeComplete } from "./night-time"
import type { Airport } from "@/types/entities/airport.types"
import type { FlightLog, Approach, PilotRole, ManualOverrides } from "@/types/entities/flight.types"
import { DEFAULT_LOGGING_PREFERENCES, type AutoFillPreferences } from "@/types/db/stores.types"
import { inferPilotFlying, inferPilotRole, UNSTATED_ROLE } from "./flight-evidence"
import { isSimulatorEntry, simulatorRepairPatch } from "./entry-type"

/**
 * A flight is "flown" once both OOOI gate times are populated.
 * Scheduled/placeholder entries without outTime or inTime are excluded
 * from dashboard totals and FDP current-window calculations.
 */
export function isFlownFlight(flight: Pick<FlightLog, "outTime" | "inTime">): boolean {
  return Boolean(flight.outTime && flight.inTime)
}

/**
 * Calculate block time from out/in times
 */
export function calculateBlockTime(outTime: string, inTime: string): string {
  return calculateDuration(outTime, inTime)
}

/**
 * Calculate flight time from off/on times
 */
export function calculateFlightTime(offTime: string, onTime: string): string {
  return calculateDuration(offTime, onTime)
}

/**
 * The airborne window to compute from: OFF/ON when the flight records both,
 * otherwise OUT/IN. OFF and ON are the times a pilot most often forgets to
 * note, and OUT/IN — which the company records — are the next best evidence
 * of when the aeroplane flew (the owner's rule). Without the fallback every
 * flight missing them held a flight time of 00:00 and no takeoff or landing,
 * which no recalculation would ever put right. `fromGate` says which it was.
 */
export function airborneTimes(f: {
  outTime?: string | null
  offTime?: string | null
  onTime?: string | null
  inTime?: string | null
}): { off: string; on: string; fromGate: boolean } | null {
  const ok = (t: string | null | undefined): t is string => !!t && isValidHHMM(t)
  if (ok(f.offTime) && ok(f.onTime)) return { off: f.offTime, on: f.onTime, fromGate: false }
  if (ok(f.outTime) && ok(f.inTime)) return { off: f.outTime, on: f.inTime, fromGate: true }
  return null
}

/**
 * The flight time a stored row SHOULD carry when it records no OFF/ON and
 * holds none — `airborneTimes`' gate fallback, for rows written before it.
 * Empty when there is nothing to fix: a simulator (no flight time at all), a
 * row with OFF/ON (the recalculation owns it), a figure already there.
 */
export function flightTimeRepairPatch(f: Partial<FlightLog>): Partial<FlightLog> {
  if (isSimulatorEntry({ entryType: f.entryType, isSimulator: f.isSimulator })) return {}
  if (hhmmToMinutes(f.flightTime || "00:00") > 0) return {}
  const airborne = airborneTimes(f)
  if (!airborne?.fromGate) return {}
  const flightTime = calculateFlightTime(airborne.off, airborne.on)
  return hhmmToMinutes(flightTime) > 0 ? { flightTime } : {}
}

/**
 * Calculate day time (Total block time minus night time)
 */
export function calculateDayTime(blockTime: string, nightTime: string): string {
  return subtractHHMM(blockTime, nightTime)
}

/**
 * Whether an airport carries a usable position. A custom airport saved with
 * its coordinates left blank is stored as 0 / 0 (`parseFloat("") || 0`) — a
 * point in the Gulf of Guinea — and a type check alone accepted it, so a
 * Singapore departure at 20:00 local was classified by the sun off West
 * Africa: day, not night. A missing longitude was not checked at all.
 */
export function hasCoordinates(airport: Pick<Airport, "latitude" | "longitude"> | null | undefined): boolean {
  if (!airport) return false
  const { latitude: lat, longitude: lon } = airport
  if (typeof lat !== "number" || typeof lon !== "number") return false
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
  return !(lat === 0 && lon === 0)
}

/**
 * The UTC instant of a clock time on a flight. A flight is keyed on the UTC
 * date of its OUT, so a time earlier in the day than OUT (an OFF at 00:07
 * after an OUT at 23:52) belongs to the NEXT day — read on `date` it was a
 * whole day early, and the sun a day early is a different sun at twilight.
 */
function instantOnFlight(date: string, time: string, outTime?: string): Date {
  const [hours, mins] = time.split(":").map(Number)
  const [y, m, d] = date.split("-").map(Number)
  const at = new Date(Date.UTC(y, m - 1, d, hours, mins, 0, 0))
  if (outTime && isValidHHMM(outTime) && hhmmToMinutes(time) < hhmmToMinutes(outTime)) {
    at.setUTCDate(at.getUTCDate() + 1)
  }
  return at
}

/**
 * Check if takeoff is at night
 */
export function isTakeoffAtNight(
  date: string,
  offTime: string,
  airport: Airport | null,
  outTime?: string
): boolean {
  if (!date || !offTime || !airport || !isValidHHMM(offTime) || !hasCoordinates(airport)) return false
  return isNight(instantOnFlight(date, offTime, outTime), airport.latitude as number, airport.longitude as number)
}

/**
 * Check if landing is at night
 */
export function isLandingAtNight(
  date: string,
  offTime: string,
  onTime: string,
  airport: Airport | null,
  outTime?: string
): boolean {
  if (!date || !onTime || !offTime || !airport || !isValidHHMM(onTime) || !hasCoordinates(airport)) return false
  const offDate = instantOnFlight(date, offTime, outTime)
  const onDate = instantOnFlight(date, onTime)
  while (onDate <= offDate) onDate.setUTCDate(onDate.getUTCDate() + 1)
  return isNight(onDate, airport.latitude as number, airport.longitude as number)
}

/**
 * Calculate takeoffs and landings
 */
export function calculateTakeoffsLandings(
  date: string,
  offTime: string,
  onTime: string,
  depAirport: Airport | null,
  arrAirport: Airport | null,
  pilotFlying: boolean,
  outTime?: string
): {
  dayTakeoffs: number
  dayLandings: number
  nightTakeoffs: number
  nightLandings: number
} {
  const result = {
    dayTakeoffs: 0,
    dayLandings: 0,
    nightTakeoffs: 0,
    nightLandings: 0,
  }

  if (!pilotFlying) return result

  if (offTime && isValidHHMM(offTime) && depAirport) {
    const takeoffNight = isTakeoffAtNight(date, offTime, depAirport, outTime)
    if (takeoffNight) {
      result.nightTakeoffs = 1
    } else {
      result.dayTakeoffs = 1
    }
  }

  if (onTime && isValidHHMM(onTime) && arrAirport) {
    const landingNight = isLandingAtNight(date, offTime, onTime, arrAirport, outTime)
    if (landingNight) {
      result.nightLandings = 1
    } else {
      result.dayLandings = 1
    }
  }

  return result
}

/**
 * Calculate role times based on pilot role
 */
export function calculateRoleTimes(
  blockTime: string,
  pilotRole: PilotRole
): {
  picTime: string
  sicTime: string
  picusTime: string
  dualTime: string
  instructorTime: string
} {
  const result = {
    picTime: "00:00",
    sicTime: "00:00",
    picusTime: "00:00",
    dualTime: "00:00",
    instructorTime: "00:00",
  }

  if (!blockTime || blockTime === "00:00") return result

  switch (pilotRole) {
    case "PIC":
      result.picTime = blockTime
      break
    case "SIC":
      result.sicTime = blockTime
      break
    case "PICUS":
      result.picusTime = blockTime
      break
    case "Dual":
      result.dualTime = blockTime
      break
    case "Instructor":
      result.instructorTime = blockTime
      result.picTime = blockTime
      break
  }

  return result
}

/**
 * Determine if an approach type is precision or non-precision
 */
export function getApproachCategory(type: string): Approach["category"] {
  const precisionApproaches = ["ILS", "GLS", "PAR", "MLS"]
  return precisionApproaches.includes(type.toUpperCase()) ? "precision" : "non-precision"
}

/** How a flight the pilot creates starts — from Settings › Logging. */
export interface NewFlightStart {
  pilotFlying?: boolean
  pilotRole?: PilotRole
}

/**
 * An empty flight log. Who flew it and in what role are the pilot's settings
 * (`start`, from Settings › Logging); with none given, the settings' own
 * defaults apply — never a constant chosen here.
 */
export function createEmptyFlightLog(
  start: NewFlightStart = {}
): Omit<FlightLog, "id" | "createdAt" | "updatedAt" | "syncStatus"> {
  return {
    date: new Date().toISOString().split("T")[0],
    flightNumber: "",
    aircraftReg: "",
    aircraftType: "",
    departureIcao: "",
    departureIata: "",
    arrivalIcao: "",
    arrivalIata: "",
    departureTimezone: 0,
    arrivalTimezone: 0,
    scheduledOut: "",
    scheduledIn: "",
    outTime: "",
    offTime: "",
    onTime: "",
    inTime: "",
    blockTime: "00:00",
    flightTime: "00:00",
    nightTime: "00:00",
    dayTime: "00:00",
    picId: "",
    picName: "",
    sicId: "",
    sicName: "",
    additionalCrew: [],
    pilotFlying: start.pilotFlying ?? DEFAULT_LOGGING_PREFERENCES.newFlightPilotFlying,
    pilotRole: start.pilotRole ?? UNSTATED_ROLE,
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
    remarks: "",
    endorsements: "",
    manualOverrides: {},
    ifrTime: "00:00",
    actualInstrumentTime: "00:00",
    simulatedInstrumentTime: "00:00",
    crossCountryTime: "00:00",
    approaches: [],
    holds: 0,
    ipcIcc: false,
  }
}

/**
 * Recalculate all derived fields for a flight
 * Respects manual overrides and auto-fill preferences
 */
export function recalculateFlightFields(
  flight: Partial<FlightLog>,
  depAirport: Airport | null,
  arrAirport: Airport | null,
  autoFill?: AutoFillPreferences
): Partial<FlightLog> {
  // A simulator has nothing to derive — its duration is its own field, and a
  // block time computed from its OUT/IN would reach every flight-hour total.
  if (isSimulatorEntry({ entryType: flight.entryType, isSimulator: flight.isSimulator })) {
    return simulatorRepairPatch(flight)
  }

  const updates: Partial<FlightLog> = {}
  const overrides = flight.manualOverrides || {}

  // Block time (always recalculate - this is the base)
  if (flight.outTime && flight.inTime) {
    updates.blockTime = calculateBlockTime(flight.outTime, flight.inTime)
  }

  // Flight time — off→on, or out→in when the flight records no OFF/ON
  const airborne = airborneTimes(flight)
  if (airborne) {
    updates.flightTime = calculateFlightTime(airborne.off, airborne.on)
  }

  // Night time — gated by autoFill.night (defaults to true if no prefs)
  const shouldCalcNight = autoFill?.night !== false
  if (
    shouldCalcNight &&
    !overrides.nightTime &&
    flight.date &&
    flight.outTime &&
    flight.inTime &&
    // Without a real position at BOTH ends there is no night time to compute
    // — leave the stored figure alone rather than writing a sun-angle answer
    // for 0°N 0°E, or 00:00 over a value the pilot already has.
    hasCoordinates(depAirport) &&
    hasCoordinates(arrAirport)
  ) {
    const nightResult = calculateNightTimeComplete(
      flight.date,
      flight.outTime,
      flight.offTime || "",
      flight.onTime || "",
      flight.inTime,
      { lat: depAirport!.latitude as number, lon: depAirport!.longitude as number },
      { lat: arrAirport!.latitude as number, lon: arrAirport!.longitude as number }
    )
    updates.nightTime = nightResult.nightTimeHHMM
  }

  const blockTime = updates.blockTime || flight.blockTime || "00:00"
  const flightTime = updates.flightTime || flight.flightTime || "00:00"
  const nightTime = updates.nightTime || flight.nightTime || "00:00"
  updates.dayTime = calculateDayTime(blockTime, nightTime)

  // Takeoffs and landings (only if not manually overridden)
  const shouldCalcTO = !overrides.dayTakeoffs && !overrides.nightTakeoffs
  const shouldCalcLdg = !overrides.dayLandings && !overrides.nightLandings

  if ((shouldCalcTO || shouldCalcLdg) && flight.date && airborne) {
    const toLdg = calculateTakeoffsLandings(
      flight.date,
      airborne.off,
      airborne.on,
      depAirport,
      arrAirport,
      flight.pilotFlying ?? inferPilotFlying(flight),
      flight.outTime
    )

    if (shouldCalcTO) {
      updates.dayTakeoffs = toLdg.dayTakeoffs
      updates.nightTakeoffs = toLdg.nightTakeoffs
    }
    if (shouldCalcLdg) {
      updates.dayLandings = toLdg.dayLandings
      updates.nightLandings = toLdg.nightLandings
    }
  }

  // Role times - use BLOCK TIME not flight time
  // Gated by individual auto-fill preferences. The five role times are ONE
  // split of the block: a pilot who pinned any of them owns the split, so
  // none is recomputed. Dual and instructor were left out of this gate, so a
  // pinned Dual (a LogTen training flight, say) was zeroed or replaced by the
  // block time on the next recalculation pass.
  if (
    !overrides.picTime &&
    !overrides.sicTime &&
    !overrides.picusTime &&
    !overrides.dualTime &&
    !overrides.instructorTime
  ) {
    const shouldAutoFillRoles =
      autoFill?.pic !== false ||
      autoFill?.sic !== false ||
      autoFill?.p1us !== false ||
      autoFill?.dualRcvd !== false ||
      autoFill?.dualGiven !== false

    if (shouldAutoFillRoles) {
      const roleTimes = calculateRoleTimes(blockTime, flight.pilotRole || inferPilotRole(flight))

      if (autoFill?.pic !== false) updates.picTime = roleTimes.picTime
      if (autoFill?.sic !== false) updates.sicTime = roleTimes.sicTime
      if (autoFill?.p1us !== false) updates.picusTime = roleTimes.picusTime
      if (autoFill?.dualRcvd !== false) updates.dualTime = roleTimes.dualTime
      if (autoFill?.dualGiven !== false) updates.instructorTime = roleTimes.instructorTime
    }
  }

  // Cross-country time — auto-fill when departure differs from arrival
  if (autoFill?.xc !== false && !overrides.crossCountryTime) {
    const depIcao = flight.departureIcao || depAirport?.icao
    const arrIcao = flight.arrivalIcao || arrAirport?.icao
    if (depIcao && arrIcao && depIcao !== arrIcao) {
      updates.crossCountryTime = blockTime
    }
  }

  // IFR time — auto-fill from flight time
  if (autoFill?.ifr === true && !overrides.ifrTime) {
    updates.ifrTime = flightTime
  }

  // Actual instrument time
  if (autoFill?.actualInst === true && !overrides.actualInstrumentTime) {
    updates.actualInstrumentTime = flightTime
  }

  // Simulated instrument time
  if (autoFill?.simInst === true && !overrides.simulatedInstrumentTime) {
    updates.simulatedInstrumentTime = flightTime
  }

  return updates
}
