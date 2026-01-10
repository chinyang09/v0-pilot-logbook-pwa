"use client"

import { useEffect } from "react"
import { initializeAircraftDatabase, quickInit } from "@/lib/db"

export function AircraftPreloader() {
  useEffect(() => {
    // Start preloading aircraft database in background
    const preload = async () => {
      // Quick check if already cached
      const ready = await quickInit()
      if (ready) {
        console.log("[Aircraft Preloader] Database already cached")
        return
      }

      // Initialize in background (will download if needed)
      console.log("[Aircraft Preloader] Starting background initialization...")
      try {
        await initializeAircraftDatabase()
        console.log("[Aircraft Preloader] Database ready")
      } catch (error) {
        console.error("[Aircraft Preloader] Failed to initialize:", error)
      }
    }

    // Delay slightly to not block initial render
    const timer = setTimeout(preload, 1000)
    return () => clearTimeout(timer)
  }, [])

  return null
}
