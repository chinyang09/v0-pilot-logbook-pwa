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
} from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"
import { hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time"

// ============================================
// Constants
// ============================================

/** Report time buffer before first OUT time (minutes) */
const REPORT_BUFFER_MINUTES = 60

/** Debrief time buffer after last IN time (minutes) */
const DEBRIEF_BUFFER_MINUTES = 30

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
 * Calculate duty period from a schedule entry
 */
export function calculateDutyPeriodFromSchedule(entry: ScheduleEntry): DutyPeriod | null {
  if (!entry.reportTime || !entry.debriefTime) return null

  const reportMinutes = hhmmToMinutes(entry.reportTime)
  const debriefMinutes = hhmmToMinutes(entry.debriefTime)

  // Handle day wrap (e.g., report 23:00, debrief 02:00 next day)
  let dutyMinutes = debriefMinutes - reportMinutes
  if (dutyMinutes < 0) {
    dutyMinutes += 1440 // Add 24 hours
  }

  // Calculate flight time from sectors
  let flightMinutes = 0
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
      }
    })
  }

  const today = new Date().toISOString().split("T")[0]

  return {
    id: entry.id,
    date: entry.date,
    reportTime: entry.reportTime,
    debriefTime: entry.debriefTime,
    dutyMinutes,
    flightMinutes,
    sectorCount: entry.sectors?.length || 0,
    maxFdpMinutes: calculateMaxFDP(entry.reportTime, entry.sectors?.length || 0),
    fdpExtensionUsed: false,
    source: "schedule",
    isFuture: entry.date > today,
    scheduleEntryIds: [entry.id],
    flightIds: entry.linkedFlightIds || [],
  }
}

/**
 * Get duty periods from schedule entries (flight duties only)
 */
export function getDutyPeriodsFromSchedule(entries: ScheduleEntry[]): DutyPeriod[] {
  return entries
    .filter((entry) => entry.dutyType === "flight" && entry.reportTime && entry.debriefTime)
    .map((entry) => calculateDutyPeriodFromSchedule(entry))
    .filter((dp): dp is DutyPeriod => dp !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

// ============================================
// DutyPeriod creation from flight logs
// ============================================

/**
 * Create duty periods from actual flight logs, grouped by date.
 * Multiple flights on the same date become one duty period.
 * Estimates report/debrief from earliest OUT and latest IN times.
 */
export function createDutyPeriodsFromFlights(flights: FlightLog[]): DutyPeriod[] {
  // Group flights by date
  const byDate = new Map<string, FlightLog[]>()
  for (const flight of flights) {
    if (!flight.date || flight.isDraft) continue
    const existing = byDate.get(flight.date) || []
    existing.push(flight)
    byDate.set(flight.date, existing)
  }

  const dutyPeriods: DutyPeriod[] = []

  for (const [date, dateFlights] of byDate) {
    // Sum flight minutes from block times
    let totalFlightMinutes = 0
    let earliestOut = Infinity
    let latestIn = -Infinity

    for (const flight of dateFlights) {
      if (flight.blockTime) {
        totalFlightMinutes += hhmmToMinutes(flight.blockTime)
      }
      if (flight.outTime) {
        earliestOut = Math.min(earliestOut, hhmmToMinutes(flight.outTime))
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

    if (earliestOut === Infinity || latestIn === -Infinity) continue

    // Estimate report/debrief with buffers
    const reportMinutes = Math.max(0, earliestOut - REPORT_BUFFER_MINUTES)
    const debriefMinutes = latestIn + DEBRIEF_BUFFER_MINUTES

    // Normalize to within 24h for display
    const reportTime = minutesToHHMM(reportMinutes % 1440)
    const debriefTime = minutesToHHMM(debriefMinutes % 1440)

    const dutyMinutes = debriefMinutes - reportMinutes

    dutyPeriods.push({
      id: `logbook-${date}`,
      date,
      reportTime,
      debriefTime,
      dutyMinutes,
      flightMinutes: totalFlightMinutes,
      sectorCount: dateFlights.length,
      maxFdpMinutes: calculateMaxFDP(reportTime, dateFlights.length),
      fdpExtensionUsed: false,
      source: "logbook",
      isFuture: false,
      scheduleEntryIds: [],
      flightIds: dateFlights.map((f) => f.id),
    })
  }

  return dutyPeriods.sort((a, b) => a.date.localeCompare(b.date))
}

// ============================================
// Merging logbook + schedule duty periods
// ============================================

/**
 * Merge logbook and schedule duty periods into a unified timeline.
 * - Past dates: prefer logbook data (actual); include schedule non-flight duties
 * - Future dates: use schedule data
 * - Same date with both: merge (logbook flight times + schedule report/debrief)
 */
export function mergeDutyPeriods(
  logbookDPs: DutyPeriod[],
  scheduleDPs: DutyPeriod[]
): DutyPeriod[] {
  const today = new Date().toISOString().split("T")[0]
  const merged = new Map<string, DutyPeriod>()

  // Index logbook by date
  const logbookByDate = new Map<string, DutyPeriod>()
  for (const dp of logbookDPs) {
    logbookByDate.set(dp.date, dp)
  }

  // Process schedule entries
  for (const dp of scheduleDPs) {
    const logbookDP = logbookByDate.get(dp.date)

    if (dp.date > today) {
      // Future: use schedule data, mark as future
      merged.set(dp.date, { ...dp, isFuture: true })
    } else if (logbookDP) {
      // Past with both: create merged entry
      merged.set(dp.date, {
        ...dp,
        flightMinutes: logbookDP.flightMinutes,
        flightIds: logbookDP.flightIds,
        sectorCount: logbookDP.sectorCount,
        source: "merged",
        isFuture: false,
      })
      logbookByDate.delete(dp.date) // consumed
    } else {
      // Past schedule only (e.g., standby, training counted as duty)
      merged.set(dp.date, { ...dp, isFuture: false })
    }
  }

  // Add remaining logbook entries not matched by schedule
  for (const [date, dp] of logbookByDate) {
    if (!merged.has(date)) {
      merged.set(date, dp)
    }
  }

  // Sort chronologically (oldest first) for rest period calculation
  return Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// ============================================
// Max FDP calculation (CAAS)
// ============================================

/**
 * Calculate max FDP based on report time and sectors.
 * Based on CAAS regulations (simplified):
 *   0600-1259: 13h base
 *   1300-1759: 12h base
 *   0500-0559: 12h base
 *   1800-0459: 11h base
 *   -30min per sector beyond 2, minimum 9h
 */
export function calculateMaxFDP(reportTime: string, sectors: number): number {
  const reportMinutes = hhmmToMinutes(reportTime)
  const reportHour = Math.floor(reportMinutes / 60)

  let baseFDP: number
  if (reportHour >= 6 && reportHour < 13) {
    baseFDP = 13 * 60
  } else if (reportHour >= 13 && reportHour < 18) {
    baseFDP = 12 * 60
  } else if (reportHour >= 5 && reportHour < 6) {
    baseFDP = 12 * 60
  } else {
    baseFDP = 11 * 60
  }

  if (sectors > 2) {
    baseFDP -= (sectors - 2) * 30
  }

  return Math.max(baseFDP, 9 * 60)
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

  const restMinutes = currReportAbsolute - prevDebriefAbsolute

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
}

/**
 * Generate timeline data points for charting.
 * Creates one data point per duty period with rolling cumulative totals.
 */
export function generateTimelineData(
  dutyPeriods: DutyPeriod[],
  limits: FTLLimits
): TimelineDataPoint[] {
  // dutyPeriods should be sorted chronologically (oldest first)
  const sorted = [...dutyPeriods].sort((a, b) => a.date.localeCompare(b.date))

  return sorted.map((dp) => {
    const asOfDate = new Date(dp.date + "T23:59:59")

    // Calculate rolling stats up to this date
    const dpsUpToDate = sorted.filter((d) => d.date <= dp.date)
    const stats14 = calculateRollingStats(dpsUpToDate, asOfDate, 14, limits)
    const stats28 = calculateRollingStats(dpsUpToDate, asOfDate, 28, limits)
    const stats365 = calculateRollingStats(dpsUpToDate, asOfDate, 365, limits)

    const dateObj = new Date(dp.date + "T00:00:00")
    const dateLabel = dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })

    return {
      date: dp.date,
      dateLabel,
      dutyHours: dp.dutyMinutes / 60,
      flightHours: dp.flightMinutes / 60,
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
    }
  })
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
