/**
 * The logbook flights of the duty starting at `atMs` (the report on duty, or
 * the next duty's): those departing from half an hour before it to eighteen
 * hours after, which covers any duty paragraph 14 allows. Simulators and
 * binned flights are not legs.
 */

import { flightInstantMs } from "@/lib/airports/code-changes"
import { getEntryType } from "@/lib/utils/entry-type"
import type { FlightLog } from "@/types/entities/flight.types"

const BEFORE_MS = 30 * 60_000
const DUTY_SPAN_MS = 18 * 3600_000

/**
 * In the order they are FLOWN (the logbook's own order, `sortFlights`, is
 * newest first) — the first leg is the one whose inbound aeroplane matters,
 * and the chain's stops are matched to the legs by position.
 */
export function dutyFlights(flights: readonly FlightLog[], atMs: number): FlightLog[] {
  const legs: { f: FlightLog; departs: number }[] = []
  for (const f of flights) {
    // `== null`: a restored flight carries `deletedAt: null` (isLiveFlight).
    if (f.deletedAt != null || getEntryType(f) === "simulator" || !f.date) continue
    const departs = flightInstantMs(f.date, f.outTime || f.scheduledOut)
    if (departs !== null && departs >= atMs - BEFORE_MS && departs <= atMs + DUTY_SPAN_MS) legs.push({ f, departs })
  }
  return legs.sort((a, b) => a.departs - b.departs || a.f.id.localeCompare(b.f.id)).map((l) => l.f)
}

/** When a leg departs, as an ISO instant — its schedule first, else its OUT. */
export function legDepartureIso(f: Pick<FlightLog, "date" | "scheduledOut" | "outTime">): string | null {
  const time = f.scheduledOut || f.outTime
  if (!f.date || !time) return null
  const ms = flightInstantMs(f.date, time)
  return ms === null ? null : new Date(ms).toISOString()
}
