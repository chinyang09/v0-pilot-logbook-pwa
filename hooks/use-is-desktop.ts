"use client"

import { useState, useEffect } from "react"

const DESKTOP_BREAKPOINT = 1024

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    // Check initial state
    const checkIsDesktop = () => {
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT)
    }

    // Set initial value
    checkIsDesktop()

    // Listen for resize events
    const mediaQuery = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)

    const handleChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches)
    }

    mediaQuery.addEventListener("change", handleChange)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [])

  return isDesktop
}
