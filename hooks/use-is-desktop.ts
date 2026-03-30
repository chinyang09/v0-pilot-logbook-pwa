"use client"

import { useState, useEffect } from "react"

const DESKTOP_BREAKPOINT = 720
const WIDE_DESKTOP_BREAKPOINT = 920

function useMediaQuery(minWidth: number) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    setMatches(window.innerWidth >= minWidth)

    const mediaQuery = window.matchMedia(`(min-width: ${minWidth}px)`)
    const handleChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [minWidth])

  return matches
}

/** True when viewport >= 720px — split panels (main + detail) */
export function useIsDesktop() {
  return useMediaQuery(DESKTOP_BREAKPOINT)
}

/** True when viewport >= 940px — push sidebar fits alongside both panels */
export function useCanPushSidebar() {
  return useMediaQuery(WIDE_DESKTOP_BREAKPOINT)
}
