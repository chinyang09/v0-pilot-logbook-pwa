"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { getAllFlights, getFlightStats, type FlightLog } from "@/lib/db"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"

/**
 * Fetch flights from IndexedDB
 */
async function fetchFlights(): Promise<FlightLog[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  const flights = await getAllFlights()
  console.log("[Flights] Fetched from IndexedDB:", flights.length)
  return flights
}

/**
 * Default empty stats
 */
const DEFAULT_STATS = {
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

/**
 * Fetch flight statistics
 */
async function fetchStats() {
  const ready = await checkDBReady()
  if (!ready) return DEFAULT_STATS
  return getFlightStats()
}

/**
 * Hook for flights data
 */
export function useFlights() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateFlights,
  } = useSWR(isReady ? CACHE_KEYS.flights : null, fetchFlights, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[Flights] Refreshing...")
    return mutateFlights(undefined, { revalidate: true })
  }, [mutateFlights])

  return {
    flights: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}

/**
 * Hook for flight statistics
 */
export function useFlightStats() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateStats,
  } = useSWR(isReady ? CACHE_KEYS.stats : null, fetchStats, {
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
