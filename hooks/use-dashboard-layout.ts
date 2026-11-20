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

// The crew is part of the flights tile (the owner's duty-and-crew widget, Nov 2026).
export const DASHBOARD_TILES = ["duty", "flight", "weather", "destination", "currency", "limits"] as const
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

/* ── Widths ─────────────────────────────────────────────────────────────── */

/** Each tile's width by default, in columns of 12 — the layout as it has always been. */
export const DEFAULT_TILE_WIDTHS: Record<DashboardTile, number> = {
  duty: 12,
  flight: 12,
  // Half each: the weather's wind dial and the destination's runway need it.
  weather: 6,
  destination: 6,
  currency: 6,
  limits: 6,
}

/** The widths each tile may take: the duty band and the sector chain need half a row at least. */
export const TILE_ALLOWED_WIDTHS: Record<DashboardTile, readonly number[]> = {
  duty: [6, 8, 12],
  flight: [6, 8, 12],
  weather: [4, 6, 8, 12],
  destination: [4, 6, 8, 12],
  currency: [4, 6, 8, 12],
  limits: [4, 6, 8, 12],
}

// v2: the layout changed (crew folded into flights, weather and destination a half each).
const WIDTHS_KEY = "ooo:dashboard-widths:v2"

/** Stored widths, put right: an unknown tile or a width it may not take falls back to its default. */
export function normaliseTileWidths(stored: unknown): Record<DashboardTile, number> {
  const out = { ...DEFAULT_TILE_WIDTHS }
  if (stored && typeof stored === "object") {
    for (const id of DASHBOARD_TILES) {
      const w = (stored as Record<string, unknown>)[id]
      if (typeof w === "number" && TILE_ALLOWED_WIDTHS[id].includes(w)) out[id] = w
    }
  }
  return out
}

let widths: Record<DashboardTile, number> = DEFAULT_TILE_WIDTHS
let widthsHydrated = false

function hydrateWidths(): void {
  if (widthsHydrated) return
  widthsHydrated = true
  try {
    const raw = window.localStorage.getItem(WIDTHS_KEY)
    if (raw) {
      widths = normaliseTileWidths(JSON.parse(raw))
      emit()
    }
  } catch {
    // The defaults stand.
  }
}

function subscribeWidths(listener: () => void): () => void {
  listeners.add(listener)
  hydrateWidths()
  return () => listeners.delete(listener)
}

export function setTileWidth(id: DashboardTile, cols: number): void {
  if (!TILE_ALLOWED_WIDTHS[id].includes(cols) || widths[id] === cols) return
  widths = { ...widths, [id]: cols }
  try {
    window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths))
  } catch {
    // Kept for this session only.
  }
  emit()
}

export function useTileWidths(): Record<DashboardTile, number> {
  return useSyncExternalStore(subscribeWidths, () => widths, () => DEFAULT_TILE_WIDTHS)
}

export function useTileOrder(): DashboardTile[] {
  return useSyncExternalStore(subscribe, () => order, () => DEFAULT_ORDER)
}

export function useArranging(): boolean {
  return useSyncExternalStore(subscribe, () => arranging, () => false)
}
