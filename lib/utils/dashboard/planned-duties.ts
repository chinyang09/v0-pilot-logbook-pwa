/**
 * The duty a day is PLANNED to be, built from the flights themselves.
 *
 * There are two places a plan can live, and the dashboard needs both:
 *
 * 1. `scheduleEntries` — a roster import, turned into duty periods by
 *    `getDutyPeriodsFromSchedule`.
 * 2. **Scheduled FLIGHT rows in the logbook** — a sector with `scheduledOut` /
 *    `scheduledIn` and no OOOI yet. This is what an eCrew import writes for the
 *    sectors still to come, and what a pilot creates by hand when they add
 *    tomorrow's trip.
 *
 * The FDP pipeline deliberately drops (2): `computeFDPResult` filters to
 * `isFlownFlight` so that unflown placeholders cannot inflate the cumulative
 * and rolling totals, which is right. But it means that on a two-sector day
 * with sector one flown and sector two still scheduled, NOTHING in the pipeline
 * knows the duty continues — the logbook duty ends at the first arrival and the
 * roster may have no entry at all. The dashboard then reported "Roster Clear"
 * and began a rest countdown while the pilot was between sectors.
 *
 * So this module builds a parallel set of duty periods where each flight's
 * times fall back to its SCHEDULED times, and hands them to the dashboard as a
 * plan. They are never used for cumulative limits — only to answer "how long
 * does this duty run, how many sectors is it, and what is its FDP maximum".
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { DutyPeriod } from "@/types/entities/roster.types"
import {
  createDutyPeriodsFromFlights,
  mergeAdjacentDutyPeriods,
} from "@/lib/utils/roster/fdp-calculator"
import { isLiveFlight } from "@/lib/db/stores/user/flights.store"
import { isFlownFlight } from "@/lib/utils/flight-calculations"

/**
 * Duty periods covering every sector of a day — flown and still-scheduled
 * alike.
 *
 * A flight contributes its ACTUAL times when it has them and its SCHEDULED
 * times otherwise, so a part-flown duty spans from the first real gate-out to
 * the last planned gate-in. Simulators and rows with no time at all are
 * skipped: neither describes an aircraft moving.
 */
export function buildPlannedDuties(flights: FlightLog[]): DutyPeriod[] {
  const projected: FlightLog[] = []

  for (const flight of flights) {
    if (!flight.date || !isLiveFlight(flight)) continue
    if (flight.isSimulator) continue

    const out = flight.outTime || flight.scheduledOut || ""
    const inn = flight.inTime || flight.scheduledIn || ""
    if (!out || !inn) continue

    // A projection, not a mutation: the real flight rows are what every other
    // consumer reads, and an unflown sector must keep looking unflown to them.
    projected.push({ ...flight, outTime: out, inTime: inn })
  }

  if (projected.length === 0) return []

  return mergeAdjacentDutyPeriods(createDutyPeriodsFromFlights(projected)).map((dp) => ({
    ...dp,
    id: `planned-${dp.id}`,
    source: "schedule",
  }))
}

/**
 * The duties still AHEAD, from the flight rows: every planned duty none of
 * whose sectors has flown yet and whose report is after `nowMs`, marked
 * `isFuture`.
 *
 * Rostered FLIGHTS live in the logbook as scheduled rows, not in
 * `scheduleEntries` (which holds standby, ground, leave and off only), and the
 * pipeline builds duty periods from FLOWN flights. So nothing ahead of today
 * reached it: the FDP page's banner read "Next · None scheduled" over a week of
 * rostered sectors, and the forecast and para 4's look-ahead never saw the
 * duty they were meant to look at. These join the timeline as future duties —
 * never the cumulative limits, which read only what has been flown.
 *
 * A part-flown duty is left out: it is the duty in progress, which the
 * dashboard reads from its own plan (`deriveDutyStatus`).
 */
export function upcomingPlannedDuties(
  flights: FlightLog[],
  nowMs: number,
  planned: DutyPeriod[] = buildPlannedDuties(flights)
): DutyPeriod[] {
  const flown = new Set<string>()
  for (const f of flights) if (isFlownFlight(f)) flown.add(f.id)
  const ahead: DutyPeriod[] = []
  for (const dp of planned) {
    if (dp.flightIds.some((id) => flown.has(id))) continue
    const reportMs = Date.parse(`${dp.date}T${dp.reportTime}:00Z`)
    if (!Number.isFinite(reportMs) || reportMs <= nowMs) continue
    ahead.push({ ...dp, isFuture: true })
  }
  return ahead
}
