"use client"

import { useEffect, useId, useRef, useState } from "react"
import { motion, useTransform, type MotionValue } from "framer-motion"
import { cn } from "@/lib/utils"

/**
 * Build a rounded-rect outline path that STARTS at the top-centre (12 o'clock),
 * runs clockwise, and returns to the top-centre — so a progress stroke grows
 * from 12 o'clock clockwise (a plain `<rect>` would start at a corner). A large
 * `radius` is clamped to `min(w,h)/2`, giving a pill outline.
 */
export function topCenterRoundedRectPath(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  const right = x + w
  const bottom = y + h
  const cx = x + w / 2
  return [
    `M ${cx} ${y}`,
    `L ${right - r} ${y}`,
    `A ${r} ${r} 0 0 1 ${right} ${y + r}`,
    `L ${right} ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `L ${x + r} ${bottom}`,
    `A ${r} ${r} 0 0 1 ${x} ${bottom - r}`,
    `L ${x} ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    `L ${cx} ${y}`,
    "Z",
  ].join(" ")
}

/**
 * A hold-progress border that traces its positioned parent's rounded-rect
 * outline. The stroke draws from 12 o'clock clockwise, thickening, glowing and
 * intensifying as `progress` (0→1) advances. Drop it as the first child of a
 * `relative` element and size it via that parent (measured with a
 * ResizeObserver; setState only ever runs in the RO callback).
 */
export function HoldProgressBorder({
  progress,
  radius = 12,
  className,
}: {
  progress: MotionValue<number>
  radius?: number
  className?: string
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const gradId = useId().replace(/[:]/g, "")

  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const inset = 3.5
  const w = Math.max(0, size.w - inset * 2)
  const h = Math.max(0, size.h - inset * 2)
  const path = w > 0 && h > 0 ? topCenterRoundedRectPath(inset, inset, w, h, radius) : ""

  // pathLength normalised to 100; offset 100 → 0 reveals the stroke fully.
  const dashOffset = useTransform(progress, [0, 1], [100, 0])
  const strokeWidth = useTransform(progress, [0, 1], [1.5, 4])
  // Intensify (brighten) as the hold nears completion.
  const opacity = useTransform(progress, [0, 0.001, 1], [0, 0.5, 1])
  const filter = useTransform(progress, (p) => `drop-shadow(0 0 ${10 * p}px var(--destructive))`)
  const trackOpacity = useTransform(progress, [0, 0.001, 1], [0, 0.14, 0.14])

  return (
    <svg
      ref={ref}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-visible", className)}
      width={size.w}
      height={size.h}
    >
      {path && (
        <>
          {/* Soft gradient so the stroke reads gentler than a flat solid red. */}
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--destructive)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--destructive)" stopOpacity="0.45" />
            </linearGradient>
          </defs>
          {/* Track (appears on press) */}
          <motion.path d={path} fill="none" stroke={`url(#${gradId})`} strokeWidth={1.5} style={{ opacity: trackOpacity }} />
          {/* Progress arc — from 12 o'clock, clockwise */}
          <motion.path
            d={path}
            pathLength={100}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeLinecap="round"
            strokeDasharray="100 100"
            style={{ strokeDashoffset: dashOffset, strokeWidth, opacity, filter }}
          />
        </>
      )}
    </svg>
  )
}
