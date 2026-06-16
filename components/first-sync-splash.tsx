"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { userDb } from "@/lib/db"
import { syncService } from "@/lib/sync"
import { useAuth } from "@/components/providers/auth-provider"

async function countLocalData(): Promise<number> {
  const [f, a, p, s, c] = await Promise.all([
    userDb.flights.count(),
    userDb.aircraft.count(),
    userDb.personnel.count(),
    userDb.scheduleEntries.count(),
    userDb.currencies.count(),
  ])
  return f + a + p + s + c
}

/**
 * Splash shown ONLY on a first login where the device has no local data yet,
 * while the initial sync pulls it down. It never appears when local data
 * already exists (data merely awaiting an outbound sync), and dismisses as soon
 * as the first record arrives, the initial sync settles, or a safety timeout
 * fires.
 *
 * All state updates happen inside callbacks (async read, sync subscription,
 * timeout) rather than synchronously in an effect body, so this stays clear of
 * the react-hooks `set-state-in-effect` rule.
 */
export function FirstSyncSplash() {
  const { isAuthenticated } = useAuth()
  const [total, setTotal] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // Count local data on mount and whenever a background pull lands.
  useEffect(() => {
    let alive = true
    const read = () => {
      countLocalData()
        .then((n) => {
          if (alive) setTotal(n)
        })
        .catch(() => {})
    }
    read()
    const unsub = syncService.onDataChanged(read)
    return () => {
      alive = false
      unsub()
    }
  }, [])

  // Dismiss once an initial sync cycle settles — covers a genuinely empty
  // account so the splash never lingers after the pull completes.
  useEffect(() => {
    let sawSyncing = false
    const unsub = syncService.subscribe((status) => {
      if (status === "syncing") sawSyncing = true
      else if (sawSyncing) setDismissed(true)
    })
    return unsub
  }, [])

  // Safety valve so an offline/empty device can't get stuck on the splash.
  useEffect(() => {
    const t = setTimeout(() => setDismissed(true), 15000)
    return () => clearTimeout(t)
  }, [])

  if (!isAuthenticated || dismissed || total !== 0) return null

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background safe-area-inset">
      <div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-3 duration-700">
        {/* OOOI brand */}
        <h1 className="text-5xl font-bold tracking-[0.3em] text-foreground">OOOI</h1>
        <p className="mt-1.5 text-[0.65rem] tracking-[0.5em] uppercase text-muted-foreground">
          Out &middot; Off &middot; On &middot; In
        </p>

        {/* Syncing status */}
        <div className="mt-12 flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">Setting up your logbook</p>
          <p className="text-xs text-muted-foreground">Syncing your data from the cloud…</p>
        </div>
      </div>
    </div>
  )
}
