"use client"

import { useEffect, useState } from "react"

/**
 * A short progressive blur across the very bottom of the screen, heaviest at
 * the edge and gone a few px above the home indicator's band — so content
 * scrolling under the indicator frosts out instead of colliding with it.
 *
 * iOS standalone only: it keys off a real bottom safe-area inset in an
 * installed app. Android's window already excludes its gesture bar and
 * desktop has no inset, so it renders nothing there (and the browser tab is
 * left alone — Safari manages its own chrome).
 *
 * Layered per the app's progressive-blur rule (see SIDEBAR_BACKDROP_BLUR):
 * several radii, smallest first and widest coverage, each masked so the
 * stack only ADDS blur toward the edge — a single masked blur cross-fades a
 * blurred copy with a sharp one, which reads as ghosting, not depth. It sits
 * BELOW the nav in z-order, so the sidebar and the pill render over it
 * un-blurred.
 */
export function BottomEdgeBlur() {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const probe = document.createElement("div")
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;" +
      "padding-bottom:env(safe-area-inset-bottom,0px)"
    document.body.appendChild(probe)
    const read = () => {
      const nav = navigator as Navigator & { standalone?: boolean }
      const installed =
        "standalone" in navigator &&
        (matchMedia("(display-mode: standalone)").matches || nav.standalone === true)
      setInset(installed ? parseFloat(getComputedStyle(probe).paddingBottom) || 0 : 0)
    }
    const raf = requestAnimationFrame(read)
    window.addEventListener("resize", read)
    window.addEventListener("orientationchange", read)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", read)
      window.removeEventListener("orientationchange", read)
      probe.remove()
    }
  }, [])

  if (inset <= 0) return null

  const height = inset + 12
  const layer = (blur: number, coverage: string, rampFrom: string): React.CSSProperties => ({
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: coverage,
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    maskImage: `linear-gradient(to bottom, transparent 0, black ${rampFrom})`,
    WebkitMaskImage: `linear-gradient(to bottom, transparent 0, black ${rampFrom})`,
  })

  return (
    <div
      aria-hidden
      style={{ position: "fixed", left: 0, right: 0, bottom: 0, height, zIndex: 40, pointerEvents: "none" }}
    >
      <div style={layer(2.5, "100%", "60%")} />
      <div style={layer(6, "70%", "55%")} />
      <div style={layer(10, "45%", "55%")} />
    </div>
  )
}
