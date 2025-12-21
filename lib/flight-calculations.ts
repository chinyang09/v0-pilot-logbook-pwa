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
import type { AirportData } from "./airport-database";
import type { FlightLog, Approach } from "./indexed-db";

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
  depAirport: AirportData | null,
  arrAirport: AirportData | null
): string {
  if (!date || !outTime || !inTime || !depAirport || !arrAirport) {
    console.log("[v0] Night calc - missing inputs:", {
      date,
      outTime,
      inTime,
      depAirport: !!depAirport,
      arrAirport: !!arrAirport,
    });
    return "00:00";
  }

  if (!isValidHHMM(outTime) || !isValidHHMM(inTime)) {
    console.log("[v0] Night calc - invalid time format:", { outTime, inTime });
    return "00:00";
  }

  // Get airport coordinates - check both naming conventions
  const depLat =
    depAirport.latitude !== undefined
      ? depAirport.latitude
      : (depAirport as any).lat;
  const depLon =
    depAirport.longitude !== undefined
      ? depAirport.longitude
      : (depAirport as any).lon;
  const arrLat =
    arrAirport.latitude !== undefined
      ? arrAirport.latitude
      : (arrAirport as any).lat;
  const arrLon =
    arrAirport.longitude !== undefined
      ? arrAirport.longitude
      : (arrAirport as any).lon;

  console.log("[v0] Night calc - airport coords:", {
    dep: { lat: depLat, lon: depLon, icao: depAirport.icao },
    arr: { lat: arrLat, lon: arrLon, icao: arrAirport.icao },
  });

  if (
    !date ||
    !isValidHHMM(outTime) ||
    !isValidHHMM(inTime) ||
    !depCoords ||
    !arrCoords
  ) {
    console.log("[v0] Night calc - invalid coordinates");
    return "00:00";
  }

  const dateParts = date.split("-");
  const year = Number.parseInt(dateParts[0], 10);
  const month = Number.parseInt(dateParts[1], 10) - 1; // JS months are 0-indexed
  const day = Number.parseInt(dateParts[2], 10);

  // Parse times - using outTime and inTime
  const [outHours, outMins] = outTime.split(":").map(Number);
  const [inHours, inMins] = inTime.split(":").map(Number);

  // Create UTC dates
  const outDate = new Date(Date.UTC(year, month, day, outHours, outMins, 0, 0));
  const inDate = new Date(Date.UTC(year, month, day, inHours, inMins, 0, 0));

  // Handle overnight flights
  if (inDate <= outDate) {
    inDate.setUTCDate(inDate.getUTCDate() + 1);
  }

  console.log("[v0] Night calc - parsed times:", {
    outDate: outDate.toISOString(),
    inDate: inDate.toISOString(),
  });

  const totalMinutes = (inDate.getTime() - outDate.getTime()) / (1000 * 60);
  if (totalMinutes <= 0) {
    console.log("[v0] Night calc - no block time");
    return "00:00";
  }

  // Get sun times at midpoint for reference
  const midTime = new Date(
    outDate.getTime() + (inDate.getTime() - outDate.getTime()) / 2
  );
  const midLat = (depLat + arrLat) / 2;
  const midLon = (depLon + arrLon) / 2;

  // Sample every minute for more accuracy on shorter flights
  const sampleInterval = Math.min(5, totalMinutes / 10); // At least 10 samples
  const samples = Math.max(Math.ceil(totalMinutes / sampleInterval), 10);
  let nightMinutes = 0;

  for (let i = 0; i <= samples; i++) {
    const progress = i / samples;
    const sampleTime = new Date(
      outDate.getTime() + progress * (inDate.getTime() - outDate.getTime())
    );

    // Linear interpolation of position
    const lat = depLat + progress * (arrLat - depLat);
    const lon = depLon + progress * (arrLon - depLon);

    const isNightSample = isNight(sampleTime, lat, lon);
    if (isNightSample) {
      nightMinutes += totalMinutes / samples;
    }
  }

  console.log("[v0] Night calc result:", {
    totalMinutes,
    nightMinutes,
    samples,
    result: minutesToHHMM(Math.round(nightMinutes)),
  });

  return minutesToHHMM(Math.round(nightMinutes));
}

/**
 * Calculate day time (flight time minus night time)
 */
export function calculateDayTime(
  flightTime: string,
  nightTime: string
): string {
  return subtractHHMM(flightTime, nightTime);
}

/**
 * Event-based Night Checks (Takeoff/Landing)
 */
export function isTakeoffAtNight(
  date: string,
  offTime: string,
  airport: AirportData | null
): boolean {
  if (!date || !offTime || !airport || !isValidHHMM(offTime)) {
    return false;
  }

  const lat = airport.latitude ?? airport.lat;
  const lon = airport.longitude ?? airport.lon;

  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    isNaN(lat) ||
    isNaN(lon)
  ) {
    return false;
  }

  const [hours, mins] = offTime.split(":").map(Number);
  const offDate = new Date(date);
  offDate.setUTCHours(hours, mins, 0, 0);

  return isNight(offDate, lat, lon);
}

/**
 * Determine if landing was during night
 */
export function isLandingAtNight(
  date: string,
  onTime: string,
  airport: AirportData | null
): boolean {
  if (!date || !onTime || !airport || !isValidHHMM(onTime)) {
    return false;
  }

  const lat = airport.latitude ?? airport.lat;
  const lon = airport.longitude ?? airport.lon;

  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    isNaN(lat) ||
    isNaN(lon)
  ) {
    return false;
  }

  const [hours, mins] = onTime.split(":").map(Number);
  const onDate = new Date(date);
  onDate.setUTCHours(hours, mins, 0, 0);

  return isNight(onDate, lat, lon);
}

/**
 * LOGIC HANDLERS
 */

export function calculateTakeoffsLandings(
  date: string,
  offTime: string,
  onTime: string,
  depAirport: AirportData | null,
  arrAirport: AirportData | null,
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
  depAirport: AirportData | null,
  arrAirport: AirportData | null
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
