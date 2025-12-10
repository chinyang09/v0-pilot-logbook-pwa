"use client"

import { useEffect } from "react"

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("SW registered:", registration.scope)
        })
        .catch((error) => {
          console.error("SW registration failed:", error)
        })

      // Listen for sync messages from service worker
      navigator.serviceWorker.addEventListener("message", async (event) => {
        if (event.data?.type === "SYNC_REQUIRED") {
          const { syncService } = await import("@/lib/sync-service")
          syncService.syncPendingChanges()
        }
      })
    }
  }, [])

  return null
}
