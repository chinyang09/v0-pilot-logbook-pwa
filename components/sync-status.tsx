"use client"

/**
 * Sync status, told WITHOUT taking a slot in the tab bar.
 *
 * The bar used to end in a cloud button — a fixed 32px bookend that cost the
 * tabs their width on every phone, to show a state that is "fine" almost all
 * of the time. Now the state lives in what the bar already has:
 *
 * | | the bar's EDGE (`NavSyncRim`) | the sidebar button (`SyncBadge`) |
 * |---|---|---|
 * | synced | nothing | nothing |
 * | changes waiting | nothing | their COUNT, amber |
 * | syncing | a light sweeping along the bottom edge | the count while it drains |
 * | sync failed | a solid amber hairline | "!" amber |
 * | offline | a dashed grey hairline | a grey dot |
 *
 * The detail and the manual sync (`SyncStatus`) live where there is room for
 * words: the sidebar's top strip, one tap away on the button carrying the
 * badge — "Synced", "3 to Sync", "Offline", "Sync Failed · Retry". The
 * sidebar button's accessible name carries the state too, so a screen reader
 * hears it where a sighted reader sees the badge.
 */

import { useSyncExternalStore } from "react"
import { syncService } from "@/lib/sync"
import type { SyncStatus as SyncState } from "@/lib/sync/sync-service"
import { AlertTriangle, Cloud, CloudOff, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/components/providers/auth-provider"

/**
 * The queue count, ONE store for every reader. The rim, the badge and the
 * strip each read it, in both bars (desktop and mobile are both mounted, one
 * hidden by CSS) — as per-component state that was a count of the queue per
 * reader on every status change.
 */
let pendingCount = 0
const pendingListeners = new Set<() => void>()
let pendingStarted = false

async function refreshPending() {
  // Counted off the index — reading the whole queue to take `.length`
  // deserialised every pending row, on the sync path.
  const { getSyncQueueCount } = await import("@/lib/db")
  const n = await getSyncQueueCount()
  if (n === pendingCount) return
  pendingCount = n
  for (const l of pendingListeners) l()
}

function subscribePending(onChange: () => void) {
  pendingListeners.add(onChange)
  if (!pendingStarted) {
    pendingStarted = true
    // Event-driven: status flips on sync start/end, onDataChanged after every
    // completed cycle; a local write is seen when its debounced sync starts.
    syncService.subscribe(() => void refreshPending())
    syncService.onDataChanged(() => void refreshPending())
    void refreshPending()
  }
  return () => {
    pendingListeners.delete(onChange)
  }
}

export function useSyncState(): { status: SyncState; pending: number } {
  // A store read, not state seeded from `getStatus()`: the server has no
  // network to report and renders "offline", the browser knows it is online,
  // and seeding state from the browser's answer made the very first render
  // disagree with the HTML — a hydration error on every page load.
  const status = useSyncExternalStore(
    (onChange) => syncService.subscribe(onChange),
    () => syncService.getStatus(),
    () => "offline" as const
  )
  const pending = useSyncExternalStore(subscribePending, () => pendingCount, () => 0)
  return { status, pending }
}

/** What the state is called, in a few words. */
export function describeSync(status: SyncState, pending: number): string {
  if (status === "syncing") return "Syncing"
  if (status === "offline") return pending > 0 ? `Offline, ${pending} to sync` : "Offline"
  if (status === "error") return "Sync failed"
  return pending > 0 ? `${pending} to sync` : "Synced"
}

/**
 * The full control, with words — the sidebar's top strip. A tap syncs now,
 * through `ensureValidSession()`, so a dead session asks for the passkey
 * instead of failing silently with a 401.
 */
export function SyncStatus({ className }: { className?: string }) {
  const { ensureValidSession } = useAuth()
  const { status, pending } = useSyncState()

  const handleSync = async () => {
    const valid = await ensureValidSession()
    if (!valid) return
    await syncService.forceSyncNow()
  }

  const busy = status === "offline" || status === "syncing"
  const Icon = status === "offline" ? CloudOff : status === "syncing" ? RefreshCw : status === "error" ? AlertTriangle : Cloud
  const label =
    status === "error"
      ? "Sync Failed · Retry"
      : status === "syncing"
        ? "Syncing…"
        : status === "offline"
          ? "Offline"
          : pending > 0
            ? `${pending > 99 ? "99+" : pending} to Sync`
            : "Synced"

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={busy}
      aria-label={status === "error" ? "Last sync failed, tap to retry" : `${describeSync(status, pending)}${busy ? "" : ", tap to sync now"}`}
      className={cn(
        "relative flex h-8 min-w-0 items-center gap-1.5 rounded-full px-2 text-xs font-semibold transition-colors",
        "after:absolute after:-inset-1 after:content-['']",
        status === "online" && (pending > 0 ? "text-[var(--status-pending)]" : "text-[var(--status-synced)]"),
        // Not the offline red: the device is connected, the server did not
        // take the last cycle. Amber, with its own mark.
        status === "error" && "text-[var(--status-pending)]",
        status === "offline" && "cursor-not-allowed text-muted-foreground",
        status === "syncing" && "cursor-wait text-[var(--status-pending)]",
        className
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", status === "syncing" && "animate-spin")} aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * The bar's bottom edge, saying what the cloud used to. A hairline in the 2px
 * between the tabs' highlight and the bar's own edge, inset past the rounded
 * ends so it never meets the curve. Nothing at all while synced — the common
 * case — so the bar is quiet unless there is something to know. Transform and
 * opacity only: the sweep is a compositor animation, and it runs only while a
 * cycle is actually syncing (a poll that finds nothing never raises it).
 */
export function NavSyncRim({ radius }: { radius: number }) {
  const { status } = useSyncState()
  if (status === "online") return null
  const inset = Math.round(radius * 0.8)
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-px z-[3] h-[1.5px] overflow-hidden rounded-full"
      style={{ left: inset, right: inset }}
    >
      {status === "syncing" ? (
        <span className="nav-sync-sweep absolute inset-y-0 left-0 w-2/5 rounded-full" />
      ) : (
        <span
          className={cn(
            "absolute inset-0 rounded-full",
            status === "error" ? "bg-[var(--status-pending)]" : "nav-sync-offline"
          )}
        />
      )}
    </span>
  )
}

/**
 * The badge on the sidebar button: changes waiting (their count), a failed
 * sync ("!") or offline (a grey dot). INSIDE the button's box — the glass
 * clips anything hanging past it.
 */
export function SyncBadge() {
  const { status, pending } = useSyncState()
  const base =
    "pointer-events-none absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px] text-[9px] font-semibold leading-none tabular-nums"
  if (pending > 0)
    return <span className={cn(base, "bg-[var(--status-pending-fill)] text-background")}>{pending > 99 ? "99+" : pending}</span>
  if (status === "error") return <span className={cn(base, "bg-[var(--status-pending-fill)] text-background")}>!</span>
  if (status === "offline")
    return <span className="pointer-events-none absolute right-0 top-0 h-2 w-2 rounded-full bg-muted-foreground ring-2 ring-[var(--on-glass)]" />
  return null
}
