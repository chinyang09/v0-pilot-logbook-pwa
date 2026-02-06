"use client"

import { useState, useEffect } from "react"
import { syncService } from "@/lib/sync"
import { Cloud, CloudOff, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

export function SyncStatus() {
  const [status, setStatus] = useState<"online" | "offline" | "syncing">("offline")
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    setStatus(syncService.getStatus())

    const unsubscribe = syncService.subscribe(setStatus)

    // Check pending count periodically
    const checkPending = async () => {
      const { getSyncQueue } = await import("@/lib/db")
      const queue = await getSyncQueue()
      setPendingCount(queue.length)
    }

    checkPending()
    const interval = setInterval(checkPending, 5000)

    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [])

  const handleSync = async () => {
    // Use force sync which triggers immediately via trigger manager
    await syncService.forceSyncNow()
    // Refresh pending count after sync
    const { getSyncQueue } = await import("@/lib/db")
    const queue = await getSyncQueue()
    setPendingCount(queue.length)
  }

  return (
    <button
      onClick={handleSync}
      className={cn(
        "flex items-center gap-1.5 p-1.5 rounded-full transition-colors",
        status === "online" && "text-[var(--status-synced)]",
        status === "offline" && "text-[var(--status-offline)]",
        status === "syncing" && "text-[var(--status-pending)]",
      )}
    >
      {status === "online" && <Cloud className="h-4 w-4" />}
      {status === "offline" && <CloudOff className="h-4 w-4" />}
      {status === "syncing" && <RefreshCw className="h-4 w-4 animate-spin" />}
      {pendingCount > 0 && (
        <span className="bg-[var(--status-pending)] text-background text-xs min-w-[18px] text-center px-1 rounded-full">{pendingCount}</span>
      )}
    </button>
  )
}
