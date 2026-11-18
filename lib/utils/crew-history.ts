/**
 * When the pilot last flew with each crew member — the "who is this again,
 * and when did we last fly" a pilot asks at the briefing.
 *
 * A flight puts someone "with" the pilot when they sit in a seat (PIC / SIC)
 * or are listed as additional crew; "Self" is the pilot and never counts. A
 * flight names a crew card by its id, and an imported one sometimes only by
 * name (a logbook report truncates names to 20 characters), so a flight
 * without the id is matched by NAME (`isSamePersonName`, the importers' rule).
 *
 * Flown = OUT and IN recorded; a flight dated today or later without them is
 * the NEXT one together. Only operated flights count — a positioning sector or
 * a simulator session is not flying with someone.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { Personnel } from "@/types/entities/crew.types"
import { isFlownFlight } from "@/lib/utils/flight-calculations"
import { getEntryType } from "@/lib/utils/entry-type"
import { isSamePersonName, normalize } from "@/lib/utils/parsers/shared/name-normalize"

export interface FlightTogether {
  flightId: string
  date: string
  flightNumber: string
  /** "WSSS-VTCC" */
  route: string
}

export interface CrewHistory {
  /** Flights flown together. */
  count: number
  last: FlightTogether | null
  /** The next rostered flight together, today or later. */
  next: FlightTogether | null
}

type CrewFlight = Pick<
  FlightLog,
  | "id"
  | "date"
  | "flightNumber"
  | "departureIcao"
  | "arrivalIcao"
  | "departureIata"
  | "arrivalIata"
  | "outTime"
  | "inTime"
  | "scheduledOut"
  | "picId"
  | "picName"
  | "sicId"
  | "sicName"
  | "additionalCrew"
  | "deletedAt"
  | "entryType"
  | "isSimulator"
>

function together(f: CrewFlight): FlightTogether {
  return {
    flightId: f.id,
    date: f.date,
    flightNumber: f.flightNumber || "",
    route: [f.departureIcao || f.departureIata, f.arrivalIcao || f.arrivalIata].filter(Boolean).join("-"),
  }
}

/** A flight's "when", for ordering within a day. */
const keyOf = (f: CrewFlight) => `${f.date} ${f.outTime || f.scheduledOut || ""}`

/**
 * Every crew card's history with the pilot, by card id. Cards never flown
 * with are absent. `today` is the UTC date ("YYYY-MM-DD") a flight must be on
 * or after to be the NEXT one.
 */
/**
 * Which crew card a seat on a flight names: its id when that card exists,
 * else the card whose name matches (`isSamePersonName`). "Self" and a blank
 * are nobody; the pilot's own card is never one.
 */
export function crewCardResolver(
  personnel: readonly Pick<Personnel, "id" | "name" | "isMe">[],
): (id: string | undefined, name: string | undefined) => string | null {
  const cards = personnel.filter((p) => !p.isMe && p.name)
  const ids = new Set(cards.map((p) => p.id))
  const byName = new Map<string, string>()
  for (const p of cards) {
    const key = normalize(p.name)
    if (key && !byName.has(key)) byName.set(key, p.id)
  }
  const nameCache = new Map<string, string | null>()
  return (id: string | undefined, name: string | undefined): string | null => {
    if (id && ids.has(id)) return id
    if (!name || name === "Self") return null
    const key = normalize(name)
    if (!key) return null
    const cached = nameCache.get(key)
    if (cached !== undefined) return cached
    let found = byName.get(key) ?? null
    if (!found) found = cards.find((p) => isSamePersonName(p.name, name))?.id ?? null
    nameCache.set(key, found)
    return found
  }
}

export function crewFlyingHistory(
  flights: readonly CrewFlight[],
  personnel: readonly Pick<Personnel, "id" | "name" | "isMe">[],
  today: string,
): Map<string, CrewHistory> {
  const cardFor = crewCardResolver(personnel)

  const out = new Map<string, CrewHistory>()
  const entry = (id: string) => {
    let h = out.get(id)
    if (!h) out.set(id, (h = { count: 0, last: null, next: null }))
    return h
  }
  const lastKey = new Map<string, string>()
  const nextKey = new Map<string, string>()

  for (const f of flights) {
    if (f.deletedAt != null || getEntryType(f) !== "flight") continue
    const flown = isFlownFlight(f)
    if (!flown && f.date < today) continue
    const aboard = new Set<string>()
    for (const [id, name] of [
      [f.picId, f.picName],
      [f.sicId, f.sicName],
      ...(f.additionalCrew ?? []).map((c) => [c.id, c.name] as const),
    ] as const) {
      const card = cardFor(id || undefined, name || undefined)
      if (card) aboard.add(card)
    }
    const key = keyOf(f)
    for (const card of aboard) {
      const h = entry(card)
      if (flown) {
        h.count++
        if (!h.last || key > (lastKey.get(card) ?? "")) {
          h.last = together(f)
          lastKey.set(card, key)
        }
      } else if (!h.next || key < (nextKey.get(card) ?? "~")) {
        h.next = together(f)
        nextKey.set(card, key)
      }
    }
  }
  return out
}
