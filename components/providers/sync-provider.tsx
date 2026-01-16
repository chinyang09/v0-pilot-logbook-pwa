"use client"

import type React from "react"
import { useEffect, useRef } from "react"
import { syncService } from "@/lib/sync"
import { refreshAllData } from "@/hooks/data"
import { getUserSession } from "@/lib/db"

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const syncInitiated = useRef(false)

  useEffect(() => {
    const initializeSync = async () => {
      // Only initialize once per session
      if (syncInitiated.current) return
      syncInitiated.current = true

      // Check if user is authenticated before syncing
      const session = await getUserSession()
      if (!session) {
        console.log("[v0] No session - skipping sync initialization")
        return
      }

      console.log("[v0] Initializing intelligent sync system for user:", session.callsign)

      // Initialize trigger manager with intelligent sync logic
      syncService.initializeTriggers()

      // Do initial sync immediately if online
      if (navigator.onLine) {
        try {
          console.log("[v0] Performing initial sync")
          // Set a timeout to prevent indefinite hangs
          const syncPromise = syncService.fullSync()
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Sync timeout after 30s")), 30000),
          )

          const result = await Promise.race([syncPromise, timeoutPromise])
          console.log("[v0] Initial sync complete:", result)
          await refreshAllData()
        } catch (error) {
          console.error("[v0] Initial sync failed:", error)
          // Continue regardless - offline mode still works
        }
      } else {
        console.log("[v0] Offline - skipping initial sync, triggers will handle it when online")
      }
    }

    // Start initialization immediately but don't wait for it
    initializeSync()

    const unsubscribe = syncService.onDataChanged(() => {
      console.log("[v0] Data changed - refreshing all caches")
      refreshAllData()
    })

    return unsubscribe
  }, [])

  return <>{children}</>
}
