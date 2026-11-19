"use client"

import { useSyncExternalStore } from "react"

/**
 * The flight dashboard's TILES in the pilot's own order, and whether they are
 * being arranged (the owner, Nov 2026: "a sortable bento box"). The order is
 * packed into rows by `packTiles` (`lib/utils/dashboard/bento.ts`).
 *
 * Per device, like the dashboard's page and the calendar's Duties: how a
 * screen is laid out is the device's look, not the account's logbook. A
 * MODULE STORE read through `useSyncExternalStore` (the `useDashboardView`
 * shape): the stored order arrives in `subscribe`, so the server and the first
 * client render agree.
 */

export const DASHBOARD_TILES = ["duty", "flight", "weather", "crew", "destination", "currency", "limits"] as const
export type DashboardTile = (typeof DASHBOARD_TILES)[number]

const STORAGE_KEY = "ooo:dashboard-tiles"

/** A stored order, put right: unknown ids dropped, duplicates removed, tiles added since appended. */
export function normaliseTileOrder(stored: unknown): DashboardTile[] {
  const known = new Set<string>(DASHBOARD_TILES)
  const seen = new Set<string>()
  const out: DashboardTile[] = []
  if (Array.isArray(stored)) {
    for (const id of stored) {
      if (typeof id === "string" && known.has(id) && !seen.has(id)) {
        seen.add(id)
        out.push(id as DashboardTile)
      }
    }
  }
  for (const id of DASHBOARD_TILES) if (!seen.has(id)) out.push(id)
  return out
}

let order: DashboardTile[] = [...DASHBOARD_TILES]
let arranging = false
let hydrated = false
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const read = normaliseTileOrder(JSON.parse(raw))
      if (read.join() !== order.join()) {
        order = read
        emit()
      }
    }
  } catch {
    // Private mode / storage disabled — the default order stands.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  hydrate()
  return () => listeners.delete(listener)
}

export function setTileOrder(next: DashboardTile[]): void {
  const normal = normaliseTileOrder(next)
  if (normal.join() === order.join()) return
  order = normal
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch {
    // Kept for this session only.
  }
  emit()
}

export function setArranging(on: boolean): void {
  if (arranging === on) return
  arranging = on
  emit()
}

const DEFAULT_ORDER: DashboardTile[] = [...DASHBOARD_TILES]

export function useTileOrder(): DashboardTile[] {
  return useSyncExternalStore(subscribe, () => order, () => DEFAULT_ORDER)
}

export function useArranging(): boolean {
  return useSyncExternalStore(subscribe, () => arranging, () => false)
}
