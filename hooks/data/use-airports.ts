"use client"

import { useCallback, useEffect, useState, type SetStateAction } from "react"
import useSWR from "swr"
import {
  getAllAirports,
  getAirportDatabase,
  getAirportsRevision,
  getAirportByIcao,
  getAirportByICAO,
  ensureAirportDatabase,
  isAirportTableSeeded,
  onAirportSeedProgress,
  type Airport,
} from "@/lib/db"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"

/** One empty list, so "no data yet" is the same reference every render. */
const NONE: never[] = []

/**
 * Fetch airports from IndexedDB (with auto-seed from JSON if empty)
 */
async function fetchAirports(): Promise<Airport[]> {
  const ready = await checkDBReady()
  if (!ready) return []

  // Try to get data from IndexedDB
  let airports = await getAllAirports()

  // If DB is empty, seed it from the bundled file. `getAirportDatabase` seeds
  // AND reads back; its rows are already mapped, so handing them to
  // `bulkLoadAirports` (which maps raw JSON) re-mapped them with no `lat`/`lon`
  // and wrote every airport back at 0°N 0°E.
  if (airports.length === 0) {
    console.log("[Airports] DB empty, fetching airports.min.json...")
    airports = await getAirportDatabase()
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
    airports: data ?? NONE,
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

/**
 * How far a running seed has got, 0..1 — null until the first report. Only
 * listens while `active`, which is while a screen is actually waiting on it.
 */
export function useAirportSeedProgress(active: boolean): number | null {
  const [fraction, setFraction] = useState<number | null>(null)
  useEffect(() => {
    if (!active) return
    return onAirportSeedProgress((done) => setFraction(done))
  }, [active])
  return active ? fraction : null
}

/**
 * ONE airport by ICAO, for a screen that needs a couple of them rather than
 * the list.
 *
 * The flight form used `useAirportDatabase` to find its departure and arrival,
 * so the first flight opened after every cold start read and deserialised the
 * whole ~29k-row table on the main thread to answer two primary-key lookups.
 * This answers from the in-memory list when something else (the airports page)
 * has already loaded it at the current revision, then from a small per-code
 * cache, and otherwise with one `get` on the primary key.
 *
 * It still makes sure the table is SEEDED (`ensureAirportDatabase`, which never
 * reads it back) — the flight form is where a new install's seed starts — and
 * looks again once a seed or any other write moves the revision.
 *
 * `undefined` = not known yet; `null` = looked up, no such airport.
 */
const icaoLookups = new Map<string, Airport | null>()
let icaoLookupsRevision = -1

function peekAirport(code: string): Airport | null | undefined {
  if (!code) return null
  const revision = getAirportsRevision()
  if (airportDbCache && airportDbCacheRevision === revision) return getAirportByICAO(airportDbCache, code) ?? null
  if (icaoLookupsRevision !== revision) {
    icaoLookups.clear()
    icaoLookupsRevision = revision
  }
  return icaoLookups.get(code)
}

/**
 * The last answer per code, whatever revision it was read at. A write to the
 * table (a custom airport, a favourite, a seed) invalidates `icaoLookups`, and
 * a screen that is still open must not see its airports go missing while it
 * looks them up again — the flight form read that gap as "no airport" and
 * zeroed the night time and the takeoffs and landings it then saved.
 */
const lastKnown = new Map<string, Airport | null>()

async function lookUpAirport(code: string): Promise<Airport | null | undefined> {
  const revision = getAirportsRevision()
  const airport = (await getAirportByIcao(code)) ?? null
  // Not there, but the seed has not finished: it may simply not be written
  // yet. Unknown, then — the seed's revision bump brings the hook back.
  if (!airport && !isAirportTableSeeded()) return undefined
  if (icaoLookupsRevision !== revision) {
    icaoLookups.clear()
    icaoLookupsRevision = revision
  }
  icaoLookups.set(code, airport)
  lastKnown.set(code, airport)
  return airport
}

/** Start the lookups for a screen about to open, so its first render has them. */
export function prefetchAirports(...icaos: (string | undefined | null)[]): void {
  for (const icao of icaos) {
    const code = icao?.trim().toUpperCase()
    if (code && peekAirport(code) === undefined) void lookUpAirport(code).catch(() => {})
  }
}

export function useAirportByIcao(icao: string | undefined | null): Airport | null | undefined {
  const code = icao?.trim().toUpperCase() ?? ""
  // Read on every render: a write moves it, and the lookup has to run again.
  // Keyed on the code alone, the effect never noticed — so after any write the
  // peek below came back empty and stayed empty for as long as the screen did.
  const revision = getAirportsRevision()
  // Only here to re-render when a lookup lands; the answer is in `lastKnown`.
  const [, setFound] = useState<{ code: string; airport: Airport | null | undefined } | null>(null)

  useEffect(() => {
    if (!code) return
    let alive = true
    const read = () =>
      lookUpAirport(code)
        .then((airport) => {
          if (alive) setFound({ code, airport })
        })
        .catch(() => {})
    const revisionBefore = getAirportsRevision()
    if (peekAirport(code) === undefined) void read()
    // A first seed (or any write) moves the revision: look again afterwards.
    void ensureAirportDatabase().then(() => {
      if (alive && getAirportsRevision() !== revisionBefore) void read()
    })
    return () => {
      alive = false
    }
  }, [code, revision])

  const cached = peekAirport(code)
  if (cached !== undefined) return cached
  // Stale while the re-read runs — the previous answer, not a gap.
  return lastKnown.get(code)
}
