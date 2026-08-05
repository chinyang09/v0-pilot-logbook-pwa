"use client"

import { useSyncExternalStore } from "react"

/**
 * Whether the main panel is currently at its DUAL-month width.
 *
 * The logbook used to work this out for itself by measuring its own container
 * with a ResizeObserver. That measurement necessarily lands a frame or two
 * after the panel actually resized, so for those frames the calendar was
 * rendering the OLD mode at the NEW width — two months squeezed into 360px on
 * the way in, and a moment of the wide layout on the way out. Either way you
 * saw a calendar that was never meant to exist, which is the "flash" on the
 * collapse.
 *
 * The layout knows the answer at the instant it resizes the panel, so it says
 * so here and the calendar re-renders in the same commit. A store rather than
 * context because the two live in different trees (the shell renders the
 * panels; the page renders inside one).
 */
let dualMonth = false
const listeners = new Set<() => void>()

export function setPanelDualMonth(next: boolean): void {
  if (next === dualMonth) return
  dualMonth = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Server snapshot is `false` — the split layout only exists on the client. */
export function usePanelDualMonth(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => dualMonth,
    () => false
  )
}
