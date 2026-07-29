"use client"

import type React from "react"
import { useEffect, useId, useRef, useState } from "react"
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion"
import { cn } from "@/lib/utils"
import {
  generateGlassMaps,
  supportsSvgBackdropFilter,
  type GlassMaps,
} from "@/lib/glass/displacement"

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
/** Coalesce a run of resizes into one regenerate. */
const RESIZE_DEBOUNCE_MS = 90
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
 * Two rendering paths (adapted from winaviation/liquid-web, MIT — itself from
 * kube's Liquid Glass article):
 *
 * - **Lens** (Chromium): a real Snell's-law displacement map + rim specular
 *   applied through `backdrop-filter: url(#filter)` — genuine edge refraction
 *   with a clean centre, fewer layers than the fallback.
 * - **Rings** (Safari/Firefox — the primary iPad PWA target): WebKit doesn't
 *   support SVG filters in backdrop-filter, so the layered ring material
 *   stays, with the specular approximated by a conic gradient on the rim.
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
  const filterId = useId().replace(/[^a-zA-Z0-9_-]/g, "") + "-lens"
  // Tagged with the radius they were built for: when the prop moves ahead of
  // the tag the maps describe a different shape (the pill's 28 vs the
  // sidebar's 20) and must not be painted — see `awaitingMaps` below.
  const [built, setBuilt] = useState<{ maps: GlassMaps; radius: number } | null>(null)
  const maps = built?.maps ?? null
  // True while the slab is animating its geometry (morph) or scale (press
  // bloom). An SVG-displacement backdrop-filter re-rasterises every frame that
  // the element resizes/scales — the jank source — so while animating we drop
  // it for a cheap plain blur and restore the lens once it settles.
  const [pressed, setPressed] = useState(false)
  // True from the moment a new size is known until its maps are built. The maps
  // already on screen belong to the OLD size, and the feImage stretches them
  // (preserveAspectRatio="none") — a pill-sized map smeared over the open
  // sidebar refracts wrongly across the whole surface, which is what made the
  // Android sidebar look unlike every other glass panel for the first second.
  // Painting the cheap blur until the real map lands keeps the material
  // continuous with the morph instead.
  const [rebuilding, setRebuilding] = useState(false)
  const awaitingMaps = rebuilding || (built !== null && built.radius !== cornerRadius)
  const reduceMotion = useReducedMotion()
  const interactive = !disableTapFeedback && !reduceMotion
  const spotlightOn = (spotlight ?? !disableTapFeedback) && !reduceMotion
  const cheapMode = !!morphing || awaitingMaps || (pressed && interactive)

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
      setPressed(true)
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
      setPressed(false)
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
    setPressed(false)
  }

  // Chromium only: (re)generate the refraction maps for the current size.
  //
  // Everything here is driven off the ResizeObserver — including the first
  // build, since observing fires once with the current size. That keeps the
  // (expensive) generate out of the effect body, so it never blocks a commit
  // and never sets state synchronously during one.
  //
  // Nothing is generated while `morphing`: the size is a moving target, the
  // lens is off for the duration anyway (cheapMode), and building a map per
  // resize tick is main-thread work landing right on top of the animation. The
  // effect re-runs when the morph clears and builds once, at the final size.
  useEffect(() => {
    if (!supportsSvgBackdropFilter()) return
    const el = rootRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let first = true

    const regenerate = () => {
      timer = null
      setRebuilding(false)
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w < 8 || h < 8) return
      setBuilt({
        maps: generateGlassMaps({ width: w, height: h, radius: cornerRadius }),
        radius: cornerRadius,
      })
    }

    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer)
      setRebuilding(true)
      timer = setTimeout(regenerate, delay)
    }

    const ro = new ResizeObserver(() => {
      if (morphing) return
      // The observer's own first callback is this element settling into its
      // size — build immediately. Later ones are a real resize, so coalesce.
      schedule(first ? 0 : RESIZE_DEBOUNCE_MS)
      first = false
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [cornerRadius, morphing])

  const lensActive = maps !== null

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

      {lensActive ? (
        <>
          {/* While animating (morph or press bloom), or until the maps for the
              current size exist, the SVG displacement is dropped for a cheap
              plain blur — the lens would otherwise re-rasterise every frame the
              element resizes/scales (the jank), or paint a map built for a
              different shape.

              The stand-in mirrors the filter chain term for term so the swap is
              only the refraction appearing, not the material changing weight:
              CSS blur(Npx) IS feGaussianBlur stdDeviation N, so 3px matches the
              filter's own blur, saturate(1.5) matches its feColorMatrix, and the
              slight brightness stands in for the specular screen. */}
          <div
            className="GlassLens"
            style={{
              backdropFilter: cheapMode
                ? `blur(3px) saturate(1.5) brightness(1.05)`
                : `url(#${filterId}) blur(0px) brightness(1) saturate(1)`,
            }}
          />
          <svg className="GlassFilterSvg" aria-hidden="true">
            <defs>
              <filter
                id={filterId}
                x="-15%"
                y="-15%"
                width="130%"
                height="130%"
                colorInterpolationFilters="sRGB"
              >
                <feGaussianBlur in="SourceGraphic" stdDeviation={3} result="blurred" />
                <feImage
                  href={maps.displacementUrl}
                  x="0"
                  y="0"
                  width={maps.width}
                  height={maps.height}
                  preserveAspectRatio="none"
                  result="dmap"
                />
                <feDisplacementMap
                  in="blurred"
                  in2="dmap"
                  scale={maps.displacementScale}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="displaced"
                />
                <feColorMatrix in="displaced" type="saturate" values="1.5" result="sat" />
                <feImage
                  href={maps.specularUrl}
                  x="0"
                  y="0"
                  width={maps.width}
                  height={maps.height}
                  preserveAspectRatio="none"
                  result="spec"
                />
                {/* Soften the rim ~0.5px so the specular reads as a glow, not a
                    hard line — smoother highlight on top of the DPR supersample. */}
                <feGaussianBlur in="spec" stdDeviation={0.5} result="specSoft" />
                <feComponentTransfer in="specSoft" result="specFaded">
                  <feFuncA type="linear" slope={0.65} />
                </feComponentTransfer>
                <feBlend in="specFaded" in2="sat" mode="screen" />
              </filter>
            </defs>
          </svg>
        </>
      ) : (
        <div className="GlassMaterial">
          <div className="GlassEdgeReflection" />
          <div className="GlassEmbossReflection" />
          <div className="GlassRefraction" />
          <div className="GlassBlur" />
          <div className="BlendLayers" />
          <div className="BlendEdge" />
          <div className="Highlight" />
          <div className="Contrast" />
          <div className="Brightness" />
        </div>
      )}
    </motion.div>
  )
}
