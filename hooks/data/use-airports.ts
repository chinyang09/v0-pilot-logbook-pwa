"use client"

import { useCallback, useEffect, useState, type SetStateAction } from "react"
import useSWR from "swr"
import {
  getAllAirports,
  bulkLoadAirports,
  getAirportDatabase,
  getAirportsRevision,
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
    mutate: mutateAirports,
  } = useSWR(isReady ? CACHE_KEYS.airports : null, fetchAirports, {
    revalidateOnFocus: false,
    revalidateOnMount: false,
    dedupingInterval: 10000,
  })

  const refresh = useCallback(() => {
    console.log("[Airports] Refreshing...")
    // Revalidate WITHOUT clearing the cache. Passing `undefined` as data wipes it
    // first, which flips `isLoading` true and flashes this list's skeleton on every
    // background refresh — and hands out a NEW array reference even when nothing
    // changed, so SWR's deep `compare` can't hold the old one and every downstream
    // memo recomputes. `use-flights` has always done it this way; the rest had not.
    return mutateAirports()
  }, [mutateAirports])

  return {
    airports: data ?? [],
    isLoading,
    error,
    refresh,
  }
}

/**
 * Hook for airport database (direct load without SWR)
 * Used for airport selection screens
 *
 * The loaded database is cached at module scope so that components which mount
 * after the first load (e.g. the flight form re-opening when switching sections)
 * get the data synchronously on their first render — preventing a flicker where
 * timezone-derived fields (UTC offsets) briefly compute from an empty database.
 */
let airportDbCache: Airport[] | null = null
/** The store revision `airportDbCache` was read at. -1 = never loaded. */
let airportDbCacheRevision = -1

export function useAirportDatabase() {
  const [airports, setAirports] = useState<Airport[]>(() => airportDbCache ?? [])
  const [isLoading, setIsLoading] = useState(!airportDbCache)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        // Only show the loading state when we have nothing cached to render yet.
        if (!airportDbCache) setIsLoading(true)
        // Captured BEFORE the read: a write that lands while we are loading
        // must leave the cache looking stale, not falsely current.
        const revisionAtLoad = getAirportsRevision()
        const data = await getAirportDatabase()
        airportDbCache = data as unknown as Airport[]
        airportDbCacheRevision = revisionAtLoad

        if (mounted) {
          setAirports(airportDbCache)
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

    // Reload only when the table has actually changed since the cached copy was
    // read. This hook used to re-read all ~10k airports from IndexedDB on EVERY
    // mount, and the flight form mounts on every flight tap. The blind reload
    // existed because the import enricher adds airports through Dexie directly
    // rather than through `mutate` below; the store's revision counter reports
    // that precisely, and covers a write while a component stays mounted, which
    // reload-on-mount never did.
    if (airportDbCache && airportDbCacheRevision === getAirportsRevision()) {
      // `airports` was already seeded from the cache in useState, and
      // `isLoading` initialised false — there is nothing to do.
      return
    }

    load()

    return () => {
      mounted = false
    }
  }, [])

  const mutate = useCallback((updater: SetStateAction<Airport[]>) => {
    setAirports((prev) => {
      const next = typeof updater === "function" ? (updater as (p: Airport[]) => Airport[])(prev) : updater
      // Keep the module cache coherent with local mutations (e.g. adding a custom airport)
      airportDbCache = next
      return next
    })
  }, [])

  return { airports, isLoading, error, mutate }
}
