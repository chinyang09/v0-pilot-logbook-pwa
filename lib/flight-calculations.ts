/**
 * Flight calculation utilities
 * Handles automatic calculation of derived fields
 */

import {
  calculateDuration,
  subtractHHMM,
  minutesToHHMM,
  isValidHHMM,
} from "./time-utils";
import { isNight } from "./night-time-calculator";
import type { Airport, FlightLog, Approach } from "./indexed-db";

/**
 * CONSTANTS & HELPERS
 */
export function calculateBlockTime(outTime: string, inTime: string): string {
  return calculateDuration(outTime, inTime);
}

/**
 * CORE CALCULATION UTILITIES
 */
export function calculateFlightTime(offTime: string, onTime: string): string {
  return calculateDuration(offTime, onTime);
}

/**
 * Calculate night time based on OUT/IN times using linear interpolation of flight path
 */
export function calculateNightTimeFromFlight(
  date: string,
  outTime: string,
  inTime: string,
  depAirport: Airport | null,
  arrAirport: Airport | null
): string {
  if (!date || !outTime || !inTime || !depAirport || !arrAirport) {
    return "00:00";
  }

  if (!isValidHHMM(outTime) || !isValidHHMM(inTime)) {
    return "00:00";
  }

  // Get airport coordinates
  const depLat = depAirport.latitude;
  const depLon = depAirport.longitude;
  const arrLat = arrAirport.latitude;
  const arrLon = arrAirport.longitude;

  if (
    typeof depLat !== "number" ||
    typeof depLon !== "number" ||
    typeof arrLat !== "number" ||
    typeof arrLon !== "number" ||
    isNaN(depLat) ||
    isNaN(depLon) ||
    isNaN(arrLat) ||
    isNaN(arrLon)
  ) {
    return "00:00";
  }

  const dateParts = date.split("-");
  const year = Number.parseInt(dateParts[0], 10);
  const month = Number.parseInt(dateParts[1], 10) - 1;
  const day = Number.parseInt(dateParts[2], 10);

  const [outHours, outMins] = outTime.split(":").map(Number);
  const [inHours, inMins] = inTime.split(":").map(Number);

  // Create UTC dates
  const outDate = new Date(Date.UTC(year, month, day, outHours, outMins, 0, 0));
  let inDate = new Date(Date.UTC(year, month, day, inHours, inMins, 0, 0));

  // FIX: Handle overnight flights by checking if arrival is before departure
  if (inDate <= outDate) {
    inDate.setUTCDate(inDate.getUTCDate() + 1);
  }

  const totalMinutes = (inDate.getTime() - outDate.getTime()) / (1000 * 60);
  if (totalMinutes <= 0) return "00:00";

  // Sample the flight path to find night minutes
  const samples = 20; // Increased samples for accuracy on long flights
  let nightMinutes = 0;

  for (let i = 0; i <= samples; i++) {
    const progress = i / samples;
    const sampleTime = new Date(
      outDate.getTime() + progress * (inDate.getTime() - outDate.getTime())
    );

    // Interpolate position along the track
    const lat = depLat + progress * (arrLat - depLat);
    const lon = depLon + progress * (arrLon - depLon);

    if (isNight(sampleTime, lat, lon)) {
      nightMinutes += totalMinutes / samples;
    }
  }

  return minutesToHHMM(Math.round(nightMinutes));
}

/**
 * Calculate day time (Total block time minus night time)
 */
export function calculateDayTime(blockTime: string, nightTime: string): string {
  return subtractHHMM(blockTime, nightTime);
}

/**
 * Event-based Night Checks (Takeoff/Landing)
 */
export function isTakeoffAtNight(
  date: string,
  offTime: string,
  airport: Airport | null
): boolean {
  if (!date || !offTime || !airport || !isValidHHMM(offTime)) return false;
  const lat = airport.latitude;
  const lon = airport.longitude;
  if (typeof lat !== "number" || typeof lon !== "number") return false;

  const [hours, mins] = offTime.split(":").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  const offDate = new Date(Date.UTC(y, m - 1, d, hours, mins, 0, 0));

  return isNight(offDate, lat, lon);
}

export function isLandingAtNight(
  date: string,
  offTime: string,
  onTime: string,
  airport: Airport | null
): boolean {
  if (!date || !onTime || !offTime || !airport || !isValidHHMM(onTime))
    return false;
  const lat = airport.latitude;
  const lon = airport.longitude;
  if (typeof lat !== "number" || typeof lon !== "number") return false;

  const [y, m, d] = date.split("-").map(Number);
  const [offH, offM] = offTime.split(":").map(Number);
  const [onH, onM] = onTime.split(":").map(Number);

  const offDate = new Date(Date.UTC(y, m - 1, d, offH, offM, 0, 0));
  let onDate = new Date(Date.UTC(y, m - 1, d, onH, onM, 0, 0));

  // FIX: Handle date wrap for landing check
  if (onDate <= offDate) {
    onDate.setUTCDate(onDate.getUTCDate() + 1);
  }

  return isNight(onDate, lat, lon);
}

/**
 * LOGIC HANDLERS
 */

export function calculateTakeoffsLandings(
  date: string,
  offTime: string,
  onTime: string,
  depAirport: Airport | null,
  arrAirport: Airport | null,
  pilotFlying: boolean
): {
  dayTakeoffs: number;
  dayLandings: number;
  nightTakeoffs: number;
  nightLandings: number;
} {
  const result = {
    dayTakeoffs: 0,
    dayLandings: 0,
    nightTakeoffs: 0,
    nightLandings: 0,
  };

  // If not pilot flying, no T/O or landings to log
  if (!pilotFlying) return result;

  if (offTime && isValidHHMM(offTime) && depAirport) {
    const takeoffNight = isTakeoffAtNight(date, offTime, depAirport);
    if (takeoffNight) {
      result.nightTakeoffs = 1;
    } else {
      result.dayTakeoffs = 1;
    }
  }

  if (onTime && isValidHHMM(onTime) && arrAirport) {
    const landingNight = isLandingAtNight(date, onTime, arrAirport);
    if (landingNight) {
      result.nightLandings = 1;
    } else {
      result.dayLandings = 1;
    }
  }

  return result;
}

export function calculateRoleTimes(
  blockTime: string,
  pilotRole: FlightLog["pilotRole"]
): {
  picTime: string;
  sicTime: string;
  picusTime: string;
  dualTime: string;
  instructorTime: string;
} {
  const result = {
    picTime: "00:00",
    sicTime: "00:00",
    picusTime: "00:00",
    dualTime: "00:00",
    instructorTime: "00:00",
  };

  if (!blockTime || blockTime === "00:00") return result;

  switch (pilotRole) {
    case "PIC":
      result.picTime = blockTime;
      break;
    case "SIC":
      result.sicTime = blockTime;
      break;
    case "PICUS":
      result.picusTime = blockTime;
      break;
    case "Dual":
      result.dualTime = blockTime;
      break;
    case "Instructor":
      result.instructorTime = blockTime;
      result.picTime = blockTime; // Instructors also log PIC
      break;
  }

  return result;
}

/**
 * Determine if an approach type is precision or non-precision
 */
export function getApproachCategory(type: string): Approach["category"] {
  const precisionApproaches = ["ILS", "GLS", "PAR", "MLS"];
  return precisionApproaches.includes(type.toUpperCase())
    ? "precision"
    : "non-precision";
}

/**
 * Create a default/empty flight log for a new draft
 */
export function createEmptyFlightLog(): Omit<
  FlightLog,
  "id" | "createdAt" | "updatedAt" | "syncStatus"
> {
  const now = new Date();
  return {
    isDraft: true,
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
  };
}

/**
 * Check if a value was manually overridden
 */
export function isManuallyOverridden(
  fieldName: keyof FlightLog["manualOverrides"],
  manualOverrides: FlightLog["manualOverrides"]
): boolean {
  return manualOverrides[fieldName] === true;
}

/**
 * Recalculate all derived fields for a flight
 * Respects manual overrides
 */
export function recalculateFlightFields(
  flight: Partial<FlightLog>,
  depAirport: Airport | null,
  arrAirport: Airport | null
): Partial<FlightLog> {
  const updates: Partial<FlightLog> = {};
  const overrides = flight.manualOverrides || {};

  // Block time (always recalculate - this is the base)
  if (flight.outTime && flight.inTime) {
    updates.blockTime = calculateBlockTime(flight.outTime, flight.inTime);
  }

  // Flight time
  if (flight.offTime && flight.onTime) {
    updates.flightTime = calculateFlightTime(flight.offTime, flight.onTime);
  }

  if (
    !overrides.nightTime &&
    flight.date &&
    flight.outTime &&
    flight.inTime &&
    depAirport &&
    arrAirport
  ) {
    updates.nightTime = calculateNightTimeFromFlight(
      flight.date,
      flight.outTime,
      flight.inTime,
      depAirport,
      arrAirport
    );
  }

  const blockTime = updates.blockTime || flight.blockTime || "00:00";
  const nightTime = updates.nightTime || flight.nightTime || "00:00";
  updates.dayTime = calculateDayTime(blockTime, nightTime);

  // Takeoffs and landings (only if not manually overridden)
  const shouldCalcTO = !overrides.dayTakeoffs && !overrides.nightTakeoffs;
  const shouldCalcLdg = !overrides.dayLandings && !overrides.nightLandings;

  if (
    (shouldCalcTO || shouldCalcLdg) &&
    flight.date &&
    flight.offTime &&
    flight.onTime
  ) {
    const toLdg = calculateTakeoffsLandings(
      flight.date,
      flight.offTime,
      flight.onTime,
      depAirport,
      arrAirport,
      flight.pilotFlying ?? true
    );

    if (shouldCalcTO) {
      updates.dayTakeoffs = toLdg.dayTakeoffs;
      updates.nightTakeoffs = toLdg.nightTakeoffs;
    }
    if (shouldCalcLdg) {
      updates.dayLandings = toLdg.dayLandings;
      updates.nightLandings = toLdg.nightLandings;
    }
  }

  // Role times - use BLOCK TIME not flight time
  if (!overrides.picTime && !overrides.sicTime && !overrides.picusTime) {
    const roleTimes = calculateRoleTimes(blockTime, flight.pilotRole || "PIC");
    updates.picTime = roleTimes.picTime;
    updates.sicTime = roleTimes.sicTime;
    updates.picusTime = roleTimes.picusTime;
    updates.dualTime = roleTimes.dualTime;
    updates.instructorTime = roleTimes.instructorTime;
  }

  return updates;
}
