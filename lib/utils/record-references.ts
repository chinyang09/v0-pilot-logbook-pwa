/**
 * The references a flight makes to other records — its crew seats to crew
 * cards, its registration to a fleet record — and how to put a broken one
 * right. Pure: the stores decide when to run it and write what it returns.
 *
 * Both breaks were found in production. Crew imported before 12 Aug 2026 was
 * written with a bare `put`, so a card existed only on the device that ran the
 * import while the flights pointing at it synced everywhere (24 flight seats
 * named a card no device held). And a fleet record was only ever created for
 * a flight an import TOUCHED, so a registration whose flights were unchanged —
 * or older than `ensureAircraftForFlights` — never got one (9 registrations).
 */

import type { AdditionalCrew, FlightLog } from "@/types/entities/flight.types"
import type { Personnel, PersonnelRole } from "@/types/entities/crew.types"
import { isSamePersonName } from "@/lib/utils/parsers/shared/name-normalize"

export interface CrewReferenceRepairs {
  /** Per flight id, the seat fields to rewrite. */
  flightPatches: Map<string, Partial<FlightLog>>
  /** Cards to create, each under the id the flights already carry. */
  cardsToCreate: Personnel[]
}

type CrewCard = Pick<Personnel, "id" | "name" | "deletedAt">

/** "Self" is the pilot's own seat; it is never a card's name. */
function isSelfName(name: string): boolean {
  return name.trim().toLowerCase() === "self"
}

/**
 * Every crew seat on a live flight that names a card nobody holds.
 *
 * - A live card for the same person (`isSamePersonName` — the logbook report
 *   truncates names to 20 characters) takes the seat, and its fuller name
 *   replaces a truncated one.
 * - Otherwise the card is CREATED under the id the flights carry, so every
 *   flight that already points at it is whole again without being rewritten
 *   (and a second orphaned id for the same person is pointed at it).
 * - A seat whose card is in Recently Deleted is left alone: that card was
 *   binned by hand, and putting it back is the user's call.
 *
 * Run it only after a COMPLETE pull — a card this device has not received yet
 * would otherwise look missing.
 */
export function crewReferenceRepairs(
  flights: FlightLog[],
  cards: CrewCard[],
  selfId: string | null
): CrewReferenceRepairs {
  const known = new Set(cards.map((c) => c.id))
  const live = cards.filter((c) => c.deletedAt == null && c.name.trim() !== "")
  const flightPatches = new Map<string, Partial<FlightLog>>()
  const created = new Map<string, Personnel>()

  const sameNamed = (name: string): CrewCard | null => {
    let best: CrewCard | null = null
    for (const card of live) {
      if (card.id === selfId || !isSamePersonName(card.name, name)) continue
      if (!best || card.name.length > best.name.length) best = card
    }
    return best
  }

  /** The id (and name) a broken seat should carry, or null to leave it. */
  const resolve = (id: string, name: string, role: PersonnelRole): { id: string; name: string } | null => {
    if (!id || known.has(id) || id === selfId || created.has(id)) return null
    if (!name.trim() || isSelfName(name)) return null
    const match = sameNamed(name)
    if (match) return { id: match.id, name: match.name.length > name.length ? match.name : name }
    const card: Personnel = { id, name: name.trim(), roles: [role], isMe: false, createdAt: Date.now(), syncStatus: "pending" }
    created.set(id, card)
    // A second orphaned id for the same person joins this card rather than
    // becoming a card of its own.
    live.push(card)
    return null
  }

  for (const flight of flights) {
    if (flight.deletedAt != null) continue
    const patch: Partial<FlightLog> = {}

    const pic = resolve(flight.picId, flight.picName, "PIC")
    if (pic) {
      patch.picId = pic.id
      if (pic.name !== flight.picName) patch.picName = pic.name
    }
    const sic = resolve(flight.sicId, flight.sicName, "SIC")
    if (sic) {
      patch.sicId = sic.id
      if (sic.name !== flight.sicName) patch.sicName = sic.name
    }

    let crewChanged = false
    const crew = (flight.additionalCrew ?? []).map((member): AdditionalCrew => {
      const fix = member.id ? resolve(member.id, member.name, "PIC") : null
      if (!fix) return member
      crewChanged = true
      return { ...member, id: fix.id, name: fix.name }
    })
    if (crewChanged) patch.additionalCrew = crew

    if (Object.keys(patch).length > 0) flightPatches.set(flight.id, patch)
  }

  return { flightPatches, cardsToCreate: [...created.values()] }
}

/**
 * Registrations flown on a live flight with no fleet record, upper-cased, each
 * with the type its flights most often name (blank when none does). A record
 * in Recently Deleted counts as held — it was binned by hand, and recreating
 * it would put a duplicate beside it the moment it was restored. Simulator
 * rows carry no registration and so never appear.
 */
export function missingFleetRegistrations(
  flights: Pick<FlightLog, "aircraftReg" | "aircraftType" | "deletedAt">[],
  fleet: { registration: string; deletedAt?: number | null }[]
): { reg: string; type: string }[] {
  const held = new Set(fleet.map((a) => a.registration.trim().toUpperCase()))
  const types = new Map<string, Map<string, number>>()
  for (const flight of flights) {
    if (flight.deletedAt != null) continue
    const reg = (flight.aircraftReg ?? "").trim().toUpperCase()
    if (!reg || held.has(reg)) continue
    const counts = types.get(reg) ?? new Map<string, number>()
    const type = (flight.aircraftType ?? "").trim()
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1)
    types.set(reg, counts)
  }
  return [...types].map(([reg, counts]) => {
    let type = ""
    let most = 0
    for (const [t, n] of counts) if (n > most) [type, most] = [t, n]
    return { reg, type }
  })
}
