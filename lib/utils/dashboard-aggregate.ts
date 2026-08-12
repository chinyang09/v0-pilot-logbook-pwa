/**
 * Pure aggregation utilities for the dashboard.
 *
 * Computes period-bounded totals from FlightLog + Aircraft arrays.
 * Decoupled from React for predictability and easy testing.
 *
 * Only flown flights (both outTime + inTime set) are counted — scheduled
 * placeholders in the logbook are excluded so the dashboard reflects
 * actually-flown activity.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { Aircraft } from "@/types/entities/aircraft.types"
import type { AutoFillPreferences } from "@/types/db/stores.types"
import { hhmmToMinutes } from "./time"
import { isFlownFlight } from "./flight-calculations"

export type AutoFillKey = keyof AutoFillPreferences

/**
 * Display order + label for each AutoFill-driven ring.
 * Order matches the Settings → Auto-fill time fields list.
 */
export const AUTO_FILL_DISPLAY: ReadonlyArray<{ key: AutoFillKey; label: string }> = [
  { key: "night", label: "Night" },
  { key: "pic", label: "PIC" },
  { key: "sic", label: "SIC" },
  { key: "p1us", label: "P1US" },
  { key: "dualRcvd", label: "Dual" },
  { key: "dualGiven", label: "Instr" },
  { key: "xc", label: "XC" },
  { key: "ifr", label: "IFR" },
  { key: "actualInst", label: "Actual" },
  { key: "simInst", label: "Sim" },
  { key: "multiPilot", label: "MPil" },
  { key: "solo", label: "Solo" },
  { key: "ground", label: "Gnd" },
  { key: "nvg", label: "NVG" },
  { key: "sfe", label: "SFE" },
  { key: "flightEngineer", label: "FE" },
]

/**
 * Maps each AutoFill key to the FlightLog field that stores its time.
 * Keys whose FlightLog field does not (yet) exist are left out — their
 * aggregated minutes stay 0 and the UI skips them.
 */
const AUTO_FILL_FIELD_MAP: Partial<Record<AutoFillKey, keyof FlightLog>> = {
  night: "nightTime",
  pic: "picTime",
  sic: "sicTime",
  p1us: "picusTime",
  dualRcvd: "dualTime",
  dualGiven: "instructorTime",
  xc: "crossCountryTime",
  ifr: "ifrTime",
  actualInst: "actualInstrumentTime",
  simInst: "simulatedInstrumentTime",
}

export type AutoFillMinutes = Record<AutoFillKey, number>

function emptyAutoFillMinutes(): AutoFillMinutes {
  return {
    night: 0, pic: 0, sic: 0, p1us: 0,
    dualRcvd: 0, dualGiven: 0, xc: 0, ifr: 0,
    actualInst: 0, simInst: 0, multiPilot: 0, solo: 0,
    ground: 0, nvg: 0, sfe: 0, flightEngineer: 0,
  }
}

export interface DashboardAggregates {
  totals: {
    flightMinutes: number
    simMinutes: number
    blockMinutes: number
    flightCount: number
  }
  dayMinutes: number
  nightMinutes: number
  xcMinutes: number
  actualIRMinutes: number
  simIRMinutes: number
  dualMinutes: number
  instructorMinutes: number
  picMinutes: number
  sicMinutes: number
  takeoffs: number
  landings: number
  byCategory: {
    airplane: number
    rotorcraft: number
    glider: number
    other: number
  }
  byEngine: {
    se: number
    me: number
    jet: number
  }
  byAutoFillField: AutoFillMinutes
  topTypes: Array<{ type: string; minutes: number }>
  /** Most recent (up to 3) flown flights with non-zero T/O or LDG counts.
   *  Always computed against the full flight history, NOT the period filter,
   *  because the dashboard uses these for currency tracking. */
  recentTLEvents: TLEvent[]
  /** Rolling 90-day takeoff + landing currency status per FAA 14 CFR 61.57.
   *  Always computed against the full flight history. */
  ninetyDayCurrency: NinetyDayCurrency
  /** Flown flights inside the period filter, newest first. */
  periodFlights: PeriodFlight[]
}

export interface PeriodFlight {
  id: string
  date: string
  flightNumber: string
  departureIcao: string
  arrivalIcao: string
  departureIata: string
  arrivalIata: string
  blockMinutes: number
}

export interface TLEvent {
  flightId: string
  date: string
  flightNumber: string
  aircraftReg: string
  takeoffs: number
  landings: number
}

export interface NinetyDayCurrency {
  takeoffs: number
  landings: number
  current: boolean
}

const EMPTY: DashboardAggregates = {
  totals: { flightMinutes: 0, simMinutes: 0, blockMinutes: 0, flightCount: 0 },
  dayMinutes: 0,
  nightMinutes: 0,
  xcMinutes: 0,
  actualIRMinutes: 0,
  simIRMinutes: 0,
  dualMinutes: 0,
  instructorMinutes: 0,
  picMinutes: 0,
  sicMinutes: 0,
  takeoffs: 0,
  landings: 0,
  byCategory: { airplane: 0, rotorcraft: 0, glider: 0, other: 0 },
  byEngine: { se: 0, me: 0, jet: 0 },
  byAutoFillField: emptyAutoFillMinutes(),
  topTypes: [],
  recentTLEvents: [],
  ninetyDayCurrency: { takeoffs: 0, landings: 0, current: false },
  periodFlights: [],
}

function classifyCategory(category: string | undefined): keyof DashboardAggregates["byCategory"] {
  if (!category) return "other"
  const c = category.toLowerCase()
  if (c.includes("airplane") || c.includes("aeroplane") || c.includes("fixed")) return "airplane"
  if (c.includes("rotor") || c.includes("helicopter")) return "rotorcraft"
  if (c.includes("glider") || c.includes("sailplane")) return "glider"
  return "other"
}

function classifyEngine(engineType: string | undefined): keyof DashboardAggregates["byEngine"] | null {
  if (!engineType) return null
  switch (engineType) {
    case "SEP":
    case "SET":
      return "se"
    case "MEP":
    case "MET":
      return "me"
    case "JET":
      return "jet"
    default:
      return null
  }
}

export interface AggregateInput {
  flights: FlightLog[]
  aircraft: Aircraft[]
  fromIso: string
  toIso: string
  now?: Date
}

export function aggregateDashboard({
  flights,
  aircraft,
  fromIso,
  toIso,
  now = new Date(),
}: AggregateInput): DashboardAggregates {
  if (!flights.length) return EMPTY

  const regToAircraft = new Map<string, Aircraft>()
  for (const a of aircraft) {
    if (a.registration) regToAircraft.set(a.registration.toUpperCase(), a)
  }

  const result: DashboardAggregates = {
    totals: { flightMinutes: 0, simMinutes: 0, blockMinutes: 0, flightCount: 0 },
    dayMinutes: 0,
    nightMinutes: 0,
    xcMinutes: 0,
    actualIRMinutes: 0,
    simIRMinutes: 0,
    dualMinutes: 0,
    instructorMinutes: 0,
    picMinutes: 0,
    sicMinutes: 0,
    takeoffs: 0,
    landings: 0,
    byCategory: { airplane: 0, rotorcraft: 0, glider: 0, other: 0 },
    byEngine: { se: 0, me: 0, jet: 0 },
    byAutoFillField: emptyAutoFillMinutes(),
    topTypes: [],
    recentTLEvents: [],
    ninetyDayCurrency: { takeoffs: 0, landings: 0, current: false },
    periodFlights: [],
  }

  // Compute 90-day currency + last-3 T/O+LDG events from the full flown
  // history (independent of the period filter).
  const ninetyDaysAgo = new Date(now)
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const ninetyAgoIso = `${ninetyDaysAgo.getFullYear()}-${(ninetyDaysAgo.getMonth() + 1)
    .toString()
    .padStart(2, "0")}-${ninetyDaysAgo.getDate().toString().padStart(2, "0")}`

  const tlCandidates: TLEvent[] = []
  for (const flight of flights) {
    if (!flight.date) continue
    if (!isFlownFlight(flight)) continue
    const to = (flight.dayTakeoffs || 0) + (flight.nightTakeoffs || 0)
    const ldg = (flight.dayLandings || 0) + (flight.nightLandings || 0)
    if (to === 0 && ldg === 0) continue
    tlCandidates.push({
      flightId: flight.id,
      date: flight.date,
      flightNumber: flight.flightNumber || "",
      aircraftReg: flight.aircraftReg || "",
      takeoffs: to,
      landings: ldg,
    })
    if (flight.date >= ninetyAgoIso) {
      result.ninetyDayCurrency.takeoffs += to
      result.ninetyDayCurrency.landings += ldg
    }
  }
  result.ninetyDayCurrency.current =
    result.ninetyDayCurrency.takeoffs >= 3 && result.ninetyDayCurrency.landings >= 3
  result.recentTLEvents = tlCandidates
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 3)

  const typeMinutes = new Map<string, number>()

  for (const flight of flights) {
    if (!flight.date) continue

    // Simulator sessions are logged as flight entries but must NOT count as
    // flown flights (no flight/block hours, no landings). They contribute
    // only their simulator-instrument time to the sim totals.
    if (flight.isSimulator) {
      if (flight.date >= fromIso && flight.date <= toIso) {
        const simM = hhmmToMinutes(flight.simulatedInstrumentTime)
        result.totals.simMinutes += simM
        result.simIRMinutes += simM
        result.byAutoFillField.simInst += simM
      }
      continue
    }

    // Exclude scheduled / not-yet-flown placeholders.
    if (!isFlownFlight(flight)) continue

    const inRange = flight.date >= fromIso && flight.date <= toIso
    if (!inRange) continue

    const blockM = hhmmToMinutes(flight.blockTime)
    const flightM = hhmmToMinutes(flight.flightTime) || blockM
    const simM = hhmmToMinutes(flight.simulatedInstrumentTime)

    result.totals.flightMinutes += flightM
    result.totals.simMinutes += simM
    result.totals.blockMinutes += blockM
    result.totals.flightCount += 1

    result.dayMinutes += hhmmToMinutes(flight.dayTime)
    result.nightMinutes += hhmmToMinutes(flight.nightTime)
    result.xcMinutes += hhmmToMinutes(flight.crossCountryTime)
    result.actualIRMinutes += hhmmToMinutes(flight.actualInstrumentTime)
    result.simIRMinutes += simM
    result.dualMinutes += hhmmToMinutes(flight.dualTime)
    result.instructorMinutes += hhmmToMinutes(flight.instructorTime)
    result.picMinutes += hhmmToMinutes(flight.picTime)
    result.sicMinutes += hhmmToMinutes(flight.sicTime)
    result.takeoffs += (flight.dayTakeoffs || 0) + (flight.nightTakeoffs || 0)
    result.landings += (flight.dayLandings || 0) + (flight.nightLandings || 0)

    result.periodFlights.push({
      id: flight.id,
      date: flight.date,
      flightNumber: flight.flightNumber || "",
      departureIcao: flight.departureIcao || "",
      arrivalIcao: flight.arrivalIcao || "",
      departureIata: flight.departureIata || "",
      arrivalIata: flight.arrivalIata || "",
      blockMinutes: blockM,
    })

    for (const key of Object.keys(AUTO_FILL_FIELD_MAP) as AutoFillKey[]) {
      const field = AUTO_FILL_FIELD_MAP[key]
      if (!field) continue
      const value = flight[field]
      if (typeof value === "string") {
        result.byAutoFillField[key] += hhmmToMinutes(value)
      }
    }

    const reg = (flight.aircraftReg || "").toUpperCase()
    const ac = regToAircraft.get(reg)
    const cat = classifyCategory(ac?.category)
    result.byCategory[cat] += flightM

    const eng = classifyEngine(ac?.engineType)
    if (eng) result.byEngine[eng] += flightM

    const typeKey = ac?.typeDesignator || ac?.type || flight.aircraftType
    if (typeKey) {
      typeMinutes.set(typeKey, (typeMinutes.get(typeKey) ?? 0) + flightM)
    }
  }

  result.topTypes = Array.from(typeMinutes.entries())
    .map(([type, minutes]) => ({ type, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3)

  // Newest first; tie-break is undefined but stable enough for display.
  result.periodFlights.sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  )

  return result
}

export function formatDecimalHours(minutes: number): string {
  const dec = minutes / 60
  if (!Number.isFinite(dec) || dec <= 0) return "0.0"
  return dec.toFixed(1)
}
