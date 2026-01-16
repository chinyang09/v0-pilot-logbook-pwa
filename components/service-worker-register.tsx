"use client"

import { useEffect, useState } from "react"

export function ServiceWorkerRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Register service worker
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("[SW] Registered:", reg.scope)
          setRegistration(reg)

          // Check for updates
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  // New version available
                  setUpdateAvailable(true)
                }
              })
            }
          })

          // Check for updates periodically
          setInterval(
            () => {
              reg.update()
            },
            60 * 60 * 1000,
          ) // Every hour
        })
        .catch((error) => {
          console.error("[SW] Registration failed:", error)
        })

      // Listen for sync messages from service worker
      navigator.serviceWorker.addEventListener("message", async (event) => {
        if (event.data?.type === "SYNC_REQUIRED") {
          const { syncService } = await import("@/lib/sync")
          // Trigger immediate sync when requested by service worker
          await syncService.forceSyncNow()
        }
      })

      // Handle controller change (new SW activated)
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // Reload to get new version
        window.location.reload()
      })
    }

    // Note: Online event handling is now primarily managed by SyncTriggerManager
    // This is kept for backward compatibility with background sync registration
    const handleOnline = async () => {
      if ("serviceWorker" in navigator && "sync" in window.ServiceWorkerRegistration.prototype) {
        const reg = await navigator.serviceWorker.ready
        try {
          await (reg as any).sync.register("sync-flights")
        } catch (e) {
          // Background sync not supported - trigger manager will handle it
          console.log("[SW] Background sync registration failed, trigger manager will handle sync")
        }
      }
    }

    window.addEventListener("online", handleOnline)
    return () => window.removeEventListener("online", handleOnline)
  }, [])

  // Function to update service worker
  const handleUpdate = () => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" })
    }
  }

  if (!updateAvailable) return null

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 bg-blue-600 text-white p-4 rounded-lg shadow-lg flex items-center justify-between">
      <span className="text-sm">A new version is available</span>
      <button onClick={handleUpdate} className="bg-white text-blue-600 px-4 py-2 rounded-md text-sm font-medium">
        Update
      </button>
    </div>
  )
}
