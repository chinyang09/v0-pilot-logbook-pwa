"use client"

import { useEffect } from "react"

/**
 * Measures WebKit's installed-PWA viewport shortfall and feeds it to the CSS
 * shell as `--shell-bottom-gap` (consumed by the `body` height rule in
 * globals.css).
 *
 * In a Home Screen web app with `viewport-fit=cover`, WebKit reports a
 * viewport SHORTER than the physical screen, so a shell clamped to `100dvh`
 * ends above the home indicator and leaves a dead band. The community recipe
 * says the missing amount is `env(safe-area-inset-bottom)` — measured on a
 * real iPad (landscape) that is WRONG: screen height 820, innerHeight 788,
 * shortfall 32 = the TOP inset, while the bottom inset is 25. No static
 * `env()` term can be correct, so the gap is measured instead:
 * `physical screen height − innerHeight`.
 *
 * Guards:
 * - iOS/iPadOS only. `"standalone" in navigator` is true exactly on the
 *   engine with the bug; on Android standalone the window legitimately
 *   excludes the system bars, and compensating there would push the shell
 *   below the visible window. This is not a platform-conditional LOOK — the
 *   compensated result is the same full-bleed shell everywhere; only the bug
 *   being cancelled is one platform's.
 * - iOS reports `screen.width/height` portrait-major (they never rotate), so
 *   the physical height in the current orientation is min/max by orientation.
 * - The measured gap is accepted only when it is positive and no larger than
 *   the safe-area insets' sum. A bigger number is not this bug — it's a
 *   Slide Over / Stage Manager window or a keyboard-resized viewport — and
 *   compensating with it would be wrong, so those apply 0.
 */
export function ViewportShellCompensator() {
  useEffect(() => {
    const root = document.documentElement

    // Body is in flow and, on buggy iOS standalone, can transiently be taller
    // than the reported viewport — which gives the document a scroll range.
    // Nothing should ever scroll it (the app's scrollers all contain their
    // overscroll), but pin it so a stray chained gesture, a programmatic
    // scroll, or a gap correction can't leave the shell shifted.
    const pin = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0)
    }

    const apply = () => {
      let gap = 0
      const nav = navigator as Navigator & { standalone?: boolean }
      const installed =
        matchMedia("(display-mode: standalone)").matches || nav.standalone === true
      if ("standalone" in navigator && installed) {
        const landscape = matchMedia("(orientation: landscape)").matches
        const physH = landscape
          ? Math.min(screen.width, screen.height)
          : Math.max(screen.width, screen.height)
        const measured = physH - window.innerHeight

        const probe = document.createElement("div")
        probe.style.cssText =
          "position:fixed;visibility:hidden;pointer-events:none;" +
          "padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)"
        document.body.appendChild(probe)
        const cs = getComputedStyle(probe)
        const cap = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
        probe.remove()

        if (measured > 0 && measured <= cap) gap = measured
      }
      root.style.setProperty("--shell-bottom-gap", `${gap}px`)
      pin()
    }

    apply()
    pin()
    // With the in-flow shell, WebKit CORRECTS innerHeight to the full screen
    // shortly after first layout (measured: 788 at launch, 820 moments later)
    // — and fires no `resize` for it. A stale gap measured against the early
    // value then overshoots the shell by exactly that gap, which is a
    // scrollable shell until the next resize. Re-measure on the events that
    // do fire around the correction, plus a short settling series.
    const settle = [300, 1000, 3000].map((ms) => window.setTimeout(apply, ms))
    const onVisible = () => {
      if (document.visibilityState === "visible") apply()
    }
    window.addEventListener("resize", apply)
    window.addEventListener("orientationchange", apply)
    window.addEventListener("pageshow", apply)
    window.visualViewport?.addEventListener("resize", apply)
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("scroll", pin, { passive: true })
    return () => {
      settle.forEach(clearTimeout)
      window.removeEventListener("resize", apply)
      window.removeEventListener("orientationchange", apply)
      window.removeEventListener("pageshow", apply)
      window.visualViewport?.removeEventListener("resize", apply)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("scroll", pin)
    }
  }, [])

  return null
}
