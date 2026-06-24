"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { motion, useTransform } from "framer-motion"
import { cn } from "@/lib/utils"
import { useHoldToConfirm } from "@/hooks/use-hold-to-confirm"

/**
 * Press-and-hold-to-confirm button. While held, an SVG border draws *around* the
 * button over a faint track (radial progress) and thickens, with a growing glow
 * — the motion.dev "hold to confirm" pattern. The label/icon stay fully visible
 * (no fill overlay). Releasing early just resets the progress; a full hold fires
 * {@link onConfirm}. (Whoever renders it decides how it's dismissed.)
 *
 * The border is an SVG `<rect>` whose `pathLength` is normalised to 100, so a
 * `strokeDashoffset` driven by the hold progress reveals the stroke from 0 → the
 * full perimeter regardless of the button's real size. Size is measured with a
 * ResizeObserver (setState only in the RO callback, never in the effect body).
 */
export function HoldToConfirmButton({
  label,
  onConfirm,
  icon,
  disabled = false,
  duration,
  className,
  ariaLabel,
  radius = 12,
}: {
  label?: string
  onConfirm: () => void
  icon?: React.ReactNode
  disabled?: boolean
  duration?: number
  className?: string
  ariaLabel?: string
  /** Corner radius of the animated border (px) — match the surface. */
  radius?: number
}) {
  const { progress, isCharging, handlers } = useHoldToConfirm({ duration, disabled, onConfirm })

  const ref = useRef<HTMLButtonElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Inset enough that the stroke + glow sit inside the surface (parents often
  // clip with overflow-hidden).
  const inset = 3.5
  const w = Math.max(0, size.w - inset * 2)
  const h = Math.max(0, size.h - inset * 2)

  // pathLength is normalised to 100; offset 100 → 0 reveals the stroke fully.
  const dashOffset = useTransform(progress, [0, 1], [100, 0])
  const strokeWidth = useTransform(progress, [0, 1], [1.5, 3.5])
  const filter = useTransform(progress, (p) => `drop-shadow(0 0 ${6 * p}px var(--destructive))`)
  // The faint track only appears once a press begins, so the resting button
  // stays clean.
  const trackOpacity = useTransform(progress, [0, 0.001, 1], [0, 0.16, 0.16])

  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      {...handlers}
      style={{ touchAction: "none" }}
      animate={{ scale: isCharging ? 0.985 : 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "relative inline-flex h-11 select-none items-center justify-center gap-2",
        "rounded-xl border border-border bg-secondary px-4 text-sm font-medium text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {size.w > 0 && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={size.w}
          height={size.h}
        >
          {/* Track (appears on press) */}
          <motion.rect
            x={inset}
            y={inset}
            width={w}
            height={h}
            rx={radius}
            ry={radius}
            fill="none"
            stroke="var(--destructive)"
            strokeWidth={1.5}
            style={{ opacity: trackOpacity }}
          />
          {/* Progress arc */}
          <motion.rect
            x={inset}
            y={inset}
            width={w}
            height={h}
            rx={radius}
            ry={radius}
            pathLength={100}
            fill="none"
            stroke="var(--destructive)"
            strokeLinecap="round"
            strokeDasharray="100 100"
            style={{ strokeDashoffset: dashOffset, strokeWidth, filter }}
          />
        </svg>
      )}
      <span className="relative z-[1] inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
    </motion.button>
  )
}
