"use client"

import { useCallback, useLayoutEffect, useRef } from "react"

/**
 * A spacer that PUSHES the content below it, animated on the compositor.
 *
 * Animating the spacer's `height` is a layout of everything after it and a
 * repaint of the scroller's contents on EVERY frame — measured on the logbook
 * at 4× CPU, the list being pushed was half of the calendar's paint and raster.
 * So the spacer takes its new height in ONE layout, and the content after it
 * starts where it visually was — `translateY(old − new)` — and slides home on
 * a transform (FLIP). The same movement, with one layout instead of one per
 * frame, and the rows never repainted.
 *
 * The delta is read in a ResizeObserver callback, which runs after the
 * browser's own layout and before paint, so the inverted first frame is the
 * one painted (no flash, and no forced layout in React's commit). An
 * interrupted push resumes from where the content is on screen.
 *
 * `animate` is the answer for the commit that resized the spacer: false for a
 * change that must not read as a push (the calendar changing shape while
 * open, which the page absorbs with one scrollTop write instead).
 *
 * Returns two callback refs — the spacer, and the content it pushes. They are
 * callback refs (React 19 runs the returned cleanup) because the list mounts
 * its spacer only once it has rows: an effect keyed on a ref object would
 * have run against the loading skeleton and never observed the real one.
 */
export function useFlipPush(animate: boolean, durationMs: number, easing: string) {
  const animateRef = useRef(animate)
  // Before the browser's layout, so the observer reads this commit's answer —
  // and outside render, where a ref write is a side effect.
  useLayoutEffect(() => {
    animateRef.current = animate
  })
  const contentRef = useRef<HTMLElement | null>(null)

  const spacerRef = useCallback(
    (spacer: HTMLElement | null) => {
      if (!spacer) return
      let last = -1
      let running: Animation | null = null
      const observer = new ResizeObserver((entries) => {
        const h = entries[entries.length - 1].contentRect.height
        const prev = last
        last = h
        const content = contentRef.current
        if (prev < 0 || prev === h || !content || !animateRef.current) {
          running?.cancel()
          running = null
          return
        }
        // Where the content is NOW on screen relative to its new place: the
        // height the spacer gained or lost, plus whatever an interrupted push
        // still had to travel.
        let carried = 0
        if (running) {
          const m = getComputedStyle(content).transform
          if (m && m !== "none") carried = new DOMMatrixReadOnly(m).m42
          running.cancel()
        }
        const mine = content.animate(
          [{ transform: `translateY(${prev - h + carried}px)` }, { transform: "translateY(0)" }],
          { duration: durationMs, easing },
        )
        running = mine
        mine.onfinish = () => {
          if (running === mine) running = null
        }
      })
      observer.observe(spacer)
      return () => {
        observer.disconnect()
        running?.cancel()
      }
    },
    [durationMs, easing],
  )

  const pushedRef = useCallback((el: HTMLElement | null) => {
    contentRef.current = el
  }, [])

  return { spacerRef, pushedRef }
}
