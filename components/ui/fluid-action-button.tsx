"use client"

import type React from "react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Check, Loader2, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Fluid action button — a gooey two-stage confirm control.
 *
 * Recreated from the Framer "Fluid Actions Button": an idle pill (here showing
 * the app's trash icon) that, when tapped, arms to red and a circular confirm
 * button **emerges with a liquid/gooey merge** (SVG filter: blur → alpha
 * threshold → composite the sharp source atop). Tapping the circle runs the
 * destructive action; tapping the pill again, or clicking outside, cancels.
 *
 * All `setState` lives in event/listener callbacks (never synchronously in an
 * effect body) and motion is declarative, keeping the lint baseline intact.
 */

type FluidSize = "sm" | "md"

const SIZES: Record<FluidSize, { height: number; circle: number; icon: number }> = {
  sm: { height: 32, circle: 28, icon: 16 },
  md: { height: 40, circle: 34, icon: 18 },
}

// Faithful to the source's spring-tinged ease and ~450ms morph.
const EASE = [0.4, 0, 0.2, 1.4] as const
const DURATION = 0.45

const IDLE_BG = "#1e293b" // slate-800 — reads as a button on light + dark cards
const ARMED_BG = "#ff3d3d"
const IDLE_ICON = "#f8fafc"
const ARMED_ICON = "#210000"

export function FluidActionButton({
  onConfirm,
  icon,
  confirmIcon,
  disabled = false,
  disabledTitle,
  loading = false,
  expand = "right",
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  onConfirm: () => void
  icon?: React.ReactNode
  confirmIcon?: React.ReactNode
  disabled?: boolean
  disabledTitle?: string
  loading?: boolean
  expand?: "left" | "right"
  size?: FluidSize
  className?: string
  "aria-label"?: string
}) {
  const [active, setActive] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )
  const rootRef = useRef<HTMLDivElement>(null)

  const rawId = useId()
  const filterId = `fluid-goo-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`

  const { height, circle, icon: iconSize } = SIZES[size]
  const blur = Math.max(2, Math.round(height * 0.16))
  const offset = (expand === "left" ? -1 : 1) * height * 1.2

  // Track prefers-reduced-motion; only setState in the change callback.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  // Close on outside tap while armed; only setState in the listener callback.
  useEffect(() => {
    if (!active) return
    const onDown = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setActive(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("touchstart", onDown)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("touchstart", onDown)
    }
  }, [active])

  const handleMainClick = useCallback(() => {
    if (disabled || loading) return
    setActive((v) => !v)
  }, [disabled, loading])

  const handleConfirmClick = useCallback(() => {
    if (loading) return
    onConfirm()
  }, [loading, onConfirm])

  const motionDuration = reducedMotion ? 0 : DURATION

  return (
    <div
      ref={rootRef}
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ height, width: height }}
    >
      {/* Gooey filter — generous region so the emerging circle isn't clipped. */}
      <svg aria-hidden className="absolute" style={{ width: 0, height: 0 }}>
        <defs>
          <filter id={filterId} x="-150%" y="-50%" width="400%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div
        className="relative"
        style={{
          height,
          width: height,
          filter: reducedMotion ? undefined : `url(#${filterId})`,
        }}
      >
        {/* Confirm circle — starts merged under the pill, slides out when armed. */}
        <motion.button
          type="button"
          aria-label="Confirm"
          aria-hidden={!active}
          tabIndex={active ? 0 : -1}
          onClick={handleConfirmClick}
          className="absolute left-1/2 top-1/2 flex items-center justify-center rounded-full"
          style={{
            width: circle,
            height: circle,
            marginLeft: -circle / 2,
            marginTop: -circle / 2,
            backgroundColor: ARMED_BG,
            pointerEvents: active ? "auto" : "none",
          }}
          initial={false}
          animate={{ x: active ? offset : 0, opacity: active ? 1 : 0 }}
          transition={{ duration: motionDuration, ease: EASE }}
        >
          {loading ? (
            <Loader2 className="animate-spin" style={{ width: iconSize, height: iconSize, color: ARMED_ICON }} />
          ) : (
            <motion.span
              className="flex"
              style={{ color: ARMED_ICON }}
              animate={{ rotate: active ? 0 : -90 }}
              transition={{ duration: motionDuration, ease: EASE }}
            >
              {confirmIcon ?? <Check style={{ width: iconSize, height: iconSize }} />}
            </motion.span>
          )}
        </motion.button>

        {/* Main pill — trash icon idle, morphs to red when armed. */}
        <motion.button
          type="button"
          aria-label={ariaLabel}
          title={disabled ? disabledTitle : undefined}
          disabled={disabled}
          onClick={handleMainClick}
          className="absolute inset-0 z-10 flex items-center justify-center rounded-full disabled:cursor-not-allowed"
          style={{ opacity: disabled ? 0.4 : 1 }}
          animate={{ backgroundColor: active ? ARMED_BG : IDLE_BG }}
          transition={{ duration: motionDuration, ease: EASE }}
        >
          <motion.span
            className="flex"
            animate={{ color: active ? ARMED_ICON : IDLE_ICON }}
            transition={{ duration: motionDuration, ease: EASE }}
          >
            {icon ?? <Trash2 style={{ width: iconSize, height: iconSize }} />}
          </motion.span>
        </motion.button>
      </div>
    </div>
  )
}
