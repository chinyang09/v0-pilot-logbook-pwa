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
    mutate: mutateAircraft,
  } = useSWR(isReady ? CACHE_KEYS.aircraft : null, fetchAircraft, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[Aircraft] Refreshing...")
    // Revalidate WITHOUT clearing the cache. Passing `undefined` as data wipes it
    // first, which flips `isLoading` true and flashes this list's skeleton on every
    // background refresh — and hands out a NEW array reference even when nothing
    // changed, so SWR's deep `compare` can't hold the old one and every downstream
    // memo recomputes. `use-flights` has always done it this way; the rest had not.
    return mutateAircraft()
  }, [mutateAircraft])

  return {
    aircraft: data ?? [],
    // isLoading (no data yet) shows skeleton; isValidating (revalidating with existing data)
    // is excluded so revalidations keep the list visible instead of flashing a skeleton.
    isLoading,
    error,
    refresh,
  }
}
