/**
 * The one order flights are listed in.
 *
 * The logbook reads newest first, and it is ONE continuous reverse-chronology:
 * newest day first, and within a day the latest departure first. Anything less
 * than a total order shows up as rows shuffling on their own — a new flight
 * landing at the top and then jumping once the list refetches, or two flights
 * on the same day swapping places between renders.
 *
 * The tiebreak chain, in order:
 *
 * 1. `date`, newest first.
 * 2. Departure time, latest first — the ACTUAL out time, falling back to the
 *    SCHEDULED one. The fallback is the important part: reading `outTime`
 *    alone treats every not-yet-flown sector as 00:00, which is why scheduled
 *    flights sank below completed ones on the same day regardless of when
 *    they actually depart.
 * 3. Departure airport, A→Z — a real tiebreak for two sectors that push back
 *    at the same minute.
 * 4. `id` — not meaningful to a reader, but it makes the order TOTAL. Without
 *    a final tiebreak two otherwise-identical rows are ordered by whatever the
 *    source happened to return, which is the unpredictability being fixed.
 *
 * A flight with no time at all sorts to the end of its day: it has no
 * departure time yet, and the end is where "unknown" belongs in a descending
 * list. It moves into place as soon as a time is entered.
 */

import type { FlightLog } from "@/types/entities/flight.types";

type SortableFlight = Pick<
  FlightLog,
  "id" | "date" | "outTime" | "scheduledOut" | "departureIcao" | "departureIata"
>;

/** When the aircraft actually left, or is planned to. "" when neither is set. */
export function effectiveOutTime(flight: Pick<SortableFlight, "outTime" | "scheduledOut">): string {
  return flight.outTime || flight.scheduledOut || "";
}

function departureCode(flight: Pick<SortableFlight, "departureIcao" | "departureIata">): string {
  return flight.departureIcao || flight.departureIata || "";
}

/**
 * Newest first. Use with `.sort()` anywhere flights are listed, so every
 * surface agrees and a re-fetch never reorders what is already on screen.
 */
export function compareFlights(a: SortableFlight, b: SortableFlight): number {
  const byDate = b.date.localeCompare(a.date);
  if (byDate !== 0) return byDate;

  // HH:MM sorts correctly as a string. "" (no time) loses to any real time,
  // which puts an untimed flight at the end of its day.
  const byTime = effectiveOutTime(b).localeCompare(effectiveOutTime(a));
  if (byTime !== 0) return byTime;

  const byDeparture = departureCode(a).localeCompare(departureCode(b));
  if (byDeparture !== 0) return byDeparture;

  return a.id.localeCompare(b.id);
}

/** A new array in list order — the input is not mutated. */
export function sortFlights<T extends SortableFlight>(flights: T[]): T[] {
  return [...flights].sort(compareFlights);
}

/**
 * Place one flight into an already-sorted list.
 *
 * For the optimistic cache write when a flight is created: prepending instead
 * put every new flight at the very top of the logbook whatever its date, and
 * it only snapped to its real position when the list next refetched — which is
 * the row seen jumping mid-delete.
 */
export function insertFlightSorted<T extends SortableFlight>(flights: T[], flight: T): T[] {
  const next = flights.filter((f) => f.id !== flight.id);
  const at = next.findIndex((f) => compareFlights(flight, f) < 0);
  if (at === -1) next.push(flight);
  else next.splice(at, 0, flight);
  return next;
}
