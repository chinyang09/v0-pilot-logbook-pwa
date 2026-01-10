"use client"

import { useCallback, useEffect, useState } from "react"
import useSWR from "swr"
import { useDBReady } from "./use-db-ready"
import { getAllAirports, bulkLoadAirports } from "@/lib/db/stores/reference/airports.store"
import type { Airport } from "@/types/entities/airport.types"

export const AIRPORTS_CACHE_KEY = "idb:airports"

async function getAirportDatabase(): Promise<Record<string, any>> {
  const response = await fetch("/airports.min.json")
  if (!response.ok) throw new Error("Failed to fetch airports data")
  return response.json()
}

async function fetchAirports(): Promise<Airport[]> {
  // Try to get data from IndexedDB first
  let airports = await getAllAirports()

  // If DB is empty, fetch the JSON and seed it
  if (airports.length === 0) {
    console.log("[v0] DB empty, fetching airports.min.json...")
    const data = await getAirportDatabase()

    // Save to IndexedDB
    await bulkLoadAirports(data)

    // Retrieve the newly saved records
    airports = await getAllAirports()
  }

  console.log("[v0] Total airports loaded:", airports.length)
  return airports
}

export function useAirports() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateAirports,
  } = useSWR(isReady ? AIRPORTS_CACHE_KEY : null, fetchAirports, {
    revalidateOnFocus: false,
    revalidateOnMount: false,
    dedupingInterval: 10000,
  })

  const refresh = useCallback(() => {
    console.log("[v0] Refreshing airports...")
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
 * Hook for airport database with loading state
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
          setAirports(Object.values(data) as unknown as Airport[])
          console.log("[Airport DB] Database ready with", Object.keys(data).length, "records")
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
