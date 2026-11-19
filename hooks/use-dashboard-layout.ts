"use client"

import { useSyncExternalStore } from "react"

/**
 * The flight dashboard's AREAS in the pilot's own order, and whether they are
 * being arranged (the owner, Nov 2026: "widget cards sortable").
 *
 * Per device, like the dashboard's page and the calendar's Duties: how a
 * screen is laid out is the device's look, not the account's logbook. A
 * MODULE STORE read through `useSyncExternalStore` (the `useDashboardView`
 * shape): the stored order arrives in `subscribe`, so the server and the first
 * client render agree.
 */

export const DASHBOARD_AREAS = ["duty", "aircraft", "weather", "crew", "destination", "currency", "limits"] as const
export type DashboardArea = (typeof DASHBOARD_AREAS)[number]

const STORAGE_KEY = "ooo:dashboard-order"

/** A stored order, put right: unknown ids dropped, duplicates removed, areas added since appended. */
export function normaliseAreaOrder(stored: unknown): DashboardArea[] {
  const known = new Set<string>(DASHBOARD_AREAS)
  const seen = new Set<string>()
  const out: DashboardArea[] = []
  if (Array.isArray(stored)) {
    for (const id of stored) {
      if (typeof id === "string" && known.has(id) && !seen.has(id)) {
        seen.add(id)
        out.push(id as DashboardArea)
      }
    }
  }
  for (const id of DASHBOARD_AREAS) if (!seen.has(id)) out.push(id)
  return out
}

let order: DashboardArea[] = [...DASHBOARD_AREAS]
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
      const read = normaliseAreaOrder(JSON.parse(raw))
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

export function setAreaOrder(next: DashboardArea[]): void {
  const normal = normaliseAreaOrder(next)
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

const DEFAULT_ORDER: DashboardArea[] = [...DASHBOARD_AREAS]

export function useAreaOrder(): DashboardArea[] {
  return useSyncExternalStore(subscribe, () => order, () => DEFAULT_ORDER)
}

export function useArranging(): boolean {
  return useSyncExternalStore(subscribe, () => arranging, () => false)
}
