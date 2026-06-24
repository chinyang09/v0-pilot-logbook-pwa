"use client"

import type React from "react"
import { motion, useTransform } from "framer-motion"
import { cn } from "@/lib/utils"
import { useHoldToConfirm } from "@/hooks/use-hold-to-confirm"

/** Eased fill so the sweep accelerates gently rather than tracking linearly. */
const easeOutCubic = (v: number) => 1 - Math.pow(1 - v, 3)

/**
 * A standalone press-and-hold-to-confirm button (no swipe row). Holding fills
 * the button with a smooth "liquid" sweep (rounded leading edge); reaching full
 * fires `onConfirm`. Releasing early springs the fill back. Used for destructive
 * actions that aren't list rows (e.g. Log Out), replacing a confirmation dialog.
 */
export function HoldToConfirmButton({
  label,
  onConfirm,
  icon,
  disabled = false,
  duration,
  className,
}: {
  label: string
  onConfirm: () => void
  icon?: React.ReactNode
  disabled?: boolean
  duration?: number
  className?: string
}) {
  const { progress, isCharging, handlers } = useHoldToConfirm({ duration, onConfirm, disabled })

  // Width-based fill with a rounded leading edge → a soft liquid sweep instead of
  // a hard rectangle. Eased so it feels physical, and translucent → solid so the
  // label stays readable through it until the very end.
  const fillWidth = useTransform(progress, (v) => `${easeOutCubic(v) * 100}%`)
  const fillOpacity = useTransform(progress, [0, 1], [0.5, 1])

  return (
    <motion.button
      type="button"
      disabled={disabled}
      aria-label={label}
      {...handlers}
      style={{ touchAction: "none" }}
      animate={{ scale: isCharging ? 0.985 : 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "relative inline-flex h-11 select-none items-center justify-center gap-2 overflow-hidden",
        "rounded-xl border border-destructive/30 bg-secondary px-4 text-sm font-medium text-foreground",
        "transition-shadow disabled:pointer-events-none disabled:opacity-50",
        isCharging && "shadow-[0_0_0_3px_color-mix(in_oklch,var(--destructive)_18%,transparent)]",
        className,
      )}
    >
      {/* Liquid fill that sweeps across as the button is held. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 rounded-r-xl bg-gradient-to-r from-destructive to-[color-mix(in_oklch,var(--destructive)_82%,black)]"
        style={{ width: fillWidth, opacity: fillOpacity }}
      />
      <span className="relative z-[1] inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
    </motion.button>
  )
}
