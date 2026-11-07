/**
 * THE FDP pipeline — flight rows and roster entries in; duty periods, rests,
 * cumulative limits, capacity, forecast and "legal from" out.
 *
 * It is a pure function of its inputs and `nowMs`, so the hook that runs it
 * (`useFDPData`, which caches the result) and the tests run the SAME code. It
 * used to live inside the hook, and the scenario suites re-assembled their
 * own copy of it — which is how a duty in progress could lose its unflown
 * sectors in the app while every suite stayed green.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import { DEFAULT_FTL_LIMITS, type DutyPeriod, type ScheduleEntry } from "@/types/entities/roster.types"
import { hhmmToMinutes } from "@/lib/utils/time"
import { isFlownFlight } from "@/lib/utils/flight-calculations"
import {
  buildPlannedDuties,
  completePartFlownDuties,
  upcomingPlannedDuties,
} from "@/lib/utils/dashboard/planned-duties"
import {
  applyAcclimatisation,
  calculateAllRestPeriods,
  calculateCapacity,
  calculateCumulativeLimits,
  calculateRestUntilLegal,
  createDutyPeriodsFromFlights,
  forecastExceedances,
  getDutyPeriodsFromSchedule,
  mergeAdjacentDutyPeriods,
  mergeDutyPeriods,
  truncateActivatedStandby,
  type RestUntilLegalResult,
} from "@/lib/utils/roster/fdp-calculator"

export interface FDPPipelineResult {
  allDutyPeriods: DutyPeriod[]
  /** The roster's own view, BEFORE it is merged with the logbook. */
  scheduleDutyPeriods: DutyPeriod[]
  /** The day's shape from the flight rows, each sector falling back to its scheduled times. */
  plannedDutyPeriods: DutyPeriod[]
  pastDuties: DutyPeriod[]
  futureDuties: DutyPeriod[]
  cumulativeLimits: ReturnType<typeof calculateCumulativeLimits>
  capacity: ReturnType<typeof calculateCapacity>
  forecast: ReturnType<typeof forecastExceedances>
  restViolations: DutyPeriod[]
  restUntilLegal: RestUntilLegalResult | null
  failed: boolean
}

export function runFDPPipeline(
  flights: FlightLog[],
  scheduleEntries: ScheduleEntry[],
  airportTimezones: Map<string, number>,
  nowMs: number,
): FDPPipelineResult {
  // Only flown logbook entries count toward duty periods. Placeholder /
  // scheduled flights without OOOI times would otherwise create spurious
  // duty periods and inflate cumulative limits.
  const flownFlights = flights.filter(isFlownFlight)
  const plannedDPs = buildPlannedDuties(flights)

  // …but a duty that is PART-flown is still one duty. With sector one on
  // blocks and sector two a scheduled row, the logbook duty "ended" at the
  // first arrival — out of base — and the sector still to fly was in neither
  // the record nor the duties ahead: the timeline drew one leg, rest started
  // at the outstation and the next duty read as a violation. The duty takes
  // the plan's shape, with only what has been flown counted as flight time.
  const logbookDPs = completePartFlownDuties(
    mergeAdjacentDutyPeriods(createDutyPeriodsFromFlights(flownFlights)),
    flights,
    plannedDPs,
  )
  const scheduleDPs = mergeAdjacentDutyPeriods(getDutyPeriodsFromSchedule(scheduleEntries, airportTimezones))

  // The duties AHEAD come from the flight rows too (`upcomingPlannedDuties`):
  // rostered flights are scheduled logbook rows, not schedule entries, so
  // without them the next duty, the forecast and para 4's look-ahead saw
  // nothing past today. A date the roster already carries a flight duty for
  // (an older import) keeps that one.
  const rosteredFlightDates = new Set(
    scheduleDPs.filter((dp) => !dp.dutyKind || dp.dutyKind === "flight").map((dp) => dp.date),
  )
  const ahead = upcomingPlannedDuties(flights, nowMs, plannedDPs).filter((dp) => !rosteredFlightDates.has(dp.date))

  // Para 6(6): a standby ends the moment the crew member is activated, so a
  // standby that was called out is cut back to the following duty's report.
  const merged = truncateActivatedStandby(
    [...mergeDutyPeriods(logbookDPs, scheduleDPs), ...ahead].sort(
      (a, b) => a.date.localeCompare(b.date) || hhmmToMinutes(a.reportTime) - hhmmToMinutes(b.reportTime),
    ),
  )
  // Each duty's FDP table against the zone the crew member was acclimated to
  // at its report — which only the whole timeline can tell. Before the rest
  // calculation, which reads the corrected figures.
  const withRest = calculateAllRestPeriods(applyAcclimatisation(merged))

  const today = new Date(nowMs)
  const limits = DEFAULT_FTL_LIMITS
  const pastDuties = withRest.filter((dp) => !dp.isFuture)
  const futureDuties = withRest.filter((dp) => dp.isFuture)

  return {
    allDutyPeriods: withRest,
    scheduleDutyPeriods: scheduleDPs,
    plannedDutyPeriods: plannedDPs,
    pastDuties,
    futureDuties,
    cumulativeLimits: calculateCumulativeLimits(pastDuties, today, limits),
    capacity: calculateCapacity(pastDuties, today, limits),
    // The forecast reads past AND future duties to project exceedances.
    forecast: forecastExceedances(withRest, limits),
    restViolations: withRest.filter((dp) => dp.restBefore && !dp.restBefore.compliant),
    // Given the WHOLE timeline: para 4 turns on the duty AHEAD.
    restUntilLegal: calculateRestUntilLegal(withRest),
    failed: false,
  }
}
