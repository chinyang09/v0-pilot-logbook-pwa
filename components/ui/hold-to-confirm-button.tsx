"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { motion, useTransform } from "framer-motion"
import { cn } from "@/lib/utils"
import { useHoldToConfirm } from "@/hooks/use-hold-to-confirm"

/**
 * Press-and-hold-to-confirm button. While held, an SVG border draws *around* the
 * button (radial progress) and thickens, with a growing glow — the
 * motion.dev "hold to confirm" pattern. The label/icon stay fully visible (no
 * fill overlay). Releasing early cancels (and calls {@link onCancel}, used when
 * the button is a dismissable overlay); a full hold fires {@link onConfirm}.
 *
 * The border is an SVG `<rect>` whose `pathLength` is normalised to 100, so a
 * `strokeDashoffset` driven by the hold progress reveals the stroke from 0 → the
 * full perimeter regardless of the button's real size. Size is measured with a
 * ResizeObserver (setState only in the RO callback, never in the effect body).
 */
export function HoldToConfirmButton({
  label,
  onConfirm,
  onCancel,
  icon,
  disabled = false,
  duration,
  className,
  ariaLabel,
  radius = 12,
}: {
  label?: string
  onConfirm: () => void
  /** Called on release before the hold completes (e.g. dismiss an overlay). */
  onCancel?: () => void
  icon?: React.ReactNode
  disabled?: boolean
  duration?: number
  className?: string
  ariaLabel?: string
  /** Corner radius of the animated border (px) — match the surface. */
  radius?: number
}) {
  const confirmedRef = useRef(false)
  const { progress, isCharging, handlers } = useHoldToConfirm({
    duration,
    disabled,
    onConfirm: () => {
      confirmedRef.current = true
      onConfirm()
    },
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

  const inset = 2
  const w = Math.max(0, size.w - inset * 2)
  const h = Math.max(0, size.h - inset * 2)

  // pathLength is normalised to 100; offset 100 → 0 reveals the stroke fully.
  const dashOffset = useTransform(progress, [0, 1], [100, 0])
  const strokeWidth = useTransform(progress, [0, 1], [1.5, 4])
  const filter = useTransform(progress, (p) => `drop-shadow(0 0 ${5 * p}px var(--destructive))`)

  // On release, run the hook's reset, then dismiss if we didn't confirm.
  const release = (e: React.PointerEvent, fn: (e: React.PointerEvent) => void) => {
    fn(e)
    if (!confirmedRef.current) onCancel?.()
    confirmedRef.current = false
  }

  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      onPointerDown={handlers.onPointerDown}
      onPointerUp={(e) => release(e, handlers.onPointerUp)}
      onPointerLeave={(e) => release(e, handlers.onPointerLeave)}
      onPointerCancel={(e) => release(e, handlers.onPointerCancel)}
      style={{ touchAction: "none" }}
      animate={{ scale: isCharging ? 0.98 : 1 }}
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
