"use client"

import { useSyncExternalStore } from "react"
import type { BottomNavTab } from "@/types/db/stores.types"

/**
 * The Logbook tab's two views — the LIST (the flight record) and the ROSTER
 * (the month and the day-by-day agenda, duties included). They are one tab:
 * the roster showed the logbook's flights anyway, and two tabs for one record
 * read as duplicates. The two stay separate ROUTES (`/logbook`, `/roster`),
 * each keep-alive with its own detail panel, and the List | Roster switch in
 * their headers moves between them.
 *
 * The tab goes back to the view the pilot was last in. A module store,
 * persisted, hydrated in `subscribe` — the dashboard view's shape.
 */
export type LogbookView = "/logbook" | "/roster"

const STORAGE_KEY = "ooo:logbook-view"
let view: LogbookView = "/logbook"
let hydrated = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!hydrated) {
    hydrated = true
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if ((stored === "/logbook" || stored === "/roster") && stored !== view) {
        view = stored
        emit()
      }
    } catch {
      // Storage unavailable: the list stands.
    }
  }
  return () => {
    listeners.delete(listener)
  }
}

/** Called by either view as it becomes the page on screen. */
export function rememberLogbookView(next: LogbookView) {
  if (next === view) return
  view = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not remembering it is no reason to refuse it.
  }
  emit()
}

export function useLogbookView(): LogbookView {
  return useSyncExternalStore(
    subscribe,
    () => view,
    () => "/logbook" as const
  )
}

/**
 * The pilot's chosen tabs with Roster folded into Logbook. A stored "roster"
 * tab (it was the default third tab) gives its slot to the first tab not
 * already chosen, so four tabs stay four and none appears twice.
 */
const REPLACEMENTS: readonly BottomNavTab[] = [
  "aircraft",
  "crew",
  "airports",
  "currencies",
  "settings",
  "account",
  "dashboard",
  "logbook",
]

export function normaliseNavTabs(
  tabs: readonly BottomNavTab[]
): [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab] {
  const out: BottomNavTab[] = []
  for (const tab of tabs) {
    const t = tab === "roster" ? "logbook" : tab
    if (!out.includes(t)) out.push(t)
  }
  for (const r of REPLACEMENTS) {
    if (out.length >= 4) break
    if (!out.includes(r)) out.push(r)
  }
  return out.slice(0, 4) as [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab]
}
