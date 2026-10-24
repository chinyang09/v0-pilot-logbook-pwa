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
 * A floating panel is open under the header (the logbook's search or
 * calendar, the dashboard's calendar), so the header's tap-to-top strip
 * (`--chrome-tap`) has to step aside.
 *
 * That strip claims the band just below the action buttons — which is exactly
 * where those panels put their own first control. With it in place the
 * calendar's month selector could not be tapped at all on a desktop: the tap
 * scrolled the list to the top instead. Same counted-hold shape as the full
 * width above. A keep-alive page holds it only while it is the active route,
 * or a calendar left open on the logbook would disable the strip everywhere.
 */
let headerTapHolds = 0
const headerTapListeners = new Set<() => void>()

function subscribeHeaderTap(listener: () => void): () => void {
  headerTapListeners.add(listener)
  return () => headerTapListeners.delete(listener)
}

export function useSuppressHeaderTap(active: boolean): void {
  useEffect(() => {
    if (!active) return
    headerTapHolds += 1
    headerTapListeners.forEach((l) => l())
    return () => {
      headerTapHolds -= 1
      headerTapListeners.forEach((l) => l())
    }
  }, [active])
}

export function useIsHeaderTapSuppressed(): boolean {
  return useSyncExternalStore(
    subscribeHeaderTap,
    () => headerTapHolds > 0,
    () => false
  )
}
