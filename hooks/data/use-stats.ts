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
    mutate: mutateStats,
  } = useSWR(isReady ? STATS_CACHE_KEY : null, fetchStats, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    // Revalidate WITHOUT clearing the cache. Passing `undefined` as data wipes it
    // first, which flips `isLoading` true and flashes this list's skeleton on every
    // background refresh — and hands out a NEW array reference even when nothing
    // changed, so SWR's deep `compare` can't hold the old one and every downstream
    // memo recomputes. `use-flights` has always done it this way; the rest had not.
    return mutateStats()
  }, [mutateStats])

  return {
    stats: data ?? DEFAULT_STATS,
    isLoading,
    error,
    refresh,
  }
}
