"use client"

import { useState, useEffect, useCallback } from "react"

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    // Set initial state
    setIsOnline(navigator.onLine)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  const checkConnection = useCallback(async (): Promise<boolean> => {
    if (!navigator.onLine) return false

    try {
      // Try to fetch a small resource to verify actual connectivity
      const response = await fetch("/manifest.json", {
        method: "HEAD",
        cache: "no-store",
      })
      return response.ok
    } catch {
      return false
    }
  }, [])

  return { isOnline, checkConnection }
}
