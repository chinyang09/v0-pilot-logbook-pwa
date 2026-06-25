"use client"

import { useEffect, useState } from "react"

/**
 * Returns `false` on first mount and flips to `true` after `delay` ms.
 *
 * Use it to SKIP a component's entrance animation: when a page is navigated to,
 * heavy widgets (progress rings, charts) otherwise animate their values in from
 * scratch right as the nav transition runs, which competes for the main thread
 * and makes the nav's liquid/bounce hitch. Gating the animation on this flag
 * renders the initial state instantly, then arms animation so SUBSEQUENT in-page
 * updates (e.g. a filter change while you stay on the page) still animate.
 *
 * setState runs in a timeout callback (never synchronously in the effect body),
 * so it doesn't add a react-hooks/set-state-in-effect warning.
 */
export function useDeferredAnimation(delay = 600): boolean {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), delay)
    return () => clearTimeout(t)
  }, [delay])
  return armed
}
