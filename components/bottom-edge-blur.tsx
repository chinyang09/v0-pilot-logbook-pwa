"use client"

import { useEffect, useState } from "react"

/**
 * A short darkening fade across the very bottom of the screen, deepest at the
 * edge and gone a few px above the home indicator's band — content scrolling
 * under the indicator dims out instead of colliding with it. A progressive
 * BLUR was tried here first and looked wrong (the owner's call): at 25–34px
 * tall the blur band reads as smearing rather than depth, so the bottom gets
 * the darken only; the blur treatment lives at the TOP, in `ChromeFade`,
 * where the band is tall enough to read as a bar.
 *
 * iOS standalone only: it keys off a real bottom safe-area inset in an
 * installed app. Android's window already excludes its gesture bar and
 * desktop has no inset, so it renders nothing there (and the browser tab is
 * left alone — Safari manages its own chrome).
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

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: inset + 12,
        zIndex: 40,
        pointerEvents: "none",
        background:
          "linear-gradient(to bottom, transparent 0, color-mix(in srgb, var(--background) 55%, transparent) 55%, color-mix(in srgb, var(--background) 85%, transparent) 100%)",
      }}
    />
  )
}
