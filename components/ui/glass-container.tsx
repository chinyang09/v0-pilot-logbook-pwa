"use client"

import type React from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { TAP_SPRING } from "@/lib/motion"

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
   * settles when the morph lands (see the [data-morphing] rules in
   * globals.css).
   */
  morphing?: boolean
}


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
  return (
    <motion.div
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
    </motion.div>
  )
}
