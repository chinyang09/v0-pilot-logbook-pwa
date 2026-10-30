/**
 * What a looked-up flight may write onto a flight record by itself — the
 * pilot never asked for it, so the rules are narrow:
 *
 * - only a BLANK field is written; anything the pilot (or an import) put
 *   there stays;
 * - only that day's schedule (`basis: "scheduled"`) writes anything
 *   unprompted — a `usual` suggestion is another day's times, and scheduled
 *   times feed the FDP plan, so it is offered and applied only when the pilot
 *   says so (`includeAircraft: false` then, because another day's aeroplane is
 *   not this day's);
 * - a record whose route already DISAGREES with the suggestion takes nothing:
 *   the number or the date is not the flight the pilot means;
 * - a simulator, a signed or a locked record takes nothing;
 * - never OUT/OFF/ON/IN: FR24's observed times are not the company's record.
 *
 * Scheduled times are stored as "HH:MM" UTC, the form's own convention.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { FlightSuggestion } from "@/lib/lookup/flight-suggest"
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
