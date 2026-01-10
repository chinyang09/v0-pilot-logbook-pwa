"use client"

import { useCallback, useEffect, useState } from "react"
import useSWR from "swr"
import {
  getAllAirports,
  bulkLoadAirports,
  getAirportDatabase,
  type Airport,
} from "@/lib/db"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"

/**
 * Fetch airports from IndexedDB (with auto-seed from JSON if empty)
 */
async function fetchAirports(): Promise<Airport[]> {
  const ready = await checkDBReady()
  if (!ready) return []

  // Try to get data from IndexedDB
  let airports = await getAllAirports()

  // If DB is empty, fetch the JSON and seed it
  if (airports.length === 0) {
    console.log("[Airports] DB empty, fetching airports.min.json...")
    const data = await getAirportDatabase()

    // Save to IndexedDB so next time it's instant
    await bulkLoadAirports(data)

    // Retrieve the newly saved records
    airports = await getAllAirports()
  }

  console.log("[Airports] Total loaded:", airports.length)
  return airports
}

/**
 * Hook for airports data (with SWR caching)
 */
export function useAirports() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateAirports,
  } = useSWR(isReady ? CACHE_KEYS.airports : null, fetchAirports, {
    revalidateOnFocus: false,
    revalidateOnMount: false,
    dedupingInterval: 10000,
  })

  const refresh = useCallback(() => {
    console.log("[Airports] Refreshing...")
    return mutateAirports(undefined, { revalidate: true })
  }, [mutateAirports])

  return {
    airports: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}

/**
 * Hook for airport database (direct load without SWR)
 * Used for airport selection screens
 */
export function useAirportDatabase() {
  const [airports, setAirports] = useState<Airport[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        setIsLoading(true)
        const data = await getAirportDatabase()

        if (mounted) {
          setAirports(data as unknown as Airport[])
          console.log("[Airport DB] Database ready with", data.length, "records")
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error)
          console.error("[Airport DB] Load failed:", err)
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    load()

    return () => {
      mounted = false
    }
  }, [])

  return { airports, isLoading, error }
}
