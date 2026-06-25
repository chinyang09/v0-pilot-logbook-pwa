"use client"

import type React from "react"
import { motion, useTransform, type MotionValue } from "framer-motion"
import { cn } from "@/lib/utils"
import { useHoldToConfirm } from "@/hooks/use-hold-to-confirm"
import { HoldProgressBorder } from "@/components/ui/hold-progress-border"

const easeOutCubic = (v: number) => 1 - Math.pow(1 - v, 3)

/**
 * Press-and-hold-to-confirm button. While held, a soft red gradient sweeps the
 * fill left→right (intensifying as it nears the end), and — when {@link showBorder}
 * — a stroke draws around the button from 12 o'clock clockwise (the motion.dev
 * pattern). The label/icon stay on top. The button does NOT depress/scale.
 * Releasing early just resets; a full hold fires {@link onConfirm}.
 *
 * Pass an external `progress` MotionValue to mirror the hold elsewhere (e.g. a
 * card border / overlay tint that advances in lock-step), and `showBorder={false}`
 * when that surrounding element owns the border instead of the button.
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
  showBorder = true,
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
  showBorder?: boolean
}) {
  const { progress, handlers } = useHoldToConfirm({
    duration,
    disabled,
    onConfirm,
    progress: externalProgress,
  })

  // Soft left→right gradient sweep: a mask reveals the gradient up to the eased
  // progress with a feathered leading edge, and the whole fill intensifies as it
  // nears completion. Reads as the fill "turning red" gradient-style (not a hard
  // solid edge).
  const fillMask = useTransform(progress, (p) => {
    const pct = easeOutCubic(p) * 100
    const soft = Math.max(0, pct - 22)
    return `linear-gradient(to right, #000 ${soft}%, transparent ${pct}%)`
  })
  const fillOpacity = useTransform(progress, [0, 1], [0.5, 1])

  return (
    <button
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
      {/* Graceful red gradient fill (left → right, intensifying) */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{
          background:
            "linear-gradient(90deg, var(--destructive), color-mix(in oklch, var(--destructive) 45%, transparent))",
          opacity: fillOpacity,
          WebkitMaskImage: fillMask,
          maskImage: fillMask,
        }}
      />
      {showBorder && <HoldProgressBorder progress={progress} radius={radius} />}
      <span className="relative z-[1] inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
    </button>
  )
}
