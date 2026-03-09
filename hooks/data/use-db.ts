"use client"

import { useEffect, useState } from "react"
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

// Global state for DB initialization
let dbInitialized = false
let dbInitPromise: Promise<boolean> | null = null

/**
 * Check if the database is ready
 * Used internally by data hooks
 */
export async function checkDBReady(): Promise<boolean> {
  if (typeof window === "undefined") return false

  if (dbInitialized) return true

  if (!dbInitPromise) {
    dbInitPromise = initializeDB().then((ready) => {
      dbInitialized = ready
      return ready
    })
  }

  return dbInitPromise
}

/**
 * Hook for DB ready state
 */
export function useDBReady() {
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    checkDBReady().then((ready) => {
      setIsReady(ready)
      setIsLoading(false)
    })
  }, [])

  return { isReady, isLoading }
}

/**
 * Refresh all cached data
 */
export async function refreshAllData() {
  console.log("[Data] Refreshing all data from IndexedDB...")
  // Call mutate(key) with no data argument — background revalidation that keeps
  // existing SWR cache data visible during the re-fetch. Passing `undefined` as
  // data would temporarily clear the cache, causing isLoading=true and a skeleton
  // flash while the Dexie re-fetch resolves.
  await Promise.all([
    mutate(CACHE_KEYS.flights),
    mutate(CACHE_KEYS.aircraft),
    mutate(CACHE_KEYS.personnel),
    mutate(CACHE_KEYS.stats),
  ])
  console.log("[Data] All data refreshed")
}
