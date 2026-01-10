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
      const { getSyncQueue } = await import("@/lib/indexed-db")
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
    const result = await syncService.syncPendingChanges()
    if (result.success > 0) {
      setPendingCount((prev) => Math.max(0, prev - result.success))
    }
  }

  return (
    <button
      onClick={handleSync}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors",
        status === "online" && "bg-[var(--status-synced)]/10 text-[var(--status-synced)]",
        status === "offline" && "bg-[var(--status-offline)]/10 text-[var(--status-offline)]",
        status === "syncing" && "bg-[var(--status-pending)]/10 text-[var(--status-pending)]",
      )}
    >
      {status === "online" && <Cloud className="h-4 w-4" />}
      {status === "offline" && <CloudOff className="h-4 w-4" />}
      {status === "syncing" && <RefreshCw className="h-4 w-4 animate-spin" />}
      <span className="capitalize">{status}</span>
      {pendingCount > 0 && (
        <span className="bg-[var(--status-pending)] text-background text-xs px-1.5 rounded-full">{pendingCount}</span>
      )}
    </button>
  )
}
