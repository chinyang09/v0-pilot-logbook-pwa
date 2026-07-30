"use client"

import type React from "react"
import { useRef } from "react"
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
   * True while this glass surface is mid-morph (pill ↔ sidebar). The material
   * surges — extra blur/brightness/vibrancy, like a droplet swelling — then
   * settles when the morph lands.
   */
  morphing?: boolean
}

/** Spring for press bloom / drag-follow — snappy with a soft settle. */
const PRESS_SPRING = { stiffness: 420, damping: 26, mass: 0.6 }
/** Bloom scale while pressed (Apple controls grow, they don't compress). */
const BLOOM = 1.045
/** How much of the finger's offset from centre the glass follows — kept LOW:
 *  the glass should STRETCH toward the drag more than it travels (owner
 *  feedback: too much movement reads as the button sliding, not gelling). */
const PULL = 0.05
const PULL_MAX = 4

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
  morphing,
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

  const setSpotlightAt = (clientX: number, clientY: number) => {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty("--press-x", `${clientX - rect.left}px`)
    el.style.setProperty("--press-y", `${clientY - rect.top}px`)
  }

  const setSpotlight = (e: React.PointerEvent) => {
    setSpotlightAt(e.clientX, e.clientY)
  }

  /**
   * The press glow is driven imperatively rather than through framer's
   * `whileTap`. A native scroll inside the surface (the sidebar list) steals
   * the pointer and fires `pointercancel`, which ends a tap gesture — so the
   * glow died the instant you started scrolling, even though the finger was
   * still down on the glass. Owning the variable means the glow survives the
   * cancel and is closed out by the real lift instead.
   */
  const setGlow = (on: boolean) => {
    rootRef.current?.style.setProperty("--glass-press", on ? "1" : "0")
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!spotlightOn) return
    // Ignore presses while this surface sits behind a modal. Radix marks
    // everything outside an open dialog `aria-hidden`, so a touch that leaks
    // through (or a scroll that Safari reports as a press) would otherwise
    // bloom the glass — the "phantom tap" on the calendar/upload buttons while
    // scrolling the import dialog.
    if (rootRef.current?.closest('[aria-hidden="true"]')) return
    pressedRef.current = true
    setSpotlight(e)
    setGlow(true)
    if (interactive) {
      sx.set(BLOOM)
      sy.set(BLOOM)
    }
  }

  /**
   * Touch moves keep firing while the browser scrolls, where pointer moves do
   * not — so this is what keeps the spotlight under the finger during a
   * rubber-band scroll of the sidebar.
   */
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!spotlightOn || !pressedRef.current) return
    const touch = e.touches[0]
    if (touch) setSpotlightAt(touch.clientX, touch.clientY)
  }

  /**
   * The scroller took the pointer. Drop the bloom/pull (scaling a scrolling
   * surface janks) but keep the glow and keep tracking — `handleTouchMove`
   * feeds it until the finger actually lifts.
   */
  const handlePointerCancel = () => {
    if (!pressedRef.current) return
    if (interactive) {
      sx.set(1)
      sy.set(1)
      tx.set(0)
      ty.set(0)
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!spotlightOn || !pressedRef.current) return
    setSpotlight(e)
    if (!interactive) return
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const dx = e.clientX - (rect.left + rect.width / 2)
    const dy = e.clientY - (rect.top + rect.height / 2)
    const clamp = (v: number) => Math.max(-PULL_MAX, Math.min(PULL_MAX, v))
    tx.set(clamp(dx * PULL))
    ty.set(clamp(dy * PULL))
    // Stretch along the pull axis — the glass "gives" toward the drag. The
    // stretch dominates over the translation (see PULL above).
    sx.set(BLOOM + Math.min(Math.abs(dx) * 0.0012, 0.05))
    sy.set(BLOOM + Math.min(Math.abs(dy) * 0.0012, 0.05))
  }

  const endPress = () => {
    if (!pressedRef.current) return
    pressedRef.current = false
    setGlow(false)
    tx.set(0)
    ty.set(0)
    sx.set(1)
    sy.set(1)
  }

  return (
    <motion.div
      ref={rootRef}
      className={cn("GlassContainer", className)}
      data-morphing={morphing ? "true" : undefined}
      style={{
        "--corner-radius": `${cornerRadius}px`,
        "--glass-press": 0,
        ...(interactive
          ? { x: txS, y: tyS, scaleX: sxS, scaleY: syS }
          : null),
        ...style,
      } as React.CSSProperties}
      // The spotlight overlay fades in via --glass-press (custom properties
      // animate through framer); position is set imperatively above.
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onTouchMove={handleTouchMove}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      /* NOT endPress: a scroll cancels the pointer while the finger is still
         down. See handlePointerCancel. */
      onPointerCancel={handlePointerCancel}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
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
