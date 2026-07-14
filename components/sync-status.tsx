"use client"

import { useState, useEffect } from "react"
import { syncService } from "@/lib/sync"
import { Cloud, CloudOff, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/components/providers/auth-provider"

export function SyncStatus({ className }: { className?: string }) {
  const { ensureValidSession } = useAuth()
  const [status, setStatus] = useState<"online" | "offline" | "syncing">(() => syncService.getStatus())
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    setStatus(syncService.getStatus())

    const checkPending = async () => {
      const { getSyncQueue } = await import("@/lib/db")
      const queue = await getSyncQueue()
      setPendingCount(queue.length)
    }

    // Event-driven instead of a 5s poll (which ran forever in every open tab):
    // status flips on sync start/end (covers the pending count draining) and
    // onDataChanged fires after every completed cycle. A local write is picked
    // up when its debounced sync starts moments later.
    const unsubscribeStatus = syncService.subscribe((s) => {
      setStatus(s)
      void checkPending()
    })
    const unsubscribeData = syncService.onDataChanged(() => {
      void checkPending()
    })

    checkPending()

    return () => {
      unsubscribeStatus()
      unsubscribeData()
    }
  }, [])

  const handleSync = async () => {
    // Intercept a manual resync attempted against a dead session: re-authenticate
    // via the custom passkey flow first. If that can't recover the session,
    // ensureValidSession routes to the login flow and we abort the sync.
    const valid = await ensureValidSession()
    if (!valid) return

    // Use force sync which triggers immediately via trigger manager
    await syncService.forceSyncNow()
    // Refresh pending count after sync
    const { getSyncQueue } = await import("@/lib/db")
    const queue = await getSyncQueue()
    setPendingCount(queue.length)
  }

  const busy = status === "offline" || status === "syncing"

  return (
    <button
      onClick={handleSync}
      disabled={busy}
      aria-label={
        status === "syncing"
          ? "Syncing"
          : status === "offline"
            ? "Offline"
            : pendingCount > 0
              ? `Sync now, ${pendingCount} pending`
              : "Sync now"
      }
      title={status === "offline" ? "Offline" : status === "syncing" ? "Syncing…" : "Tap to sync"}
      className={cn(
        "relative flex items-center justify-center p-1.5 rounded-full transition-colors",
        status === "online" && "text-[var(--status-synced)]",
        status === "offline" && "text-[var(--status-offline)] cursor-not-allowed",
        status === "syncing" && "text-[var(--status-pending)] cursor-wait",
        className,
      )}
    >
      {status === "online" && <Cloud className="h-4 w-4" />}
      {status === "offline" && <CloudOff className="h-4 w-4" />}
      {status === "syncing" && <RefreshCw className="h-4 w-4 animate-spin" />}
      {pendingCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-[var(--status-pending)] text-background text-[10px] leading-none min-w-[16px] h-[16px] flex items-center justify-center px-1 rounded-full font-medium">{pendingCount}</span>
      )}
    </button>
  )
}
