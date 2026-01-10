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
  airports: "idb:airports",
  personnel: "idb:personnel",
  stats: "idb:stats",
  dbReady: "idb:ready",
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
  await Promise.all([
    mutate(CACHE_KEYS.flights, undefined, { revalidate: true }),
    mutate(CACHE_KEYS.aircraft, undefined, { revalidate: true }),
    mutate(CACHE_KEYS.personnel, undefined, { revalidate: true }),
    mutate(CACHE_KEYS.stats, undefined, { revalidate: true }),
  ])
  console.log("[Data] All data refreshed")
}
