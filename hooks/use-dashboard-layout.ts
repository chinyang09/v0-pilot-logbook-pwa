"use client"

import { useSyncExternalStore } from "react"
import { arrangeTiles, clampPos, clampSize, columnsOf, findFreePlace, positionsFromSizes, rowsOf, type GridKind, type TileSize, type TilePos } from "@/lib/utils/dashboard/bento"

/**
 * The flight dashboard's TILES in the pilot's own order, and whether they are
 * being arranged (the owner, Nov 2026: "a sortable bento box"). The order is
 * kept beside each tile's PLACE on the grid (`lib/utils/dashboard/bento.ts`).
 *
 * Per device, like the dashboard's page and the calendar's Duties: how a
 * screen is laid out is the device's look, not the account's logbook. A
 * MODULE STORE read through `useSyncExternalStore` (the `useDashboardView`
 * shape): the stored order arrives in `subscribe`, so the server and the first
 * client render agree.
 */

// The crew is part of the flights tile (the owner's duty-and-crew widget, Nov
// 2026), the airport and its weather are one tile (the owner: "combine
// airport and weather widget"), and so are the flights and the duty (the
// owner, Nov 2026: one tactical tile for today — the legs and the FDP on one
// timeline — beside the limits, the strategic one).
//
// Every tile can be ADDED or REMOVED (the owner, Nov 2026: "the ability to add
// and remove widget from flight deck … that would also mean we need more
// relevant widgets"): the four the deck starts with, and the ones a pilot can
// add — the sun and night on the duty's legs, days off (para 5), the leg's
// OFP from its briefing, and the logbook's month.
export const DASHBOARD_TILES = ["flight", "airport", "currency", "limits", "sun", "daysOff", "briefing", "logbook"] as const
export type DashboardTile = (typeof DASHBOARD_TILES)[number]

/** The tiles a new device's deck shows. */
export const DEFAULT_ENABLED: readonly DashboardTile[] = ["flight", "airport", "currency", "limits"]

const STORAGE_KEY = "ooo:dashboard-tiles"

/** Tiles that became another: a stored order keeps the new one where the first of the old ones was. */
const RENAMED: Record<string, string> = { weather: "airport", destination: "airport", duty: "flight" }

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

/* ── Places ─────────────────────────────────────────────────────────────── */

/**
 * Each tile's PLACE by default on a phone's home screen — six columns by six
 * rows: the flights and the duty across the top two rows, the airport station
 * down the left half of the rest, the currency's dots over the limits beside it.
 */
export const DEFAULT_TILE_POSITIONS: Record<DashboardTile, TilePos> = {
  flight: { col: 0, row: 0, cols: 6, rows: 2 },
  airport: { col: 0, row: 2, cols: 3, rows: 4 },
  currency: { col: 3, row: 2, cols: 3, rows: 2 },
  limits: { col: 3, row: 4, cols: 3, rows: 2 },
  // The tiles a pilot adds: their SIZE when added (`addTile` finds the place).
  sun: { col: 0, row: 6, cols: 3, rows: 2 },
  daysOff: { col: 3, row: 6, cols: 3, rows: 2 },
  briefing: { col: 0, row: 8, cols: 6, rows: 2 },
  logbook: { col: 0, row: 10, cols: 3, rows: 2 },
}

/**
 * The WIDE grid's (twelve columns by six rows — a desktop, an iPad on its
 * side): the flights and the duty across the top, the legs side by side with
 * the FDP beside them; the airport (its airports side by side) on the left
 * half, the currency over the limits on the right.
 */
export const DEFAULT_WIDE_TILE_POSITIONS: Record<DashboardTile, TilePos> = {
  flight: { col: 0, row: 0, cols: 12, rows: 2 },
  airport: { col: 0, row: 2, cols: 6, rows: 4 },
  currency: { col: 6, row: 2, cols: 6, rows: 2 },
  limits: { col: 6, row: 4, cols: 6, rows: 2 },
  sun: { col: 0, row: 6, cols: 4, rows: 2 },
  daysOff: { col: 4, row: 6, cols: 4, rows: 2 },
  briefing: { col: 0, row: 8, cols: 8, rows: 2 },
  logbook: { col: 8, row: 6, cols: 4, rows: 2 },
}

/** An iPad held upright: twelve columns by EIGHT rows — the same tiles, taller. */
export const DEFAULT_TALL_TILE_POSITIONS: Record<DashboardTile, TilePos> = {
  flight: { col: 0, row: 0, cols: 12, rows: 2 },
  airport: { col: 0, row: 2, cols: 6, rows: 6 },
  currency: { col: 6, row: 2, cols: 6, rows: 3 },
  limits: { col: 6, row: 5, cols: 6, rows: 3 },
  sun: { col: 0, row: 8, cols: 6, rows: 2 },
  daysOff: { col: 6, row: 8, cols: 6, rows: 2 },
  briefing: { col: 0, row: 10, cols: 12, rows: 2 },
  logbook: { col: 0, row: 12, cols: 6, rows: 2 },
}

const DEFAULTS: Record<GridKind, Record<DashboardTile, TilePos>> = {
  narrow: DEFAULT_TILE_POSITIONS,
  wide: DEFAULT_WIDE_TILE_POSITIONS,
  tall: DEFAULT_TALL_TILE_POSITIONS,
}

/** The fewest columns a tile can take: the duty strip and the day bar need two thirds of a phone's row. */
export const TILE_MIN_COLS: Record<DashboardTile, number> = {
  flight: 4,
  airport: 2,
  currency: 2,
  limits: 2,
  sun: 2,
  daysOff: 2,
  briefing: 3,
  logbook: 2,
}

/** The same on the wide grid: a column there is about the narrow grid's at 760px, more beyond it. */
const TILE_MIN_COLS_WIDE: Record<DashboardTile, number> = {
  flight: 4,
  airport: 3,
  currency: 3,
  limits: 3,
  sun: 3,
  daysOff: 3,
  briefing: 4,
  logbook: 3,
}

export function minColsOf(id: DashboardTile, grid: GridKind): number {
  return (grid === "narrow" ? TILE_MIN_COLS : TILE_MIN_COLS_WIDE)[id]
}

// v6: a tile has a PLACE on a fixed grid (the home screen), where it had a
// size in an order that was packed. A stored layout of sizes is carried
// across (`positionsFromSizes`), its rows scaled to the grid's new rows.
const KEYS: Record<GridKind, string> = {
  narrow: "ooo:dashboard-places:v6",
  wide: "ooo:dashboard-places-wide:v6",
  tall: "ooo:dashboard-places-tall:v6",
}
/** The layouts of sizes before places, and how many of their rows filled the screen. */
const SIZE_KEYS: Record<GridKind, { key: string; rows: number }[]> = {
  narrow: [
    { key: "ooo:dashboard-sizes:v5", rows: 4 },
    { key: "ooo:dashboard-sizes:v4", rows: 7 },
  ],
  wide: [{ key: "ooo:dashboard-sizes-wide:v2", rows: 4 }],
  tall: [{ key: "ooo:dashboard-sizes-tall:v1", rows: 6 }],
}

/** A v4 size (rows as tall as their content, seven to a phone) on the four-row grid. */
export function sizesFromV4(stored: unknown): unknown {
  if (!stored || typeof stored !== "object") return null
  const out: Record<string, TileSize> = {}
  for (const [id, v] of Object.entries(stored as Record<string, Partial<TileSize>>)) {
    if (v && typeof v === "object") out[id] = { cols: Number(v.cols) || 6, rows: Math.max(1, Math.round(((Number(v.rows) || 1) * 4) / 7)) }
  }
  return out
}

/**
 * Stored places, put right: an unknown tile, or a place it may not take, falls
 * back to its default; overlaps among the tiles ON the deck (`shown`) are
 * pushed apart — a tile not on it keeps its place without pushing anything.
 */
export function normaliseTilePositions(stored: unknown, grid: GridKind = "narrow", shown: readonly DashboardTile[] = DEFAULT_ENABLED): Record<DashboardTile, TilePos> {
  const out = { ...DEFAULTS[grid] }
  if (stored && typeof stored === "object") {
    // A layout from before the flights tile took the duty's in starts the merged tile at its default.
    const premerge = "duty" in (stored as object)
    for (const id of DASHBOARD_TILES) {
      if (premerge && id === "flight") continue
      const v = (stored as Record<string, unknown>)[id]
      if (v && typeof v === "object") out[id] = clampPos(v as Partial<TilePos>, minColsOf(id, grid), columnsOf(grid), rowsOf(grid), true)
    }
  }
  const placed = arrangeTiles(shown, out, columnsOf(grid), rowsOf(grid))
  for (const p of placed) out[p.id] = { col: p.col, row: p.row, cols: p.cols, rows: p.rows }
  return out
}

/** A layout of SIZES (before places) as places, its rows scaled from `fromRows` to the grid's. */
export function positionsFromStoredSizes(stored: unknown, tileOrder: readonly DashboardTile[], grid: GridKind, fromRows: number): Record<DashboardTile, TilePos> {
  if (!stored || typeof stored !== "object") return { ...DEFAULTS[grid] }
  const columns = columnsOf(grid)
  const premerge = "duty" in (stored as object)
  const sizes = {} as Record<DashboardTile, TileSize>
  for (const id of DASHBOARD_TILES) {
    const v = (stored as Record<string, Partial<TileSize>>)[id]
    const d = DEFAULTS[grid][id]
    sizes[id] =
      v && typeof v === "object" && !(premerge && id === "flight")
        ? clampSize(v, minColsOf(id, grid), columns, fromRows)
        : { cols: d.cols, rows: Math.max(1, Math.round((d.rows * fromRows) / rowsOf(grid))) }
  }
  return normaliseTilePositions(positionsFromSizes(tileOrder.filter((id) => DEFAULT_ENABLED.includes(id)), sizes, columns, fromRows, rowsOf(grid)), grid)
}

const positions: Record<GridKind, Record<DashboardTile, TilePos>> = { ...DEFAULTS }
let positionsHydrated = false

function hydratePositions(): void {
  if (positionsHydrated) return
  positionsHydrated = true
  hydrate()
  hydrateEnabled()
  try {
    let changed = false
    for (const grid of ["narrow", "wide", "tall"] as const) {
      const raw = window.localStorage.getItem(KEYS[grid])
      if (raw) {
        positions[grid] = normaliseTilePositions(JSON.parse(raw), grid, enabled)
        changed = true
        continue
      }
      for (const old of SIZE_KEYS[grid]) {
        const v = window.localStorage.getItem(old.key)
        if (!v) continue
        const parsed = old.key.endsWith(":v4") ? sizesFromV4(JSON.parse(v)) : JSON.parse(v)
        positions[grid] = positionsFromStoredSizes(parsed, order, grid, old.key.endsWith(":v4") ? 4 : old.rows)
        changed = true
        break
      }
    }
    if (changed) emit()
  } catch {
    // The defaults stand.
  }
}

function subscribePositions(listener: () => void): () => void {
  listeners.add(listener)
  hydratePositions()
  return () => listeners.delete(listener)
}

/** The layout on `grid` replaced by `next` (every tile's place, the moved one's and those it pushed). */
export function setTilePositions(next: Partial<Record<DashboardTile, TilePos>>, grid: GridKind = "narrow"): void {
  const cur = positions[grid]
  const merged = { ...cur, ...next }
  const same = DASHBOARD_TILES.every((id) => {
    const a = cur[id]
    const b = merged[id]
    return a.col === b.col && a.row === b.row && a.cols === b.cols && a.rows === b.rows
  })
  if (same) return
  positions[grid] = merged
  try {
    window.localStorage.setItem(KEYS[grid], JSON.stringify(merged))
  } catch {
    // Kept for this session only.
  }
  emit()
}

export function useTilePositions(grid: GridKind = "narrow"): Record<DashboardTile, TilePos> {
  return useSyncExternalStore(subscribePositions, () => positions[grid], () => DEFAULTS[grid])
}

export function useTileOrder(): DashboardTile[] {
  return useSyncExternalStore(subscribe, () => order, () => DEFAULT_ORDER)
}

export function useArranging(): boolean {
  return useSyncExternalStore(subscribe, () => arranging, () => false)
}

/* ── Which tiles are on the deck ─────────────────────────────────────────── */

const ENABLED_KEY = "ooo:dashboard-widgets:v1"
let enabled: DashboardTile[] = [...DEFAULT_ENABLED]
let enabledHydrated = false

/** A stored list put right: known tiles, each once. */
export function normaliseEnabled(stored: unknown): DashboardTile[] {
  if (!Array.isArray(stored)) return [...DEFAULT_ENABLED]
  const known = new Set<string>(DASHBOARD_TILES)
  const out: DashboardTile[] = []
  for (const raw of stored) if (typeof raw === "string" && known.has(raw) && !out.includes(raw as DashboardTile)) out.push(raw as DashboardTile)
  return out
}

function hydrateEnabled(): void {
  if (enabledHydrated) return
  enabledHydrated = true
  try {
    const raw = window.localStorage.getItem(ENABLED_KEY)
    if (raw) enabled = normaliseEnabled(JSON.parse(raw))
  } catch {
    // The default set stands.
  }
}

function saveEnabled(): void {
  try {
    window.localStorage.setItem(ENABLED_KEY, JSON.stringify(enabled))
  } catch {
    // Kept for this session only.
  }
}

function subscribeEnabled(listener: () => void): () => void {
  listeners.add(listener)
  hydrateEnabled()
  hydratePositions()
  return () => listeners.delete(listener)
}

export function useEnabledTiles(): readonly DashboardTile[] {
  return useSyncExternalStore(subscribeEnabled, () => enabled, () => DEFAULT_ENABLED)
}

/** The grid the deck is drawn on now — where an added tile looks for room. */
let currentGrid: GridKind = "narrow"
export function setCurrentGrid(grid: GridKind): void {
  currentGrid = grid
}

/**
 * A tile put on the deck, in the first free place on the grid in use that
 * holds it — at its usual size, else smaller (down to one row, and its least
 * columns). False when no cell is free for it: a home screen with no room
 * says so rather than pushing a tile off it.
 */
export function addTile(id: DashboardTile, grid: GridKind = currentGrid): boolean {
  hydrateEnabled()
  hydratePositions()
  if (enabled.includes(id)) return true
  const columns = columnsOf(grid)
  const rows = rowsOf(grid)
  const placed = arrangeTiles(enabled, positions[grid], columns, rows)
  const want = DEFAULTS[grid][id]
  const place = findFreePlace(placed, { cols: want.cols, rows: want.rows }, minColsOf(id, grid), columns, rows)
  if (!place) return false
  enabled = [...enabled, id]
  saveEnabled()
  setTilePositions({ [id]: place }, grid)
  emit()
  return true
}

/** A tile taken off the deck: its cells are left empty, the others where they are. */
export function removeTile(id: DashboardTile): void {
  hydrateEnabled()
  if (!enabled.includes(id)) return
  enabled = enabled.filter((t) => t !== id)
  saveEnabled()
  emit()
}
