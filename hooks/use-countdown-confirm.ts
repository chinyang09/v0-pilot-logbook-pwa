"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useMotionValue, type MotionValue } from "framer-motion"

/**
 * Countdown-to-confirm primitive: the action is already happening, and the
 * user's job is to stop it.
 *
 * This replaced press-and-hold. Holding put the effort on the person who wants
 * the outcome and gave the person who didn't nothing to grab — a mis-tap that
 * became a 2.5-second press still deleted the row. A countdown inverts that:
 * the destructive path needs no further input, and cancelling is a single tap
 * available for the whole window.
 *
 * `progress` ramps 0 → 1 over `duration` as a framer-motion `MotionValue`, so
 * fills and borders animate without a re-render per frame. `remaining` is the
 * whole seconds left and DOES re-render — once a second, which is the point.
 *
 * Every `setState` happens in a rAF or timer callback rather than synchronously
 * in an effect body, keeping the react-compiler lint baseline intact.
 */
export function useCountdownConfirm({
  duration = 10_000,
  onConfirm,
  autoStart = true,
  progress: externalProgress,
}: {
  duration?: number
  onConfirm: () => void
  /** Begin the moment the control mounts (the usual case). */
  autoStart?: boolean
  progress?: MotionValue<number>
}): {
  progress: MotionValue<number>
  /** Whole seconds left, for the label. */
  remaining: number
  running: boolean
  start: () => void
  cancel: () => void
} {
  const internalProgress = useMotionValue(0)
  const progress = externalProgress ?? internalProgress

  const [remaining, setRemaining] = useState(Math.ceil(duration / 1000))
  const [running, setRunning] = useState(false)
  const rafRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)

  // Keep the latest callback without re-creating start/cancel.
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
    stopRaf()
    startedAtRef.current = performance.now()
    setRunning(true)
    setRemaining(Math.ceil(duration / 1000))
    if (typeof navigator !== "undefined") navigator.vibrate?.(10)

    // Self-referential rAF closure so the loop stays lint-clean.
    const loop = () => {
      const elapsed = performance.now() - startedAtRef.current
      const p = Math.min(1, elapsed / duration)
      progress.set(p)
      setRemaining(Math.max(0, Math.ceil((duration - elapsed) / 1000)))
      if (p >= 1) {
        rafRef.current = null
        setRunning(false)
        if (typeof navigator !== "undefined") navigator.vibrate?.(30)
        onConfirmRef.current()
        return
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [duration, progress, stopRaf])

  const cancel = useCallback(() => {
    stopRaf()
    setRunning(false)
    setRemaining(Math.ceil(duration / 1000))
    progress.set(0)
    if (typeof navigator !== "undefined") navigator.vibrate?.(10)
  }, [duration, progress, stopRaf])

  // Kick off on mount when asked, and always cancel any in-flight frame.
  // The start is deferred into a frame callback rather than run in the effect
  // body: `start` sets state, and doing that synchronously in an effect is the
  // cascading-render pattern the compiler rules flag.
  useEffect(() => {
    if (!autoStart) return stopRaf
    const id = requestAnimationFrame(() => start())
    return () => {
      cancelAnimationFrame(id)
      stopRaf()
    }
    // `start` is stable for a given duration; depending on it would restart
    // the countdown on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  return { progress, remaining, running, start, cancel }
}
