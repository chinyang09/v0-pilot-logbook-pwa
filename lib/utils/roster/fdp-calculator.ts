/**
 * FDP (Flight Duty Period) Calculator
 * Calculates duty times, flight times, and regulatory compliance
 */

import type {
  DutyPeriod,
  RollingPeriodStats,
  CumulativeDutyLimits,
  FTLLimits,
  ScheduleEntry,
} from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"
import { hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time"

/**
 * Calculate duty period from schedule entry
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
    scheduleEntryIds: [entry.id],
    flightIds: entry.linkedFlightIds || [],
  }
}

/**
 * Calculate max FDP based on report time and sectors
 * Based on CAAS regulations (simplified)
 */
export function calculateMaxFDP(reportTime: string, sectors: number): number {
  const reportMinutes = hhmmToMinutes(reportTime)
  const reportHour = Math.floor(reportMinutes / 60)

  // Base FDP limits by report time (CAAS)
  // 0600-1259: 13h, 1300-1759: 12h, 1800-0459: 11h, 0500-0559: 12h
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

  // Reduce by 30 min for each sector beyond 2
  if (sectors > 2) {
    baseFDP -= (sectors - 2) * 30
  }

  // Minimum of 9 hours
  return Math.max(baseFDP, 9 * 60)
}

/**
 * Calculate rolling period statistics
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

  // Get max limits based on days
  let maxDutyHours: number
  let maxFlightHours: number

  if (days === 7) {
    maxDutyHours = limits.maxDuty7Days
    maxFlightHours = limits.maxFlight7Days
  } else if (days === 14) {
    maxDutyHours = limits.maxDuty14Days
    maxFlightHours = limits.maxFlight14Days
  } else if (days === 28) {
    maxDutyHours = limits.maxDuty28Days
    maxFlightHours = limits.maxFlight28Days
  } else if (days === 90) {
    maxDutyHours = 0 // Not tracked for 90 days
    maxFlightHours = limits.maxFlight90Days
  } else if (days === 365) {
    maxDutyHours = 0 // Not tracked for 365 days
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
 * Calculate cumulative duty limits for a specific date
 */
export function calculateCumulativeLimits(
  dutyPeriods: DutyPeriod[],
  forDate: Date,
  limits: FTLLimits
): CumulativeDutyLimits {
  return {
    last7Days: calculateRollingStats(dutyPeriods, forDate, 7, limits),
    last14Days: calculateRollingStats(dutyPeriods, forDate, 14, limits),
    last28Days: calculateRollingStats(dutyPeriods, forDate, 28, limits),
    last90Days: {
      flightHours: calculateRollingStats(dutyPeriods, forDate, 90, limits).flightHours,
      maxFlightHours: limits.maxFlight90Days,
      utilizationPercent: calculateRollingStats(dutyPeriods, forDate, 90, limits)
        .utilizationPercent,
    },
    last365Days: {
      flightHours: calculateRollingStats(dutyPeriods, forDate, 365, limits).flightHours,
      maxFlightHours: limits.maxFlight365Days,
      utilizationPercent: calculateRollingStats(dutyPeriods, forDate, 365, limits)
        .utilizationPercent,
    },
    calculatedAt: Date.now(),
    calculatedForDate: forDate.toISOString().split("T")[0],
  }
}

/**
 * Get duty periods from schedule entries
 */
export function getDutyPeriodsFromSchedule(entries: ScheduleEntry[]): DutyPeriod[] {
  return entries
    .filter((entry) => entry.dutyType === "flight" && entry.reportTime && entry.debriefTime)
    .map((entry) => calculateDutyPeriodFromSchedule(entry))
    .filter((dp): dp is DutyPeriod => dp !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

/**
 * Check if duty period exceeds FDP limits
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
  const maxFdpHours = dutyPeriod.maxFdpMinutes / 60

  const exceedsFDP = dutyPeriod.dutyMinutes > dutyPeriod.maxFdpMinutes
  const exceedsDuty = dutyHours > limits.maxSingleDutyHours

  return {
    exceedsFDP,
    exceedsDuty,
    exceeds: exceedsFDP || exceedsDuty,
  }
}

/**
 * Calculate rest status since the last duty ended.
 * Returns how much rest has elapsed, how much is required,
 * and how much remains before the pilot is legal for the next duty.
 */
export function calculateRestStatus(
  dutyPeriods: DutyPeriod[],
  limits: FTLLimits,
  now: Date = new Date()
): {
  lastDutyDate: string | null
  lastDebriefTime: string | null
  restElapsedMinutes: number
  restRequiredMinutes: number
  restRemainingMinutes: number
  isLegalForDuty: boolean
  legalAtTime: Date | null
} {
  if (dutyPeriods.length === 0) {
    return {
      lastDutyDate: null,
      lastDebriefTime: null,
      restElapsedMinutes: 0,
      restRequiredMinutes: limits.minRestBetweenDuties * 60,
      restRemainingMinutes: 0,
      isLegalForDuty: true,
      legalAtTime: null,
    }
  }

  // Sort ascending by date+debriefTime to find the most recent duty that has ended
  const sorted = [...dutyPeriods].sort((a, b) => {
    const aEnd = new Date(`${a.date}T${a.debriefTime}:00`).getTime()
    const bEnd = new Date(`${b.date}T${b.debriefTime}:00`).getTime()
    return bEnd - aEnd // newest first
  })

  // Find the most recent duty whose debrief has already passed
  let lastDuty: DutyPeriod | null = null
  for (const dp of sorted) {
    const debriefDate = new Date(`${dp.date}T${dp.debriefTime}:00`)
    // Handle day wrap: if debrief < report, debrief is next day
    const reportMinutes = hhmmToMinutes(dp.reportTime)
    const debriefMinutes = hhmmToMinutes(dp.debriefTime)
    if (debriefMinutes < reportMinutes) {
      debriefDate.setDate(debriefDate.getDate() + 1)
    }
    if (debriefDate <= now) {
      lastDuty = dp
      break
    }
  }

  if (!lastDuty) {
    return {
      lastDutyDate: null,
      lastDebriefTime: null,
      restElapsedMinutes: 0,
      restRequiredMinutes: limits.minRestBetweenDuties * 60,
      restRemainingMinutes: 0,
      isLegalForDuty: true,
      legalAtTime: null,
    }
  }

  // Calculate debrief end datetime
  const debriefEnd = new Date(`${lastDuty.date}T${lastDuty.debriefTime}:00`)
  const reportMinutes = hhmmToMinutes(lastDuty.reportTime)
  const debriefMinutes = hhmmToMinutes(lastDuty.debriefTime)
  if (debriefMinutes < reportMinutes) {
    debriefEnd.setDate(debriefEnd.getDate() + 1)
  }

  const restElapsedMinutes = Math.max(0, (now.getTime() - debriefEnd.getTime()) / 60000)
  const restRequiredMinutes = limits.minRestBetweenDuties * 60
  const restRemainingMinutes = Math.max(0, restRequiredMinutes - restElapsedMinutes)

  const legalAtTime = restRemainingMinutes > 0
    ? new Date(debriefEnd.getTime() + restRequiredMinutes * 60000)
    : null

  return {
    lastDutyDate: lastDuty.date,
    lastDebriefTime: lastDuty.debriefTime,
    restElapsedMinutes,
    restRequiredMinutes,
    restRemainingMinutes,
    isLegalForDuty: restRemainingMinutes <= 0,
    legalAtTime,
  }
}

/**
 * Quick legality check: temporarily add a hypothetical duty to existing
 * duty periods and check all regulatory limits for violations.
 */
export function checkLegalityWithDuty(
  existingDutyPeriods: DutyPeriod[],
  hypotheticalDuty: {
    date: string       // YYYY-MM-DD
    reportTime: string // HH:MM
    debriefTime: string // HH:MM
    sectors: number
    flightMinutes: number
  },
  limits: FTLLimits
): {
  violations: Array<{ rule: string; actual: string; limit: string; severity: "warning" | "exceeded" }>
  isLegal: boolean
  dutyPeriod: DutyPeriod
  cumulativeLimits: CumulativeDutyLimits
  restViolation: { restAvailable: number; restRequired: number } | null
} {
  // Build the hypothetical DutyPeriod
  const reportMinutes = hhmmToMinutes(hypotheticalDuty.reportTime)
  const debriefMinutes = hhmmToMinutes(hypotheticalDuty.debriefTime)
  let dutyMinutes = debriefMinutes - reportMinutes
  if (dutyMinutes < 0) dutyMinutes += 1440

  const dp: DutyPeriod = {
    id: `hypothetical-${Date.now()}`,
    date: hypotheticalDuty.date,
    reportTime: hypotheticalDuty.reportTime,
    debriefTime: hypotheticalDuty.debriefTime,
    dutyMinutes,
    flightMinutes: hypotheticalDuty.flightMinutes,
    sectorCount: hypotheticalDuty.sectors,
    maxFdpMinutes: calculateMaxFDP(hypotheticalDuty.reportTime, hypotheticalDuty.sectors),
    fdpExtensionUsed: false,
    scheduleEntryIds: [],
    flightIds: [],
  }

  // Merge with existing duty periods
  const allPeriods = [...existingDutyPeriods, dp]

  // Calculate cumulative limits as of the hypothetical duty date
  const forDate = new Date(hypotheticalDuty.date + "T23:59:59")
  const cumLimits = calculateCumulativeLimits(allPeriods, forDate, limits)

  // Collect violations
  const violations: Array<{ rule: string; actual: string; limit: string; severity: "warning" | "exceeded" }> = []

  // Check single duty FDP
  if (dp.dutyMinutes > dp.maxFdpMinutes) {
    violations.push({
      rule: "FDP Limit",
      actual: `${(dp.dutyMinutes / 60).toFixed(1)}h`,
      limit: `${(dp.maxFdpMinutes / 60).toFixed(1)}h`,
      severity: "exceeded",
    })
  }

  // Check single duty max
  if (dp.dutyMinutes / 60 > limits.maxSingleDutyHours) {
    violations.push({
      rule: "Single Duty",
      actual: `${(dp.dutyMinutes / 60).toFixed(1)}h`,
      limit: `${limits.maxSingleDutyHours}h`,
      severity: "exceeded",
    })
  }

  // Check rolling limits
  const rollingChecks: Array<{ label: string; stats: { dutyHours?: number; flightHours: number; maxDutyHours?: number; maxFlightHours: number; utilizationPercent: number } }> = [
    { label: "7-Day Duty", stats: cumLimits.last7Days },
    { label: "14-Day Duty", stats: cumLimits.last14Days },
    { label: "28-Day Duty", stats: cumLimits.last28Days },
    { label: "7-Day Flight", stats: cumLimits.last7Days },
    { label: "14-Day Flight", stats: cumLimits.last14Days },
    { label: "28-Day Flight", stats: cumLimits.last28Days },
    { label: "90-Day Flight", stats: cumLimits.last90Days },
    { label: "365-Day Flight", stats: cumLimits.last365Days },
  ]

  for (const check of rollingChecks) {
    const isDutyCheck = check.label.includes("Duty")
    const actual = isDutyCheck ? (check.stats as RollingPeriodStats).dutyHours : check.stats.flightHours
    const max = isDutyCheck ? (check.stats as RollingPeriodStats).maxDutyHours : check.stats.maxFlightHours
    if (actual === undefined || max === undefined || max <= 0) continue

    if (actual > max) {
      violations.push({
        rule: check.label,
        actual: `${actual.toFixed(1)}h`,
        limit: `${max}h`,
        severity: "exceeded",
      })
    } else if (actual / max >= 0.9) {
      violations.push({
        rule: check.label,
        actual: `${actual.toFixed(1)}h`,
        limit: `${max}h`,
        severity: "warning",
      })
    }
  }

  // Check rest before this duty
  let restViolation: { restAvailable: number; restRequired: number } | null = null
  const reportDateTime = new Date(`${hypotheticalDuty.date}T${hypotheticalDuty.reportTime}:00`)

  // Find the most recent duty before this one
  const priorDuties = existingDutyPeriods
    .map(d => {
      const end = new Date(`${d.date}T${d.debriefTime}:00`)
      const rMin = hhmmToMinutes(d.reportTime)
      const dMin = hhmmToMinutes(d.debriefTime)
      if (dMin < rMin) end.setDate(end.getDate() + 1)
      return { dp: d, endTime: end }
    })
    .filter(d => d.endTime < reportDateTime)
    .sort((a, b) => b.endTime.getTime() - a.endTime.getTime())

  if (priorDuties.length > 0) {
    const restAvailableMinutes = (reportDateTime.getTime() - priorDuties[0].endTime.getTime()) / 60000
    const restRequiredMinutes = limits.minRestBetweenDuties * 60
    if (restAvailableMinutes < restRequiredMinutes) {
      restViolation = {
        restAvailable: restAvailableMinutes,
        restRequired: restRequiredMinutes,
      }
      violations.push({
        rule: "Min Rest",
        actual: `${(restAvailableMinutes / 60).toFixed(1)}h`,
        limit: `${limits.minRestBetweenDuties}h`,
        severity: "exceeded",
      })
    }
  }

  return {
    violations,
    isLegal: violations.filter(v => v.severity === "exceeded").length === 0,
    dutyPeriod: dp,
    cumulativeLimits: cumLimits,
    restViolation,
  }
}

/**
 * Get compliance status for cumulative limits
 */
export function getComplianceStatus(utilizationPercent: number): {
  status: "ok" | "warning" | "critical" | "exceeded"
  color: string
  label: string
} {
  if (utilizationPercent >= 100) {
    return {
      status: "exceeded",
      color: "text-red-500",
      label: "Exceeded",
    }
  } else if (utilizationPercent >= 90) {
    return {
      status: "critical",
      color: "text-orange-500",
      label: "Critical",
    }
  } else if (utilizationPercent >= 75) {
    return {
      status: "warning",
      color: "text-yellow-500",
      label: "Warning",
    }
  } else {
    return {
      status: "ok",
      color: "text-green-500",
      label: "OK",
    }
  }
}
