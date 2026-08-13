"use client"

import { useSyncExternalStore } from "react"

/**
 * Which of the dashboard's two pages is showing.
 *
 * | | Answers |
 * |---|---|
 * | `legal` | Am I current, what must I do, where am I in my duty |
 * | `summary` | What have I flown, and how does it add up |
 *
 * They are two different questions asked at two different times — one before a
 * duty, one after a month — and trying to serve both on one screen is what
 * makes a dashboard a spreadsheet. `legal` is the default because it is the one
 * with an answer that can change between now and the next time the app opens.
 *
 * A MODULE STORE read through `useSyncExternalStore`, the same shape as
 * `useDBReady` and `useIsDesktop`. The alternative — `useState` plus an effect
 * that reads `localStorage` — is a setState in an effect body (the pattern the
 * react-compiler rules flag) and makes every consumer render once with the
 * wrong page before correcting. Here the server and first-client snapshots
 * agree, so there is no hydration mismatch, and the stored value arrives in the
 * subscribe callback.
 */

export type DashboardView = "legal" | "summary"

const STORAGE_KEY = "ooo:dashboard-view"
const DEFAULT_VIEW: DashboardView = "legal"

let view: DashboardView = DEFAULT_VIEW
let hydrated = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if ((stored === "legal" || stored === "summary") && stored !== view) {
      view = stored
      emit()
    }
  } catch {
    // Private mode / storage disabled — the default stands.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // `useSyncExternalStore` calls this in an effect, i.e. after the first paint,
  // which is exactly when reading storage is safe.
  hydrate()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): DashboardView {
  return view
}

function getServerSnapshot(): DashboardView {
  return DEFAULT_VIEW
}

export function setDashboardView(next: DashboardView): void {
  if (next === view) return
  view = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not being able to remember the choice is not a reason to refuse it.
  }
  emit()
}

export function useDashboardView(): DashboardView {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export const DASHBOARD_VIEWS: ReadonlyArray<{ value: DashboardView; label: string }> = [
  { value: "legal", label: "Legal" },
  { value: "summary", label: "Summary" },
]
