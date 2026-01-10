"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { useDBReady } from "./use-db-ready"
import { getAllFlights } from "@/lib/db/stores/user/flights.store"
import type { FlightLog } from "@/types/entities/flight.types"

export const FLIGHTS_CACHE_KEY = "idb:flights"

async function fetchFlights(): Promise<FlightLog[]> {
  const flights = await getAllFlights()
  console.log("[v0] Fetched flights from IndexedDB:", flights.length)
  return flights
}

export function useFlights() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateFlights,
  } = useSWR(isReady ? FLIGHTS_CACHE_KEY : null, fetchFlights, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[v0] Refreshing flights...")
    return mutateFlights(undefined, { revalidate: true })
  }, [mutateFlights])

  return {
    flights: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}
