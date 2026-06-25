"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { motion, useTransform, type MotionValue } from "framer-motion"
import { cn } from "@/lib/utils"
import { useHoldToConfirm } from "@/hooks/use-hold-to-confirm"

const easeOutCubic = (v: number) => 1 - Math.pow(1 - v, 3)

/**
 * Build a rounded-rect outline path that STARTS at the top-centre (12 o'clock),
 * runs clockwise, and returns to the top-centre. Used so the progress stroke
 * grows from 12 o'clock clockwise (a plain `<rect>` would start at a corner).
 * A large `radius` is clamped to `min(w,h)/2`, giving a pill outline.
 */
function topCenterRoundedRectPath(x: number, y: number, w: number, h: number, radius: number): string {
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
 * Press-and-hold-to-confirm button. While held, the button fills gracefully with
 * red while a stroke draws *around* it over a faint track — starting from 12
 * o'clock clockwise, thickening with a growing glow (the motion.dev "hold to
 * confirm" pattern). The label/icon stay on top. The button does NOT
 * depress/scale. Releasing early just resets the progress; a full hold fires
 * {@link onConfirm}.
 *
 * Pass an external `progress` MotionValue to mirror the hold elsewhere (e.g. a
 * surrounding overlay tint that fills in lock-step).
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
  progress: externalProgress,
}: {
  label?: string
  onConfirm: () => void
  icon?: React.ReactNode
  disabled?: boolean
  duration?: number
  className?: string
  ariaLabel?: string
  /** Corner radius of the animated border (px) — match the surface. Large = pill. */
  radius?: number
  progress?: MotionValue<number>
}) {
  const { progress, handlers } = useHoldToConfirm({
    duration,
    disabled,
    onConfirm,
    progress: externalProgress,
  })

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
  const path = w > 0 && h > 0 ? topCenterRoundedRectPath(inset, inset, w, h, radius) : ""

  // Graceful left→right fill that grows with the hold.
  const fillWidth = useTransform(progress, (p) => `${easeOutCubic(p) * 100}%`)
  // pathLength is normalised to 100; offset 100 → 0 reveals the stroke fully,
  // growing forward from the path start (12 o'clock) clockwise.
  const dashOffset = useTransform(progress, [0, 1], [100, 0])
  const strokeWidth = useTransform(progress, [0, 1], [1.5, 3.5])
  const filter = useTransform(progress, (p) => `drop-shadow(0 0 ${6 * p}px var(--destructive))`)
  // The faint track only appears once a press begins, so the resting button
  // stays clean.
  const trackOpacity = useTransform(progress, [0, 0.001, 1], [0, 0.16, 0.16])

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      {...handlers}
      style={{ touchAction: "none", WebkitTapHighlightColor: "transparent" }}
      className={cn(
        "relative inline-flex h-11 select-none items-center justify-center gap-2 isolate",
        "rounded-xl border border-border bg-secondary px-4 text-sm font-medium text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {/* Graceful red fill */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 rounded-[inherit] bg-destructive"
        style={{ width: fillWidth }}
      />
      {path && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={size.w}
          height={size.h}
        >
          {/* Track (appears on press) */}
          <motion.path d={path} fill="none" stroke="var(--destructive)" strokeWidth={1.5} style={{ opacity: trackOpacity }} />
          {/* Progress arc — from 12 o'clock, clockwise */}
          <motion.path
            d={path}
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
    </button>
  )
}
