"use client"

import type React from "react"
import { useEffect, useRef } from "react"
import { syncService } from "@/lib/sync"
import { refreshAllData } from "@/hooks/data"
import { getUserSession } from "@/lib/db"

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const syncInitiated = useRef(false)

  useEffect(() => {
    const doInitialSync = async () => {
      // Only sync once per session
      if (syncInitiated.current) return
      syncInitiated.current = true

      // Check if user is authenticated before syncing
      const session = await getUserSession()
      if (!session) {
        console.log("[v0] No session - skipping sync")
        return
      }

      console.log("[v0] Starting background sync for user:", session.callsign)

      if (navigator.onLine) {
        try {
          // Set a timeout to prevent indefinite hangs
          const syncPromise = syncService.fullSync()
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Sync timeout after 30s")), 30000),
          )

          const result = await Promise.race([syncPromise, timeoutPromise])
          console.log("[v0] Background sync complete:", result)
          await refreshAllData()
        } catch (error) {
          console.error("[v0] Background sync failed:", error)
          // Continue regardless - offline mode still works
        }
      } else {
        console.log("[v0] Offline - skipping sync")
      }
    }

    // Start sync immediately but don't wait for it
    doInitialSync()

    const unsubscribe = syncService.onDataChanged(() => {
      console.log("[v0] Data changed - refreshing all caches")
      refreshAllData()
    })

    return unsubscribe
  }, [])

  return <>{children}</>
}
