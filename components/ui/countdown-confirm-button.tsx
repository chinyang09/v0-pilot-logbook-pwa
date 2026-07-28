"use client"

import type React from "react"
import { motion, useTransform, type MotionValue } from "framer-motion"
import { cn } from "@/lib/utils"
import { useCountdownConfirm } from "@/hooks/use-countdown-confirm"
import { HoldProgressBorder } from "@/components/ui/hold-progress-border"

/**
 * Countdown-to-confirm button: the destructive action is already underway and
 * this button stops it.
 *
 * Replaces press-and-hold. The visual language is inherited — a red gradient
 * sweeping the fill left→right and a stroke drawing from 12 o'clock — but the
 * meaning is inverted: the sweep is time running out rather than effort being
 * applied, and the tap cancels rather than commits. The label carries the
 * seconds left so the deadline is never a guess.
 *
 * Pass an external `progress` MotionValue to mirror the countdown on a
 * surrounding surface (the card border), and `showBorder={false}` when that
 * surface owns the border.
 */
export function CountdownConfirmButton({
  label = "Cancel",
  onConfirm,
  onCancel,
  icon,
  duration = 10_000,
  className,
  ariaLabel,
  radius = 12,
  progress: externalProgress,
  showBorder = true,
  deadline,
}: {
  /** Verb for the cancel action, e.g. "Cancel delete". Seconds are appended. */
  label?: string
  /** Fired when the countdown completes untouched. */
  onConfirm: () => void
  /** Fired when the user taps to stop it. */
  onCancel: () => void
  icon?: React.ReactNode
  duration?: number
  className?: string
  ariaLabel?: string
  /** Corner radius of the animated border (px) — match the surface. Large = pill. */
  radius?: number
  progress?: MotionValue<number>
  showBorder?: boolean
  /**
   * Epoch ms the action fires at, when the timer is owned elsewhere so it can
   * outlive this component (an armed row delete). Without it the button times
   * itself.
   */
  deadline?: number
}) {
  const { progress, remaining, cancel } = useCountdownConfirm({
    duration,
    onConfirm,
    progress: externalProgress,
    deadline,
  })

  // The fill tracks the countdown linearly — it is a clock, so a soft eased
  // sweep would misreport how much time is actually left.
  const fillMask = useTransform(progress, (p) => {
    const pct = p * 100
    const soft = Math.max(0, pct - 12)
    return `linear-gradient(to right, #000 ${soft}%, transparent ${pct}%)`
  })
  const fillOpacity = useTransform(progress, [0, 1], [0.55, 1])

  return (
    <motion.button
      type="button"
      aria-label={ariaLabel ?? `${label}, ${remaining} seconds remaining`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        cancel()
        onCancel()
      }}
      style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
      className={cn(
        "relative inline-flex h-11 select-none items-center justify-center gap-2 isolate",
        "rounded-xl border border-border bg-secondary px-4 text-sm font-medium text-foreground",
        className,
      )}
    >
      {/* Red gradient fill, sweeping left → right as the time runs out */}
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
        <span className="tabular-nums opacity-80">{remaining}</span>
      </span>
    </motion.button>
  )
}
