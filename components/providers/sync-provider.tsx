"use client"

import type React from "react"
import { useEffect, useRef } from "react"
import { syncService } from "@/lib/sync"
import { refreshAllData } from "@/hooks/data"
import { useAuth } from "@/components/providers/auth-provider"

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const userId = user?.userId ?? null

  // Tracks which user the trigger manager + initial sync are currently set up
  // for, so we only (re)initialize on an actual auth transition — not on every
  // render, and not on same-user updates (callsign change, silent reauth).
  const syncedUserId = useRef<string | null>(null)

  // Initialization is driven by auth state, not by mount: the provider mounts
  // once at the root and never remounts across login/logout (those are route
  // changes). So a login that happens after mount must (re)initialize here.
  useEffect(() => {
    // Logged out (or not yet authenticated) — tear down any running triggers
    // so a stale session's listeners can't keep firing, and reset so the next
    // login re-initializes from scratch.
    if (!userId) {
      if (syncedUserId.current) {
        console.log("[v0] User signed out - tearing down sync triggers")
        syncService.destroyTriggers()
        syncedUserId.current = null
      }
      return
    }

    // Already initialized for this user — nothing to do.
    if (syncedUserId.current === userId) return
    syncedUserId.current = userId

    console.log("[v0] Initializing intelligent sync system for user:", userId)

    // Initialize trigger manager (idempotent) with intelligent sync logic.
    syncService.initializeTriggers()

    // Do an initial sync immediately if online so a fresh login pulls data
    // without needing a manual sync tap.
    if (navigator.onLine) {
      void (async () => {
        try {
          console.log("[v0] Performing initial sync")
          // Guard against indefinite hangs; fullSync also has per-request timeouts.
          const syncPromise = syncService.fullSync()
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Sync timeout after 30s")), 30000),
          )

          const result = await Promise.race([syncPromise, timeoutPromise])
          console.log("[v0] Initial sync complete:", result)
          await refreshAllData()
        } catch (error) {
          console.error("[v0] Initial sync failed:", error)
          // Continue regardless - offline mode still works.
        }
      })()
    } else {
      console.log("[v0] Offline - skipping initial sync, triggers will handle it when online")
    }
  }, [userId])

  // Keep app caches in sync with background pulls, independent of auth state.
  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      console.log("[v0] Data changed - refreshing all caches")
      refreshAllData()
    })
    return unsubscribe
  }, [])

  // On full provider unmount (app teardown), stop the triggers.
  useEffect(() => {
    return () => {
      syncService.destroyTriggers()
      syncedUserId.current = null
    }
  }, [])

  return <>{children}</>
}
