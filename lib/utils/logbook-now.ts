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
