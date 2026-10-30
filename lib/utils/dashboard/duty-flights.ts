/**
 * The logbook flights of the duty starting at `atMs` (the report on duty, or
 * the next duty's): those departing from half an hour before it to eighteen
 * hours after, which covers any duty paragraph 14 allows — and only up to the
 * first long time on the ground, because eighteen hours can also reach the
 * NEXT duty's first sector after a minimum rest. Simulators and binned
 * flights are not legs.
 */

import { flightInstantMs } from "@/lib/airports/code-changes"
import { getEntryType } from "@/lib/utils/entry-type"
import type { FlightLog } from "@/types/entities/flight.types"

const BEFORE_MS = 30 * 60_000
const DUTY_SPAN_MS = 18 * 3600_000
/** A turnaround is an hour or two; this much on the ground is a rest, so another duty. */
const REST_GAP_MS = 8 * 3600_000

/**
 * In the order they are FLOWN (the logbook's own order, `sortFlights`, is
 * newest first) — the first leg is the one whose inbound aeroplane matters,
 * and the chain's stops are matched to the legs by position.
 */
export function dutyFlights(flights: readonly FlightLog[], atMs: number): FlightLog[] {
  const legs: { f: FlightLog; departs: number; arrives: number }[] = []
  for (const f of flights) {
    // `== null`: a restored flight carries `deletedAt: null` (isLiveFlight).
    if (f.deletedAt != null || getEntryType(f) === "simulator" || !f.date) continue
    const out = f.outTime || f.scheduledOut
    const departs = flightInstantMs(f.date, out)
    if (departs === null || departs < atMs - BEFORE_MS || departs > atMs + DUTY_SPAN_MS) continue
    const arrives = flightInstantMs(f.date, f.inTime || f.scheduledIn, out) ?? departs
    legs.push({ f, departs, arrives: Math.max(arrives, departs) })
  }
  legs.sort((a, b) => a.departs - b.departs || a.f.id.localeCompare(b.f.id))
  const duty: FlightLog[] = []
  for (let i = 0; i < legs.length; i++) {
    if (i > 0 && legs[i].departs - legs[i - 1].arrives > REST_GAP_MS) break
    duty.push(legs[i].f)
  }
  return duty
}

/**
 * The leg whose aeroplane is worth asking after: the first not yet off blocks
 * (on duty, the next one to fly — a later leg can be another tail), else the
 * first. Only legs that name an aeroplane.
 */
export function inboundLeg(legs: readonly FlightLog[]): FlightLog | null {
  return legs.find((f) => f.aircraftReg && !f.outTime) ?? legs.find((f) => f.aircraftReg) ?? null
}

/** When a leg departs, as an ISO instant — its schedule first, else its OUT. */
export function legDepartureIso(f: Pick<FlightLog, "date" | "scheduledOut" | "outTime">): string | null {
  const time = f.scheduledOut || f.outTime
  if (!f.date || !time) return null
  const ms = flightInstantMs(f.date, time)
  return ms === null ? null : new Date(ms).toISOString()
}
