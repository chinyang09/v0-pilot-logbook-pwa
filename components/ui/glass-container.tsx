"use client"

import type React from "react"
import { useEffect, useId, useRef, useState } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { TAP_SPRING } from "@/lib/motion"
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
   * True while this glass surface is mid-morph (pill ↔ sidebar). The material
   * surges — extra blur/brightness/vibrancy, like a droplet swelling — then
   * settles when the morph lands.
   */
  morphing?: boolean
}

/**
 * Liquid glass surface.
 *
 * Two rendering paths (adapted from winaviation/liquid-web, MIT — itself from
 * kube's Liquid Glass article):
 *
 * - **Lens** (Chromium): a real Snell's-law displacement map + rim specular is
 *   generated per element size and applied through
 *   `backdrop-filter: url(#filter)` — genuine edge refraction with a clean
 *   centre, and FEWER layers than the fallback (one backdrop-filter surface
 *   instead of nine).
 * - **Rings** (Safari/Firefox — the primary iPad PWA target): WebKit doesn't
 *   support SVG filters in backdrop-filter, so the layered ring material
 *   stays, with the specular approximated by a conic gradient on the rim
 *   (see globals.css `.GlassMaterial::before`).
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
  morphing,
}: GlassContainerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const filterId = useId().replace(/[^a-zA-Z0-9_-]/g, "") + "-lens"
  const [maps, setMaps] = useState<GlassMaps | null>(null)

  // Chromium only: (re)generate the refraction maps for the current size.
  // Debounced so morphs/resizes regenerate once at settle — mid-flight the
  // feImage stretches with the element (preserveAspectRatio="none"), which is
  // visually acceptable for ~350ms.
  useEffect(() => {
    if (!supportsSvgBackdropFilter()) return
    const el = rootRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const regenerate = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w < 8 || h < 8) return
      setMaps(generateGlassMaps({ width: w, height: h, radius: cornerRadius }))
    }
    regenerate()
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(regenerate, 150)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [cornerRadius])

  const lensActive = maps !== null

  return (
    <motion.div
      ref={rootRef}
      className={cn("GlassContainer", className)}
      data-morphing={morphing ? "true" : undefined}
      style={{
        "--corner-radius": `${cornerRadius}px`,
        "--glass-press": 0,
        ...style,
      } as React.CSSProperties}
      // Apple-style press: the glass COMPRESSES under the finger (not grows)
      // while the material blooms brighter (--glass-press drives the
      // .GlassContent::after overlay), then springs back on release.
      whileTap={
        disableTapFeedback
          ? undefined
          : ({ scale: 0.965, "--glass-press": 1 } as Record<string, number | string>)
      }
      transition={TAP_SPRING}
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
          {/* Both filter-function lists have the same shape so the morph surge
              interpolates instead of stepping. */}
          <div
            className="GlassLens"
            style={{
              backdropFilter: morphing
                ? `url(#${filterId}) blur(5px) brightness(1.15) saturate(1.15)`
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
                <feComponentTransfer in="spec" result="specFaded">
                  <feFuncA type="linear" slope={0.5} />
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
