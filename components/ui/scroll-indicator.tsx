"use client"

import { useEffect, useRef } from "react"

/**
 * Native-style overlay scroll indicator, inset below the floating header.
 *
 * iOS draws its own indicator across the scroller's full box — which in an
 * edge-to-edge app means it starts at the screen edge, riding over the status
 * bar. A native scroll view insets its indicator to the safe area
 * (`scrollIndicatorInsets`); CSS has no equivalent, so the native indicator
 * is hidden (`scrollbar-hide` on the scroller) and this draws the same
 * affordance inset to the chrome: the track runs from `--chrome-top` (below
 * the action buttons) down to the nav clearance, exactly like the reference
 * native apps.
 *
 * Render it as the FIRST CHILD of the scroller. A zero-height sticky anchor
 * pins it to the scroller's visible top, so the overlay itself never scrolls
 * and everything stays compositor-friendly; geometry is updated from a
 * passive scroll listener through rAF.
 */
export function ScrollIndicator() {
  const anchorRef = useRef<HTMLDivElement>(null)
  const topProbeRef = useRef<HTMLDivElement>(null)
  const bottomProbeRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const anchor = anchorRef.current
    const thumb = thumbRef.current
    const topProbe = topProbeRef.current
    const bottomProbe = bottomProbeRef.current
    const scroller = anchor?.parentElement
    if (!anchor || !thumb || !topProbe || !bottomProbe || !scroller) return

    let hideTimer = 0
    let raf = 0

    const update = () => {
      raf = 0
      const { scrollTop, scrollHeight, clientHeight } = scroller
      const range = scrollHeight - clientHeight
      if (range <= 1) {
        thumb.style.opacity = "0"
        return
      }
      const topInset = topProbe.offsetHeight
      const bottomInset = bottomProbe.offsetHeight + 6
      const track = clientHeight - topInset - bottomInset
      if (track <= 0) return
      const thumbH = Math.max(36, (track * clientHeight) / scrollHeight)
      const progress = Math.min(1, Math.max(0, scrollTop / range))
      const y = topInset + (track - thumbH) * progress
      thumb.style.transform = `translateY(${y}px)`
      thumb.style.height = `${thumbH}px`
      thumb.style.opacity = "1"
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        thumb.style.opacity = "0"
      }, 800)
    }

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }

    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      scroller.removeEventListener("scroll", onScroll)
      window.clearTimeout(hideTimer)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      ref={anchorRef}
      aria-hidden
      style={{ position: "sticky", top: 0, height: 0, zIndex: 45, pointerEvents: "none" }}
    >
      {/* invisible probes resolving the CSS-var insets to px */}
      <div ref={topProbeRef} style={{ position: "absolute", width: 0, height: "var(--chrome-top)", visibility: "hidden" }} />
      <div ref={bottomProbeRef} style={{ position: "absolute", width: 0, height: "var(--nav-bottom-offset, 4px)", visibility: "hidden" }} />
      <div
        ref={thumbRef}
        style={{
          position: "absolute",
          right: 3,
          width: 3,
          borderRadius: 2,
          background: "color-mix(in srgb, var(--foreground) 35%, transparent)",
          opacity: 0,
          transition: "opacity 250ms ease",
          willChange: "transform",
        }}
      />
    </div>
  )
}
