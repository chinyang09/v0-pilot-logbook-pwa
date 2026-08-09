"use client"

import { useSyncExternalStore } from "react"
import { mutate } from "swr"
import { initializeDB } from "@/lib/db"

/**
 * SWR cache keys for data hooks
 */
export const CACHE_KEYS = {
  flights: "idb:flights",
  aircraft: "idb:aircraft",
  referenceAircraft: "idb:referenceAircraft",
  airports: "idb:airports",
  personnel: "idb:personnel",
  stats: "idb:stats",
  dbReady: "idb:ready",
  // Roster
  schedule: "idb:schedule",
  currencies: "idb:currencies",
  discrepancies: "idb:discrepancies",
}

// ── DB readiness, as a module store ──────────────────────────────────────────
//
// One process-wide answer, published through useSyncExternalStore rather than
// held per-hook.
//
// It used to be a `useState(false)` + effect in every consumer, which meant
// every page that reads data rendered ONCE as "not ready" and then again as
// ready — even when the database had been open since the first page. That
// first render is what put a skeleton on screen for a frame on every mount of
// every list, and there are five of them mounted at once. A store makes the
// answer available during the FIRST render of a page that mounts after init,
// so those pages paint their data straight away and never flash.
//
// Snapshots must be referentially stable, so the returned object is cached and
// only rebuilt on an actual transition.
let dbInitialized = false
let dbInitPromise: Promise<boolean> | null = null
let dbSnapshot = { isReady: false, isLoading: true }
const dbListeners = new Set<() => void>()

const SERVER_SNAPSHOT = { isReady: false, isLoading: true }

function setDBSnapshot(next: { isReady: boolean; isLoading: boolean }) {
  if (next.isReady === dbSnapshot.isReady && next.isLoading === dbSnapshot.isLoading) return
  dbSnapshot = next
  dbListeners.forEach((l) => l())
}

/**
 * Reset DB initialization state (called on logout so re-login re-initializes)
 */
export function resetDBState() {
  dbInitialized = false
  dbInitPromise = null
  setDBSnapshot({ isReady: false, isLoading: true })
}

/**
 * Check if the database is ready
 * Used internally by data hooks
 */
export async function checkDBReady(): Promise<boolean> {
  if (typeof window === "undefined") return false

  if (dbInitialized) return true

  if (!dbInitPromise) {
    dbInitPromise = initializeDB()
      .then((ready) => {
        dbInitialized = ready
        setDBSnapshot({ isReady: ready, isLoading: false })
        return ready
      })
      .catch((error) => {
        // Stop reporting "loading" — a page that can never become ready should
        // show its empty state, not a skeleton forever. Leaves `dbInitPromise`
        // set so we don't hammer a database that is failing to open.
        console.error("[UserDB] Initialization failed:", error)
        setDBSnapshot({ isReady: false, isLoading: false })
        return false
      })
  }

  return dbInitPromise
}

function subscribeDBReady(onChange: () => void) {
  dbListeners.add(onChange)
  // Mounting a consumer is what opens the database — same trigger as the
  // effect this replaced, just without the extra render it cost.
  void checkDBReady()
  return () => {
    dbListeners.delete(onChange)
  }
}

const getDBSnapshot = () => dbSnapshot
const getDBServerSnapshot = () => SERVER_SNAPSHOT

/**
 * Hook for DB ready state
 */
export function useDBReady() {
  return useSyncExternalStore(subscribeDBReady, getDBSnapshot, getDBServerSnapshot)
}

/** Coalesces overlapping refreshes — see `refreshAllData`. */
let refreshInFlight: Promise<unknown> | null = null

/**
 * Refresh every cached IndexedDB-backed collection.
 *
 * A KEY FILTER, not a hardcoded list. `mutate(fn)` revalidates only the keys
 * actually present in the SWR cache, so this costs one Dexie read per
 * collection a mounted page is really showing — and it can't go stale the way
 * the old four-key list had: the roster, currencies and discrepancies caches
 * were never in it, so those pages kept showing pre-sync numbers until they
 * remounted.
 *
 * Concurrent callers share ONE pass. `onDataChanged` fires once per sync
 * cycle but several always-mounted subscribers can land on the same tick (the
 * provider plus a keep-alive page's own re-activation refresh), and each
 * duplicate was a full re-read of every table plus the re-render it triggers.
 * Callers still get a promise that resolves when the data is actually in.
 */
export async function refreshAllData() {
  if (refreshInFlight) return refreshInFlight
  console.log("[Data] Refreshing all data from IndexedDB...")
  // No data argument — a background revalidation that keeps the existing cache
  // visible during the re-fetch. Passing `undefined` as data would clear it,
  // flipping isLoading true and flashing a skeleton while Dexie resolves.
  refreshInFlight = mutate(
    (key) => typeof key === "string" && key.startsWith("idb:"),
  ).finally(() => {
    refreshInFlight = null
  })
  await refreshInFlight
  console.log("[Data] All data refreshed")
}
