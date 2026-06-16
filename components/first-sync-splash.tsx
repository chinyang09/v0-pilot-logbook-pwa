"use client"

import { useEffect, useRef, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { userDb } from "@/lib/db"
import { useAuth } from "@/components/providers/auth-provider"
import { useSyncStatus } from "@/hooks/sync/use-sync-status"
import { AppStatusOverlay } from "@/components/app-status-overlay"

/**
 * Splash shown ONLY on a first login where the device has no local data yet,
 * while the initial sync pulls it down. It never appears when local data
 * already exists (data merely awaiting an outbound sync), and dismisses as soon
 * as the first record arrives or the initial sync cycle settles.
 */
export function FirstSyncSplash() {
  const { isAuthenticated } = useAuth()
  const { isSyncing } = useSyncStatus()

  // Reactive total of local user data — undefined while the first query runs,
  // so we never flash the splash for an established (data-bearing) account.
  const total = useLiveQuery(async () => {
    const [f, a, p, s, c] = await Promise.all([
      userDb.flights.count(),
      userDb.aircraft.count(),
      userDb.personnel.count(),
      userDb.scheduleEntries.count(),
      userDb.currencies.count(),
    ])
    return f + a + p + s + c
  }, [])

  const [done, setDone] = useState(false)
  const sawSyncing = useRef(false)

  // Any data present → never show (covers "existing data awaiting sync").
  useEffect(() => {
    if (typeof total === "number" && total > 0) setDone(true)
  }, [total])

  // A sync cycle that completed while still empty → genuinely empty account.
  useEffect(() => {
    if (isSyncing) sawSyncing.current = true
    else if (sawSyncing.current) setDone(true)
  }, [isSyncing])

  // Safety valve so an offline/empty account can't get trapped on the splash.
  useEffect(() => {
    const t = setTimeout(() => setDone(true), 15000)
    return () => clearTimeout(t)
  }, [])

  if (!isAuthenticated || done || total !== 0) return null

  return (
    <AppStatusOverlay
      title="Setting up your logbook…"
      description="Syncing your data from the cloud"
    />
  )
}
