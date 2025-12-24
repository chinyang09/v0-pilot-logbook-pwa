"use client"

import { useEffect, useState } from "react"
import { WifiOff } from "lucide-react"

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false)
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    // Check initial state
    setIsOffline(!navigator.onLine)

    const handleOnline = () => {
      setIsOffline(false)
      // Show brief "back online" message
      setShowBanner(true)
      setTimeout(() => setShowBanner(false), 3000)
    }

    const handleOffline = () => {
      setIsOffline(true)
      setShowBanner(true)
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  if (!showBanner && !isOffline) return null

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[100] px-4 py-2 text-center text-sm font-medium transition-all duration-300 ${
        isOffline ? "bg-amber-500 text-amber-950" : "bg-green-500 text-green-950"
      }`}
    >
      {isOffline ? (
        <span className="flex items-center justify-center gap-2">
          <WifiOff className="h-4 w-4" />
          You're offline - Changes will sync when back online
        </span>
      ) : (
        <span>Back online - Syncing changes...</span>
      )}
    </div>
  )
}
