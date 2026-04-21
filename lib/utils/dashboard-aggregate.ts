/**
 * Pure aggregation utilities for the dashboard.
 *
 * Computes period-bounded totals from FlightLog + Aircraft arrays.
 * Decoupled from React for predictability and easy testing.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { Aircraft } from "@/types/entities/aircraft.types"
import { hhmmToMinutes } from "./time"

export interface DashboardAggregates {
  totals: {
    flightMinutes: number
    simMinutes: number
    blockMinutes: number
    flightCount: number
  }
  weekdayFlightMinutes: number[] // length 7, Mon→Sun (current calendar week)
  weekdaySimMinutes: number[]
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
  topTypes: Array<{ type: string; minutes: number }>
}

const EMPTY: DashboardAggregates = {
  totals: { flightMinutes: 0, simMinutes: 0, blockMinutes: 0, flightCount: 0 },
  weekdayFlightMinutes: [0, 0, 0, 0, 0, 0, 0],
  weekdaySimMinutes: [0, 0, 0, 0, 0, 0, 0],
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
  topTypes: [],
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

/**
 * Compute Monday-based weekday index (0 = Mon, 6 = Sun) from YYYY-MM-DD string.
 */
function weekdayIndex(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`)
  const js = d.getDay() // 0 = Sun
  return (js + 6) % 7
}

/**
 * Returns ISO date strings for the current calendar week (Mon → Sun).
 */
export function currentWeekIsoDates(now: Date = new Date()): string[] {
  const dayJs = now.getDay() // 0 Sun
  const monOffset = (dayJs + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - monOffset)
  monday.setHours(0, 0, 0, 0)
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const y = d.getFullYear()
    const m = (d.getMonth() + 1).toString().padStart(2, "0")
    const day = d.getDate().toString().padStart(2, "0")
    out.push(`${y}-${m}-${day}`)
  }
  return out
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

  const week = new Set(currentWeekIsoDates(now))

  const result: DashboardAggregates = {
    totals: { flightMinutes: 0, simMinutes: 0, blockMinutes: 0, flightCount: 0 },
    weekdayFlightMinutes: [0, 0, 0, 0, 0, 0, 0],
    weekdaySimMinutes: [0, 0, 0, 0, 0, 0, 0],
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
    topTypes: [],
  }

  const typeMinutes = new Map<string, number>()

  for (const flight of flights) {
    if (!flight.date) continue
    const inRange = flight.date >= fromIso && flight.date <= toIso
    const inWeek = week.has(flight.date)

    const blockM = hhmmToMinutes(flight.blockTime)
    const flightM = hhmmToMinutes(flight.flightTime) || blockM
    const simM = hhmmToMinutes(flight.simulatedInstrumentTime)

    if (inWeek) {
      const idx = weekdayIndex(flight.date)
      result.weekdayFlightMinutes[idx] += flightM
      result.weekdaySimMinutes[idx] += simM
    }

    if (!inRange) continue

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

  return result
}

export function minutesToDecimal(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10
}

export function formatDecimalHours(minutes: number): string {
  const dec = minutes / 60
  if (!Number.isFinite(dec) || dec <= 0) return "0.0"
  return dec.toFixed(1)
}
