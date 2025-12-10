"use client"

import { useCallback } from "react"
import useSWR, { mutate } from "swr"
import {
  initializeDB,
  getAllFlights,
  getAllAircraft,
  getAllAirports,
  getAllPersonnel,
  getFlightStats,
  type FlightLog,
  type Aircraft,
  type Airport,
  type Personnel,
} from "@/lib/indexed-db"

// Keys for SWR cache
export const CACHE_KEYS = {
  flights: "idb:flights",
  aircraft: "idb:aircraft",
  airports: "idb:airports",
  personnel: "idb:personnel",
  stats: "idb:stats",
  dbReady: "idb:ready",
}

// Initialize DB and return ready state
async function checkDBReady(): Promise<boolean> {
  if (typeof window === "undefined") return false
  return initializeDB()
}

// Fetchers that wait for DB to be ready
async function fetchFlights(): Promise<FlightLog[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  return getAllFlights()
}

async function fetchAircraft(): Promise<Aircraft[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  return getAllAircraft()
}

async function fetchAirports(): Promise<Airport[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  return getAllAirports()
}

async function fetchPersonnel(): Promise<Personnel[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  return getAllPersonnel()
}

async function fetchStats() {
  const ready = await checkDBReady()
  if (!ready) {
    return {
      totalFlights: 0,
      blockTime: "00:00",
      flightTime: "00:00",
      p1Time: "00:00",
      p2Time: "00:00",
      p1usTime: "00:00",
      dualTime: "00:00",
      nightTime: "00:00",
      ifrTime: "00:00",
      totalDayLandings: 0,
      totalNightLandings: 0,
      uniqueAircraft: 0,
      uniqueAirports: 0,
    }
  }
  return getFlightStats()
}

// Hook for DB ready state
export function useDBReady() {
  const { data: isReady, isLoading } = useSWR(CACHE_KEYS.dbReady, checkDBReady, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  })
  return { isReady: isReady ?? false, isLoading }
}

// Hook for flights with lazy loading support
export function useFlights() {
  const {
    data,
    error,
    isLoading,
    mutate: mutateFlights,
  } = useSWR(CACHE_KEYS.flights, fetchFlights, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
  })

  const refresh = useCallback(() => {
    return mutateFlights()
  }, [mutateFlights])

  return {
    flights: data ?? [],
    isLoading,
    error,
    refresh,
  }
}

// Hook for aircraft
export function useAircraft() {
  const {
    data,
    error,
    isLoading,
    mutate: mutateAircraft,
  } = useSWR(CACHE_KEYS.aircraft, fetchAircraft, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  })

  const refresh = useCallback(() => {
    return mutateAircraft()
  }, [mutateAircraft])

  return {
    aircraft: data ?? [],
    isLoading,
    error,
    refresh,
  }
}

// Hook for airports
export function useAirports() {
  const {
    data,
    error,
    isLoading,
    mutate: mutateAirports,
  } = useSWR(CACHE_KEYS.airports, fetchAirports, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  })

  const refresh = useCallback(() => {
    return mutateAirports()
  }, [mutateAirports])

  return {
    airports: data ?? [],
    isLoading,
    error,
    refresh,
  }
}

// Hook for personnel
export function usePersonnel() {
  const {
    data,
    error,
    isLoading,
    mutate: mutatePersonnel,
  } = useSWR(CACHE_KEYS.personnel, fetchPersonnel, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  })

  const refresh = useCallback(() => {
    return mutatePersonnel()
  }, [mutatePersonnel])

  return {
    personnel: data ?? [],
    isLoading,
    error,
    refresh,
  }
}

// Hook for stats
export function useFlightStats() {
  const {
    data,
    error,
    isLoading,
    mutate: mutateStats,
  } = useSWR(CACHE_KEYS.stats, fetchStats, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
  })

  const refresh = useCallback(() => {
    return mutateStats()
  }, [mutateStats])

  return {
    stats: data ?? {
      totalFlights: 0,
      blockTime: "00:00",
      flightTime: "00:00",
      p1Time: "00:00",
      p2Time: "00:00",
      p1usTime: "00:00",
      dualTime: "00:00",
      nightTime: "00:00",
      ifrTime: "00:00",
      totalDayLandings: 0,
      totalNightLandings: 0,
      uniqueAircraft: 0,
      uniqueAirports: 0,
    },
    isLoading,
    error,
    refresh,
  }
}

// Utility to refresh all data after sync
export async function refreshAllData() {
  await Promise.all([
    mutate(CACHE_KEYS.flights),
    mutate(CACHE_KEYS.aircraft),
    mutate(CACHE_KEYS.airports),
    mutate(CACHE_KEYS.personnel),
    mutate(CACHE_KEYS.stats),
  ])
}
