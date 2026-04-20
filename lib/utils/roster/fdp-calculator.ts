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

/** Report time buffer before first OUT time (minutes) */
const REPORT_BUFFER_MINUTES = 60

/**
 * Rest start buffer after gate-in (minutes).
 * Duty period ends at gate-in (no post-duty extension), but the pilot is
 * considered "at rest" only after this buffer — accounting for shutdown,
 * debrief, and transit to rest location.
 */
const REST_START_BUFFER_MINUTES = 30

/**
 * SGT local night window in UTC minutes.
 * Local night in Singapore (UTC+8) = 22:00-06:00 SGT = 14:00-22:00 UTC.
 */
const LOCAL_NIGHT_UTC_START = 14 * 60   // 14:00 UTC = 22:00 SGT
const LOCAL_NIGHT_UTC_END = 22 * 60     // 22:00 UTC = 06:00 SGT (next day)

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

  // Calculate flight time and longest sector from sectors
  let flightMinutes = 0
  let longestSectorMinutes = 0
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
        longestSectorMinutes = Math.max(longestSectorMinutes, blockTime)
      }
    })
  }

  // Convert report time to local departure time for table lookup
  let localReportMinutes: number
  if (entry.timeReference === "UTC") {
    localReportMinutes = reportMinutes + departureTimezoneOffset * 60
  } else {
    // LOCAL_BASE = SGT (UTC+8), convert to departure local
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

  const fdpResult = calculateMaxFDP({
    reportTimeLocal: localReportTime,
    sectors: sectorCount,
    departureTimezoneOffset,
    longestSectorMinutes,
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
    departureTimezoneOffset,
    effectiveSectors: fdpResult.effectiveSectors,
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
    .filter((entry) => entry.dutyType === "flight" && entry.reportTime && entry.debriefTime)
    .map((entry) => {
      const depIata = entry.sectors?.[0]?.departureIata
      const tzOffset = depIata && airportTimezones ? airportTimezones.get(depIata) ?? 8 : 8
      return calculateDutyPeriodFromSchedule(entry, tzOffset)
    })
    .filter((dp): dp is DutyPeriod => dp !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
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

  // Report = 1h before first gate-out. Debrief = last gate-in (no buffer).
  // Duty period duration = 1h report + (gate-out to gate-in). The +30min post-duty
  // buffer is NOT counted toward duty hours — it's applied to rest start instead
  // (see REST_START_BUFFER_MINUTES in rest calculations).
  const reportMinutes = Math.max(0, earliestOut - REPORT_BUFFER_MINUTES)
  const debriefMinutes = latestIn

  // For FDP table lookup: use scheduled OUT when available, else actual OUT
  const scheduledReportMinutes = earliestScheduledOut !== Infinity
    ? Math.max(0, earliestScheduledOut - REPORT_BUFFER_MINUTES)
    : reportMinutes

  // Normalize to within 24h for display
  const reportTime = minutesToHHMM(reportMinutes % 1440)
  const debriefTime = minutesToHHMM(debriefMinutes % 1440)

  const dutyMinutes = debriefMinutes - reportMinutes

  // Departure timezone from first flight (default SGT)
  const depTzOffset = groupFlights[0]?.departureTimezone ?? 8

  // Longest sector block time for long sector adjustment
  const longestSectorMinutes = Math.max(
    ...groupFlights.map((f) => (f.blockTime ? hhmmToMinutes(f.blockTime) : 0))
  )

  // Convert scheduled report time to local for FDP table lookup
  let localReportMinutes = scheduledReportMinutes + depTzOffset * 60
  if (localReportMinutes < 0) localReportMinutes += 1440
  const localReportTime = minutesToHHMM(localReportMinutes % 1440)

  const fdpResult = calculateMaxFDP({
    reportTimeLocal: localReportTime,
    sectors: groupFlights.length,
    departureTimezoneOffset: depTzOffset,
    longestSectorMinutes,
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
    departureTimezoneOffset: depTzOffset,
    effectiveSectors: fdpResult.effectiveSectors,
    source: "logbook",
    isFuture: date > new Date().toISOString().split("T")[0],
    scheduleEntryIds: [],
    flightIds: groupFlights.map((f) => f.id),
    route,
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
      // Past schedule only (e.g., standby, training counted as duty)
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

      // Recalculate max FDP with merged parameters
      const depTzOffset = prev.departureTimezoneOffset ?? 8
      let localReportMinutes = hhmmToMinutes(prev.reportTime) + depTzOffset * 60
      if (localReportMinutes < 0) localReportMinutes += 1440
      const localReportTime = minutesToHHMM(localReportMinutes % 1440)

      const fdpResult = calculateMaxFDP({
        reportTimeLocal: localReportTime,
        sectors: totalSectors,
        departureTimezoneOffset: depTzOffset,
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
  longestSectorMinutes?: number        // default: 0 (no long sector adj)
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
    longestSectorMinutes = 0,
  } = params

  const localHour = Math.floor(hhmmToMinutes(reportTimeLocal) / 60)

  // Determine which table to use
  let tableUsed: FdpTableUsed
  if (crewConfig === "single-pilot") {
    tableUsed = "C"
  } else if (isAcclimated(departureTimezoneOffset)) {
    tableUsed = "A"
  } else {
    tableUsed = "B"
  }

  // Apply long sector adjustment (only for 2-pilot, Tables A/B)
  let effectiveSectors = sectors
  if (tableUsed !== "C" && longestSectorMinutes > 420) {
    effectiveSectors = applyLongSectorAdjustment(
      sectors,
      longestSectorMinutes,
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

  // Apply augmented crew extension (Reg 15)
  if (augmentedCrew !== "none") {
    maxFdpMinutes = applyAugmentedCrewExtension(maxFdpMinutes, augmentedCrew)
  }

  return { maxFdpMinutes, tableUsed, effectiveSectors }
}

// ============================================
// Rest period calculation (CAAS Reg 3)
// ============================================

/**
 * Check if a time interval (in UTC) includes a Singapore local night.
 * SGT local night = 22:00-06:00 SGT = 14:00-22:00 UTC.
 * Checks across multiple days if the rest spans more than 24h.
 */
export function includesLocalNight(
  debriefDate: string,
  debriefTime: string,
  reportDate: string,
  reportTime: string
): boolean {
  // Convert to absolute UTC minutes from epoch-reference for comparison
  const debriefDayOffset = dateToDays(debriefDate)
  const reportDayOffset = dateToDays(reportDate)

  const debriefAbsolute = debriefDayOffset * 1440 + hhmmToMinutes(debriefTime)
  const reportAbsolute = reportDayOffset * 1440 + hhmmToMinutes(reportTime)

  // Check each day in the rest window for local night overlap
  const startDay = debriefDayOffset
  const endDay = reportDayOffset

  for (let day = startDay; day <= endDay; day++) {
    const nightStart = day * 1440 + LOCAL_NIGHT_UTC_START
    const nightEnd = day * 1440 + LOCAL_NIGHT_UTC_END

    // Check if rest interval overlaps this night window
    if (debriefAbsolute < nightEnd && reportAbsolute > nightStart) {
      return true
    }
  }

  return false
}

/** Convert YYYY-MM-DD to days since a reference for absolute comparison */
function dateToDays(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z")
  return Math.floor(d.getTime() / 86400000)
}

/**
 * Calculate rest period between two consecutive duty periods per CAAS Reg 3.
 *
 * Rules (applied in order of precedence):
 *   (d) preceding duty > 16h → ≥24h rest + must include local night
 *   (c) preceding duty > 10h but ≤ 16h → rest ≥ preceding duty rounded up to next whole hour
 *   (a) rest includes local night → ≥10h
 *   (b) rest without local night → ≥12h
 */
export function calculateRestPeriod(
  current: DutyPeriod,
  previous: DutyPeriod
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

  // Rest starts REST_START_BUFFER_MINUTES after gate-in (debrief), not at gate-in.
  // This accounts for shutdown, debrief, and transit time that isn't duty but
  // also isn't rest.
  const restMinutes = currReportAbsolute - prevDebriefAbsolute - REST_START_BUFFER_MINUTES

  // Check if rest includes local night
  const hasLocalNight = includesLocalNight(
    previous.date,
    previous.debriefTime,
    current.date,
    current.reportTime
  )

  const precedingDutyMinutes = previous.dutyMinutes

  // Determine required rest and applicable rule
  let requiredRestMinutes: number
  let rule: RestPeriodInfo["rule"]

  if (precedingDutyMinutes > 16 * 60) {
    // Reg 3(1)(d): preceding duty > 16h → ≥24h + local night
    requiredRestMinutes = 24 * 60
    rule = "3d"
  } else if (precedingDutyMinutes > 10 * 60) {
    // Reg 3(1)(c): preceding duty > 10h but ≤ 16h → ≥ preceding duty rounded up to next whole hour
    const precedingHours = Math.ceil(precedingDutyMinutes / 60)
    requiredRestMinutes = precedingHours * 60
    rule = "3c"
  } else if (hasLocalNight) {
    // Reg 3(1)(a): rest includes local night → ≥10h
    requiredRestMinutes = 10 * 60
    rule = "3a"
  } else {
    // Reg 3(1)(b): no local night → ≥12h
    requiredRestMinutes = 12 * 60
    rule = "3b"
  }

  return {
    restMinutes: Math.max(0, restMinutes),
    requiredRestMinutes,
    includesLocalNight: hasLocalNight,
    precedingDutyMinutes,
    compliant: restMinutes >= requiredRestMinutes,
    rule,
  }
}

/**
 * Enrich sorted duty periods with rest period information.
 * Expects duty periods sorted chronologically (oldest first).
 */
export function calculateAllRestPeriods(sortedDPs: DutyPeriod[]): DutyPeriod[] {
  if (sortedDPs.length <= 1) return sortedDPs

  return sortedDPs.map((dp, index) => {
    if (index === 0) return dp
    const previous = sortedDPs[index - 1]
    return {
      ...dp,
      restBefore: calculateRestPeriod(dp, previous),
    }
  })
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

  const dutyMinutes = periodsInRange.reduce((sum, dp) => sum + dp.dutyMinutes, 0)
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
  const exceedsFDP = dutyPeriod.dutyMinutes > dutyPeriod.maxFdpMinutes
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
  // Rest starts REST_START_BUFFER_MINUTES after gate-in, not at gate-in itself.
  const restStartTimestamp = new Date(debriefTimestamp.getTime() + REST_START_BUFFER_MINUTES * 60000)
  const restElapsedMs = now.getTime() - restStartTimestamp.getTime()
  const restElapsedMinutes = Math.max(0, Math.floor(restElapsedMs / 60000))

  // Determine required rest based on preceding duty duration (Reg 3)
  const precedingDutyMinutes = lastDP.dutyMinutes
  let requiredRestMinutes: number
  let rule: RestPeriodInfo["rule"]

  if (precedingDutyMinutes > 16 * 60) {
    // Reg 3(1)(d): preceding duty > 16h → ≥24h + local night
    requiredRestMinutes = 24 * 60
    rule = "3d"
  } else if (precedingDutyMinutes > 10 * 60) {
    // Reg 3(1)(c): preceding duty > 10h but ≤ 16h → ≥ preceding duty rounded up
    requiredRestMinutes = Math.ceil(precedingDutyMinutes / 60) * 60
    rule = "3c"
  } else {
    // For rules 3a/3b we need to check if the rest window includes local night.
    // Project the rest window from rest-start to rest-start + max(10h, 12h) to determine
    // which rule applies — if rest includes local night, 10h applies; else 12h.
    const legalAtForNight = new Date(restStartTimestamp.getTime() + 10 * 60 * 60000)
    const restEndDate = legalAtForNight.toISOString().split("T")[0]
    const restEndTime = legalAtForNight.toISOString().split("T")[1].slice(0, 5)

    const hasLocalNight = includesLocalNight(
      debriefDate,
      lastDP.debriefTime,
      restEndDate,
      restEndTime
    )

    if (hasLocalNight) {
      requiredRestMinutes = 10 * 60
      rule = "3a"
    } else {
      requiredRestMinutes = 12 * 60
      rule = "3b"
    }
  }

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

  // Report time is in UTC — convert to local for FDP table lookup (default SGT)
  const depTzOffset = 8
  let localReportMin = reportMin + depTzOffset * 60
  if (localReportMin < 0) localReportMin += 1440
  const localReportTime = minutesToHHMM(localReportMin % 1440)

  const fdpResult = calculateMaxFDP({
    reportTimeLocal: localReportTime,
    sectors: hypothetical.sectorCount,
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
    maxFdpMinutes,
    compliant: dutyMinutes <= maxFdpMinutes,
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

      // Report time is in UTC — convert to local for FDP table lookup (default SGT)
      const depTzOffset = 8
      let localRepMin = reportMin + depTzOffset * 60
      if (localRepMin < 0) localRepMin += 1440
      const localRepTime = minutesToHHMM(localRepMin % 1440)

      const fdpRes = calculateMaxFDP({
        reportTimeLocal: localRepTime,
        sectors: sectorCount,
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
