"use client"

import { useSyncExternalStore } from "react"

/**
 * The duty the legal page's sector chain draws (its report, ms) — this one on
 * duty, else the next — published by the page so the header's Weather button
 * can open the same panel the chain does (`duty:<ms>`) without the header
 * holding the whole status model. Null when there is no such duty.
 */
let current: number | null = null
const listeners = new Set<() => void>()

export function setChainDuty(ms: number | null) {
  if (ms === current) return
  current = ms
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useChainDuty(): number | null {
  return useSyncExternalStore(subscribe, () => current, () => null)
}
