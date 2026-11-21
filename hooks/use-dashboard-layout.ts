"use client"

import { useSyncExternalStore } from "react"
import { clampSize, type TileSize } from "@/lib/utils/dashboard/bento"

/**
 * The flight dashboard's TILES in the pilot's own order, and whether they are
 * being arranged (the owner, Nov 2026: "a sortable bento box"). The order is
 * placed on a six-column grid by `packTiles` (`lib/utils/dashboard/bento.ts`).
 *
 * Per device, like the dashboard's page and the calendar's Duties: how a
 * screen is laid out is the device's look, not the account's logbook. A
 * MODULE STORE read through `useSyncExternalStore` (the `useDashboardView`
 * shape): the stored order arrives in `subscribe`, so the server and the first
 * client render agree.
 */

// The crew is part of the flights tile (the owner's duty-and-crew widget, Nov
// 2026), and the airport and its weather are one tile (the owner: "combine
// airport and weather widget").
export const DASHBOARD_TILES = ["duty", "flight", "airport", "currency", "limits"] as const
export type DashboardTile = (typeof DASHBOARD_TILES)[number]

const STORAGE_KEY = "ooo:dashboard-tiles"

/** Tiles that became another: a stored order keeps the new one where the first of the old ones was. */
const RENAMED: Record<string, string> = { weather: "airport", destination: "airport" }

/** A stored order, put right: unknown ids dropped, duplicates removed, tiles added since appended. */
export function normaliseTileOrder(stored: unknown): DashboardTile[] {
  const known = new Set<string>(DASHBOARD_TILES)
  const seen = new Set<string>()
  const out: DashboardTile[] = []
  if (Array.isArray(stored)) {
    for (const raw of stored) {
      const id = typeof raw === "string" ? (RENAMED[raw] ?? raw) : raw
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

/* ── Sizes ──────────────────────────────────────────────────────────────── */

/**
 * Each tile's size by default, on the six-column grid (`packTiles`): the duty
 * and the flights across the page, the airport station half the row and four
 * rows tall (its wind dial between the code and the sky), the currency's dots
 * and the limits stacked beside it.
 */
export const DEFAULT_TILE_SIZES: Record<DashboardTile, TileSize> = {
  duty: { cols: 6, rows: 2 },
  flight: { cols: 6, rows: 2 },
  airport: { cols: 3, rows: 4 },
  currency: { cols: 3, rows: 2 },
  limits: { cols: 3, rows: 2 },
}

/** The fewest columns a tile can take: the duty strip and the day bar need two thirds of the row. */
export const TILE_MIN_COLS: Record<DashboardTile, number> = {
  duty: 4,
  flight: 4,
  airport: 2,
  currency: 2,
  limits: 2,
}

// v4: the grid became six columns by up to six rows. A v3 size (three
// columns, two rows) is carried across doubled, so a pilot's layout stays.
const SIZES_KEY = "ooo:dashboard-sizes:v4"
const SIZES_KEY_V3 = "ooo:dashboard-sizes:v3"

/** A v3 size (on the 3 × 2 grid) on the 6 × 6 one. */
export function sizesFromV3(stored: unknown): unknown {
  if (!stored || typeof stored !== "object") return null
  const out: Record<string, TileSize> = {}
  for (const [id, v] of Object.entries(stored as Record<string, Partial<TileSize>>)) {
    if (v && typeof v === "object") out[id] = { cols: (Number(v.cols) || 3) * 2, rows: (Number(v.rows) || 1) * 2 }
  }
  return out
}

/** Stored sizes, put right: an unknown tile or a size it may not take falls back to its default. */
export function normaliseTileSizes(stored: unknown): Record<DashboardTile, TileSize> {
  const out = { ...DEFAULT_TILE_SIZES }
  if (stored && typeof stored === "object") {
    for (const id of DASHBOARD_TILES) {
      const v = (stored as Record<string, unknown>)[id]
      // The airport tile keeps its default rather than the size of either tile it replaced.
      if (v && typeof v === "object") out[id] = clampSize(v as Partial<TileSize>, TILE_MIN_COLS[id])
    }
  }
  return out
}

let sizes: Record<DashboardTile, TileSize> = DEFAULT_TILE_SIZES
let sizesHydrated = false

function hydrateSizes(): void {
  if (sizesHydrated) return
  sizesHydrated = true
  try {
    const raw = window.localStorage.getItem(SIZES_KEY)
    const old = raw ? null : window.localStorage.getItem(SIZES_KEY_V3)
    if (raw || old) {
      sizes = normaliseTileSizes(raw ? JSON.parse(raw) : sizesFromV3(JSON.parse(old!)))
      emit()
    }
  } catch {
    // The defaults stand.
  }
}

function subscribeSizes(listener: () => void): () => void {
  listeners.add(listener)
  hydrateSizes()
  return () => listeners.delete(listener)
}

export function setTileSize(id: DashboardTile, next: TileSize): void {
  const size = clampSize(next, TILE_MIN_COLS[id])
  if (sizes[id].cols === size.cols && sizes[id].rows === size.rows) return
  sizes = { ...sizes, [id]: size }
  try {
    window.localStorage.setItem(SIZES_KEY, JSON.stringify(sizes))
  } catch {
    // Kept for this session only.
  }
  emit()
}

export function useTileSizes(): Record<DashboardTile, TileSize> {
  return useSyncExternalStore(subscribeSizes, () => sizes, () => DEFAULT_TILE_SIZES)
}

export function useTileOrder(): DashboardTile[] {
  return useSyncExternalStore(subscribe, () => order, () => DEFAULT_ORDER)
}

export function useArranging(): boolean {
  return useSyncExternalStore(subscribe, () => arranging, () => false)
}
