"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Virtualizer } from "@tanstack/react-virtual"

/**
 * ONE row height for a virtualised list whose rows are all the same height,
 * calibrated from the first row that lays out — and after that, nothing is
 * measured at all.
 *
 * Measuring every row (`ref={virtualizer.measureElement}`) is what the
 * logbook stopped doing, for two reasons that hit every list built the same
 * way:
 *
 * - When a measured row differs from `estimateSize`, the virtualizer keeps the
 *   view still by programmatically scrolling by the difference, and a
 *   programmatic scroll CANCELS a momentum scroll on touch — so a fling dies
 *   row by row through rows that have never been on screen.
 * - Each new size invalidates the measurement cache and rebuilds it for EVERY
 *   row. On the airports list (~29k rows) a four-flick fling spent ~370ms of
 *   main thread at a 4× throttle in the virtualizer alone.
 *
 * One measurement is exact when every row is one height by construction (two
 * truncated lines, reserved optional lines), and with nothing measured the
 * virtualizer can never discover a size it did not expect. It is strictly
 * one-shot: feeding every row back in is a setState in a ref callback, and two
 * rows disagreeing by a subpixel ping-pong it until React gives up.
 *
 * Read from a ResizeObserver, never in the ref callback — a ref callback runs
 * mid-commit, so a rect read there forces a layout of the whole app.
 */
export function useCalibratedRowHeight(guess: number) {
  const [rowHeight, setRowHeight] = useState(0) // 0 = not calibrated yet
  const rowHeightRef = useRef(guess) // the opening guess, for the first paint only
  const calibratedRef = useRef(false)
  const observerRef = useRef<ResizeObserver | null>(null)

  const measureRow = useCallback((el: HTMLElement | null) => {
    if (!el || calibratedRef.current || observerRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      // Exact, not rounded: a 105.5px card rounded to 106 put an extra half
      // pixel between every pair of cards. There is only ever one value.
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      if (h <= 0) return
      observer.disconnect()
      observerRef.current = null
      calibratedRef.current = true
      rowHeightRef.current = h
      setRowHeight(h)
    })
    observerRef.current = observer
    observer.observe(el)
    // The row unmounted before it laid out: let the next one calibrate.
    return () => {
      if (observerRef.current !== observer) return
      observer.disconnect()
      observerRef.current = null
    }
  }, [])

  const estimateSize = useCallback(() => rowHeightRef.current, [])

  return { rowHeight, measureRow, estimateSize }
}

/**
 * Rebuild every row's position once the height is known. `estimateSize` reads
 * a ref, which the virtualizer does not watch — this is what tells it to look
 * again.
 */
export function useRemeasureOnCalibration(
  rowHeight: number,
  virtualizer: Pick<Virtualizer<HTMLElement, Element>, "measure">
) {
  useEffect(() => {
    if (rowHeight > 0) virtualizer.measure()
  }, [rowHeight, virtualizer])
}
