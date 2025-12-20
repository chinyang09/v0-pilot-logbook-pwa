import {
  calculateDuration,
  subtractHHMM,
  minutesToHHMM,
  isValidHHMM,
} from "./time-utils";
import { isNight, getSunTimes } from "./night-time-calculator";
import type { AirportData } from "./airport-database";
import type { FlightLog, Approach } from "./indexed-db";

/**
 * CONSTANTS & HELPERS
 */
const PRECISION_APPROACHES = ["ILS", "GLS", "PAR", "MLS"];

const getCoords = (airport: AirportData | null) => {
  if (!airport) return null;
  const lat = airport.latitude ?? (airport as any).lat;
  const lon = airport.longitude ?? (airport as any).lon;
  return typeof lat === "number" && typeof lon === "number"
    ? { lat, lon }
    : null;
};

const parseToUTCDate = (dateStr: string, timeStr: string): Date => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, mins] = timeStr.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours, mins, 0, 0));
};

/**
 * CORE CALCULATION UTILITIES
 */

export const calculateBlockTime = (outTime: string, inTime: string) =>
  calculateDuration(outTime, inTime);
export const calculateFlightTime = (offTime: string, onTime: string) =>
  calculateDuration(offTime, onTime);

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
  const depCoords = getCoords(depAirport);
  const arrCoords = getCoords(arrAirport);

  if (
    !date ||
    !isValidHHMM(outTime) ||
    !isValidHHMM(inTime) ||
    !depCoords ||
    !arrCoords
  ) {
    return "00:00";
  }

  const outDate = parseToUTCDate(date, outTime);
  const inDate = parseToUTCDate(date, inTime);
  if (inDate <= outDate) inDate.setUTCDate(inDate.getUTCDate() + 1);

  const totalMinutes = (inDate.getTime() - outDate.getTime()) / (1000 * 60);
  if (totalMinutes <= 0) return "00:00";

  // Sample the route to check for night conditions
  const sampleInterval = Math.min(5, totalMinutes / 10);
  const samples = Math.max(Math.ceil(totalMinutes / sampleInterval), 10);
  let nightMinutes = 0;

  for (let i = 0; i <= samples; i++) {
    const progress = i / samples;
    const sampleTime = new Date(
      outDate.getTime() + progress * (inDate.getTime() - outDate.getTime())
    );
    const lat = depCoords.lat + progress * (arrCoords.lat - depCoords.lat);
    const lon = depCoords.lon + progress * (arrCoords.lon - depCoords.lon);

    if (isNight(sampleTime, lat, lon)) {
      nightMinutes += totalMinutes / samples;
    }
  }

  return minutesToHHMM(Math.round(nightMinutes));
}

export const calculateDayTime = (flightTime: string, nightTime: string) =>
  subtractHHMM(flightTime, nightTime);

/**
 * Event-based Night Checks (Takeoff/Landing)
 */
function checkNightAtLocation(
  date: string,
  time: string,
  airport: AirportData | null
): boolean {
  const coords = getCoords(airport);
  if (!coords || !isValidHHMM(time)) return false;

  const eventDate = parseToUTCDate(date, time);
  return isNight(eventDate, coords.lat, coords.lon);
}

export const isTakeoffAtNight = checkNightAtLocation;
export const isLandingAtNight = checkNightAtLocation;

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
) {
  const res = {
    dayTakeoffs: 0,
    dayLandings: 0,
    nightTakeoffs: 0,
    nightLandings: 0,
  };
  if (!pilotFlying) return res;

  if (offTime && depAirport) {
    isTakeoffAtNight(date, offTime, depAirport)
      ? (res.nightTakeoffs = 1)
      : (res.dayTakeoffs = 1);
  }
  if (onTime && arrAirport) {
    isLandingAtNight(date, onTime, arrAirport)
      ? (res.nightLandings = 1)
      : (res.dayLandings = 1);
  }
  return res;
}

export function calculateRoleTimes(
  blockTime: string,
  pilotRole: FlightLog["pilotRole"]
) {
  const res = {
    picTime: "00:00",
    sicTime: "00:00",
    picusTime: "00:00",
    dualTime: "00:00",
    instructorTime: "00:00",
  };
  if (!blockTime || blockTime === "00:00") return res;

  const roleMap: Record<string, keyof typeof res> = {
    PIC: "picTime",
    SIC: "sicTime",
    PICUS: "picusTime",
    Dual: "dualTime",
    Instructor: "instructorTime",
  };

  const field = roleMap[pilotRole];
  if (field) res[field] = blockTime;
  if (pilotRole === "Instructor") res.picTime = blockTime;

  return res;
}

export const getApproachCategory = (type: string): Approach["category"] =>
  PRECISION_APPROACHES.includes(type.toUpperCase())
    ? "precision"
    : "non-precision";

/**
 * RECALCULATION ENGINE
 */

export function recalculateFlightFields(
  flight: Partial<FlightLog>,
  depAirport: AirportData | null,
  arrAirport: AirportData | null
): Partial<FlightLog> {
  const updates: Partial<FlightLog> = {};
  const ovr = flight.manualOverrides || {};

  // 1. Durations
  if (flight.outTime && flight.inTime)
    updates.blockTime = calculateBlockTime(flight.outTime, flight.inTime);
  if (flight.offTime && flight.onTime)
    updates.flightTime = calculateFlightTime(flight.offTime, flight.onTime);

  const activeBlock = updates.blockTime || flight.blockTime || "00:00";

  // 2. Night/Day Logic
  if (
    !ovr.nightTime &&
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

  const activeNight = updates.nightTime || flight.nightTime || "00:00";
  updates.dayTime = calculateDayTime(activeBlock, activeNight);

  // 3. Takeoffs & Landings
  const needsTO = !ovr.dayTakeoffs && !ovr.nightTakeoffs;
  const needsLdg = !ovr.dayLandings && !ovr.nightLandings;

  if ((needsTO || needsLdg) && flight.date && flight.offTime && flight.onTime) {
    const toLdg = calculateTakeoffsLandings(
      flight.date,
      flight.offTime,
      flight.onTime,
      depAirport,
      arrAirport,
      flight.pilotFlying ?? true
    );
    if (needsTO) {
      updates.dayTakeoffs = toLdg.dayTakeoffs;
      updates.nightTakeoffs = toLdg.nightTakeoffs;
    }
    if (needsLdg) {
      updates.dayLandings = toLdg.dayLandings;
      updates.nightLandings = toLdg.nightLandings;
    }
  }

  // 4. Role Times
  if (!ovr.picTime && !ovr.sicTime && !ovr.picusTime) {
    Object.assign(
      updates,
      calculateRoleTimes(activeBlock, flight.pilotRole || "PIC")
    );
  }

  return updates;
}

export function createEmptyFlightLog(): Omit<
  FlightLog,
  "id" | "createdAt" | "updatedAt" | "syncStatus"
> {
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
