"use client"

import { useCallback } from "react"
import useSWR from "swr"
import {
  getAllAircraftFromDatabase,
  normalizeAircraft,
  type NormalizedAircraft,
} from "@/lib/db/stores/reference/aircraft.store"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"

/**
 * Fetch all reference aircraft from IndexedDB and normalize them
 */
async function fetchReferenceAircraft(): Promise<NormalizedAircraft[]> {
  const ready = await checkDBReady()
  if (!ready) return []

  const allRecords = await getAllAircraftFromDatabase()
  const parsed: NormalizedAircraft[] = []
  for (const record of allRecords) {
    try {
      const data = JSON.parse(record.data)
      parsed.push(normalizeAircraft(data))
    } catch {
      /* skip invalid records */
    }
  }
  console.log("[ReferenceAircraft] Fetched from IndexedDB:", parsed.length)
  return parsed
}

/**
 * Hook for reference aircraft data (from referenceDb.aircraftDatabase)
 *
 * Follows the same SWR pattern as useFlights() for reactive updates.
 * Call refresh() after adding/modifying aircraft to re-read from IndexedDB.
 */
export function useReferenceAircraft() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateAircraft,
  } = useSWR(
    isReady ? CACHE_KEYS.referenceAircraft : null,
    fetchReferenceAircraft,
    {
      revalidateOnFocus: false,
      revalidateOnMount: true,
      dedupingInterval: 0,
    }
  )

  const refresh = useCallback(() => {
    console.log("[ReferenceAircraft] Refreshing...")
    return mutateAircraft(undefined, { revalidate: true })
  }, [mutateAircraft])

  return {
    aircraft: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}
