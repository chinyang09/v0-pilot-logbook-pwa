"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { getAllAircraft, type Aircraft } from "@/lib/db"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"

/**
 * Fetch user aircraft from IndexedDB
 */
async function fetchAircraft(): Promise<Aircraft[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  const aircraft = await getAllAircraft()
  console.log("[Aircraft] Fetched from IndexedDB:", aircraft.length)
  return aircraft
}

/**
 * Hook for user aircraft data
 */
export function useAircraft() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateAircraft,
  } = useSWR(isReady ? CACHE_KEYS.aircraft : null, fetchAircraft, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[Aircraft] Refreshing...")
    return mutateAircraft(undefined, { revalidate: true })
  }, [mutateAircraft])

  return {
    aircraft: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}
