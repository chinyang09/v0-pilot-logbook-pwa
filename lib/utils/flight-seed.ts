/**
 * What a looked-up flight may write onto a flight record. The pilot asks for
 * it (the flight form's Lookup), and the rules are still narrow:
 *
 * - only a BLANK field is written, or one the PREVIOUS lookup wrote and the
 *   pilot has not touched since (`lookupPatch`) — so 288 then 289 moves the
 *   route with the number, while anything the pilot (or an import) put there
 *   stays until they choose to replace it;
 * - the aeroplane only from that day's schedule (`basis: "scheduled"`): a
 *   `usual` answer is another day's times moved onto this one, and another
 *   day's aeroplane is not this day's;
 * - a record whose route DISAGREES with the answer takes nothing unless the
 *   pilot says replace: the number or the date is not the flight they mean;
 * - a simulator, a signed or a locked record takes nothing;
 * - never OUT/OFF/ON/IN: FR24's observed times are not the company's record.
 *
 * Scheduled times are stored as "HH:MM" UTC, the form's own convention.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { FlightSuggestion } from "@/lib/lookup/flight-suggest"
import type { AircraftMovement } from "@/lib/lookup/aircraft-whereabouts"
import { getEntryType } from "@/lib/utils/entry-type"

export type SeedField =
  | "aircraftReg"
  | "aircraftType"
  | "departureIcao"
  | "departureIata"
  | "arrivalIcao"
  | "arrivalIata"
  | "scheduledOut"
  | "scheduledIn"

export const SEED_FIELDS: readonly SeedField[] = [
  "aircraftReg",
  "aircraftType",
  "departureIcao",
  "departureIata",
  "arrivalIcao",
  "arrivalIata",
  "scheduledOut",
  "scheduledIn",
]

const blank = (v: unknown) => v === undefined || v === null || v === ""
const hhmm = (iso: string | null) => (iso ? iso.slice(11, 16) : "")

/** Whether a record may take a suggestion at all. */
export function isSeedable(flight: Partial<FlightLog>): boolean {
  return getEntryType(flight) !== "simulator" && !flight.signature && !flight.isLocked
}

/** A route already on the record that names another airport than the suggestion's. */
function routeDisagrees(flight: Partial<FlightLog>, s: FlightSuggestion): boolean {
  const differs = (icao: string | undefined, iata: string | undefined, a: FlightSuggestion["origin"]) =>
    !!a && ((!!icao && !!a.icao && icao.toUpperCase() !== a.icao) || (!icao && !!iata && !!a.iata && iata.toUpperCase() !== a.iata))
  return differs(flight.departureIcao, flight.departureIata, s.origin) || differs(flight.arrivalIcao, flight.arrivalIata, s.destination)
}

/**
 * The patch a suggestion makes to `flight` — blank fields only, by the rules
 * above. `{}` when it may make none.
 */
export function seedFromSuggestion(
  flight: Partial<FlightLog>,
  s: FlightSuggestion,
  opts: { includeAircraft?: boolean } = {}
): Partial<Pick<FlightLog, SeedField>> {
  if (!isSeedable(flight) || routeDisagrees(flight, s)) return {}
  if (flight.date && flight.date !== s.date) return {}
  const patch: Partial<Pick<FlightLog, SeedField>> = {}

  if (s.origin && blank(flight.departureIcao) && blank(flight.departureIata)) {
    patch.departureIcao = s.origin.icao
    patch.departureIata = s.origin.iata
  }
  if (s.destination && blank(flight.arrivalIcao) && blank(flight.arrivalIata)) {
    patch.arrivalIcao = s.destination.icao
    patch.arrivalIata = s.destination.iata
  }
  if (blank(flight.scheduledOut) && hhmm(s.scheduledDeparture)) patch.scheduledOut = hhmm(s.scheduledDeparture)
  if (blank(flight.scheduledIn) && hhmm(s.scheduledArrival)) patch.scheduledIn = hhmm(s.scheduledArrival)

  const withAircraft = (opts.includeAircraft ?? true) && s.basis === "scheduled"
  if (withAircraft && s.registration && blank(flight.aircraftReg)) {
    patch.aircraftReg = s.registration
    if (blank(flight.aircraftType) && s.typecode) patch.aircraftType = s.typecode
  }
  return patch
}

/** The values a lookup wrote onto a record, field by field. */
export type LookupOwned = Partial<Record<SeedField, string>>

/**
 * An explicit lookup's patch. A field the previous lookup wrote (`previous`)
 * and still holds that value is the lookup's, not the pilot's, so it counts as
 * blank — and goes back to blank when this answer has nothing for it (289's
 * aeroplane is not assigned yet; 288's must not stay). `conflicts` are the
 * fields the pilot's OWN values keep from this answer: what "Replace" would
 * write (`overwrite`).
 */
export function lookupPatch(
  flight: Partial<FlightLog>,
  s: FlightSuggestion,
  previous: LookupOwned = {},
  opts: { overwrite?: boolean } = {}
): { patch: Partial<Pick<FlightLog, SeedField>>; conflicts: SeedField[] } {
  if (!isSeedable(flight)) return { patch: {}, conflicts: [] }
  const owned = (f: SeedField) => previous[f] !== undefined && (flight[f] ?? "") === previous[f]
  const without = (drop: (f: SeedField) => boolean): Partial<FlightLog> => {
    const copy: Partial<FlightLog> = { ...flight }
    for (const f of SEED_FIELDS) if (drop(f)) copy[f] = ""
    return copy
  }
  const everything = seedFromSuggestion(without(() => true), s)
  const patch = opts.overwrite ? { ...everything } : seedFromSuggestion(without(owned), s)
  for (const f of SEED_FIELDS) {
    if (owned(f) && !(f in patch) && !blank(flight[f])) patch[f] = ""
  }
  const conflicts = opts.overwrite
    ? []
    : SEED_FIELDS.filter((f) => f in everything && !(f in patch) && (flight[f] ?? "") !== everything[f])
  return { patch, conflicts }
}

/** What the lookup owns after `patch` was applied over `previous`. */
export function ownedAfter(flight: Partial<FlightLog>, previous: LookupOwned, patch: Partial<Pick<FlightLog, SeedField>>): LookupOwned {
  const next: LookupOwned = {}
  for (const f of SEED_FIELDS) {
    if (f in patch) {
      if (patch[f]) next[f] = patch[f]
    } else if (previous[f] !== undefined && (flight[f] ?? "") === previous[f]) {
      next[f] = previous[f]
    }
  }
  return next
}

const same = (a?: string, b?: string) => !!a && !!b && a.toUpperCase() === b.toUpperCase()

/**
 * A next leg or a return the pilot just made from a flight, filled from what
 * the aeroplane flies NEXT (`aircraft/whereabouts`' `next`): the flight number,
 * the far end and the scheduled times — blanks only, and only when that flight
 * departs from this leg's own departure airport (otherwise it is not this
 * leg) and, if this leg already names its arrival, goes there.
 *
 * `allowDate` lets the DATE move too, to the day that flight departs, up to a
 * day after the leg's own. It is for a leg the app has just DERIVED — its date
 * was copied from the flight before it, not chosen — and only while the leg
 * records no times at all: an overnight turnaround's return is the next day.
 */
export function seedFromNextFlight(
  flight: Partial<FlightLog>,
  next: AircraftMovement,
  opts: { allowDate?: boolean } = {}
): Partial<FlightLog> {
  if (!isSeedable(flight) || !next.origin || !next.scheduledDeparture) return {}
  const fromHere = same(flight.departureIcao, next.origin.icao) || same(flight.departureIata, next.origin.iata)
  if (!fromHere) return {}
  if (
    next.destination &&
    ((flight.arrivalIcao && next.destination.icao && !same(flight.arrivalIcao, next.destination.icao)) ||
      (!flight.arrivalIcao && flight.arrivalIata && next.destination.iata && !same(flight.arrivalIata, next.destination.iata)))
  ) {
    return {}
  }

  const departs = next.scheduledDeparture.slice(0, 10)
  const patch: Partial<FlightLog> = {}
  if (departs !== flight.date) {
    const recorded = [flight.outTime, flight.offTime, flight.onTime, flight.inTime].some((t) => !blank(t))
    const dayAfter = flight.date ? new Date(Date.parse(`${flight.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : ""
    if (!opts.allowDate || recorded || departs !== dayAfter) return {}
    patch.date = departs
  }
  if (blank(flight.flightNumber) && next.flightNumber) patch.flightNumber = next.flightNumber
  if (next.destination && blank(flight.arrivalIcao) && blank(flight.arrivalIata)) {
    patch.arrivalIcao = next.destination.icao
    patch.arrivalIata = next.destination.iata
  }
  if (blank(flight.scheduledOut)) patch.scheduledOut = hhmm(next.scheduledDeparture)
  if (blank(flight.scheduledIn) && hhmm(next.scheduledArrival)) patch.scheduledIn = hhmm(next.scheduledArrival)
  return patch
}

/**
 * A flight number typed as digits alone takes the pilot's airline (Settings ›
 * Logging): "288" → "TR288". Anything with a letter in it is left as typed.
 */
export function withAirlinePrefix(number: string, airline: string | null | undefined): string {
  const trimmed = (number || "").trim()
  return airline && /^\d{1,4}[A-Z]?$/i.test(trimmed) ? `${airline.toUpperCase()}${trimmed.toUpperCase()}` : number
}

/**
 * What an EMPTY Flight # field holds after a key, when it was showing the
 * airline as a prefix ("TR"): a LETTER typed first replaces the prefix — the
 * pilot is writing the whole designator ("TR288" out of habit, "SQ12", a
 * paste), and keeping it gave "TRTR288"; a digit is added to it ("TR288").
 * Anything else is left as typed.
 */
export function afterPrefill(shown: string, typed: string, prefill: string | undefined): string {
  if (!prefill || shown !== prefill || !typed.startsWith(prefill)) return typed
  return /^[A-Za-z]/.test(typed.slice(prefill.length)) ? typed.slice(prefill.length) : typed
}
