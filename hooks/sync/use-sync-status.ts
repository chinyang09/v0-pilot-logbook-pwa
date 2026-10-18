"use client"

import { useState, useEffect, useSyncExternalStore } from "react"
import { syncService } from "@/lib/sync"

type SyncStatus = "online" | "offline" | "syncing"

/**
 * Hook to subscribe to sync status changes
 */
export function useSyncStatus() {
  // Store read with an "offline" server snapshot — see `SyncStatus`: seeding
  // state from the browser's answer mismatches the server-rendered HTML.
  const status = useSyncExternalStore<SyncStatus>(
    (onChange) => syncService.subscribe(onChange),
    () => syncService.getStatus(),
    () => "offline"
  )

  return {
    status,
    isOnline: status === "online",
    isOffline: status === "offline",
    isSyncing: status === "syncing",
  }
}

/**
 * Hook to trigger a manual sync
 */
export function useSyncTrigger() {
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<{
    pushed: number
    pulled: number
    failed: number
  } | null>(null)

  const triggerSync = async () => {
    setIsSyncing(true)
    try {
      const result = await syncService.fullSync()
      setLastResult(result)
      return result
    } finally {
      setIsSyncing(false)
    }
  }

  return {
    triggerSync,
    isSyncing,
    lastResult,
  }
}

/**
 * Hook to subscribe to data change notifications
 */
export function useDataChanged(callback: () => void) {
  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(callback)
    return unsubscribe
  }, [callback])
}
