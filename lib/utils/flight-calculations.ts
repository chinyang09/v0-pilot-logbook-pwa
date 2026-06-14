/**
 * Flight calculation utilities
 * Handles automatic calculation of derived fields
 */

import { calculateDuration, subtractHHMM, isValidHHMM } from "./time"
import { isNight, calculateNightTimeComplete } from "./night-time"
import type { Airport } from "@/types/entities/airport.types"
import type { FlightLog, Approach, PilotRole, ManualOverrides } from "@/types/entities/flight.types"
import type { AutoFillPreferences } from "@/types/db/stores.types"

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
 * Calculate day time (Total block time minus night time)
 */
export function calculateDayTime(blockTime: string, nightTime: string): string {
  return subtractHHMM(blockTime, nightTime)
}

/**
 * Check if takeoff is at night
 */
export function isTakeoffAtNight(date: string, offTime: string, airport: Airport | null): boolean {
  if (!date || !offTime || !airport || !isValidHHMM(offTime)) return false
  const lat = airport.latitude
  const lon = airport.longitude
  if (typeof lat !== "number" || typeof lon !== "number") return false

  const [hours, mins] = offTime.split(":").map(Number)
  const [y, m, d] = date.split("-").map(Number)
  const offDate = new Date(Date.UTC(y, m - 1, d, hours, mins, 0, 0))

  return isNight(offDate, lat, lon)
}

/**
 * Check if landing is at night
 */
export function isLandingAtNight(
  date: string,
  offTime: string,
  onTime: string,
  airport: Airport | null
): boolean {
  if (!date || !onTime || !offTime || !airport || !isValidHHMM(onTime)) return false
  const lat = airport.latitude
  const lon = airport.longitude
  if (typeof lat !== "number" || typeof lon !== "number") return false

  const [y, m, d] = date.split("-").map(Number)
  const [offH, offM] = offTime.split(":").map(Number)
  const [onH, onM] = onTime.split(":").map(Number)

  const offDate = new Date(Date.UTC(y, m - 1, d, offH, offM, 0, 0))
  let onDate = new Date(Date.UTC(y, m - 1, d, onH, onM, 0, 0))

  if (onDate <= offDate) {
    onDate.setUTCDate(onDate.getUTCDate() + 1)
  }

  return isNight(onDate, lat, lon)
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
  pilotFlying: boolean
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
    const takeoffNight = isTakeoffAtNight(date, offTime, depAirport)
    if (takeoffNight) {
      result.nightTakeoffs = 1
    } else {
      result.dayTakeoffs = 1
    }
  }

  if (onTime && isValidHHMM(onTime) && arrAirport) {
    const landingNight = isLandingAtNight(date, offTime, onTime, arrAirport)
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

/**
 * Create a default/empty flight log
 */
export function createEmptyFlightLog(): Omit<FlightLog, "id" | "createdAt" | "updatedAt" | "syncStatus"> {
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
    pilotFlying: true,
    pilotRole: "PIC",
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
 * Check if a value was manually overridden
 */
export function isManuallyOverridden(
  fieldName: keyof ManualOverrides,
  manualOverrides: ManualOverrides
): boolean {
  return manualOverrides[fieldName] === true
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
  const updates: Partial<FlightLog> = {}
  const overrides = flight.manualOverrides || {}

  // Block time (always recalculate - this is the base)
  if (flight.outTime && flight.inTime) {
    updates.blockTime = calculateBlockTime(flight.outTime, flight.inTime)
  }

  // Flight time
  if (flight.offTime && flight.onTime) {
    updates.flightTime = calculateFlightTime(flight.offTime, flight.onTime)
  }

  // Night time — gated by autoFill.night (defaults to true if no prefs)
  const shouldCalcNight = autoFill?.night !== false
  if (
    shouldCalcNight &&
    !overrides.nightTime &&
    flight.date &&
    flight.outTime &&
    flight.inTime &&
    depAirport &&
    arrAirport
  ) {
    const nightResult = calculateNightTimeComplete(
      flight.date,
      flight.outTime,
      flight.offTime || "",
      flight.onTime || "",
      flight.inTime,
      { lat: depAirport.latitude ?? NaN, lon: depAirport.longitude ?? NaN },
      { lat: arrAirport.latitude ?? NaN, lon: arrAirport.longitude ?? NaN }
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

  if ((shouldCalcTO || shouldCalcLdg) && flight.date && flight.offTime && flight.onTime) {
    const toLdg = calculateTakeoffsLandings(
      flight.date,
      flight.offTime,
      flight.onTime,
      depAirport,
      arrAirport,
      flight.pilotFlying ?? true
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
  // Gated by individual auto-fill preferences
  if (!overrides.picTime && !overrides.sicTime && !overrides.picusTime) {
    const shouldAutoFillRoles =
      autoFill?.pic !== false ||
      autoFill?.sic !== false ||
      autoFill?.p1us !== false ||
      autoFill?.dualRcvd !== false ||
      autoFill?.dualGiven !== false

    if (shouldAutoFillRoles) {
      const roleTimes = calculateRoleTimes(blockTime, flight.pilotRole || "PIC")

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
