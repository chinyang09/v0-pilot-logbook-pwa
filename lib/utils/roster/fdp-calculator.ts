/**
 * FDP (Flight Duty Period) Calculator
 * Calculates duty times, flight times, rest periods, and regulatory compliance
 * per CAAS (Civil Aviation Authority of Singapore) regulations:
 *   - Reg 3: Minimum rest periods
 *   - Reg 12: Duty hour limits (90h/14d, 180h/28d)
 *   - Reg 107: Flight time limits (100h/28d, 1000h/12mo)
 */

import type {
  DutyPeriod,
  RollingPeriodStats,
  CumulativeDutyLimits,
  FTLLimits,
  ScheduleEntry,
  RestPeriodInfo,
  CapacityRemaining,
  ForecastExceedance,
  ForecastResult,
  CrewConfiguration,
  AugmentedCrewLevel,
  FdpTableUsed,
} from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"
import { hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time"
import {
  acclimatisedOffsetMinutes,
  CIRCADIAN_REST_MIN,
  circadianRestRule,
  classifyCircadian,
  containsLocalNight,
  POST_FLIGHT_CHECK_MIN,
  PRE_FLIGHT_CHECK_MIN,
  REST_STARTS_AFTER_DUTY_MIN,
  type DutyInterval,
} from "@/lib/utils/roster/regulation-definitions"
import {
  lookupTableA,
  lookupTableB,
  lookupTableC,
  applyLongSectorAdjustment,
  applyAugmentedCrewExtension,
  isAcclimated,
} from "@/lib/utils/roster/fdp-tables"

// ============================================
// Constants
// ============================================

/**
 * Report time buffer before first OUT time — para 7(2)'s "minimum of one hour
 * to the completion of pre-flight checks".
 */
const REPORT_BUFFER_MINUTES = PRE_FLIGHT_CHECK_MIN

/**
 * Where a duty period ENDS relative to gate-in.
 *
 * A "duty period" ends when the crew member "is free from all duties" (First
 * Schedule), and para 7(2) requires 90 minutes for pre-flight and post-flight
 * checks together with at least 60 of those before the flight — so at least 30
 * minutes of post-flight checks are still DUTY. The code used to end the duty
 * at gate-in and treat the 30 minutes as part of the rest instead.
 */
const DEBRIEF_BUFFER_MINUTES = POST_FLIGHT_CHECK_MIN

/** Home base offset, in minutes from UTC — Singapore. */
const HOME_BASE_OFFSET_MINUTES = 8 * 60

/**
 * Para 10's threshold. A reporting delay below this keeps the FDP maximum on
 * the original reporting time; at or above it, the maximum is re-based on the
 * actual one and the FDP window opens 4 hours after the original.
 */
const DELAY_REBASE_MINUTES = 4 * 60

// ============================================
// DutyPeriod creation from schedule entries
// ============================================

/**
 * Calculate duty period from a schedule entry.
 * @param entry - The schedule entry
 * @param departureTimezoneOffset - UTC offset of departure airport (default 8 = SGT)
 */
export function calculateDutyPeriodFromSchedule(
  entry: ScheduleEntry,
  departureTimezoneOffset: number = 8
): DutyPeriod | null {
  if (!entry.reportTime || !entry.debriefTime) return null

  const reportMinutes = hhmmToMinutes(entry.reportTime)
  const debriefMinutes = hhmmToMinutes(entry.debriefTime)

  // Handle day wrap (e.g., report 23:00, debrief 02:00 next day)
  let dutyMinutes = debriefMinutes - reportMinutes
  if (dutyMinutes < 0) {
    dutyMinutes += 1440 // Add 24 hours
  }

  // Flight time, and EVERY sector's block time — para 14(2) counts each long
  // sector up, not only the longest.
  let flightMinutes = 0
  const sectorMinutes: number[] = []
  if (entry.sectors && entry.sectors.length > 0) {
    entry.sectors.forEach((sector) => {
      const outTime = sector.actualOut || sector.scheduledOut
      const inTime = sector.actualIn || sector.scheduledIn
      if (outTime && inTime) {
        const out = hhmmToMinutes(outTime)
        const in_ = hhmmToMinutes(inTime)
        let blockTime = in_ - out
        if (blockTime < 0) blockTime += 1440
        flightMinutes += blockTime
        sectorMinutes.push(blockTime)
      } else {
        sectorMinutes.push(0)
      }
    })
  }

  // Para 14 enters its tables on "the local time at the place of commencement
  // of the flight duty period", so the report time has to be moved into the
  // DEPARTURE station's clock — from whichever frame the report stated it in.
  let localReportMinutes: number
  switch (entry.timeReference) {
    case "UTC":
      localReportMinutes = reportMinutes + departureTimezoneOffset * 60
      break
    case "LOCAL_STATION":
      // Already the local time where the crew member reports. Shifting it
      // again would double-count the offset — an eight-hour error on a
      // long-haul departure.
      localReportMinutes = reportMinutes
      break
    default:
      // LOCAL_BASE = SGT (UTC+8), converted to departure local.
      localReportMinutes = reportMinutes + (departureTimezoneOffset - 8) * 60
  }
  if (localReportMinutes < 0) localReportMinutes += 1440
  const localReportTime = minutesToHHMM(localReportMinutes % 1440)

  const sectorCount = entry.sectors?.length || 0

  // Build chained route string like "WSSS-VVNB-WSSS" (dep of first + arr of each sector)
  const route = entry.sectors && entry.sectors.length > 0
    ? [
        entry.sectors[0].departureIata || "?",
        ...entry.sectors.map((s) => s.arrivalIata || "?"),
      ].join("-").toUpperCase()
    : undefined

  const fdpResult = deriveMaxFDP({
    reportTime: entry.reportTime,
    fdpStartLocal: localReportTime,
    sectorCount,
    sectorMinutes,
    departureTimezoneOffset,
  })

  const today = new Date().toISOString().split("T")[0]

  return {
    id: entry.id,
    date: entry.date,
    reportTime: entry.reportTime,
    debriefTime: entry.debriefTime,
    dutyMinutes,
    flightMinutes,
    sectorCount,
    maxFdpMinutes: fdpResult.maxFdpMinutes,
    fdpExtensionUsed: false,
    fdpTableUsed: fdpResult.tableUsed,
    fdpStartLocal: localReportTime,
    departureTimezoneOffset,
    effectiveSectors: fdpResult.effectiveSectors,
    sectorMinutes,
    ...collectScheduleCircadianInstants(entry),
    source: "schedule",
    isFuture: entry.date > today,
    scheduleEntryIds: [entry.id],
    flightIds: entry.linkedFlightIds || [],
    route,
  }
}

/**
 * Get duty periods from schedule entries (flight duties only).
 * @param entries - Schedule entries
 * @param airportTimezones - Pre-resolved map of IATA code → UTC offset
 */
export function getDutyPeriodsFromSchedule(
  entries: ScheduleEntry[],
  airportTimezones?: Map<string, number>
): DutyPeriod[] {
  return entries
    .filter((entry) => entry.reportTime && entry.debriefTime)
    .map((entry) => {
      if (entry.dutyType === "standby") return calculateStandbyDutyPeriod(entry)
      if (entry.dutyType !== "flight") return null
      const depIata = entry.sectors?.[0]?.departureIata
      const tzOffset = depIata && airportTimezones ? airportTimezones.get(depIata) ?? 8 : 8
      return calculateDutyPeriodFromSchedule(entry, tzOffset)
    })
    .filter((dp): dp is DutyPeriod => dp !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

// ============================================
// Standby (Fifth Schedule paragraph 6)
// ============================================

/**
 * How a standby is served, which is what decides its treatment.
 *
 * Para 6(7): only **20%** of standby at home or in local accommodation counts
 * toward the cumulative duty limits of para 12.
 * Para 6(3): AIRPORT standby is part of the minimum rest period where adequate
 * rest facilities are provided, and part of the following FDP where they are
 * not — so it is never a separate contribution of its own.
 */
export type StandbyKind = "home" | "airport"

/** Para 6(7). */
export const HOME_STANDBY_DUTY_FRACTION = 0.2

/** Para 6(2)(a) — the length of a flight crew member's standby duty. */
export const MAX_STANDBY_HOURS_FLIGHT_CREW = 18

/**
 * Which kind of standby a company duty code names.
 *
 * Every code currently maps to `home`, which is what this operator rosters.
 * It is a lookup rather than a constant so that the day airport standby
 * appears it is an entry here, not a rewrite — and so the reading in force is
 * written down rather than assumed.
 */
const STANDBY_KIND_BY_CODE: Record<string, StandbyKind> = {}

export function standbyKind(dutyCode: string | undefined): StandbyKind {
  return STANDBY_KIND_BY_CODE[(dutyCode || "").toUpperCase().trim()] ?? "home"
}

/**
 * A standby as a duty period.
 *
 * It is a DUTY period but not a FLIGHT duty period, so it carries no FDP
 * maximum — `maxFdpMinutes: 0` — and must never reach an FDP gauge or an FDP
 * exceedance check. What it does carry:
 *
 * - `dutyMinutes`, the real length, which is what para 3's rest rules and para
 *   6(2)(a)'s 18-hour cap are measured against, and what makes the rest BEFORE
 *   a standby checkable at all;
 * - `countedDutyMinutes`, the 20% of para 6(7) that reaches the cumulative
 *   limits. Airport standby contributes nothing separately (para 6(3) folds it
 *   into the rest period or the following FDP), so it counts zero here.
 */
export function calculateStandbyDutyPeriod(entry: ScheduleEntry): DutyPeriod | null {
  if (!entry.reportTime || !entry.debriefTime) return null

  const startMin = hhmmToMinutes(entry.reportTime)
  let endMin = hhmmToMinutes(entry.debriefTime)
  if (endMin <= startMin) endMin += 1440
  const dutyMinutes = endMin - startMin
  if (dutyMinutes <= 0) return null

  const kind = standbyKind(entry.dutyCode)
  const today = new Date().toISOString().split("T")[0]

  return {
    id: entry.id,
    date: entry.date,
    reportTime: entry.reportTime,
    debriefTime: entry.debriefTime,
    dutyMinutes,
    countedDutyMinutes:
      kind === "home" ? Math.round(dutyMinutes * HOME_STANDBY_DUTY_FRACTION) : 0,
    flightMinutes: 0,
    sectorCount: 0,
    // Not a flight duty period. A dash on the panel, never a default.
    maxFdpMinutes: 0,
    fdpExtensionUsed: false,
    dutyKind: "standby",
    standbyKind: kind,
    source: "schedule",
    isFuture: entry.date > today,
    scheduleEntryIds: [entry.id],
    flightIds: [],
  }
}

/**
 * Para 6(6) — activation.
 *
 * > the standby duty ceases from the moment the crew member is activated for
 * > duty; and the duty period commences from the moment that crew member
 * > reports for duty at the designated reporting point.
 *
 * So a standby that is called out ends at the following duty's report, and its
 * counted contribution is taken over the truncated window. Left whole, the
 * called-out hours are counted twice — once at 20% as standby and again in
 * full as the flight duty they turned into.
 *
 * A standby the pilot was never called out on is untouched.
 */
/**
 * The rule itself: the earliest report falling INSIDE a standby window is the
 * activation. Absolute minutes throughout, so a window crossing midnight and a
 * duty reporting the next morning compare correctly.
 *
 * Shared, because two callers need the same answer from different data — the
 * FDP pipeline works in duty periods, and the roster page has schedule entries
 * and flights. Two copies of "was this standby called out" would drift.
 *
 * @returns the activation as absolute minutes, or null
 */
export function findActivationMinute(
  standbyStartAbs: number,
  standbyEndAbs: number,
  reportAbsMinutes: number[]
): number | null {
  let earliest = Infinity
  for (const reportAbs of reportAbsMinutes) {
    if (reportAbs > standbyStartAbs && reportAbs < standbyEndAbs && reportAbs < earliest) {
      earliest = reportAbs
    }
  }
  return earliest === Infinity ? null : earliest
}

/**
 * Is this standby one the crew member was never called out on?
 *
 * Such a standby is treated as REST: the rest period runs straight through it,
 * so it neither requires rest after it nor resets the clock for the duty that
 * follows. The crew member spent it at home, which is where rest is taken —
 * the same reading para 6(3) already applies to airport standby served with
 * adequate rest facilities.
 *
 * It still contributes para 6(7)'s 20% to the cumulative limits. "Did you
 * rest" and "how many hours have you worked" are different questions and the
 * schedule answers them in different paragraphs.
 *
 * ⚠ ASSUMED, PENDING CONFIRMATION. Para 3(1)(c)/(d) are written against a
 * "duty period", not a flight duty period, so read literally a 12-hour standby
 * does demand 12 hours of rest after it. This is the operator's practice taken
 * over the literal text, and it is the PERMISSIVE direction — it should be
 * re-checked against a real roster before it is settled.
 */
export function isRestingStandby(dp: DutyPeriod): boolean {
  return dp.dutyKind === "standby" && !dp.activatedAt
}

export function truncateActivatedStandby(dutyPeriods: DutyPeriod[]): DutyPeriod[] {
  const flightDuties = dutyPeriods.filter((dp) => dp.dutyKind !== "standby")
  if (flightDuties.length === 0) return dutyPeriods

  const reportAbsMinutes = flightDuties.map(
    (duty) => dateToDays(duty.date) * 1440 + hhmmToMinutes(duty.reportTime)
  )

  return dutyPeriods.map((dp) => {
    if (dp.dutyKind !== "standby") return dp

    const startAbs = dateToDays(dp.date) * 1440 + hhmmToMinutes(dp.reportTime)
    const endAbs = startAbs + dp.dutyMinutes

    const activationAbs = findActivationMinute(startAbs, endAbs, reportAbsMinutes)
    if (activationAbs === null) return dp

    const dutyMinutes = activationAbs - startAbs
    return {
      ...dp,
      dutyMinutes,
      countedDutyMinutes:
        dp.standbyKind === "home"
          ? Math.round(dutyMinutes * HOME_STANDBY_DUTY_FRACTION)
          : 0,
      debriefTime: minutesToHHMM(((activationAbs % 1440) + 1440) % 1440),
      activatedAt: minutesToHHMM(((activationAbs % 1440) + 1440) % 1440),
    }
  })
}

// ============================================
// DutyPeriod creation from flight logs
// ============================================

/**
 * Create duty periods from actual flight logs, grouped by date.
 * Flights on the same date are split into separate duty periods when the gap
 * between consecutive flights (previous IN → next OUT) exceeds minimum rest
 * (10h), indicating the pilot went off duty between them.
 * Estimates report/debrief from earliest OUT and latest IN times.
 */
export function createDutyPeriodsFromFlights(flights: FlightLog[]): DutyPeriod[] {
  // Group flights by date
  const byDate = new Map<string, FlightLog[]>()
  for (const flight of flights) {
    if (!flight.date) continue
    const existing = byDate.get(flight.date) || []
    existing.push(flight)
    byDate.set(flight.date, existing)
  }

  const dutyPeriods: DutyPeriod[] = []

  for (const [date, dateFlights] of byDate) {
    // Sort flights by OUT time within the date.
    // Future flights have no outTime, so fall back to scheduledOut; otherwise
    // every future sector collapses to 0 and stays in insertion order, which
    // reverses the route string when IndexedDB returns them out of order.
    const sorted = [...dateFlights].sort((a, b) => {
      const aOut = a.outTime ? hhmmToMinutes(a.outTime)
        : a.scheduledOut ? hhmmToMinutes(a.scheduledOut) : 0
      const bOut = b.outTime ? hhmmToMinutes(b.outTime)
        : b.scheduledOut ? hhmmToMinutes(b.scheduledOut) : 0
      return aOut - bOut
    })

    // Split into sub-groups when gap between consecutive flights >= MIN_REST_MINUTES
    const subGroups: FlightLog[][] = [[sorted[0]]]
    for (let i = 1; i < sorted.length; i++) {
      const prevFlight = sorted[i - 1]
      const currFlight = sorted[i]

      if (prevFlight.inTime && currFlight.outTime) {
        let prevIn = hhmmToMinutes(prevFlight.inTime)
        // Handle overnight IN
        if (prevFlight.outTime && prevIn < hhmmToMinutes(prevFlight.outTime)) {
          prevIn += 1440
        }
        const currOut = hhmmToMinutes(currFlight.outTime)
        const gap = currOut - prevIn
        // If gap < 0, currOut is earlier in the day (shouldn't happen after sort)
        // If gap >= MIN_REST_MINUTES, start a new sub-group
        if (gap >= MIN_REST_MINUTES) {
          subGroups.push([currFlight])
          continue
        }
      }

      subGroups[subGroups.length - 1].push(currFlight)
    }

    // Create a DutyPeriod for each sub-group
    for (let idx = 0; idx < subGroups.length; idx++) {
      const groupFlights = subGroups[idx]
      const dp = createDutyPeriodFromFlightGroup(date, groupFlights, idx, subGroups.length)
      if (dp) dutyPeriods.push(dp)
    }
  }

  return dutyPeriods.sort((a, b) => a.date.localeCompare(b.date))
}

/** Create a single DutyPeriod from a group of flights on the same date */
function createDutyPeriodFromFlightGroup(
  date: string,
  groupFlights: FlightLog[],
  groupIdx: number,
  totalGroups: number
): DutyPeriod | null {
  let totalFlightMinutes = 0
  let earliestOut = Infinity
  let earliestScheduledOut = Infinity
  let earliestStatedReport = Infinity
  let latestIn = -Infinity

  for (const flight of groupFlights) {
    if (flight.blockTime) {
      totalFlightMinutes += hhmmToMinutes(flight.blockTime)
    }
    if (flight.outTime) {
      earliestOut = Math.min(earliestOut, hhmmToMinutes(flight.outTime))
    }
    // Track scheduled OUT for FDP table lookup (CAAS uses scheduled, not actual)
    if (flight.scheduledOut) {
      earliestScheduledOut = Math.min(earliestScheduledOut, hhmmToMinutes(flight.scheduledOut))
    }
    // An explicitly recorded report — only a duty's first sector normally
    // carries one, but take the earliest so it does not matter which.
    if (flight.reportTime) {
      earliestStatedReport = Math.min(earliestStatedReport, hhmmToMinutes(flight.reportTime))
    }
    if (flight.inTime) {
      let inMin = hhmmToMinutes(flight.inTime)
      // Handle overnight: if IN is before OUT, it's next day
      if (flight.outTime && inMin < hhmmToMinutes(flight.outTime)) {
        inMin += 1440
      }
      latestIn = Math.max(latestIn, inMin)
    }
  }

  // Fall back to scheduled times when actual times are missing
  if (earliestOut === Infinity && earliestScheduledOut !== Infinity) {
    earliestOut = earliestScheduledOut
  }
  if (latestIn === -Infinity) {
    for (const flight of groupFlights) {
      if (flight.scheduledIn) {
        let inMin = hhmmToMinutes(flight.scheduledIn)
        const outRef = flight.scheduledOut
        if (outRef && inMin < hhmmToMinutes(outRef)) {
          inMin += 1440
        }
        latestIn = Math.max(latestIn, inMin)
      }
    }
  }

  if (totalFlightMinutes === 0) {
    for (const flight of groupFlights) {
      if (flight.scheduledOut && flight.scheduledIn) {
        let blockMin = hhmmToMinutes(flight.scheduledIn) - hhmmToMinutes(flight.scheduledOut)
        if (blockMin < 0) blockMin += 1440
        totalFlightMinutes += blockMin
      }
    }
  }

  if (earliestOut === Infinity || latestIn === -Infinity) return null

  // ── When the duty period began ─────────────────────────────────────────
  //
  // The ORIGINAL (rostered) report is the SCHEDULED gate-out less the hour
  // para 7(2) allows for pre-flight checks — and it is also the default for
  // when the duty actually started. Deriving the report from the ACTUAL
  // gate-out instead, which is what this did, is right only when the company
  // moved the report by exactly the pushback delay; in the ordinary case of a
  // late aircraft and an unchanged report it slid the duty's start forward
  // with the delay and made the duty look shorter than it was.
  //
  // A stated `flight.reportTime` overrides it. That is the case para 10
  // governs: informed of a delay before leaving the place of rest, so the
  // report itself moves while the scheduled departure may not.
  const originalReportMinutes = Math.max(
    0,
    (earliestScheduledOut !== Infinity ? earliestScheduledOut : earliestOut) -
      REPORT_BUFFER_MINUTES
  )
  const reportMinutes =
    earliestStatedReport !== Infinity ? earliestStatedReport : originalReportMinutes

  // A duty period "ends when that crew member is free from all duties", and
  // para 7(2) puts at least 30 minutes of post-flight checks after gate-in.
  const debriefMinutes = latestIn + DEBRIEF_BUFFER_MINUTES

  // ── Para 10 — delayed reporting ────────────────────────────────────────
  //
  //   (a) where the delay is less than 4 hours, the maximum permitted flight
  //       duty period is based on the ORIGINAL reporting time but the flight
  //       duty period starts at the ACTUAL reporting time;
  //   (b) where the delay is 4 hours or more, the maximum permitted flight
  //       duty period is based on the ACTUAL reporting time but the flight
  //       duty period starts 4 HOURS AFTER the original reporting time.
  //
  // Under (b) the FDP window therefore opens BEFORE the crew member reports,
  // so part of it is already spent by the time they do.
  const reportDelayMinutes = Math.max(0, reportMinutes - originalReportMinutes)
  const rebasedOnActual = reportDelayMinutes >= DELAY_REBASE_MINUTES
  const scheduledReportMinutes = rebasedOnActual ? reportMinutes : originalReportMinutes
  const fdpElapsedAtReport = rebasedOnActual
    ? reportDelayMinutes - DELAY_REBASE_MINUTES
    : 0

  // Normalize to within 24h for display
  const reportTime = minutesToHHMM(reportMinutes % 1440)
  const debriefTime = minutesToHHMM(debriefMinutes % 1440)

  const dutyMinutes = debriefMinutes - reportMinutes

  // Departure timezone from the first flight, arrival timezone from the last —
  // the latter is where the crew member is when the duty ends, which is the
  // "local time" a local night is measured in.
  const depTzOffset = groupFlights[0]?.departureTimezone ?? 8
  const arrTzOffset =
    groupFlights[groupFlights.length - 1]?.arrivalTimezone ?? depTzOffset

  // EVERY sector's block time — para 14(2) counts each long sector up, not
  // only the longest.
  const sectorMinutes = groupFlights.map((f) =>
    f.blockTime ? hhmmToMinutes(f.blockTime) : 0
  )

  const circadianInstants = collectCircadianInstants(date, groupFlights)

  // Para 14 enters its tables on the local time of start of the FDP, taken
  // from the SCHEDULED report — para 10(a) keeps the maximum on the original
  // reporting time when the actual one slips by less than 4 hours.
  const localReportTime = toLocalClock(scheduledReportMinutes, depTzOffset)

  const fdpResult = deriveMaxFDP({
    reportTime,
    fdpStartLocal: localReportTime,
    sectorCount: groupFlights.length,
    sectorMinutes,
    departureTimezoneOffset: depTzOffset,
  })

  // Use unique id when multiple duty periods exist on same date
  const id = totalGroups > 1 ? `logbook-${date}-${groupIdx}` : `logbook-${date}`

  // Build chained route string like "WSSS-VVNB-WSSS" (prefers ICAO, falls back to IATA)
  const route = groupFlights.length > 0
    ? [
        groupFlights[0].departureIcao || groupFlights[0].departureIata || "?",
        ...groupFlights.map((f) => f.arrivalIcao || f.arrivalIata || "?"),
      ].join("-").toUpperCase()
    : ""

  return {
    id,
    date,
    reportTime,
    debriefTime,
    dutyMinutes,
    flightMinutes: totalFlightMinutes,
    sectorCount: groupFlights.length,
    maxFdpMinutes: fdpResult.maxFdpMinutes,
    fdpExtensionUsed: false,
    fdpTableUsed: fdpResult.tableUsed,
    fdpStartLocal: localReportTime,
    fdpElapsedAtReport,
    departureTimezoneOffset: depTzOffset,
    arrivalTimezoneOffset: arrTzOffset,
    effectiveSectors: fdpResult.effectiveSectors,
    sectorMinutes,
    ...circadianInstants,
    source: "logbook",
    isFuture: date > new Date().toISOString().split("T")[0],
    scheduleEntryIds: [],
    flightIds: groupFlights.map((f) => f.id),
    route,
  }
}

// ============================================
// Circadian instants (para 4 / First Schedule)
// ============================================

/** The absolute UTC instants paragraph 4's classification is drawn from. */
interface CircadianInstants {
  departureMs?: number
  arrivalMs?: number
  takeoffLandingMs?: number[]
}

/**
 * Collect the instants the three circadian definitions are tested against.
 *
 * They are stored as absolute UTC instants rather than classified here, because
 * "early start", "late finish" and "window of circadian low" are all defined in
 * the crew member's ACCLIMATED time — and acclimatisation is a property of the
 * whole timeline, not of one duty (`applyAcclimatisation` does the classifying).
 *
 * Two readings of the source data are deliberate:
 *
 * - **One source per flight.** A flight that has been flown supplies its actual
 *   times; one that has not supplies its scheduled ones. Mixing the two within a
 *   sector risks an actual time reading as earlier than the scheduled one it
 *   follows, which the day-wrap below would push a whole day out.
 * - **Gate times stand in for wheels times when a flight has none.** The window
 *   of circadian low is defined in relation to a TAKE-OFF or LANDING, so off/on
 *   are preferred; a duty that records neither (every planned duty, and older
 *   logbook rows) would otherwise be classified as never touching the window at
 *   all, which is the permissive way to be wrong.
 */
function collectCircadianInstants(
  date: string,
  groupFlights: FlightLog[]
): CircadianInstants {
  const dayStartMinutes = dateToDays(date) * 1440

  // A duty runs strictly forward from its first gate-out, so any time that
  // reads as earlier than the one before it belongs to the following day.
  let cursor = -1
  const step = (time?: string): number | undefined => {
    if (!time) return undefined
    let m = hhmmToMinutes(time)
    while (m < cursor) m += 1440
    cursor = m
    return (dayStartMinutes + m) * 60_000
  }

  let departureMs: number | undefined
  let arrivalMs: number | undefined
  const takeoffLandingMs: number[] = []

  for (const flight of groupFlights) {
    const flown = Boolean(flight.outTime)
    const outT = flown ? flight.outTime : flight.scheduledOut
    const inT = flown ? flight.inTime : flight.scheduledIn
    const offT = (flown ? flight.offTime : undefined) ?? outT
    const onT = (flown ? flight.onTime : undefined) ?? inT

    const out = step(outT)
    const off = step(offT)
    const on = step(onT)
    const arrived = step(inT)

    if (out !== undefined && departureMs === undefined) departureMs = out
    if (off !== undefined) takeoffLandingMs.push(off)
    if (on !== undefined) takeoffLandingMs.push(on)
    if (arrived !== undefined) arrivalMs = arrived
  }

  return {
    departureMs,
    arrivalMs,
    takeoffLandingMs: takeoffLandingMs.length ? takeoffLandingMs : undefined,
  }
}

/**
 * The same instants, from a schedule entry's sectors.
 *
 * A schedule entry's times are in whatever frame the report stated, so they are
 * shifted to UTC first. A LOCAL_STATION report cannot be: its departure-side and
 * arrival-side times are in DIFFERENT zones and the entry does not carry the
 * arrival's offset, so it returns nothing rather than a classification that
 * could be a whole timezone out.
 */
function collectScheduleCircadianInstants(entry: ScheduleEntry): CircadianInstants {
  if (entry.timeReference === "LOCAL_STATION") return {}
  const toUtcShift =
    entry.timeReference === "UTC" ? 0 : -HOME_BASE_OFFSET_MINUTES

  const dayStartMinutes = dateToDays(entry.date) * 1440

  let cursor = -1
  const step = (time?: string): number | undefined => {
    if (!time) return undefined
    let m = hhmmToMinutes(time)
    while (m < cursor) m += 1440
    cursor = m
    return (dayStartMinutes + m + toUtcShift) * 60_000
  }

  let departureMs: number | undefined
  let arrivalMs: number | undefined
  const takeoffLandingMs: number[] = []

  for (const sector of entry.sectors ?? []) {
    const out = step(sector.actualOut || sector.scheduledOut)
    const arrived = step(sector.actualIn || sector.scheduledIn)
    if (out !== undefined && departureMs === undefined) departureMs = out
    // A schedule carries gate times only — they stand in for the wheels times,
    // as above.
    if (out !== undefined) takeoffLandingMs.push(out)
    if (arrived !== undefined) takeoffLandingMs.push(arrived)
    if (arrived !== undefined) arrivalMs = arrived
  }

  return {
    departureMs,
    arrivalMs,
    takeoffLandingMs: takeoffLandingMs.length ? takeoffLandingMs : undefined,
  }
}

// ============================================
// Merging logbook + schedule duty periods
// ============================================

/**
 * Merge logbook and schedule duty periods into a unified timeline.
 * - Past dates: prefer logbook data (actual); include schedule non-flight duties
 * - Future dates: use schedule data
 * - Same date with both: merge (logbook flight times + schedule report/debrief)
 *
 * Supports multiple logbook duty periods on the same date (e.g., morning
 * and evening duties split by a rest period >= 10h).
 */
export function mergeDutyPeriods(
  logbookDPs: DutyPeriod[],
  scheduleDPs: DutyPeriod[]
): DutyPeriod[] {
  const today = new Date().toISOString().split("T")[0]
  const result: DutyPeriod[] = []

  // Index logbook DPs by date (supports multiple per date)
  const logbookByDate = new Map<string, DutyPeriod[]>()
  for (const dp of logbookDPs) {
    const existing = logbookByDate.get(dp.date) || []
    existing.push(dp)
    logbookByDate.set(dp.date, existing)
  }

  const consumedDates = new Set<string>()

  // Process schedule entries
  for (const dp of scheduleDPs) {
    // Only a schedule FLIGHT duty is an alternative record of a logbook duty,
    // and only that competes for the date. A standby is a DIFFERENT duty that
    // happens to fall on the same day — and the day it shares with a flight is
    // precisely the day it was activated on, so consuming the date there threw
    // away the one standby whose hours needed accounting for. It also hid the
    // pair from `truncateActivatedStandby`, which is what para 6(6) needs to
    // see to stop those hours being counted twice.
    if (dp.dutyKind && dp.dutyKind !== "flight") {
      result.push({ ...dp, isFuture: dp.date > today })
      continue
    }

    const logbookDPsForDate = logbookByDate.get(dp.date)

    if (dp.date > today) {
      // Future: use schedule data, mark as future
      result.push({ ...dp, isFuture: true })
      consumedDates.add(dp.date)
    } else if (logbookDPsForDate && !consumedDates.has(dp.date)) {
      // Past with both: prefer logbook DPs (may be multiple), mark as consumed
      for (const logDP of logbookDPsForDate) {
        result.push({ ...logDP, source: "merged" })
      }
      consumedDates.add(dp.date)
    } else if (!consumedDates.has(dp.date)) {
      // Past schedule only (e.g. training counted as duty)
      result.push({ ...dp, isFuture: false })
    }
  }

  // Add remaining logbook entries not matched by schedule
  for (const [date, dps] of logbookByDate) {
    if (!consumedDates.has(date)) {
      for (const dp of dps) {
        result.push(dp)
      }
    }
  }

  // Sort chronologically (oldest first) for rest period calculation
  return result.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date)
    if (dateCmp !== 0) return dateCmp
    return hhmmToMinutes(a.reportTime) - hhmmToMinutes(b.reportTime)
  })
}

// ============================================
// Overnight duty period merging
// ============================================

/** Minimum rest period in minutes (Reg 3(1)(a): 10h) */
const MIN_REST_MINUTES = 600

/**
 * Merge adjacent duty periods where the gap between debrief and next report
 * is less than minimum rest (10 hours).
 * This handles overnight flights that get split across dates.
 */
export function mergeAdjacentDutyPeriods(dutyPeriods: DutyPeriod[]): DutyPeriod[] {
  if (dutyPeriods.length <= 1) return dutyPeriods

  // Sort chronologically
  const sorted = [...dutyPeriods].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date)
    if (dateCmp !== 0) return dateCmp
    return hhmmToMinutes(a.reportTime) - hhmmToMinutes(b.reportTime)
  })

  const result: DutyPeriod[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1]
    const curr = sorted[i]

    // Only like merges with like. A standby that runs into a flight duty is
    // two different kinds of duty period — one carries an FDP maximum and the
    // other cannot — and merging them would give the pair a single maximum
    // covering hours paragraph 14 never applied to. Para 6(6) handles that
    // pairing instead, by ending the standby at activation.
    if ((prev.dutyKind ?? "flight") !== (curr.dutyKind ?? "flight")) {
      result.push(curr)
      continue
    }

    // Calculate absolute minutes for debrief and report
    const prevDayMinutes = dateToDays(prev.date) * 1440
    let prevDebriefAbs = prevDayMinutes + hhmmToMinutes(prev.debriefTime)
    // Handle debrief wrapping past midnight
    if (hhmmToMinutes(prev.debriefTime) < hhmmToMinutes(prev.reportTime)) {
      prevDebriefAbs += 1440
    }

    const currDayMinutes = dateToDays(curr.date) * 1440
    const currReportAbs = currDayMinutes + hhmmToMinutes(curr.reportTime)

    const gap = currReportAbs - prevDebriefAbs

    if (gap < MIN_REST_MINUTES) {
      // Merge: combine into a single duty period
      let currDebriefAbs = currDayMinutes + hhmmToMinutes(curr.debriefTime)
      if (hhmmToMinutes(curr.debriefTime) < hhmmToMinutes(curr.reportTime)) {
        currDebriefAbs += 1440
      }

      const prevReportAbs = prevDayMinutes + hhmmToMinutes(prev.reportTime)
      const totalDutyMinutes = currDebriefAbs - prevReportAbs
      const totalSectors = prev.sectorCount + curr.sectorCount

      // The merged duty's sector lengths, so para 14(2) still applies. Without
      // them this recompute used the sector COUNT alone and silently dropped
      // the long sector adjustment, so an over-long merged overnight read as
      // compliant.
      const mergedSectorMinutes = [
        ...(prev.sectorMinutes ?? []),
        ...(curr.sectorMinutes ?? []),
      ]

      // The merged duty COMMENCES when the first one did, so it keeps the
      // first one's table entry. This used to re-derive it from
      // `prev.reportTime` — the actual report — which is the para 10(a)
      // mistake, and on a duty reporting near 2200 it moved the lookup into
      // the next band and lost an hour of FDP.
      const fdpResult = deriveMaxFDP({
        ...prev,
        sectorCount: totalSectors,
        sectorMinutes: mergedSectorMinutes,
      })

      result[result.length - 1] = {
        ...prev,
        debriefTime: curr.debriefTime,
        dutyMinutes: totalDutyMinutes,
        flightMinutes: prev.flightMinutes + curr.flightMinutes,
        sectorCount: totalSectors,
        maxFdpMinutes: fdpResult.maxFdpMinutes,
        fdpTableUsed: fdpResult.tableUsed,
        effectiveSectors: fdpResult.effectiveSectors,
        sectorMinutes: mergedSectorMinutes,
        // The merged duty departs when the first one did and arrives when the
        // second one did, and every take-off and landing belongs to it. Dropped,
        // a merged overnight would be classified against half of itself — and
        // an overnight is precisely the shape that lands in the window of
        // circadian low.
        departureMs: prev.departureMs ?? curr.departureMs,
        arrivalMs: curr.arrivalMs ?? prev.arrivalMs,
        takeoffLandingMs:
          prev.takeoffLandingMs || curr.takeoffLandingMs
            ? [...(prev.takeoffLandingMs ?? []), ...(curr.takeoffLandingMs ?? [])]
            : undefined,
        flightIds: [...prev.flightIds, ...curr.flightIds],
        scheduleEntryIds: [...prev.scheduleEntryIds, ...curr.scheduleEntryIds],
        source: prev.source !== curr.source ? "merged" : prev.source,
        route: (() => {
          // Chain two route strings, collapsing duplicate airports at the seam
          // (e.g. "WSSS-VVNB-WSSS" + "WSSS-KIX-WSSS" → "WSSS-VVNB-WSSS-KIX-WSSS")
          const a = prev.route ? prev.route.split("-") : []
          const b = curr.route ? curr.route.split("-") : []
          if (!a.length) return b.join("-") || undefined
          if (!b.length) return a.join("-") || undefined
          const merged = a[a.length - 1] === b[0] ? [...a, ...b.slice(1)] : [...a, ...b]
          return merged.join("-") || undefined
        })(),
      }
    } else {
      result.push(curr)
    }
  }

  return result
}

// ============================================
// Max FDP calculation (CAAS Reg 14 Fifth Schedule)
// ============================================

export interface FdpCalculationParams {
  reportTimeLocal: string              // HH:MM in local time at departure
  sectors: number
  crewConfig?: CrewConfiguration       // default: "two-pilot"
  augmentedCrew?: AugmentedCrewLevel   // default: "none"
  departureTimezoneOffset?: number     // default: 8 (SGT = acclimated)
  /**
   * EVERY sector's block time, in minutes. Preferred over
   * `longestSectorMinutes`: para 14(2) counts every long sector up, not only
   * the longest one.
   */
  sectorMinutes?: number[]
  /** Just the longest sector, for callers that have nothing better. */
  longestSectorMinutes?: number
  /**
   * The zone the crew member is ACCLIMATED to, in hours from UTC.
   *
   * Para 14(1)(a) compares the local time where the FDP commences against the
   * crew member's acclimated time — which the First Schedule defines as the
   * zone they have spent three consecutive local nights free of duty in, not
   * home base. Defaults to home base for a caller with no history to derive it
   * from.
   */
  acclimatedOffset?: number
  /**
   * Whether appropriate in-flight rest facilities are confirmed available.
   * Para 15(1)(b) makes them a condition of any augmented-crew extension and
   * 15(3)(b) forbids the extension without them, so an unset value withholds
   * it rather than assuming.
   */
  inFlightRestFacilities?: boolean
}

export interface FdpCalculationResult {
  maxFdpMinutes: number
  tableUsed: FdpTableUsed
  effectiveSectors: number
}

/**
 * Calculate max FDP per CAAS Regulation 14 Fifth Schedule.
 *
 * Overload 1 (backward-compatible): (reportTime, sectors) → number
 * Overload 2 (full): (params) → { maxFdpMinutes, tableUsed, effectiveSectors }
 */
export function calculateMaxFDP(reportTime: string, sectors: number): number
export function calculateMaxFDP(params: FdpCalculationParams): FdpCalculationResult
export function calculateMaxFDP(
  reportTimeOrParams: string | FdpCalculationParams,
  sectorsArg?: number
): number | FdpCalculationResult {
  if (typeof reportTimeOrParams === "string") {
    // Backward-compatible: old callers get just the number
    const result = calculateMaxFDPFull({
      reportTimeLocal: reportTimeOrParams,
      sectors: sectorsArg!,
    })
    return result.maxFdpMinutes
  }
  return calculateMaxFDPFull(reportTimeOrParams)
}

function calculateMaxFDPFull(params: FdpCalculationParams): FdpCalculationResult {
  const {
    reportTimeLocal,
    sectors,
    crewConfig = "two-pilot",
    augmentedCrew = "none",
    departureTimezoneOffset = 8,
    acclimatedOffset = 8,
    sectorMinutes,
    longestSectorMinutes = 0,
    inFlightRestFacilities,
  } = params

  const localHour = Math.floor(hhmmToMinutes(reportTimeLocal) / 60)

  // Determine which table to use
  let tableUsed: FdpTableUsed
  if (crewConfig === "single-pilot") {
    tableUsed = "C"
  } else if (isAcclimated(departureTimezoneOffset, acclimatedOffset)) {
    tableUsed = "A"
  } else {
    tableUsed = "B"
  }

  // Long sector adjustment — para 14(2).
  //
  // It applies ONLY "when the assigned flight crew for a flight of a large
  // aeroplane only consists of 2 pilots", and only to Tables A and B: an
  // augmented crew is not that crew (its ceiling comes from para 15 instead),
  // and Table C is not named in 14(2) at all.
  const lengths = sectorMinutes?.length ? sectorMinutes : longestSectorMinutes
  let effectiveSectors = sectors
  if (tableUsed !== "C" && augmentedCrew === "none") {
    effectiveSectors = applyLongSectorAdjustment(
      sectors,
      lengths,
      tableUsed as "A" | "B"
    )
  }

  // Look up base FDP from the appropriate table
  let maxFdpMinutes: number
  switch (tableUsed) {
    case "A":
      maxFdpMinutes = lookupTableA(localHour, effectiveSectors)
      break
    case "B":
      maxFdpMinutes = lookupTableB(effectiveSectors)
      break
    case "C":
      maxFdpMinutes = lookupTableC(localHour, sectors)
      break
  }

  // Augmented crew extension — para 15. Withheld without confirmed rest
  // facilities (para 15(3)(b)).
  if (augmentedCrew !== "none") {
    maxFdpMinutes = applyAugmentedCrewExtension(
      maxFdpMinutes,
      augmentedCrew,
      inFlightRestFacilities
    )
  }

  return { maxFdpMinutes, tableUsed, effectiveSectors }
}

/**
 * **THE** way to get a duty period's FDP maximum. Every stage goes through
 * this — the two producers, the overnight merge and the acclimatisation pass.
 *
 * It exists because the maximum used to be recomputed at each of those stages
 * from whatever inputs that stage happened to have, and they disagreed. The
 * producers correctly entered Table A on the SCHEDULED report time; the merge
 * and the acclimatisation pass re-derived it from `reportTime`, which is the
 * ACTUAL one. On a real duty reporting at 2150 local and pushing back 23
 * minutes late, that moved the lookup from the 1500–2159 band to 2200–0559 and
 * reported a maximum of 10:15 where the schedule allows 12:15.
 *
 * A later stage may know something the producer did not — so far only the
 * acclimatised zone, which needs the whole timeline — and passes it as an
 * override. Everything else is read off the duty period, so there is exactly
 * one set of inputs and one answer.
 */
export type FdpInputs = Pick<
  DutyPeriod,
  | "reportTime"
  | "sectorCount"
  | "sectorMinutes"
  | "departureTimezoneOffset"
  | "crewConfig"
  | "augmentedCrew"
  | "inFlightRestFacilities"
  | "acclimatedOffset"
  | "fdpStartLocal"
>

export function deriveMaxFDP(
  dp: FdpInputs,
  overrides: { acclimatedOffset?: number } = {}
): FdpCalculationResult {
  const depTz = dp.departureTimezoneOffset ?? HOME_BASE_OFFSET_MINUTES / 60

  return calculateMaxFDP({
    // A duty period built before `fdpStartLocal` existed falls back to the
    // actual report time, which is what every stage used to do — wrong only
    // for a delayed report, and better than no figure at all.
    reportTimeLocal:
      dp.fdpStartLocal ?? toLocalClock(hhmmToMinutes(dp.reportTime), depTz),
    sectors: dp.sectorCount,
    sectorMinutes: dp.sectorMinutes,
    departureTimezoneOffset: depTz,
    crewConfig: dp.crewConfig,
    augmentedCrew: dp.augmentedCrew,
    inFlightRestFacilities: dp.inFlightRestFacilities,
    acclimatedOffset: overrides.acclimatedOffset ?? dp.acclimatedOffset,
  })
}

/** A UTC minute-of-day read as a wall clock in a zone, as HH:MM. */
function toLocalClock(utcMinutes: number, tzOffsetHours: number): string {
  const local = utcMinutes + tzOffsetHours * 60
  return minutesToHHMM(((local % 1440) + 1440) % 1440)
}

// ============================================
// Rest period calculation (CAAS Reg 3)
// ============================================

/**
 * Does a rest interval include a LOCAL NIGHT, as the First Schedule defines it?
 *
 * > "Local night" means a period of 8 hours falling between 2200 hours and
 * > 0800 hours local time.
 *
 * Two things were wrong before the definition was to hand, and both made rest
 * look better than it was:
 *
 * 1. The window was modelled as a fixed 22:00–06:00. It is 2200 **to 0800** —
 *    a ten-hour envelope — and a local night is any eight contiguous hours
 *    inside it. Rest running 00:30 → 08:30 local contains a full local night
 *    and used to be reported as containing none.
 * 2. ANY overlap counted. One minute inside the window satisfied it, so a rest
 *    that clipped the edge of the night claimed the 10-hour rule of para 3(1)(a)
 *    when the 12-hour rule of 3(1)(b) applied.
 *
 * @param tzOffsetMinutes the zone the rest is taken in — the ARRIVAL station of
 *   the preceding duty, not home base, because "local time" means where the
 *   crew member is.
 */
export function includesLocalNight(
  debriefDate: string,
  debriefTime: string,
  reportDate: string,
  reportTime: string,
  tzOffsetMinutes: number = HOME_BASE_OFFSET_MINUTES
): boolean {
  const debriefMs =
    (dateToDays(debriefDate) * 1440 + hhmmToMinutes(debriefTime)) * 60_000
  const reportMs =
    (dateToDays(reportDate) * 1440 + hhmmToMinutes(reportTime)) * 60_000

  return containsLocalNight(debriefMs, reportMs, tzOffsetMinutes)
}

/** Convert YYYY-MM-DD to days since a reference for absolute comparison */
function dateToDays(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z")
  return Math.floor(d.getTime() / 86400000)
}

/** The inverse of `dateToDays` — needed to name the day a wrapped debrief
 *  actually falls on. */
function daysToDate(days: number): string {
  return new Date(days * 86400000).toISOString().slice(0, 10)
}

/**
 * Calculate rest period between two consecutive duty periods, per the Fifth
 * Schedule paragraph 3.
 *
 * The four sub-rules are CUMULATIVE conditions, not a precedence chain — every
 * one that applies must be satisfied, so the requirement is the largest of
 * them:
 *   (a) rest includes a local night → ≥10h
 *   (b) rest includes no local night → ≥12h
 *   (c) preceding duty over 10h and ≤16h → ≥ that duty, rounded up to the hour
 *   (d) preceding duty over 16h → ≥24h AND inclusive of a local night
 *
 * Paragraph 4 then adds its own 24-hour requirement around duties that
 * encompass an early start, a late finish, or a take-off or landing in the
 * window of circadian low — see `priorDisruptiveRun`.
 *
 * @param priorDisruptiveRun how many consecutive disruptive flight duty
 *   periods the crew member has completed since their last 24-hour circadian
 *   rest. Only `calculateAllRestPeriods` can know this; a standalone call
 *   treats a disruptive duty as the first of a series, which is para 4(1)(a).
 */
export function calculateRestPeriod(
  current: DutyPeriod,
  previous: DutyPeriod,
  priorDisruptiveRun: number = 0
): RestPeriodInfo {
  // Calculate actual rest in minutes
  const prevDebriefDay = dateToDays(previous.date)
  const currReportDay = dateToDays(current.date)

  let prevDebriefAbsolute = prevDebriefDay * 1440 + hhmmToMinutes(previous.debriefTime)
  const currReportAbsolute = currReportDay * 1440 + hhmmToMinutes(current.reportTime)

  // Handle debrief wrapping to next day (duty crossing midnight)
  if (previous.dutyMinutes > 0) {
    const prevReportAbsolute = prevDebriefDay * 1440 + hhmmToMinutes(previous.reportTime)
    if (prevDebriefAbsolute < prevReportAbsolute) {
      prevDebriefAbsolute += 1440 // debrief is next day
    }
  }

  // A "rest period" commences ONE HOUR after the individual is free of all
  // duties (First Schedule). The duty already ends after its post-flight
  // checks, so this hour sits on top of that — the code used to allow only 30
  // minutes from gate-in for both, which over-counted rest by an hour.
  const restMinutes =
    currReportAbsolute - prevDebriefAbsolute - REST_STARTS_AFTER_DUTY_MIN

  // Check if rest includes local night. The debrief DATE must be the wrapped
  // one: a duty that crossed midnight debriefs on the following day, and
  // testing the night window against the wrong day picks the wrong rest rule.
  const wrappedDebriefDate = daysToDate(Math.floor(prevDebriefAbsolute / 1440))
  const wrappedDebriefTime = minutesToHHMM(
    ((prevDebriefAbsolute % 1440) + 1440) % 1440
  )
  const hasLocalNight = includesLocalNight(
    wrappedDebriefDate,
    wrappedDebriefTime,
    current.date,
    current.reportTime,
    // Where the crew member actually is once the previous duty ends.
    previous.arrivalTimezoneOffset != null
      ? previous.arrivalTimezoneOffset * 60
      : HOME_BASE_OFFSET_MINUTES
  )

  const precedingDutyMinutes = previous.dutyMinutes

  // ── Para 3(1): EVERY applicable sub-rule must be satisfied ──────────────
  //
  // The schedule lists the minimum rest as "(a) … (b) … (c) … ; and (d) …",
  // which is a set of conditions, not a menu. (a) and (b) exclude each other
  // by their own wording, and so do (c) and (d) — but an (a)/(b) rule and a
  // (c)/(d) rule can BOTH bite at once, and then the longer one governs.
  //
  // Read as an if/else chain (which is what this was), an 11-hour duty
  // followed by rest with no local night required only the 11 hours of 3(c)
  // and ignored the 12 hours of 3(b). That under-states the requirement, which
  // is the dangerous direction.
  const candidates: Array<{ minutes: number; rule: RestPeriodInfo["rule"] }> = []

  // ── Para 4: duties encompassing an early start, a late finish, or a
  // take-off or landing in the window of circadian low ────────────────────
  //
  // 24 hours inclusive of a local night, before the FIRST such duty in a
  // series (4(1)(a)) and again before the next one after two consecutive ones
  // (4(2)). It is a requirement on the rest BEFORE the duty, so the CURRENT
  // duty's classification decides it, not the preceding one's.
  //
  // Pushed FIRST so that it names itself on a tie with para 3(1)(d), which is
  // also 24 hours: it is the rule a pilot would need to look up, and the same
  // rest satisfies 3(1)(d) anyway.
  const circadianRule = circadianRestRule(
    priorDisruptiveRun,
    current.circadian?.disruptive ?? false
  )
  if (circadianRule) {
    candidates.push({ minutes: CIRCADIAN_REST_MIN, rule: circadianRule })
  }

  // 3(1)(a) / 3(1)(b) — turns on whether the rest contains a local night.
  if (hasLocalNight) {
    candidates.push({ minutes: 10 * 60, rule: "3a" })
  } else {
    candidates.push({ minutes: 12 * 60, rule: "3b" })
  }

  // 3(1)(c) — preceding duty over 10h and not more than 16h: at least as long
  // as that duty, rounded UP to the next whole hour.
  if (precedingDutyMinutes > 10 * 60 && precedingDutyMinutes <= 16 * 60) {
    candidates.push({
      minutes: Math.ceil(precedingDutyMinutes / 60) * 60,
      rule: "3c",
    })
  }

  // 3(1)(d) — preceding duty over 16h: at least 24h AND inclusive of a local
  // night. The local night is part of the requirement, not a footnote.
  if (precedingDutyMinutes > 16 * 60) {
    candidates.push({ minutes: 24 * 60, rule: "3d" })
  }

  // The governing rule is whichever demands the most; on a tie the first
  // pushed wins, which is why para 4 goes in ahead of the para 3 candidates.
  const governing = candidates.reduce((a, b) => (b.minutes > a.minutes ? b : a))
  const requiredRestMinutes = governing.minutes
  const rule = governing.rule

  // Both 3(1)(d) and para 4 require the rest to INCLUDE a local night, so a
  // 24-hour rest with none is still not compliant.
  const localNightSatisfied =
    precedingDutyMinutes > 16 * 60 || circadianRule !== null ? hasLocalNight : true

  return {
    restMinutes: Math.max(0, restMinutes),
    requiredRestMinutes,
    includesLocalNight: hasLocalNight,
    precedingDutyMinutes,
    compliant: restMinutes >= requiredRestMinutes && localNightSatisfied,
    rule,
  }
}

/**
 * Enrich sorted duty periods with rest period information.
 * Expects duty periods sorted chronologically (oldest first).
 *
 * Also carries paragraph 4's running count of consecutive DISRUPTIVE duties —
 * ones encompassing an early start, a late finish, or a take-off or landing in
 * the window of circadian low. It has to be tracked across the timeline because
 * neither duty in a pair can see it: 4(2) reacts to the two duties BEFORE the
 * one whose rest is being measured.
 *
 * The count is "since the last 24-hour circadian rest", not "since the last
 * ordinary duty": once para 4 has required its 24 hours, the duty that follows
 * begins a fresh series, so a run of disruptive duties asks for 24 hours before
 * the first and again after every second one thereafter. A non-disruptive duty
 * clears it outright.
 */
export function calculateAllRestPeriods(sortedDPs: DutyPeriod[]): DutyPeriod[] {
  if (sortedDPs.length <= 1) return sortedDPs

  let disruptiveRun = 0
  // The last duty that actually ENDED a rest period. A standby the crew member
  // was never called out on is rest, so it neither takes a rest requirement of
  // its own nor becomes the duty the next one is measured against — the rest
  // period runs straight through it. It stays in the timeline regardless,
  // because its 20% still counts toward the cumulative limits.
  let previousDuty: DutyPeriod | null = null

  return sortedDPs.map((dp) => {
    if (isRestingStandby(dp)) return dp

    const priorRun = disruptiveRun
    const result = previousDuty
      ? { ...dp, restBefore: calculateRestPeriod(dp, previousDuty, priorRun) }
      : dp

    previousDuty = dp
    disruptiveRun = advanceDisruptiveRun(priorRun, dp.circadian?.disruptive ?? false)
    return result
  })
}

/**
 * Step paragraph 4's run of consecutive disruptive duties past one more duty.
 *
 * A duty that is not disruptive clears the run. One that IS extends it — unless
 * para 4 already required a 24-hour rest before it, in which case it is the
 * first of a new series rather than the third of an old one.
 */
function advanceDisruptiveRun(run: number, disruptive: boolean): number {
  if (!disruptive) return 0
  return circadianRestRule(run, true) ? 1 : run + 1
}

/** The next duty period chronologically after `after`, if there is one. */
function nextDutyAfter(
  dutyPeriods: DutyPeriod[],
  after: DutyPeriod
): DutyPeriod | undefined {
  const key = (dp: DutyPeriod) => `${dp.date} ${dp.reportTime}`
  const afterKey = key(after)
  let best: DutyPeriod | undefined
  for (const dp of dutyPeriods) {
    if (dp.id === after.id) continue
    if (key(dp) <= afterKey) continue
    if (!best || key(dp) < key(best)) best = dp
  }
  return best
}

// ============================================
// Rolling statistics & cumulative limits
// ============================================

/**
 * Calculate rolling period statistics for a given window
 */
export function calculateRollingStats(
  dutyPeriods: DutyPeriod[],
  fromDate: Date,
  days: number,
  limits: FTLLimits
): RollingPeriodStats {
  const toDate = new Date(fromDate)
  toDate.setDate(toDate.getDate() - days)

  const periodsInRange = dutyPeriods.filter((dp) => {
    const dpDate = new Date(dp.date + "T00:00:00")
    return dpDate <= fromDate && dpDate > toDate
  })

  // Para 12 counts duty hours — but para 6(7) counts only 20% of home standby
  // toward them, and para 6(3) folds airport standby into the rest period or
  // the following FDP rather than counting it at all. `countedDutyMinutes`
  // carries that; every ordinary duty leaves it unset and counts in full.
  const dutyMinutes = periodsInRange.reduce(
    (sum, dp) => sum + (dp.countedDutyMinutes ?? dp.dutyMinutes),
    0
  )
  const flightMinutes = periodsInRange.reduce((sum, dp) => sum + dp.flightMinutes, 0)

  const dutyHours = dutyMinutes / 60
  const flightHours = flightMinutes / 60

  let maxDutyHours: number
  let maxFlightHours: number

  if (days === 14) {
    maxDutyHours = limits.maxDuty14Days
    maxFlightHours = 0 // No 14-day flight limit in CAAS
  } else if (days === 28) {
    maxDutyHours = limits.maxDuty28Days
    maxFlightHours = limits.maxFlight28Days
  } else if (days === 365) {
    maxDutyHours = 0 // No 365-day duty limit in CAAS
    maxFlightHours = limits.maxFlight365Days
  } else {
    maxDutyHours = 0
    maxFlightHours = 0
  }

  const dutyUtilization = maxDutyHours > 0 ? (dutyHours / maxDutyHours) * 100 : 0
  const flightUtilization = maxFlightHours > 0 ? (flightHours / maxFlightHours) * 100 : 0
  const utilizationPercent = Math.max(dutyUtilization, flightUtilization)

  return {
    dutyHours,
    flightHours,
    maxDutyHours,
    maxFlightHours,
    utilizationPercent,
  }
}

/**
 * Calculate cumulative duty limits for a specific date (CAAS: 14d, 28d, 365d)
 */
export function calculateCumulativeLimits(
  dutyPeriods: DutyPeriod[],
  forDate: Date,
  limits: FTLLimits
): CumulativeDutyLimits {
  const stats14 = calculateRollingStats(dutyPeriods, forDate, 14, limits)
  const stats28 = calculateRollingStats(dutyPeriods, forDate, 28, limits)
  const stats365 = calculateRollingStats(dutyPeriods, forDate, 365, limits)

  return {
    last14Days: stats14,
    last28Days: stats28,
    last365Days: {
      flightHours: stats365.flightHours,
      maxFlightHours: stats365.maxFlightHours,
      utilizationPercent: stats365.utilizationPercent,
    },
    calculatedAt: Date.now(),
    calculatedForDate: forDate.toISOString().split("T")[0],
  }
}

// ============================================
// Capacity remaining
// ============================================

/**
 * Calculate remaining capacity before hitting each regulatory limit.
 * Uses only past + today duty periods (not future) for current state.
 */
export function calculateCapacity(
  dutyPeriods: DutyPeriod[],
  forDate: Date,
  limits: FTLLimits
): CapacityRemaining {
  const stats14 = calculateRollingStats(dutyPeriods, forDate, 14, limits)
  const stats28 = calculateRollingStats(dutyPeriods, forDate, 28, limits)
  const stats365 = calculateRollingStats(dutyPeriods, forDate, 365, limits)

  const duty14 = {
    used: stats14.dutyHours,
    limit: limits.maxDuty14Days,
    remaining: Math.max(0, limits.maxDuty14Days - stats14.dutyHours),
  }
  const duty28 = {
    used: stats28.dutyHours,
    limit: limits.maxDuty28Days,
    remaining: Math.max(0, limits.maxDuty28Days - stats28.dutyHours),
  }
  const flight28 = {
    used: stats28.flightHours,
    limit: limits.maxFlight28Days,
    remaining: Math.max(0, limits.maxFlight28Days - stats28.flightHours),
  }
  const flight365 = {
    used: stats365.flightHours,
    limit: limits.maxFlight365Days,
    remaining: Math.max(0, limits.maxFlight365Days - stats365.flightHours),
  }

  const allRemaining = [
    { name: "14-day duty", remaining: duty14.remaining },
    { name: "28-day duty", remaining: duty28.remaining },
    { name: "28-day flight", remaining: flight28.remaining },
    { name: "12-month flight", remaining: flight365.remaining },
  ]

  const bottleneckItem = allRemaining.reduce((min, item) =>
    item.remaining < min.remaining ? item : min
  )

  return {
    duty14Days: duty14,
    duty28Days: duty28,
    flight28Days: flight28,
    flight365Days: flight365,
    canAcceptMore: allRemaining.every((item) => item.remaining > 0),
    bottleneck: bottleneckItem.name,
  }
}

// ============================================
// Forecast
// ============================================

/**
 * Forecast limit exceedances from future scheduled duty periods.
 * For each future date, simulates rolling totals as if all duties up to
 * that date have occurred, and checks against limits.
 */
export function forecastExceedances(
  dutyPeriods: DutyPeriod[],
  limits: FTLLimits
): ForecastResult {
  const exceedances: ForecastExceedance[] = []
  const futureDPs = dutyPeriods.filter((dp) => dp.isFuture)

  for (const futureDp of futureDPs) {
    const asOfDate = new Date(futureDp.date + "T23:59:59")
    // Include all duties up to and including this future date
    const dpsUpToDate = dutyPeriods.filter(
      (dp) => dp.date <= futureDp.date
    )

    // Check 14-day duty limit
    const stats14 = calculateRollingStats(dpsUpToDate, asOfDate, 14, limits)
    if (stats14.dutyHours > limits.maxDuty14Days) {
      exceedances.push({
        date: futureDp.date,
        limitName: "14-day duty (Reg 12a)",
        projected: stats14.dutyHours,
        limit: limits.maxDuty14Days,
      })
    }

    // Check 28-day duty limit
    const stats28 = calculateRollingStats(dpsUpToDate, asOfDate, 28, limits)
    if (stats28.dutyHours > limits.maxDuty28Days) {
      exceedances.push({
        date: futureDp.date,
        limitName: "28-day duty (Reg 12b)",
        projected: stats28.dutyHours,
        limit: limits.maxDuty28Days,
      })
    }

    // Check 28-day flight limit
    if (stats28.flightHours > limits.maxFlight28Days) {
      exceedances.push({
        date: futureDp.date,
        limitName: "28-day flight (Reg 107a)",
        projected: stats28.flightHours,
        limit: limits.maxFlight28Days,
      })
    }

    // Check 365-day flight limit
    const stats365 = calculateRollingStats(dpsUpToDate, asOfDate, 365, limits)
    if (stats365.flightHours > limits.maxFlight365Days) {
      exceedances.push({
        date: futureDp.date,
        limitName: "12-month flight (Reg 107b)",
        projected: stats365.flightHours,
        limit: limits.maxFlight365Days,
      })
    }
  }

  return {
    exceedances,
    hasExceedance: exceedances.length > 0,
  }
}

// ============================================
// Single duty compliance checks
// ============================================

/**
 * Check if a single duty period exceeds FDP or single duty limits
 */
export function isDutyExceedingLimits(
  dutyPeriod: DutyPeriod,
  limits: FTLLimits
): {
  exceedsFDP: boolean
  exceedsDuty: boolean
  exceeds: boolean
} {
  const dutyHours = dutyPeriod.dutyMinutes / 60

  // A standby is a duty period but not a FLIGHT duty period, so paragraph 14's
  // tables never applied to it and there is no FDP to exceed. Its own cap is
  // para 6(2)(a): 18 hours for a flight crew member.
  if (dutyPeriod.dutyKind === "standby") {
    const exceedsStandby = dutyHours > MAX_STANDBY_HOURS_FLIGHT_CREW
    return {
      exceedsFDP: false,
      exceedsDuty: exceedsStandby,
      exceeds: exceedsStandby,
    }
  }

  // A duty carrying no computed maximum has nothing to be checked against —
  // reading 0 as a limit would make every such duty an exceedance.
  const exceedsFDP =
    dutyPeriod.maxFdpMinutes > 0 && dutyPeriod.dutyMinutes > dutyPeriod.maxFdpMinutes
  const exceedsDuty = dutyHours > limits.maxSingleDutyHours

  return {
    exceedsFDP,
    exceedsDuty,
    exceeds: exceedsFDP || exceedsDuty,
  }
}

// ============================================
// Timeline chart data generation
// ============================================

export interface TimelineDataPoint {
  date: string                      // YYYY-MM-DD
  dateLabel: string                 // "Apr 4" display label
  dutyHours: number                 // Daily duty hours
  flightHours: number               // Daily flight hours
  maxFdpHours: number | null        // Max FDP for this duty (null if no duty)
  rolling14DayDuty: number          // Rolling 14-day cumulative duty
  rolling28DayDuty: number          // Rolling 28-day cumulative duty
  rolling28DayFlight: number        // Rolling 28-day cumulative flight
  rolling365DayFlight: number       // Rolling 365-day cumulative flight
  restHours: number | null          // Rest before this duty (null if no prior duty)
  restRequired: number | null       // Required rest hours
  restCompliant: boolean | null     // Rest compliance
  restRule: string | null           // Which Reg 3 sub-rule
  isFuture: boolean
  source: "logbook" | "schedule" | "merged"
  route?: string                    // e.g. "WSSS-VVNB/VVNB-WSSS"
}

/** Format a UTC date as "dd MMM" (e.g. "04 Apr") */
function formatDateLabel(dateStr: string): string {
  const dateObj = new Date(dateStr + "T00:00:00Z")
  const day = dateObj.getUTCDate().toString().padStart(2, "0")
  const mon = dateObj.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
  return `${day} ${mon}`
}

/** Get the next date string (YYYY-MM-DD) after the given date */
function nextDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().split("T")[0]
}

/**
 * Generate timeline data points for charting.
 * Creates a continuous timeline from earliest to latest duty date,
 * filling gap days (no flights) with zero-duty data points so rolling
 * period lines show accurate decay during rest days.
 */
export function generateTimelineData(
  dutyPeriods: DutyPeriod[],
  limits: FTLLimits
): TimelineDataPoint[] {
  if (dutyPeriods.length === 0) return []

  const sorted = [...dutyPeriods].sort((a, b) => a.date.localeCompare(b.date))
  const today = new Date().toISOString().split("T")[0]

  // Index duty periods by date (supports multiple DPs per date)
  const dpsByDate = new Map<string, DutyPeriod[]>()
  for (const dp of sorted) {
    const existing = dpsByDate.get(dp.date) || []
    existing.push(dp)
    dpsByDate.set(dp.date, existing)
  }

  // Determine date range: earliest DP to max(latest DP, today)
  const startDate = sorted[0].date
  const lastDpDate = sorted[sorted.length - 1].date
  const endDate = lastDpDate > today ? lastDpDate : today

  const result: TimelineDataPoint[] = []
  let currentDate = startDate

  while (currentDate <= endDate) {
    const asOfDate = new Date(currentDate + "T23:59:59Z")
    const dpsOnDate = dpsByDate.get(currentDate)

    // Calculate rolling stats for this date (uses all DPs up to this date)
    const dpsUpToDate = sorted.filter((d) => d.date <= currentDate)
    const stats14 = calculateRollingStats(dpsUpToDate, asOfDate, 14, limits)
    const stats28 = calculateRollingStats(dpsUpToDate, asOfDate, 28, limits)
    const stats365 = calculateRollingStats(dpsUpToDate, asOfDate, 365, limits)

    if (dpsOnDate) {
      // Duty day(s) — create a point per DP on this date
      for (const dp of dpsOnDate) {
        result.push({
          date: dp.date,
          dateLabel: formatDateLabel(dp.date),
          dutyHours: dp.dutyMinutes / 60,
          flightHours: dp.flightMinutes / 60,
          maxFdpHours: dp.maxFdpMinutes / 60,
          rolling14DayDuty: stats14.dutyHours,
          rolling28DayDuty: stats28.dutyHours,
          rolling28DayFlight: stats28.flightHours,
          rolling365DayFlight: stats365.flightHours,
          restHours: dp.restBefore ? dp.restBefore.restMinutes / 60 : null,
          restRequired: dp.restBefore ? dp.restBefore.requiredRestMinutes / 60 : null,
          restCompliant: dp.restBefore ? dp.restBefore.compliant : null,
          restRule: dp.restBefore ? dp.restBefore.rule : null,
          isFuture: dp.isFuture,
          source: dp.source,
          route: dp.route,
        })
      }
    } else {
      // Gap day — zero duty/flight, but rolling stats still calculated
      result.push({
        date: currentDate,
        dateLabel: formatDateLabel(currentDate),
        dutyHours: 0,
        flightHours: 0,
        maxFdpHours: null,
        rolling14DayDuty: stats14.dutyHours,
        rolling28DayDuty: stats28.dutyHours,
        rolling28DayFlight: stats28.flightHours,
        rolling365DayFlight: stats365.flightHours,
        restHours: null,
        restRequired: null,
        restCompliant: null,
        restRule: null,
        isFuture: currentDate > today,
        source: "logbook",
      })
    }

    currentDate = nextDate(currentDate)
  }

  return result
}

// ============================================
// Rest until legal
// ============================================

export interface RestUntilLegalResult {
  isLegalNow: boolean
  restNeededMinutes: number    // 0 if legal
  restElapsedMinutes: number   // since last debrief
  requiredRestMinutes: number  // total required by regulation
  rule: RestPeriodInfo["rule"]
  lastDutyDate: string
  lastDebriefTime: string
  lastDutyMinutes: number
  legalAtUtc: string           // ISO timestamp when pilot becomes legal
}

/**
 * Calculate how much rest is still needed before the pilot is legally
 * available for the next duty period (per CAAS Reg 3).
 *
 * Returns null if there are no past duty periods.
 */
export function calculateRestUntilLegal(
  dutyPeriods: DutyPeriod[],
  asOfDate?: Date
): RestUntilLegalResult | null {
  const now = asOfDate ?? new Date()

  // Only consider duties whose debrief has actually passed.
  // Same-day scheduled duties that haven't been completed yet must be excluded
  // (their isFuture can be false because date === today, but they haven't happened).
  const completedDPs = dutyPeriods
    .filter((dp) => {
      if (dp.isFuture) return false
      // A standby that was never called out was rest, not a duty to rest from.
      // Counting it here would restart the countdown from the end of a period
      // the crew member spent at home.
      if (isRestingStandby(dp)) return false
      // Compute debrief timestamp to check if it's in the past
      let dDate = dp.date
      const rMin = hhmmToMinutes(dp.reportTime)
      const dMin = hhmmToMinutes(dp.debriefTime)
      if (dMin < rMin) {
        const d = new Date(dDate + "T00:00:00Z")
        d.setUTCDate(d.getUTCDate() + 1)
        dDate = d.toISOString().split("T")[0]
      }
      const ts = new Date(`${dDate}T${dp.debriefTime}:00Z`)
      return ts.getTime() <= now.getTime()
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  if (completedDPs.length === 0) return null

  const lastDP = completedDPs[completedDPs.length - 1]

  // Calculate debrief timestamp
  let debriefDate = lastDP.date
  const reportMin = hhmmToMinutes(lastDP.reportTime)
  const debriefMin = hhmmToMinutes(lastDP.debriefTime)

  // Handle debrief crossing midnight
  if (debriefMin < reportMin) {
    const d = new Date(debriefDate + "T00:00:00Z")
    d.setUTCDate(d.getUTCDate() + 1)
    debriefDate = d.toISOString().split("T")[0]
  }

  const debriefTimestamp = new Date(`${debriefDate}T${lastDP.debriefTime}:00Z`)
  // Rest commences one hour after the crew member is free of all duties.
  const restStartTimestamp = new Date(
    debriefTimestamp.getTime() + REST_STARTS_AFTER_DUTY_MIN * 60000
  )
  const restElapsedMs = now.getTime() - restStartTimestamp.getTime()
  const restElapsedMinutes = Math.max(0, Math.floor(restElapsedMs / 60000))

  // ── The requirement, as a set of conditions rather than a chain ──────────
  //
  // Same rule as `calculateRestPeriod`: paragraph 3's sub-rules are joined by
  // "and", so every applicable one must be met and the largest governs. This
  // one was still an if/else chain, which under-stated the requirement by an
  // hour for an 11-hour duty resting without a local night — the number a pilot
  // reads off the dashboard to know when they may next report.
  const precedingDutyMinutes = lastDP.dutyMinutes

  // Whether the rest contains a local night, projected over the shortest rest
  // that could possibly satisfy it. Measured where the crew member actually is
  // once that duty ended.
  const legalAtForNight = new Date(restStartTimestamp.getTime() + 10 * 60 * 60000)
  const restEndDate = legalAtForNight.toISOString().split("T")[0]
  const restEndTime = legalAtForNight.toISOString().split("T")[1].slice(0, 5)
  const hasLocalNight = includesLocalNight(
    debriefDate,
    lastDP.debriefTime,
    restEndDate,
    restEndTime,
    lastDP.arrivalTimezoneOffset != null
      ? lastDP.arrivalTimezoneOffset * 60
      : HOME_BASE_OFFSET_MINUTES
  )

  const candidates: Array<{ minutes: number; rule: RestPeriodInfo["rule"] }> = []

  // Para 4 — 24 hours inclusive of a local night around a duty encompassing an
  // early start, a late finish, or a take-off or landing in the window of
  // circadian low. Unlike paragraph 3 this turns on the duty AHEAD, so it can
  // only be answered when the next one is known; with no roster loaded it
  // simply does not apply. Pushed first so it names itself on a tie with 3(1)(d).
  const nextDP = nextDutyAfter(dutyPeriods, lastDP)
  const circadianRule = circadianRestRule(
    completedDPs.reduce(
      (run, dp) => advanceDisruptiveRun(run, dp.circadian?.disruptive ?? false),
      0
    ),
    nextDP?.circadian?.disruptive ?? false
  )
  if (circadianRule) {
    candidates.push({ minutes: CIRCADIAN_REST_MIN, rule: circadianRule })
  }

  candidates.push(
    hasLocalNight
      ? { minutes: 10 * 60, rule: "3a" }
      : { minutes: 12 * 60, rule: "3b" }
  )
  if (precedingDutyMinutes > 10 * 60 && precedingDutyMinutes <= 16 * 60) {
    candidates.push({
      minutes: Math.ceil(precedingDutyMinutes / 60) * 60,
      rule: "3c",
    })
  }
  if (precedingDutyMinutes > 16 * 60) {
    candidates.push({ minutes: 24 * 60, rule: "3d" })
  }

  const governing = candidates.reduce((a, b) => (b.minutes > a.minutes ? b : a))
  const requiredRestMinutes = governing.minutes
  const rule = governing.rule

  const restNeededMinutes = Math.max(0, requiredRestMinutes - restElapsedMinutes)
  const legalAtMs = restStartTimestamp.getTime() + requiredRestMinutes * 60000
  const legalAtUtc = new Date(legalAtMs).toISOString()

  return {
    isLegalNow: restNeededMinutes === 0,
    restNeededMinutes,
    restElapsedMinutes,
    requiredRestMinutes,
    rule,
    lastDutyDate: lastDP.date,
    lastDebriefTime: lastDP.debriefTime,
    lastDutyMinutes: lastDP.dutyMinutes,
    legalAtUtc,
  }
}

// ============================================
// Quick Check — hypothetical duty simulation
// ============================================

export interface QuickCheckInput {
  date: string           // YYYY-MM-DD
  reportTime: string     // HH:MM
  debriefTime: string    // HH:MM
  flightMinutes: number
  sectorCount: number
}

export interface QuickCheckResult {
  restBefore: {
    compliant: boolean
    restMinutes: number
    requiredRestMinutes: number
    rule: RestPeriodInfo["rule"]
  } | null
  duty14Days: { projected: number; limit: number; compliant: boolean }
  duty28Days: { projected: number; limit: number; compliant: boolean }
  flight28Days: { projected: number; limit: number; compliant: boolean }
  flight365Days: { projected: number; limit: number; compliant: boolean }
  maxFdp: { dutyMinutes: number; maxFdpMinutes: number; compliant: boolean }
  overallCompliant: boolean
}

/**
 * Simulate adding a hypothetical duty period to the existing data
 * and check all regulatory limits. Used for "quick check" legality
 * when a pilot is asked to accept an ad-hoc flight or swap.
 */
export function simulateHypotheticalDuty(
  existingDPs: DutyPeriod[],
  hypothetical: QuickCheckInput,
  limits: FTLLimits
): QuickCheckResult {
  // Build a temporary DutyPeriod from the hypothetical input
  const reportMin = hhmmToMinutes(hypothetical.reportTime)
  let debriefMin = hhmmToMinutes(hypothetical.debriefTime)
  if (debriefMin <= reportMin) debriefMin += 1440 // crosses midnight

  const dutyMinutes = debriefMin - reportMin

  // Report time is in UTC — convert to local for FDP table lookup (default
  // SGT). A hypothetical duty has no delay to account for, so the stated
  // report time IS the basis.
  const depTzOffset = 8
  const localReportTime = toLocalClock(reportMin, depTzOffset)

  const fdpResult = deriveMaxFDP({
    reportTime: hypothetical.reportTime,
    fdpStartLocal: localReportTime,
    sectorCount: hypothetical.sectorCount,
    departureTimezoneOffset: depTzOffset,
  })

  const hypotheticalDP: DutyPeriod = {
    id: "__quick_check__",
    date: hypothetical.date,
    reportTime: hypothetical.reportTime,
    debriefTime: hypothetical.debriefTime,
    dutyMinutes,
    flightMinutes: hypothetical.flightMinutes,
    sectorCount: hypothetical.sectorCount,
    maxFdpMinutes: fdpResult.maxFdpMinutes,
    fdpExtensionUsed: false,
    fdpTableUsed: fdpResult.tableUsed,
    fdpStartLocal: localReportTime,
    departureTimezoneOffset: depTzOffset,
    source: "schedule",
    isFuture: true,
    scheduleEntryIds: [],
    flightIds: [],
  }

  // Insert into existing DPs and sort chronologically
  const allDPs = [...existingDPs.filter((dp) => !dp.isFuture), hypotheticalDP]
    .sort((a, b) => a.date.localeCompare(b.date))

  // Rest period check — find the DP immediately before the hypothetical
  const hypoIndex = allDPs.findIndex((dp) => dp.id === "__quick_check__")
  let restCheck: QuickCheckResult["restBefore"] = null

  if (hypoIndex > 0) {
    const prevDP = allDPs[hypoIndex - 1]
    const rest = calculateRestPeriod(hypotheticalDP, prevDP)
    restCheck = {
      compliant: rest.compliant,
      restMinutes: rest.restMinutes,
      requiredRestMinutes: rest.requiredRestMinutes,
      rule: rest.rule,
    }
  }

  // Rolling stats including hypothetical
  const asOfDate = new Date(hypothetical.date + "T23:59:59Z")
  const stats14 = calculateRollingStats(allDPs, asOfDate, 14, limits)
  const stats28 = calculateRollingStats(allDPs, asOfDate, 28, limits)
  const stats365 = calculateRollingStats(allDPs, asOfDate, 365, limits)

  const duty14 = {
    projected: stats14.dutyHours,
    limit: limits.maxDuty14Days,
    compliant: stats14.dutyHours <= limits.maxDuty14Days,
  }
  const duty28 = {
    projected: stats28.dutyHours,
    limit: limits.maxDuty28Days,
    compliant: stats28.dutyHours <= limits.maxDuty28Days,
  }
  const flight28 = {
    projected: stats28.flightHours,
    limit: limits.maxFlight28Days,
    compliant: stats28.flightHours <= limits.maxFlight28Days,
  }
  const flight365 = {
    projected: stats365.flightHours,
    limit: limits.maxFlight365Days,
    compliant: stats365.flightHours <= limits.maxFlight365Days,
  }
  const maxFdpCheck = {
    dutyMinutes,
    maxFdpMinutes: fdpResult.maxFdpMinutes,
    compliant: dutyMinutes <= fdpResult.maxFdpMinutes,
  }

  const overallCompliant =
    (restCheck === null || restCheck.compliant) &&
    duty14.compliant &&
    duty28.compliant &&
    flight28.compliant &&
    flight365.compliant &&
    maxFdpCheck.compliant

  return {
    restBefore: restCheck,
    duty14Days: duty14,
    duty28Days: duty28,
    flight28Days: flight28,
    flight365Days: flight365,
    maxFdp: maxFdpCheck,
    overallCompliant,
  }
}

// ============================================
// Scenario Simulation — multi-change what-if analysis
// ============================================

export interface ScenarioChange {
  id: string
  type: "add" | "remove"
  /** For "add": the duty to inject. For "remove": identifies the DP to exclude. */
  date: string           // YYYY-MM-DD
  reportTime?: string    // HH:MM (required for "add")
  debriefTime?: string   // HH:MM (required for "add")
  flightMinutes?: number // required for "add"
  sectorCount?: number   // required for "add"
  /** For "remove": the original DP id to exclude */
  targetDutyId?: string
}

export interface ScenarioViolation {
  date: string
  type: "rest" | "duty14" | "duty28" | "flight28" | "flight365" | "fdp"
  label: string
  projected: number
  limit: number
}

export interface ScenarioResult {
  timelineData: TimelineDataPoint[]
  violations: ScenarioViolation[]
  overallLegal: boolean
  /** Set of dates that were modified (added/affected by removal) */
  modifiedDates: Set<string>
  /** Set of dates that were removed */
  removedDates: Set<string>
}

/**
 * Apply scenario changes to existing duty periods and regenerate
 * timeline data with full compliance checking.
 * Changes are non-destructive — returns new data without modifying originals.
 */
export function simulateScenario(
  existingDPs: DutyPeriod[],
  changes: ScenarioChange[],
  limits: FTLLimits
): ScenarioResult {
  const removedIds = new Set<string>()
  const removedDates = new Set<string>()
  const modifiedDates = new Set<string>()

  // Collect removals
  for (const change of changes) {
    if (change.type === "remove" && change.targetDutyId) {
      removedIds.add(change.targetDutyId)
      removedDates.add(change.date)
    }
  }

  // Start with existing DPs minus removals
  const baseDPs = existingDPs.filter((dp) => !removedIds.has(dp.id))

  // Build added DPs
  const addedDPs: DutyPeriod[] = []
  for (const change of changes) {
    if (change.type === "add" && change.reportTime && change.debriefTime) {
      const reportMin = hhmmToMinutes(change.reportTime)
      let debriefMin = hhmmToMinutes(change.debriefTime)
      if (debriefMin <= reportMin) debriefMin += 1440

      const dutyMinutes = debriefMin - reportMin
      const sectorCount = change.sectorCount ?? 1

      // Report time is in UTC — convert to local for FDP table lookup (default
      // SGT). A hypothetical duty has no delay, so the stated report IS the
      // basis.
      const depTzOffset = 8
      const localRepTime = toLocalClock(reportMin, depTzOffset)

      const fdpRes = deriveMaxFDP({
        reportTime: change.reportTime,
        fdpStartLocal: localRepTime,
        sectorCount,
        departureTimezoneOffset: depTzOffset,
      })
      const maxFdpMinutes = fdpRes.maxFdpMinutes

      addedDPs.push({
        id: `__scenario_${change.id}__`,
        date: change.date,
        reportTime: change.reportTime,
        debriefTime: change.debriefTime,
        dutyMinutes,
        flightMinutes: change.flightMinutes ?? 0,
        sectorCount,
        maxFdpMinutes,
        fdpExtensionUsed: false,
        fdpTableUsed: fdpRes.tableUsed,
        fdpStartLocal: localRepTime,
        departureTimezoneOffset: depTzOffset,
        source: "schedule",
        isFuture: true,
        scheduleEntryIds: [],
        flightIds: [],
      })
      modifiedDates.add(change.date)
    }
  }

  // Merge and sort
  const allDPs = [...baseDPs, ...addedDPs].sort((a, b) => a.date.localeCompare(b.date))

  // Recalculate rest periods
  const withRest = calculateAllRestPeriods(allDPs)

  // Generate timeline
  const timelineData = generateTimelineData(withRest, limits)

  // Check for violations — only on scenario-affected dates
  // A date is "affected" if it was added, removed, or is directly adjacent to a change
  const violations: ScenarioViolation[] = []
  const affectedDates = new Set([...modifiedDates, ...removedDates])

  // Also mark dates immediately after a modified/removed date as affected (rest impact)
  for (const dp of withRest) {
    const dpIdx = withRest.indexOf(dp)
    if (dpIdx > 0) {
      const prevDp = withRest[dpIdx - 1]
      if (affectedDates.has(prevDp.date)) {
        affectedDates.add(dp.date)
      }
    }
  }

  for (const dp of withRest) {
    if (!affectedDates.has(dp.date)) continue

    // Rest check — only flag if rest is genuinely insufficient
    if (dp.restBefore && !dp.restBefore.compliant) {
      violations.push({
        date: dp.date,
        type: "rest",
        label: `Insufficient rest`,
        projected: dp.restBefore.restMinutes / 60,
        limit: dp.restBefore.requiredRestMinutes / 60,
      })
    }

    // FDP check
    if (dp.dutyMinutes > dp.maxFdpMinutes) {
      violations.push({
        date: dp.date,
        type: "fdp",
        label: "FDP exceeded",
        projected: dp.dutyMinutes / 60,
        limit: dp.maxFdpMinutes / 60,
      })
    }
  }

  // Check rolling limits on all affected dates
  for (const date of affectedDates) {
    const asOfDate = new Date(date + "T23:59:59Z")
    const dpsUpToDate = withRest.filter((d) => d.date <= date)
    if (dpsUpToDate.length === 0) continue

    const stats14 = calculateRollingStats(dpsUpToDate, asOfDate, 14, limits)
    const stats28 = calculateRollingStats(dpsUpToDate, asOfDate, 28, limits)
    const stats365 = calculateRollingStats(dpsUpToDate, asOfDate, 365, limits)

    if (stats14.dutyHours > limits.maxDuty14Days) {
      violations.push({ date, type: "duty14", label: "14-day duty", projected: stats14.dutyHours, limit: limits.maxDuty14Days })
    }
    if (stats28.dutyHours > limits.maxDuty28Days) {
      violations.push({ date, type: "duty28", label: "28-day duty", projected: stats28.dutyHours, limit: limits.maxDuty28Days })
    }
    if (stats28.flightHours > limits.maxFlight28Days) {
      violations.push({ date, type: "flight28", label: "28-day flight", projected: stats28.flightHours, limit: limits.maxFlight28Days })
    }
    if (stats365.flightHours > limits.maxFlight365Days) {
      violations.push({ date, type: "flight365", label: "12-mo flight", projected: stats365.flightHours, limit: limits.maxFlight365Days })
    }
  }

  return {
    timelineData,
    violations,
    overallLegal: violations.length === 0,
    modifiedDates,
    removedDates,
  }
}

/**
 * Get compliance status from utilization percentage
 */
export function getComplianceStatus(utilizationPercent: number): {
  status: "ok" | "warning" | "critical" | "exceeded"
  color: string
  label: string
} {
  if (utilizationPercent >= 100) {
    return { status: "exceeded", color: "text-red-500", label: "Exceeded" }
  } else if (utilizationPercent >= 90) {
    return { status: "critical", color: "text-orange-500", label: "Critical" }
  } else if (utilizationPercent >= 75) {
    return { status: "warning", color: "text-yellow-500", label: "Warning" }
  } else {
    return { status: "ok", color: "text-green-500", label: "OK" }
  }
}


// ============================================
// Acclimatisation (First Schedule)
// ============================================

/**
 * Re-derive each duty period's FDP maximum against the crew member's ACTUAL
 * acclimatised zone.
 *
 * The duty periods are built one at a time, before anything knows the history
 * that determines acclimatisation — so they are built against home base and
 * corrected here, once the whole timeline is in hand.
 *
 * "Acclimated" means having spent at least 3 consecutive local nights free of
 * duty within a particular time zone (First Schedule). A pilot who night-stops
 * once in London is NOT acclimated to London, so their next duty out of there
 * belongs on Table B — and a pilot who has been there a week IS, so theirs
 * belongs on Table A. Reading it off home base alone got both wrong.
 *
 * @param sortedDPs duty periods, oldest first
 * @param homeOffsetHours the crew member's home base offset, in hours
 */
export function applyAcclimatisation(
  sortedDPs: DutyPeriod[],
  homeOffsetHours: number = HOME_BASE_OFFSET_MINUTES / 60
): DutyPeriod[] {
  if (sortedDPs.length === 0) return sortedDPs

  const intervals: DutyInterval[] = sortedDPs.map((dp) => {
    const startDay = dateToDays(dp.date)
    const reportMin = hhmmToMinutes(dp.reportTime)
    let debriefMin = hhmmToMinutes(dp.debriefTime)
    if (debriefMin < reportMin) debriefMin += 1440
    return {
      startMs: (startDay * 1440 + reportMin) * 60_000,
      endMs: (startDay * 1440 + debriefMin) * 60_000,
      endZoneOffsetMinutes:
        (dp.arrivalTimezoneOffset ?? dp.departureTimezoneOffset ?? homeOffsetHours) * 60,
    }
  })

  return sortedDPs.map((dp, i) => {
    // A standby is not a flight duty period, so paragraph 14's tables never
    // applied to it — deriving a maximum here would hand it a one-sector FDP
    // it has no business carrying. It still occupies the timeline, which is
    // what matters for the acclimatisation of the duties around it.
    if (dp.dutyKind === "standby") return dp

    // What the crew member was acclimated to when THIS duty commenced — so the
    // duty's own arrival zone cannot retroactively justify its own table.
    const acclimatedMin = acclimatisedOffsetMinutes(
      intervals.slice(0, i),
      homeOffsetHours * 60,
      intervals[i].startMs
    )
    const acclimatedHours = acclimatedMin / 60

    // The acclimatised zone is the ONLY thing this pass knows that the
    // producer did not, so it is the only thing overridden. Everything else —
    // above all the local time the FDP commenced at — comes off the duty
    // period through the one derivation. Re-deriving the table entry here from
    // `dp.reportTime` is what reported 10:15 against a schedule allowing
    // 12:15 on a duty that pushed back 23 minutes late.
    const fdp = deriveMaxFDP(dp, { acclimatedOffset: acclimatedHours })

    // Early start, late finish and the window of circadian low are all defined
    // in ACCLIMATED time, so this is the only place that can answer them — the
    // duty period was built before anything knew the history.
    const circadian = classifyCircadian(
      {
        departureMs: dp.departureMs,
        arrivalMs: dp.arrivalMs,
        takeoffLandingMs: dp.takeoffLandingMs,
      },
      acclimatedMin
    )

    return {
      ...dp,
      maxFdpMinutes: fdp.maxFdpMinutes,
      fdpTableUsed: fdp.tableUsed,
      effectiveSectors: fdp.effectiveSectors,
      acclimatedOffset: acclimatedHours,
      circadian,
    }
  })
}
