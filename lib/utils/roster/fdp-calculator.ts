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
