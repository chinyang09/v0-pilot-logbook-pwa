/**
 * The flight dashboard's briefing about ONE duty — the things a pilot asks on
 * the way in that the logbook already knows: who am I flying with and when
 * did we last fly, when was I last at the destination, and when am I at each
 * airport (for the weather). Pure, so it is tested (`flight-brief.test.ts`).
 *
 * "Last" always means BEFORE this duty: on the second sector of a day the
 * first one is not "the last time I flew with the captain".
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { Personnel } from "@/types/entities/crew.types"
import { flightInstantMs } from "@/lib/airports/code-changes"
import { cabinKey, crewCardResolver, crewFlyingHistory, type FlightTogether } from "@/lib/utils/crew-history"
import { isFlownFlight } from "@/lib/utils/flight-calculations"
import { getEntryType } from "@/lib/utils/entry-type"
import { hhmmToMinutes } from "@/lib/utils/time"
import { normalize } from "@/lib/utils/parsers/shared/name-normalize"
import type { LegTimes } from "@/lib/weather/brief"

const isClock = (t?: string | null) => !!t && /^\d{1,2}:\d{2}$/.test(t)

/**
 * When a leg leaves and arrives, ms — what the weather is read against.
 * Departure: the actual OUT, else the schedule. Arrival: the actual IN; else,
 * once it has left, OUT plus the PLANNED block (the owner's rule: "if blocks
 * off provided then blocks off + planned duration"); else the schedule.
 */
export function legTimes(f: FlightLog): LegTimes {
  const out = isClock(f.outTime) ? f.outTime : isClock(f.scheduledOut) ? f.scheduledOut : null
  const departMs = out ? flightInstantMs(f.date, out) : null
  let arriveMs: number | null = null
  if (isClock(f.inTime)) arriveMs = flightInstantMs(f.date, f.inTime, f.outTime || out)
  else if (isClock(f.outTime) && isClock(f.scheduledOut) && isClock(f.scheduledIn) && departMs !== null) {
    let planned = hhmmToMinutes(f.scheduledIn) - hhmmToMinutes(f.scheduledOut)
    if (planned < 0) planned += 1440
    arriveMs = departMs + planned * 60_000
  } else if (isClock(f.scheduledIn)) arriveMs = flightInstantMs(f.date, f.scheduledIn, f.scheduledOut || out)
  return {
    label: f.flightNumber || [f.departureIata || f.departureIcao, f.arrivalIata || f.arrivalIcao].filter(Boolean).join("-"),
    departureIcao: (f.departureIcao || "").toUpperCase(),
    arrivalIcao: (f.arrivalIcao || "").toUpperCase(),
    departMs,
    arriveMs,
  }
}

/* ── Crew ────────────────────────────────────────────────────────────────── */

export interface CrewMate {
  /** The crew card, when one is on file. */
  personId: string | null
  name: string
  /** "PIC", "SIC", or an additional crew role ("Relief Pilot"). */
  role: string
  /** The last flight flown together BEFORE this duty. */
  last: FlightTogether | null
  /** Flights flown together before this duty. */
  count: number
  /** A cabin crew member (the report's role code in `role`) — the card lists them; the tile and the logbook do not. */
  cabin?: boolean
}

/**
 * Everyone the pilot flies with on these legs, each once, in seat order (the
 * first leg's seats, then anyone joining later). "Self" is the pilot.
 */
export function crewOnDuty(
  legs: readonly FlightLog[],
  flights: readonly FlightLog[],
  personnel: readonly Pick<Personnel, "id" | "name" | "isMe">[],
  today: string,
): CrewMate[] {
  const legIds = new Set(legs.map((l) => l.id))
  const history = crewFlyingHistory(
    flights.filter((f) => !legIds.has(f.id)),
    personnel,
    today,
  )
  const cardFor = crewCardResolver(personnel)
  const out: CrewMate[] = []
  const seen = new Set<string>()
  for (const leg of legs) {
    const seats: Array<[string | undefined, string | undefined, string]> = [
      [leg.picId, leg.picName, "PIC"],
      [leg.sicId, leg.sicName, "SIC"],
      ...(leg.additionalCrew ?? []).map((c) => [c.id, c.name, c.role] as [string | undefined, string, string]),
    ]
    for (const [id, name, role] of seats) {
      if (!name || name === "Self") continue
      const card = cardFor(id || undefined, name)
      const key = card ?? `name:${normalize(name)}`
      if (seen.has(key)) continue
      seen.add(key)
      const h = card ? history.get(card) : undefined
      out.push({ personId: card, name, role, last: h?.last ?? null, count: h?.count ?? 0 })
    }
  }
  // Then the cabin, as the schedule report lists them (the owner: the card
  // shows ALL the crew; the logbook keeps the flight crew only).
  for (const leg of legs) {
    for (const c of leg.cabinCrew ?? []) {
      const key = c.crewId ? cabinKey(c.crewId) : `cabin-name:${normalize(c.name)}`
      if (seen.has(key)) continue
      seen.add(key)
      const h = c.crewId ? history.get(key) : undefined
      out.push({ personId: null, name: c.name, role: c.role, last: h?.last ?? null, count: h?.count ?? 0, cabin: true })
    }
  }
  return out
}

/* ── Destinations ────────────────────────────────────────────────────────── */

export interface DestinationVisits {
  icao: string
  /** The last flight that ARRIVED there before this duty. */
  last: { flightId: string; date: string; flightNumber: string; from: string } | null
  /** Arrivals there in the 365 days before `beforeMs`. */
  year: number
  /** Every arrival there in the logbook. */
  total: number
}

/**
 * When the pilot last flew INTO each airport the duty arrives at (its
 * turnaround points and its end), before the duty. Only operated flights that
 * were flown — positioning is not flying in, and a sector still to fly is
 * this trip, not the last.
 */
export function destinationVisits(
  legs: readonly FlightLog[],
  flights: readonly FlightLog[],
  beforeMs: number,
): DestinationVisits[] {
  const legIds = new Set(legs.map((l) => l.id))
  const wanted: string[] = []
  for (const l of legs) {
    const icao = (l.arrivalIcao || "").toUpperCase()
    if (icao && !wanted.includes(icao)) wanted.push(icao)
  }
  const byIcao = new Map<string, DestinationVisits>(
    wanted.map((icao) => [icao, { icao, last: null, year: 0, total: 0 }]),
  )
  const lastKey = new Map<string, string>()
  const yearAgo = beforeMs - 365 * 86_400_000
  for (const f of flights) {
    if (legIds.has(f.id) || f.deletedAt != null || getEntryType(f) !== "flight" || !isFlownFlight(f)) continue
    const v = byIcao.get((f.arrivalIcao || "").toUpperCase())
    if (!v) continue
    const ms = flightInstantMs(f.date, f.outTime)
    if (ms === null || ms >= beforeMs) continue
    v.total++
    if (ms >= yearAgo) v.year++
    const key = `${f.date} ${f.outTime}`
    if (key > (lastKey.get(v.icao) ?? "")) {
      lastKey.set(v.icao, key)
      v.last = { flightId: f.id, date: f.date, flightNumber: f.flightNumber || "", from: f.departureIcao || f.departureIata || "" }
    }
  }
  return wanted.map((icao) => byIcao.get(icao)!)
}

/** Every airport the legs touch, in the order flown, each once (ICAO). */
export function dutyStations(legs: readonly Pick<FlightLog, "departureIcao" | "arrivalIcao">[]): string[] {
  const out: string[] = []
  for (const l of legs) {
    for (const code of [l.departureIcao, l.arrivalIcao]) {
      const c = (code || "").toUpperCase()
      if (/^[A-Z0-9]{4}$/.test(c) && !out.includes(c)) out.push(c)
    }
  }
  return out
}
