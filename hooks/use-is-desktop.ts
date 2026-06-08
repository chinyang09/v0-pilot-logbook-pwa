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

    // matchMedia is the fast path on normal browser resizes.
    const mediaQuery = window.matchMedia(`(min-width: ${minWidth}px)`)
    const handleChange = (e: MediaQueryListEvent) => setMatches(e.matches)

    // iPadOS PWA quirk: when the user switches apps (Cmd+Tab, app switcher,
    // background→foreground), iOS may freeze JS during a transient viewport
    // shrink (app-switcher thumbnail). matchMedia events fired in that window
    // are effectively lost, and window.innerWidth can take a few hundred ms
    // to report the real restored viewport after resume. We re-read on every
    // plausible resume signal across multiple frames so we catch the eventual
    // restored width.
    //
    // Rotation alone won't recover hooks whose breakpoint isn't crossed
    // (e.g. on iPad Pro 12.9" the 920 / 720 thresholds stay above on both
    // orientations), which is why we don't rely on matchMedia events alone.
    const resync = () => {
      evaluate()
      requestAnimationFrame(evaluate)
      setTimeout(evaluate, 250)
      setTimeout(evaluate, 600)
    }
    const handleVisibility = () => {
      if (document.visibilityState === "visible") resync()
    }

    mediaQuery.addEventListener("change", handleChange)
    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("pageshow", resync)
    window.addEventListener("focus", resync)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("pageshow", resync)
      window.removeEventListener("focus", resync)
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
