/**
 * "Which flight is TR288 on 30 Oct" — read off a flight number's list (the
 * Worker's `/flight`), which runs about a week AHEAD with scheduled times and
 * a week back with what flew. The registration appears on the day the
 * aeroplane is assigned, so a future date answers its route and times only.
 *
 * Two bases, and a caller must treat them differently:
 *
 * | basis | from | may fill a blank field by itself |
 * |---|---|---|
 * | `scheduled` | the list's row for THAT date | yes — it is that day's schedule |
 * | `usual` | a date OUTSIDE the list: the nearest dated row, its times moved to the date asked | no — it is a guess (a retimed or cancelled day looks the same), and scheduled times feed the FDP plan |
 *
 * A date INSIDE the list with no row for it is a day the number does not
 * operate, and answers nothing.
 *
 * Dates are the app's: the UTC date of OUT (`FlightLog.date`). Pure, so the
 * door (Edge) and the tests share it.
 */

import type { Fr24Flight } from "@/lib/fr24/types"

export interface SuggestedAirport {
  icao: string
  iata: string
  name: string
}

export interface FlightSuggestion {
  flightNumber: string
  /** The UTC date asked for. */
  date: string
  basis: "scheduled" | "usual"
  /** `usual` only: the date whose times were moved onto `date`. */
  basedOn: string | null
  origin: SuggestedAirport | null
  destination: SuggestedAirport | null
  /** ISO UTC, or null where the source had none. */
  scheduledDeparture: string | null
  scheduledArrival: string | null
  /** The aeroplane assigned — "" until it is (and always "" for `usual`). */
  registration: string
  typecode: string
  model: string
}

export interface GateInfo {
  /** IATA where known, else ICAO. */
  airport: string
  gate: string
  terminal: string
}

export interface FlightGates {
  flight: FlightSuggestion
  departure: GateInfo
  arrival: GateInfo & { baggage: string }
  /** Where the gates came from: the tracked flight, the airport boards, or nowhere yet. */
  source: "live" | "board" | "none"
}

/** `TR0288`, `tr 288` and `TR288` are one flight number. */
export function normalizeFlightNumber(number: string): string {
  const compact = (number || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
  const m = /^([A-Z0-9]{2})(\d+)([A-Z]?)$/.exec(compact)
  return m ? `${m[1]}${String(Number(m[2]))}${m[3]}` : compact
}

const dateOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "")
const minutesOfDay = (iso: string) => {
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
const DAY_MS = 86_400_000

/** An end of a flight as the app names an airport; null when the source named neither code. */
export function suggestedAirport(a: Fr24Flight["origin"]): SuggestedAirport | null {
  return a && (a.icao || a.iata) ? { icao: a.icao, iata: a.iata, name: a.name } : null
}

/**
 * The row for `number` departing on `date` (UTC). Where a number operates
 * twice that day, `out` ("HH:MM" UTC) picks the nearer; without it, the first.
 */
export function pickFlightOnDate(flights: Fr24Flight[], number: string, date: string, out?: string): Fr24Flight | null {
  const wanted = normalizeFlightNumber(number)
  const sameDay = flights
    .filter((f) => normalizeFlightNumber(f.flightNumber) === wanted && dateOf(f.scheduledDeparture) === date)
    .sort((a, b) => (a.scheduledDeparture! < b.scheduledDeparture! ? -1 : 1))
  if (sameDay.length <= 1 || !out) return sameDay[0] ?? null
  const target = Number(out.slice(0, 2)) * 60 + Number(out.slice(3, 5))
  return sameDay.reduce((best, f) =>
    Math.abs(minutesOfDay(f.scheduledDeparture!) - target) < Math.abs(minutesOfDay(best.scheduledDeparture!) - target) ? f : best
  )
}

function fromRow(f: Fr24Flight, date: string): FlightSuggestion {
  return {
    flightNumber: f.flightNumber,
    date,
    basis: "scheduled",
    basedOn: null,
    origin: suggestedAirport(f.origin),
    destination: suggestedAirport(f.destination),
    scheduledDeparture: f.scheduledDeparture,
    scheduledArrival: f.scheduledArrival,
    registration: f.registration,
    typecode: f.typecode,
    model: f.model,
  }
}

/**
 * What the list says about `number` on `date`: that day's row (`scheduled`),
 * or — when the date is outside the list — the nearest day's route and times
 * moved onto it (`usual`). Null when the list has nothing for the number.
 */
export function suggestFlight(flights: Fr24Flight[], number: string, date: string, out?: string): FlightSuggestion | null {
  const onDate = pickFlightOnDate(flights, number, date, out)
  if (onDate) return fromRow(onDate, date)

  const wanted = normalizeFlightNumber(number)
  const asked = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(asked)) return null
  const dated = flights.filter((f) => normalizeFlightNumber(f.flightNumber) === wanted && f.scheduledDeparture)
  if (!dated.length) return null
  // A date INSIDE the list's span with no row is a day the flight does not
  // operate (TR288 skips some days) — not one to project times onto.
  const days = dated.map((f) => dateOf(f.scheduledDeparture)).sort()
  if (date >= days[0] && date <= days[days.length - 1]) return null
  const nearest = dated.reduce((best, f) =>
    Math.abs(Date.parse(dateOf(f.scheduledDeparture) + "T00:00:00Z") - asked) <
    Math.abs(Date.parse(dateOf(best.scheduledDeparture) + "T00:00:00Z") - asked)
      ? f
      : best
  )

  const from = Date.parse(nearest.scheduledDeparture!)
  const shift = asked - Date.parse(dateOf(nearest.scheduledDeparture) + "T00:00:00Z")
  const block = nearest.scheduledArrival ? Date.parse(nearest.scheduledArrival) - from : null
  const departure = new Date(from + shift).toISOString()
  return {
    ...fromRow(nearest, date),
    basis: "usual",
    basedOn: dateOf(nearest.scheduledDeparture),
    scheduledDeparture: departure,
    scheduledArrival: block !== null && block > 0 && block < DAY_MS ? new Date(from + shift + block).toISOString() : null,
    // Another day's aeroplane is not this day's.
    registration: "",
  }
}

/**
 * The row on an airport board that IS this flight: the same number, departing
 * within three hours of the scheduled time (a board lists a number once a day,
 * but a delayed one and the next day's can sit on one page).
 */
export function findOnBoard(board: Fr24Flight[], number: string, scheduledDeparture: string | null): Fr24Flight | null {
  const wanted = normalizeFlightNumber(number)
  const at = scheduledDeparture ? Date.parse(scheduledDeparture) : null
  return (
    board.find(
      (f) =>
        normalizeFlightNumber(f.flightNumber) === wanted &&
        (at === null || !f.scheduledDeparture || Math.abs(Date.parse(f.scheduledDeparture) - at) <= 3 * 3600_000)
    ) ?? null
  )
}
