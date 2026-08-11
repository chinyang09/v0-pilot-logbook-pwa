"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion"
import { cn } from "@/lib/utils"

interface GlassContainerProps {
  children: React.ReactNode
  className?: string
  contentClassName?: string
  cornerRadius?: number
  /** CSS color value for a tint overlay (e.g. "var(--primary)") */
  tintColor?: string
  /** Tint opacity 0-1 (default 0.3) */
  tintOpacity?: number
  style?: React.CSSProperties
  /** Disable the whileTap scale feedback */
  disableTapFeedback?: boolean
  /**
   * Enable the finger-tracking spotlight WITHOUT the bloom/stretch transforms.
   * Defaults to following !disableTapFeedback. Nav surfaces (pill, sidebar,
   * bottom pill) set this true while keeping tap feedback disabled — the glow
   * follows the finger but the container never scales (its tabs/items carry
   * their own affordances).
   */
  spotlight?: boolean
  /**
   * This surface sits over something that has ALREADY blurred the page — the
   * header's `ChromeFade` band, the mobile sidebar's backdrop, a modal's blur.
   *
   * The material then only needs enough opacity to read as a surface, not
   * enough to hide a legible backdrop, so `--glass-base` steps down and the
   * glass becomes properly see-through. Everything else — the face blur, the
   * veil, the rim, the specular — is unchanged: this varies the opacity alone.
   *
   * It is a fact about WHERE a surface is rendered, so it is set per call
   * site. See the `[data-over-blur]` rule in globals.css for which surfaces
   * qualify and which deliberately do not.
   */
  overBlur?: boolean
}

/**
 * Spring for press bloom / drag-follow.
 *
 * Softened from { 420, 26, 0.6 }: on a small icon button that was crisp, but on
 * the NAV PILL — a wide surface, and the one the drag lens hands back to — the
 * return read as the control snapping to size rather than easing to it. Lower
 * stiffness with more damping and mass makes the settle gradual at any width,
 * which is what the owner was comparing the pill against in the first place.
 */
const PRESS_SPRING = { stiffness: 260, damping: 30, mass: 0.9 }
/** Bloom scale while pressed (Apple controls grow, they don't compress). */
const BLOOM = 1.045
/**
 * Release settle: the control doesn't just return to 1, it passes slightly
 * UNDER and springs back up — the weight of the press carrying through, the
 * way an Apple control lands. Small on purpose; past about 0.96 it reads as
 * the button being pushed again rather than settling.
 */
const RELEASE_DIP = 0.97
/* The spring lags the target, so this is how long the dip is HELD, not how
   deep it gets: at 90ms it only reached 0.983 before being pulled back. 140ms
   lets it actually arrive at the dip and settle from there. */
const RELEASE_DIP_MS = 140
/** How much of the finger's offset from centre the glass follows — kept LOW:
 *  the glass should STRETCH toward the drag more than it travels (owner
 *  feedback: too much movement reads as the button sliding, not gelling). */
const PULL = 0.05
const PULL_MAX = 4
/** How long the glow survives a cancelled gesture before letting go. */
const CANCEL_GRACE_MS = 700

/**
 * Liquid glass surface.
 *
 * ONE material on every platform: the layered ring stack in `globals.css`
 * (blur + edge reflections + a conic-gradient specular rim).
 *
 * There used to be a second, Chromium-only path — a per-element Snell's-law
 * displacement map applied through `backdrop-filter: url(#filter)`. It was
 * removed deliberately. An SVG backdrop-filter re-rasterises every frame the
 * element resizes or scales, so every morph and every press needed the lens
 * swapped out for a plain blur and back; each surface had to raster and
 * PNG-encode a pair of megapixel maps on the main thread, keyed and cached by
 * geometry, and held a cheap stand-in until they landed. That is a lot of
 * machinery whose entire output is a rim, and on a phone it read as the app
 * being slow rather than as glass. It also meant iOS and Android rendered
 * visibly different materials.
 *
 * So: do not reintroduce a platform-conditional material here. If the rim
 * needs more presence, change the ring stack — every device gets it.
 *
 * Interaction (unless disableTapFeedback): press BLOOMS the glass (~1.045)
 * with a spotlight glow anchored to the finger; holding and moving drags the
 * spotlight across the surface while the whole slab spring-follows the pull
 * and stretches slightly — release springs everything home.
 */
export function GlassContainer({
  children,
  className,
  contentClassName,
  cornerRadius = 24,
  tintColor,
  tintOpacity = 0.3,
  style,
  disableTapFeedback,
  spotlight,
  overBlur,
}: GlassContainerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const interactive = !disableTapFeedback && !reduceMotion
  const spotlightOn = (spotlight ?? !disableTapFeedback) && !reduceMotion

  // Press-follow springs: translate toward the held finger + bloom/stretch.
  const tx = useMotionValue(0)
  const ty = useMotionValue(0)
  const sx = useMotionValue(1)
  const sy = useMotionValue(1)
  const txS = useSpring(tx, PRESS_SPRING)
  const tyS = useSpring(ty, PRESS_SPRING)
  const sxS = useSpring(sx, PRESS_SPRING)
  const syS = useSpring(sy, PRESS_SPRING)
  const pressedRef = useRef(false)
  /** Tears down the window listeners for the current press. */
  const detachRef = useRef<(() => void) | null>(null)
  const graceRef = useRef<number | undefined>(undefined)
  const settleRef = useRef<number | undefined>(undefined)
  const rippleKeyRef = useRef(0)
  /** One release ripple at a time; keyed so a re-press restarts the animation. */
  const [ripple, setRipple] = useState<{ x: number; y: number; key: number } | null>(null)

  // A surface can unmount mid-press (a morph, a route change). Drop the
  // window listeners with it, or they outlive the element they were tracking.
  useEffect(
    () => () => {
      detachRef.current?.()
      detachRef.current = null
      window.clearTimeout(graceRef.current)
      window.clearTimeout(settleRef.current)
      // No need to cancel a queued track frame here — `applyPoint` bails when
      // the element is gone, so a stray frame is a no-op.
    },
    []
  )

  /**
   * The press's latest point, applied ONCE PER FRAME.
   *
   * Tracking used to run straight off the event: `setSpotlightAt` took a
   * `getBoundingClientRect`, then `trackTo` took another one — two forced
   * layout reads per `pointermove`, and pointer events fire faster than frames
   * on a 120Hz panel (and arrive coalesced besides). Nothing downstream can
   * show more than one position per frame, so the reads were pure cost paid
   * during the one interaction that has to feel immediate.
   *
   * Coalescing into a rAF gives one rect per frame instead of two per event,
   * and keeps the rect FRESH — caching it at pointerdown would be cheaper still
   * but goes stale for a surface that moves under the finger (the nav pill
   * morphing mid-press).
   */
  const pointRef = useRef<{ x: number; y: number } | null>(null)
  const trackRafRef = useRef(0)

  const applyPoint = () => {
    trackRafRef.current = 0
    const point = pointRef.current
    const el = rootRef.current
    if (!point || !el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty("--press-x", `${point.x - rect.left}px`)
    el.style.setProperty("--press-y", `${point.y - rect.top}px`)
    if (!interactive) return
    const dx = point.x - (rect.left + rect.width / 2)
    const dy = point.y - (rect.top + rect.height / 2)
    const clamp = (v: number) => Math.max(-PULL_MAX, Math.min(PULL_MAX, v))
    tx.set(clamp(dx * PULL))
    ty.set(clamp(dy * PULL))
    // Stretch along the pull axis — the glass "gives" toward the drag. The
    // stretch dominates over the translation (see PULL above).
    sx.set(BLOOM + Math.min(Math.abs(dx) * 0.0012, 0.05))
    sy.set(BLOOM + Math.min(Math.abs(dy) * 0.0012, 0.05))
  }

  /** Place the spotlight immediately — for pointerdown, which must not wait. */
  const setSpotlightAt = (clientX: number, clientY: number) => {
    pointRef.current = { x: clientX, y: clientY }
    if (trackRafRef.current) cancelAnimationFrame(trackRafRef.current)
    applyPoint()
  }

  /**
   * The press glow is driven imperatively rather than through framer's
   * `whileTap`, because a tap gesture ends the moment the browser decides the
   * finger is scrolling — and then the glow died while the finger was still
   * on the glass.
   */
  const setGlow = (on: boolean) => {
    rootRef.current?.style.setProperty("--glass-press", on ? "1" : "0")
  }

  /** Move handler: record the point, let the frame do the work. */
  const trackTo = (clientX: number, clientY: number) => {
    pointRef.current = { x: clientX, y: clientY }
    if (trackRafRef.current) return
    trackRafRef.current = requestAnimationFrame(applyPoint)
  }

  /** Home, with no settle — for a cancelled gesture, which isn't a release. */
  const dropBloom = () => {
    if (!interactive) return
    tx.set(0)
    ty.set(0)
    sx.set(1)
    sy.set(1)
  }

  /** Home via the under-and-back settle. */
  const settleFromPress = () => {
    if (!interactive) return dropBloom()
    tx.set(0)
    ty.set(0)
    sx.set(RELEASE_DIP)
    sy.set(RELEASE_DIP)
    window.clearTimeout(settleRef.current)
    settleRef.current = window.setTimeout(() => {
      sx.set(1)
      sy.set(1)
    }, RELEASE_DIP_MS)
  }

  /**
   * Finger lifted. The glow rides outward from where it left as a ripple
   * rather than just fading where it stood — the light leaves with the touch.
   */
  const releasePress = (clientX?: number, clientY?: number) => {
    if (!pressedRef.current) return
    pressedRef.current = false
    detachRef.current?.()
    detachRef.current = null
    // A queued frame would re-apply the pull after the settle has started.
    if (trackRafRef.current) {
      cancelAnimationFrame(trackRafRef.current)
      trackRafRef.current = 0
    }
    const el = rootRef.current
    if (el && clientX !== undefined && clientY !== undefined) {
      const rect = el.getBoundingClientRect()
      setRipple({
        x: clientX - rect.left,
        y: clientY - rect.top,
        key: rippleKeyRef.current++,
      })
    }
    setGlow(false)
    settleFromPress()
  }

  /**
   * Tracking runs on the WINDOW for the life of the press, not on the element.
   *
   * Two things this fixes, both Android:
   *
   * - The element stops receiving pointer moves once the finger wanders off
   *   it, so the spotlight froze at the edge.
   * - Chrome fires `touchcancel`/`pointercancel` as soon as a move starts to
   *   look like a scroll. That used to run `endPress`, which is why the glow
   *   appeared on touch and then died the instant the finger moved. A cancel
   *   now only drops the bloom (scaling a scrolling surface janks) and keeps
   *   the light — touch moves usually keep coming, and if they don't, the
   *   grace timer closes it out so a glow can never stick.
   */
  const attachTracking = () => {
    const onPointerMove = (e: PointerEvent) => trackTo(e.clientX, e.clientY)
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (t) {
        window.clearTimeout(graceRef.current)
        trackTo(t.clientX, t.clientY)
      }
    }
    const onPointerUp = (e: PointerEvent) => releasePress(e.clientX, e.clientY)
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      releasePress(t?.clientX, t?.clientY)
    }
    // A cancelled gesture gives us no lift to close on, so hold the light
    // briefly and let it go if nothing else arrives.
    const onCancel = () => {
      dropBloom()
      window.clearTimeout(graceRef.current)
      graceRef.current = window.setTimeout(() => releasePress(), CANCEL_GRACE_MS)
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: true })
    window.addEventListener("pointerup", onPointerUp, { passive: true })
    window.addEventListener("touchend", onTouchEnd, { passive: true })
    window.addEventListener("pointercancel", onCancel, { passive: true })
    window.addEventListener("touchcancel", onCancel, { passive: true })

    return () => {
      window.clearTimeout(graceRef.current)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("touchend", onTouchEnd)
      window.removeEventListener("pointercancel", onCancel)
      window.removeEventListener("touchcancel", onCancel)
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!spotlightOn) return
    // Ignore presses while this surface sits behind a modal. Radix marks
    // everything outside an open dialog `aria-hidden`, so a touch that leaks
    // through (or a scroll that Safari reports as a press) would otherwise
    // bloom the glass — the "phantom tap" on the calendar/upload buttons while
    // scrolling the import dialog.
    if (rootRef.current?.closest('[aria-hidden="true"]')) return
    detachRef.current?.()
    pressedRef.current = true
    setSpotlightAt(e.clientX, e.clientY)
    setGlow(true)
    if (interactive) {
      sx.set(BLOOM)
      sy.set(BLOOM)
    }
    detachRef.current = attachTracking()
  }

  return (
    <motion.div
      ref={rootRef}
      className={cn("GlassContainer", className)}
      data-over-blur={overBlur ? "true" : undefined}
      style={{
        "--corner-radius": `${cornerRadius}px`,
        "--glass-press": 0,
        ...(interactive
          ? { x: txS, y: tyS, scaleX: sxS, scaleY: syS }
          : null),
        ...style,
      } as React.CSSProperties}
      // Only the press STARTS here — everything after it is tracked on the
      // window (see attachTracking), so the gesture survives the finger
      // leaving the element and survives the browser cancelling the pointer.
      onPointerDown={handlePointerDown}
    >
      <div className={cn("GlassContent", contentClassName)}>
        {tintColor && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: tintColor,
              opacity: tintOpacity,
              borderRadius: "inherit",
            }}
          />
        )}
        {children}
      </div>

      {/* Release ripple — the light rides outward from where the finger left
          and fades. Keyed so a quick second press restarts it rather than
          being swallowed by the still-running animation, and it clears itself
          on animationend so nothing accumulates. */}
      {ripple && (
        <span
          key={ripple.key}
          aria-hidden
          className="GlassRipple"
          style={{ left: ripple.x, top: ripple.y }}
          onAnimationEnd={() => setRipple(null)}
        />
      )}

      {/* `GlassBlur` is the face and carries the ONLY full-face
          backdrop-filter — see globals.css for why there used to be six of
          them and why that made iOS and Android look different. The rest are
          masked to a rim: they refract only the edge band, which is what gives
          the slab its thickness. */}
      <div className="GlassMaterial">
        <div className="GlassEdgeReflection" />
        <div className="GlassEmbossReflection" />
        <div className="GlassRefraction" />
        <div className="GlassBlur" />
        <div className="Highlight" />
      </div>
    </motion.div>
  )
}
