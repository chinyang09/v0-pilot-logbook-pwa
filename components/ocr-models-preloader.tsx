"use client"

import { useEffect } from "react"
import { checkOCRModelsCached, ensureOCRModelsCached } from "@/lib/ocr"
import { warmBrowserOCR } from "@/lib/ocr/ocr-service"

export function OCRModelsPreloader() {
  useEffect(() => {
    // Only preload when online
    if (!navigator.onLine) {
      console.log("[OCR Preloader] Offline - skipping model preload")
      return
    }

    const preloadModels = async () => {
      // The engine's code as well as its models: neither is any use offline
      // unless it was fetched while online.
      warmBrowserOCR()
      try {
        // Check if already cached
        const { allCached } = await checkOCRModelsCached()
        if (allCached) {
          console.log("[OCR Preloader] Models already cached for offline use")
          return
        }

        // Cache models in background
        console.log("[OCR Preloader] Starting background model caching...")
        const result = await ensureOCRModelsCached()
        if (result.success) {
          console.log("[OCR Preloader] Models cached successfully for offline use")
        } else {
          console.warn("[OCR Preloader] Some models failed to cache:", result.details)
        }
      } catch (error) {
        console.error("[OCR Preloader] Failed to preload models:", error)
      }
    }

    // Not before 3s (let the first render and the SW registration go first),
    // and then only when the main thread is idle — a fixed timer landed on
    // the user's first interactions. The idle deadline guarantees it runs.
    let idle: number | undefined
    const timer = setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(() => void preloadModels(), { timeout: 5000 })
      } else {
        void preloadModels()
      }
    }, 3000)
    return () => {
      clearTimeout(timer)
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
    }
  }, [])

  return null
}
