"use client"

import { useEffect } from "react"
import { initServiceWorker } from "@/hooks/use-service-worker"

/**
 * Headless service worker registration component.
 * Update UI is now handled by PWAInstallPrompt.
 * This component only handles SW lifecycle.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    initServiceWorker()
  }, [])
  return null
}
