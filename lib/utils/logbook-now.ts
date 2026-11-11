import { isFlownFlight } from "./flight-calculations"
import type { FlightLog } from "@/types/entities/flight.types"

/**
 * Where "now" is in the logbook's list.
 *
 * The list is newest first, so every flight still to come sits ABOVE the last
 * one flown — and with a month rostered ahead the logbook opened on a flight
 * three weeks away, the one being logged today thirty rows down. This is the
 * row the list opens at instead: the NEXT flight to fly (the earliest one,
 * dated today or later, that has not flown), with the flights just flown
 * directly beneath it and the rest of the roster a scroll up.
 *
 * `flights` is in list order (`sortFlights`, newest first) and `todayUtc` is
 * the UTC date flights are keyed on. 0 — the top, as before — when nothing is
 * ahead, so a logbook with no roster in it opens exactly as it did.
 */
export function logbookNowIndex(
  flights: ReadonlyArray<Pick<FlightLog, "date" | "outTime" | "inTime">>,
  todayUtc: string,
): number {
  let index = 0
  for (let i = 0; i < flights.length; i++) {
    const f = flights[i]
    // Past the future run: everything below is older still.
    if (f.date < todayUtc) break
    if (!isFlownFlight(f)) index = i
  }
  return index
}

/**
 * A sector whose day is over and which still has no OUT and IN.
 *
 * A scheduled flight in the past is not "planned" any more: either it was
 * flown and never logged, or it was cancelled and is still in the book. Both
 * are the pilot's to settle — and both quietly change the legal figures (a
 * flown sector missing from the logbook is missing from recency and the
 * limits). It looked exactly like next week's roster, in the accent colour
 * with "sch", so nothing drew the eye to it.
 *
 * Judged by DAY, on the UTC date the flight is keyed on: past once the day
 * it ARRIVES has ended (an overnight sector — scheduled IN before its OUT —
 * arrives the next day), so a sector in the air across midnight is never
 * called unlogged. A simulator is left out: a session is logged by its
 * length, not its gate times.
 */
export function isUnloggedPast(
  flight: Pick<FlightLog, "date" | "outTime" | "inTime" | "scheduledOut" | "scheduledIn" | "entryType" | "isSimulator">,
  todayUtc: string,
): boolean {
  if (!flight.date || !todayUtc) return false
  if (flight.entryType === "simulator" || flight.isSimulator) return false
  if (isFlownFlight(flight)) return false
  let arrival = flight.date
  if (flight.scheduledOut && flight.scheduledIn && flight.scheduledIn < flight.scheduledOut) {
    const [y, m, d] = flight.date.split("-").map(Number)
    arrival = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  }
  return arrival < todayUtc
}
