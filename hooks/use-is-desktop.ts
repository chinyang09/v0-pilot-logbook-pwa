"use client"

import { useState, useEffect } from "react"

const DESKTOP_BREAKPOINT = 720
const WIDE_DESKTOP_BREAKPOINT = 920
const DESKTOP_PILL_BREAKPOINT = 1120

function useMediaQuery(minWidth: number) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const evaluate = () => setMatches(window.innerWidth >= minWidth)
    evaluate()

    // matchMedia is the authoritative source — fires only on real breakpoint
    // transitions. iOS WebKit (PWA) can drop these events while the PWA is
    // backgrounded, so we re-read window.innerWidth on visibilitychange when
    // the document becomes visible again.
    //
    // We intentionally do NOT listen to `resize` or `orientationchange`:
    // when iOS captures the app-switcher thumbnail during a swipe-up gesture
    // it transiently resizes the viewport while the document is still
    // "visible", which would latch matches=false before the eventual restore.
    const mediaQuery = window.matchMedia(`(min-width: ${minWidth}px)`)
    const handleChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return
      // Defer one frame so post-resume layout metrics are in place.
      requestAnimationFrame(evaluate)
    }
    mediaQuery.addEventListener("change", handleChange)
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [minWidth])

  return matches
}

/** True when viewport >= 720px — split panels (main + detail) */
export function useIsDesktop() {
  return useMediaQuery(DESKTOP_BREAKPOINT)
}

/** True when viewport >= 920px — push sidebar fits alongside both panels */
export function useCanPushSidebar() {
  return useMediaQuery(WIDE_DESKTOP_BREAKPOINT)
}

/** True when viewport >= 1120px — desktop pill morph fits without overlapping actions */
export function useDesktopPill() {
  return useMediaQuery(DESKTOP_PILL_BREAKPOINT)
}
