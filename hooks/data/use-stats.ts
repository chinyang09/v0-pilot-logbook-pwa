"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { useDBReady } from "./use-db-ready"
import { getFlightStats, type FlightStats } from "@/lib/db/stores/metadata/stats.store"

export const STATS_CACHE_KEY = "idb:stats"

const DEFAULT_STATS: FlightStats = {
  totalFlights: 0,
  blockTime: "00:00",
  flightTime: "00:00",
  picTime: "00:00",
  sicTime: "00:00",
  picusTime: "00:00",
  dualTime: "00:00",
  instructorTime: "00:00",
  nightTime: "00:00",
  ifrTime: "00:00",
  totalDayLandings: 0,
  totalNightLandings: 0,
  totalAutolands: 0,
  uniqueAircraft: 0,
  uniqueAirports: 0,
}

async function fetchStats(): Promise<FlightStats> {
  return getFlightStats()
}

export function useFlightStats() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateStats,
  } = useSWR(isReady ? STATS_CACHE_KEY : null, fetchStats, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    return mutateStats(undefined, { revalidate: true })
  }, [mutateStats])

  return {
    stats: data ?? DEFAULT_STATS,
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}
