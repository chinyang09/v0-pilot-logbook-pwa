"use client"

import { useMemo } from "react"
import { useFlights } from "./use-flights"
import { useScheduleEntries } from "./use-schedule"
import { DEFAULT_FTL_LIMITS } from "@/types/entities/roster.types"
import type { DutyPeriod } from "@/types/entities/roster.types"
import {
  createDutyPeriodsFromFlights,
  getDutyPeriodsFromSchedule,
  mergeDutyPeriods,
  calculateAllRestPeriods,
  calculateCumulativeLimits,
  calculateCapacity,
  forecastExceedances,
  generateTimelineData,
} from "@/lib/utils/roster/fdp-calculator"

/**
 * Combined FDP data hook.
 * Merges actual flights (logbook) with scheduled flights for a unified
 * picture of duty periods, rest compliance, capacity remaining, and
 * forecast exceedances per CAAS regulations.
 */
export function useFDPData() {
  const { flights, isLoading: flightsLoading } = useFlights()
  const { scheduleEntries, isLoading: scheduleLoading } = useScheduleEntries()

  const result = useMemo(() => {
    const logbookDPs = createDutyPeriodsFromFlights(flights)
    const scheduleDPs = getDutyPeriodsFromSchedule(scheduleEntries)

    const merged = mergeDutyPeriods(logbookDPs, scheduleDPs)
    const withRest = calculateAllRestPeriods(merged)

    const today = new Date()
    const limits = DEFAULT_FTL_LIMITS

    // Use only non-future DPs for current cumulative/capacity calculations
    const currentDPs = withRest.filter((dp) => !dp.isFuture)
    const cumulativeLimits = calculateCumulativeLimits(currentDPs, today, limits)
    const capacity = calculateCapacity(currentDPs, today, limits)

    // Forecast uses all DPs (past + future) to project exceedances
    const forecast = forecastExceedances(withRest, limits)

    // Split for display
    const pastDuties = withRest.filter((dp) => !dp.isFuture)
    const futureDuties = withRest.filter((dp) => dp.isFuture)

    // Rest violations
    const restViolations = withRest.filter(
      (dp) => dp.restBefore && !dp.restBefore.compliant
    )

    // Timeline chart data
    const timelineData = generateTimelineData(withRest, limits)

    return {
      allDutyPeriods: withRest,
      pastDuties,
      futureDuties,
      cumulativeLimits,
      capacity,
      forecast,
      restViolations,
      timelineData,
    }
  }, [flights, scheduleEntries])

  return {
    ...result,
    isLoading: flightsLoading || scheduleLoading,
  }
}
