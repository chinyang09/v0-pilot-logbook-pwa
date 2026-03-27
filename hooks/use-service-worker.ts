"use client"

import { useSyncExternalStore } from "react"

// Module-level singleton state
let updateAvailable = false
let registration: ServiceWorkerRegistration | null = null
let listeners = new Set<() => void>()
let initialized = false

function notify() {
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return updateAvailable
}

function getServerSnapshot() {
  return false
}

/** Call once from ServiceWorkerRegister to initialize SW lifecycle */
export function initServiceWorker() {
  if (initialized || typeof window === "undefined" || !("serviceWorker" in navigator)) return
  initialized = true

  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      console.log("[SW] Registered:", reg.scope)
      registration = reg

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing
        if (newWorker) {
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              updateAvailable = true
              notify()
            }
          })
        }
      })

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
      await syncService.forceSyncNow()
    }
  })

  // Handle controller change (new SW activated)
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload()
  })

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
}

export function applyServiceWorkerUpdate() {
  if (registration?.waiting) {
    registration.waiting.postMessage({ type: "SKIP_WAITING" })
  }
}

/** React hook to subscribe to update availability */
export function useServiceWorkerUpdate() {
  const hasUpdate = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { updateAvailable: hasUpdate, applyUpdate: applyServiceWorkerUpdate }
}
