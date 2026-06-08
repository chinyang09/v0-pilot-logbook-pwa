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

    // matchMedia is the efficient fast path — fires only on real transitions.
    // iOS WebKit (PWA) can drop these events while backgrounded or during
    // Stage Manager / Split View resizes, so we layer resize / orientation /
    // visibility listeners as a safety net that re-reads window.innerWidth.
    const mediaQuery = window.matchMedia(`(min-width: ${minWidth}px)`)
    const handleChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mediaQuery.addEventListener("change", handleChange)
    window.addEventListener("resize", evaluate)
    window.addEventListener("orientationchange", evaluate)
    document.addEventListener("visibilitychange", evaluate)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
      window.removeEventListener("resize", evaluate)
      window.removeEventListener("orientationchange", evaluate)
      document.removeEventListener("visibilitychange", evaluate)
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
