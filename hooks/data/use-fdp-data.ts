"use client"

import { useMemo, useState, useEffect, useCallback } from "react"
import { useFlights } from "./use-flights"
import { useScheduleEntries } from "./use-schedule"
import { DEFAULT_FTL_LIMITS } from "@/types/entities/roster.types"
import type { DutyPeriod } from "@/types/entities/roster.types"
import {
  createDutyPeriodsFromFlights,
  getDutyPeriodsFromSchedule,
  mergeDutyPeriods,
  mergeAdjacentDutyPeriods,
  calculateAllRestPeriods,
  calculateCumulativeLimits,
  calculateCapacity,
  forecastExceedances,
  generateTimelineData,
  calculateRestUntilLegal,
} from "@/lib/utils/roster/fdp-calculator"
import type { RestUntilLegalResult } from "@/lib/utils/roster/fdp-calculator"
import { getAirportByIata } from "@/lib/db/stores/reference/airports.store"
import { getAirportTimeInfo } from "@/lib/db/stores/reference/airports.store"

/**
 * Combined FDP data hook.
 * Merges actual flights (logbook) with scheduled flights for a unified
 * picture of duty periods, rest compliance, capacity remaining, and
 * forecast exceedances per CAAS regulations.
 */
export function useFDPData() {
  const { flights, isLoading: flightsLoading } = useFlights()
  const { scheduleEntries, isLoading: scheduleLoading } = useScheduleEntries()

  // Pre-resolve airport timezone offsets for schedule entries
  const [airportTimezones, setAirportTimezones] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    async function resolveTimezones() {
      const iatas = new Set<string>()
      for (const entry of scheduleEntries) {
        const depIata = entry.sectors?.[0]?.departureIata
        if (depIata) iatas.add(depIata)
      }
      if (iatas.size === 0) {
        setAirportTimezones(new Map())
        return
      }
      const map = new Map<string, number>()
      await Promise.all(
        [...iatas].map(async (iata) => {
          const airport = await getAirportByIata(iata)
          if (airport?.tz) {
            map.set(iata, getAirportTimeInfo(airport.tz).offset)
          }
        })
      )
      setAirportTimezones(map)
    }
    if (scheduleEntries.length > 0) {
      resolveTimezones()
    }
  }, [scheduleEntries])

  const result = useMemo(() => {
    const logbookDPs = mergeAdjacentDutyPeriods(createDutyPeriodsFromFlights(flights))
    const scheduleDPs = mergeAdjacentDutyPeriods(
      getDutyPeriodsFromSchedule(scheduleEntries, airportTimezones)
    )

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

    // Rest until legal for next duty
    const restUntilLegal = calculateRestUntilLegal(currentDPs)

    return {
      allDutyPeriods: withRest,
      pastDuties,
      futureDuties,
      cumulativeLimits,
      capacity,
      forecast,
      restViolations,
      timelineData,
      restUntilLegal,
    }
  }, [flights, scheduleEntries, airportTimezones])

  // Live countdown — recompute rest-until-legal every 60 seconds
  const [liveRestUntilLegal, setLiveRestUntilLegal] = useState<RestUntilLegalResult | null>(
    result.restUntilLegal
  )

  useEffect(() => {
    setLiveRestUntilLegal(result.restUntilLegal)
  }, [result.restUntilLegal])

  useEffect(() => {
    if (!result.restUntilLegal || result.restUntilLegal.isLegalNow) return

    const interval = setInterval(() => {
      // Rebuild from the same last duty data but with updated "now"
      const currentDPs = result.allDutyPeriods.filter((dp) => !dp.isFuture)
      const updated = calculateRestUntilLegal(currentDPs)
      setLiveRestUntilLegal(updated)
    }, 60_000)

    return () => clearInterval(interval)
  }, [result.restUntilLegal, result.allDutyPeriods])

  return {
    ...result,
    restUntilLegal: liveRestUntilLegal,
    isLoading: flightsLoading || scheduleLoading,
  }
}
