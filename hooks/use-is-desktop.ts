"use client"

import { useSyncExternalStore } from "react"

const DESKTOP_BREAKPOINT = 720
const DESKTOP_PILL_BREAKPOINT = 1120

/**
 * Shared per-breakpoint stores (module scope, one per breakpoint) consumed via
 * useSyncExternalStore. Previously every useIsDesktop()/useDesktopPill() call
 * attached its own resize/visibility/pageshow/focus listeners and flipped on
 * its own schedule; with dozens of consumers that meant dozens of listener
 * sets and the risk of components disagreeing about the tier mid-transition.
 * Now there are exactly three stores and every consumer flips in the same
 * render pass — which is what makes breakpoint crossings (iPad window
 * resizing) feel like one coherent layout switch.
 */
interface BreakpointStore {
  subscribe: (onChange: () => void) => () => void
  getSnapshot: () => boolean
}

function createBreakpointStore(minWidth: number): BreakpointStore {
  // SSR-safe: snapshot stays false until the browser store initialises.
  if (typeof window === "undefined") {
    return { subscribe: () => () => {}, getSnapshot: () => false }
  }

  let matches = window.innerWidth >= minWidth
  const listeners = new Set<() => void>()

  const set = (next: boolean) => {
    if (next === matches) return
    matches = next
    listeners.forEach((l) => l())
  }
  const evaluate = () => set(window.innerWidth >= minWidth)

  // matchMedia is the fast path on normal browser resizes.
  const mediaQuery = window.matchMedia(`(min-width: ${minWidth}px)`)
  mediaQuery.addEventListener("change", (e) => set(e.matches))
  window.addEventListener("resize", evaluate)

  // iPadOS PWA quirk: when the user switches apps (Cmd+Tab, app switcher,
  // background→foreground), iOS may freeze JS during a transient viewport
  // shrink (app-switcher thumbnail). matchMedia events fired in that window
  // are effectively lost, and window.innerWidth can take a few hundred ms
  // to report the real restored viewport after resume. Re-read on every
  // plausible resume signal across multiple frames to catch the eventual
  // restored width. (Rotation alone won't recover breakpoints that aren't
  // crossed, which is why matchMedia events alone aren't enough.)
  const resync = () => {
    evaluate()
    requestAnimationFrame(evaluate)
    setTimeout(evaluate, 250)
    setTimeout(evaluate, 600)
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resync()
  })
  window.addEventListener("pageshow", resync)
  window.addEventListener("focus", resync)

  return {
    subscribe: (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    getSnapshot: () => matches,
  }
}

const desktopStore = createBreakpointStore(DESKTOP_BREAKPOINT)
const desktopPillStore = createBreakpointStore(DESKTOP_PILL_BREAKPOINT)

const getServerSnapshot = () => false

/** True when viewport >= 720px — split panels (main + detail) */
export function useIsDesktop() {
  return useSyncExternalStore(desktopStore.subscribe, desktopStore.getSnapshot, getServerSnapshot)
}

/** True when viewport >= 1120px — desktop pill morph + push sidebar tier */
export function useDesktopPill() {
  return useSyncExternalStore(desktopPillStore.subscribe, desktopPillStore.getSnapshot, getServerSnapshot)
}

const emptySubscribe = () => () => {}

/**
 * False during SSR and the hydration render, true from the first client-owned
 * render — the same pass in which the breakpoint stores above deliver their
 * real values. Use it to CSS-gate layout variants pre-hydration: the JS
 * breakpoint hooks must report `false` while hydrating (server snapshot), so
 * anything JS-gated on them renders the mobile tier first and visibly jumps
 * at desktop widths. Rendering both variants behind viewport classes until
 * hydration, then letting JS pick one, removes that flash.
 */
export function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}
