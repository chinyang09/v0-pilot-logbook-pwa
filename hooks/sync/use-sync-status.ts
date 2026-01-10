"use client"

import { useState, useEffect } from "react"
import { syncService } from "@/lib/sync"

type SyncStatus = "online" | "offline" | "syncing"

/**
 * Hook to subscribe to sync status changes
 */
export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>(syncService.getStatus())

  useEffect(() => {
    const unsubscribe = syncService.subscribe(setStatus)
    return unsubscribe
  }, [])

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
