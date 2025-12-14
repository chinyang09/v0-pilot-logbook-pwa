"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { syncService } from "@/lib/sync-service"
import { refreshAllData } from "@/hooks/use-indexed-db"

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    const doInitialSync = async () => {
      // Only sync once per session
      if (initialized) return

      console.log("[v0] Running initial sync...")

      if (navigator.onLine) {
        try {
          const result = await syncService.fullSync()
          console.log("[v0] Initial sync complete:", result)
          await refreshAllData()
          setInitialized(true)
        } catch (error) {
          console.error("[v0] Initial sync failed:", error)
          // Mark as initialized even if sync fails to prevent infinite retries
          setInitialized(true)
        }
      } else {
        console.log("[v0] Offline - skipping initial sync")
        setInitialized(true)
      }
    }

    doInitialSync()

    const unsubscribe = syncService.onDataChanged(() => {
      console.log("[v0] Data changed - refreshing all caches")
      refreshAllData()
    })

    return unsubscribe
  }, [initialized])

  return <>{children}</>
}
