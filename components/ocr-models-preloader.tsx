"use client"

import { useEffect } from "react"
import { checkOCRModelsCached, ensureOCRModelsCached } from "@/lib/ocr"

export function OCRModelsPreloader() {
  useEffect(() => {
    // Only preload when online
    if (!navigator.onLine) {
      console.log("[OCR Preloader] Offline - skipping model preload")
      return
    }

    const preloadModels = async () => {
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

    // Delay to not block initial render and allow service worker to register
    const timer = setTimeout(preloadModels, 3000)
    return () => clearTimeout(timer)
  }, [])

  return null
}
