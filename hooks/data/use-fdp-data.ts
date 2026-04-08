"use client"

import { useMemo, useState, useEffect, useCallback } from "react"
import { useFlights } from "./use-flights"
import { useScheduleEntries } from "./use-schedule"
import { useDBReady } from "./use-db"
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
import type { RestUntilLegalResult, TimelineDataPoint } from "@/lib/utils/roster/fdp-calculator"
import { getAirportByIata } from "@/lib/db/stores/reference/airports.store"
import { getAirportTimeInfo } from "@/lib/db/stores/reference/airports.store"

/** Safe empty defaults — avoids recreating objects on every render */
const EMPTY_CAPACITY = {
  duty14Days: { used: 0, limit: 0, remaining: 0 },
  duty28Days: { used: 0, limit: 0, remaining: 0 },
  flight28Days: { used: 0, limit: 0, remaining: 0 },
  flight365Days: { used: 0, limit: 0, remaining: 0 },
  canAcceptMore: true,
  bottleneck: "",
}

const EMPTY_RESULT = {
  allDutyPeriods: [] as DutyPeriod[],
  pastDuties: [] as DutyPeriod[],
  futureDuties: [] as DutyPeriod[],
  cumulativeLimits: {
    last14Days: { dutyHours: 0, flightHours: 0, maxDutyHours: 0, maxFlightHours: 0, utilizationPercent: 0 },
    last28Days: { dutyHours: 0, flightHours: 0, maxDutyHours: 0, maxFlightHours: 0, utilizationPercent: 0 },
    last365Days: { flightHours: 0, maxFlightHours: 0, utilizationPercent: 0 },
    calculatedAt: 0,
    calculatedForDate: "",
  },
  capacity: EMPTY_CAPACITY,
  forecast: { exceedances: [] as Array<{ date: string; limitName: string; projected: number; limit: number }>, hasExceedance: false },
  restViolations: [] as DutyPeriod[],
  timelineData: [] as TimelineDataPoint[],
  restUntilLegal: null as RestUntilLegalResult | null,
}

/**
 * Combined FDP data hook.
 * Merges actual flights (logbook) with scheduled flights for a unified
 * picture of duty periods, rest compliance, capacity remaining, and
 * forecast exceedances per CAAS regulations.
 */
export function useFDPData() {
  const { isReady: dbReady } = useDBReady()
  const { flights, isLoading: flightsLoading } = useFlights()
  const { scheduleEntries, isLoading: scheduleLoading } = useScheduleEntries()

  // Pre-resolve airport timezone offsets for schedule entries
  const [airportTimezones, setAirportTimezones] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    async function resolveTimezones() {
      try {
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
            try {
              const airport = await getAirportByIata(iata)
              if (airport?.tz) {
                map.set(iata, getAirportTimeInfo(airport.tz).offset)
              }
            } catch {
              // Individual airport lookup failed — skip, will use default SGT offset
            }
          })
        )
        setAirportTimezones(map)
      } catch (err) {
        console.warn("[FDP] Failed to resolve timezones:", err)
      }
    }
    if (dbReady && scheduleEntries.length > 0) {
      resolveTimezones()
    }
  }, [dbReady, scheduleEntries])

  const result = useMemo(() => {
    if (!dbReady) return EMPTY_RESULT

    try {
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
    } catch (err) {
      console.error("[FDP] Error computing duty data:", err)
      return EMPTY_RESULT
    }
  }, [dbReady, flights, scheduleEntries, airportTimezones])

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
    isLoading: !dbReady || flightsLoading || scheduleLoading,
  }
}
