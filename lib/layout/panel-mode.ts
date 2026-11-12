"use client"

import { useEffect, useSyncExternalStore } from "react"

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

/**
 * Whether the page on screen wants the MAIN panel to take the whole width —
 * the detail panel and the divider step aside. The FDP page asks for it: its
 * chart is the page, and there is nothing behind a row to open beside it
 * until the Quick Check is opened, which gives the detail panel back.
 *
 * A COUNTED hold (`useMainPanelFullWidth` takes one while its argument is
 * true), so a page leaving as another arrives cannot release the newcomer's
 * claim. Only the split layout reads it; a phone has one panel anyway.
 */
let fullWidthHolds = 0
const fullWidthListeners = new Set<() => void>()

function subscribeFullWidth(listener: () => void): () => void {
  fullWidthListeners.add(listener)
  return () => fullWidthListeners.delete(listener)
}

export function useMainPanelFullWidth(active: boolean): void {
  useEffect(() => {
    if (!active) return
    fullWidthHolds += 1
    fullWidthListeners.forEach((l) => l())
    return () => {
      fullWidthHolds -= 1
      fullWidthListeners.forEach((l) => l())
    }
  }, [active])
}

export function useIsMainPanelFullWidth(): boolean {
  return useSyncExternalStore(
    subscribeFullWidth,
    () => fullWidthHolds > 0,
    () => false
  )
}


/**
 * In dual-month mode the two panes are a FIXED pair — odd month on the left,
 * even on the right (Jan|Feb, Mar|Apr, …), months 0-based. Every page that
 * shows two months anchors on this, so a pair never shuffles by one.
 */
export function pairStart(month: number): number {
  return month - (month % 2)
}

/**
 * The phone's sidebar (the bottom bar's morph, below 1120px) is up OVER the
 * page. It keeps its own open state — it is not the desktop push sidebar's —
 * so the shell could not see it, and the header, which sits above the
 * sidebar's backdrop in z-order, kept taking taps meant for that backdrop:
 * tapping the header behind an open sidebar scrolled the list to the top or
 * pressed an action button instead of closing it. The header is `inert` while
 * this holds.
 */
let overlaySidebarOpen = false
const overlayListeners = new Set<() => void>()

export function setOverlaySidebarOpen(next: boolean): void {
  if (next === overlaySidebarOpen) return
  overlaySidebarOpen = next
  overlayListeners.forEach((l) => l())
}

export function useIsOverlaySidebarOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      overlayListeners.add(listener)
      return () => overlayListeners.delete(listener)
    },
    () => overlaySidebarOpen,
    () => false
  )
}
