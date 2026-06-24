"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/lib/utils"

/**
 * A glowing segment that *glides* around its children's rounded-rect border
 * while `active` — a "border beam". Used for the TOTP login while a code is
 * being verified. A faint full ring sits underneath so the travelling segment
 * reads as a moving highlight on a border (the full-border "confirmed" glow is
 * handled separately by the `.totp-success` box-shadow).
 *
 * Built on an SVG `<rect>` with the `pathLength` attribute normalised to 100, so
 * a `strokeDasharray`/`strokeDashoffset` animation glides regardless of the
 * element's real dimensions. The size is measured with a ResizeObserver (all
 * setState happens in the RO callback, never synchronously in the effect body,
 * so the lint baseline is preserved).
 */
export function BorderGlide({
  active,
  children,
  className,
  radius = 8,
  duration = 1.4,
  color = "rgb(255, 210, 80)", // amber, matching the previous TOTP glow
}: {
  active: boolean
  children: React.ReactNode
  className?: string
  radius?: number
  duration?: number
  color?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const inset = 1.5
  const w = Math.max(0, size.w - inset * 2)
  const h = Math.max(0, size.h - inset * 2)

  return (
    <div ref={ref} className={cn("relative", className)}>
      <AnimatePresence>
        {active && size.w > 0 && (
          <motion.svg
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={size.w}
            height={size.h}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Faint full ring */}
            <rect
              x={inset}
              y={inset}
              width={w}
              height={h}
              rx={radius}
              ry={radius}
              fill="none"
              stroke={color}
              strokeOpacity={0.18}
              strokeWidth={1.5}
            />
            {/* Gliding glow segment */}
            <motion.rect
              x={inset}
              y={inset}
              width={w}
              height={h}
              rx={radius}
              ry={radius}
              pathLength={100}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray="20 80"
              style={{ filter: `drop-shadow(0 0 5px ${color})` }}
              animate={{ strokeDashoffset: [0, -100] }}
              transition={{ duration, ease: "linear", repeat: Infinity }}
            />
          </motion.svg>
        )}
      </AnimatePresence>
      {children}
    </div>
  )
}
