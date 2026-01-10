"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { useDBReady } from "./use-db-ready"
import { getAllAircraft } from "@/lib/db/stores/user/aircraft.store"
import type { Aircraft } from "@/types/entities/aircraft.types"

export const AIRCRAFT_CACHE_KEY = "idb:aircraft"

async function fetchAircraft(): Promise<Aircraft[]> {
  const aircraft = await getAllAircraft()
  console.log("[v0] Fetched aircraft from IndexedDB:", aircraft.length)
  return aircraft
}

export function useAircraft() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateAircraft,
  } = useSWR(isReady ? AIRCRAFT_CACHE_KEY : null, fetchAircraft, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[v0] Refreshing aircraft...")
    return mutateAircraft(undefined, { revalidate: true })
  }, [mutateAircraft])

  return {
    aircraft: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}
