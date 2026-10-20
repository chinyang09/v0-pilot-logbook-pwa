"use client"

import { useSyncExternalStore } from "react"

/**
 * A key that changes when the DATE changes — local or UTC, whichever turns
 * first — for memos that read "today" but are otherwise keyed only on data.
 *
 * The dashboard stays mounted for the whole session and a sync that brings
 * nothing new keeps the same flights array, so its aggregates and its period
 * froze on the day they were first computed. Left open overnight, the 90-day
 * recency kept counting an event that had aged out (a lapsed pilot read
 * CAUTION) and "last 28 days" stopped rolling. Depending on this key re-runs
 * them once a day and costs nothing in between.
 *
 * A module store like `useDBReady`: one timer however many consumers, re-armed
 * on every change, and re-checked when the app comes back to the foreground —
 * a suspended iOS app does not run timers, so the midnight one may never fire.
 */

function currentKey(now = new Date()): string {
  const local = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
  const utc = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`
  return `${local}|${utc}`
}

function msToNextBoundary(now = new Date()): number {
  const localMidnight = new Date(now)
  localMidnight.setHours(24, 0, 0, 0)
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1_000, Math.min(localMidnight.getTime(), utcMidnight) - now.getTime() + 1_000)
}

let key = typeof window === "undefined" ? "" : currentKey()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

function check() {
  const next = currentKey()
  if (next !== key) {
    key = next
    listeners.forEach((l) => l())
  }
}

function arm() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    check()
    arm()
  }, msToNextBoundary())
}

function onVisible() {
  if (document.visibilityState === "visible") check()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    check()
    arm()
    document.addEventListener("visibilitychange", onVisible)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (timer) clearTimeout(timer)
      timer = null
      document.removeEventListener("visibilitychange", onVisible)
    }
  }
}

export function useDayKey(): string {
  return useSyncExternalStore(subscribe, () => key, () => "")
}
