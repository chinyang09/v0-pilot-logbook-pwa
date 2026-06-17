"use client"

import type React from "react"
import { motion, useTransform } from "framer-motion"
import { cn } from "@/lib/utils"
import { useHoldToConfirm } from "@/hooks/use-hold-to-confirm"

/**
 * A standalone press-and-hold-to-confirm button (no swipe row). Holding fills
 * the button red left→right; reaching full fires `onConfirm`. Releasing early
 * cancels. Used for destructive actions that aren't list rows (e.g. Log Out),
 * replacing a confirmation dialog.
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
  const { progress, handlers } = useHoldToConfirm({ duration, onConfirm, disabled })
  const fillOpacity = useTransform(progress, [0, 0.001, 1], [0, 1, 1])

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      {...handlers}
      style={{ touchAction: "none" }}
      className={cn(
        "relative inline-flex h-10 select-none items-center justify-center gap-2 overflow-hidden",
        "rounded-md border border-destructive/40 bg-secondary px-4 text-sm font-medium text-foreground",
        "transition-colors disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {/* Red fill that sweeps across as the button is held. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 origin-left bg-destructive"
        style={{ scaleX: progress, opacity: fillOpacity }}
      />
      <span className="relative z-[1] inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
    </button>
  )
}
