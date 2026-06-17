"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { animate, useMotionValue, type MotionValue } from "framer-motion"

export interface HoldHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerLeave: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
}

/**
 * Press-and-hold-to-confirm primitive.
 *
 * While the pointer is held down, `progress` ramps 0 → 1 over `duration` (ms).
 * Reaching 1 fires `onConfirm` once. Releasing early animates `progress` back to
 * 0 so the next hold starts from scratch ("release cancels, re-hold to charge").
 *
 * `progress` is a framer-motion `MotionValue` so a consumer can drive a red fill
 * (e.g. `scaleX`) without per-frame React re-renders. An external `progress` MV
 * can be supplied so a parent can render the fill over a larger surface (the
 * whole swipe row) while the button owns the gesture.
 *
 * All `setState` happens inside pointer / rAF callbacks (never synchronously in
 * an effect body), keeping the lint baseline intact.
 */
export function useHoldToConfirm({
  duration = 700,
  onConfirm,
  disabled = false,
  progress: externalProgress,
}: {
  duration?: number
  onConfirm: () => void
  disabled?: boolean
  progress?: MotionValue<number>
}): {
  progress: MotionValue<number>
  isCharging: boolean
  handlers: HoldHandlers
  reset: () => void
} {
  const internalProgress = useMotionValue(0)
  const progress = externalProgress ?? internalProgress

  const [isCharging, setIsCharging] = useState(false)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef(0)

  // Keep the latest onConfirm without re-creating the gesture handlers.
  const onConfirmRef = useRef(onConfirm)
  useEffect(() => {
    onConfirmRef.current = onConfirm
  })

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    if (disabled) return
    stopRaf()
    startRef.current = performance.now()
    setIsCharging(true)
    if (typeof navigator !== "undefined") navigator.vibrate?.(10)
    // Local self-referential rAF loop (a plain closure, so it stays lint-clean).
    const loop = () => {
      const p = Math.min(1, (performance.now() - startRef.current) / duration)
      progress.set(p)
      if (p >= 1) {
        rafRef.current = null
        setIsCharging(false)
        if (typeof navigator !== "undefined") navigator.vibrate?.(30)
        progress.set(0)
        onConfirmRef.current()
        return
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [disabled, duration, progress, stopRaf])

  const reset = useCallback(() => {
    stopRaf()
    setIsCharging(false)
    animate(progress, 0, { type: "spring", stiffness: 500, damping: 40 })
  }, [progress, stopRaf])

  // Cancel any in-flight rAF on unmount.
  useEffect(() => stopRaf, [stopRaf])

  const handlers: HoldHandlers = {
    onPointerDown: (e) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      start()
    },
    onPointerUp: () => reset(),
    onPointerLeave: () => reset(),
    onPointerCancel: () => reset(),
  }

  return { progress, isCharging, handlers, reset }
}
