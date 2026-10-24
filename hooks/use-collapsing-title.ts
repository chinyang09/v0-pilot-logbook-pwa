"use client"

import { useCallback, useEffect, useRef, useState, type UIEvent } from "react"
import { clearHeaderTitle, setHeaderTitle } from "@/lib/layout/header-title"

/**
 * Publishes a panel's large title to the header once it has scrolled under the
 * bar (see `lib/layout/header-title.ts`).
 *
 * - `titleRef` goes on the large title, `spacerRef` on the scroller's
 *   `h-chrome-top` spacer — the one element whose bottom edge IS the bar's
 *   lower edge at rest. Both move with the scroll, so the distance between
 *   their bottoms is how far the panel has to scroll before the title is under
 *   the bar, whatever the status bar, the install banner or the font size.
 * - That distance is measured in a ResizeObserver callback (after the
 *   browser's own layout, never mid-commit), and only re-measured when one of
 *   the two changes size.
 * - `onScroll` then costs one comparison per event, and writes to the store
 *   only when the answer flips.
 */
export function useCollapsingTitle(key: string | null, title: string | undefined) {
  const [owner] = useState(() => Symbol("header-title"))
  const titleRef = useRef<HTMLHeadingElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const thresholdRef = useRef<number | null>(null)
  const collapsedRef = useRef(false)

  const evaluate = useCallback(
    (scrollTop: number) => {
      const threshold = thresholdRef.current
      if (!key || !title || threshold == null) return
      // Collapsed once the bulk of the title is under the bar — the last few
      // pixels are the descenders, and waiting for them reads as a lag.
      const collapsed = scrollTop > threshold - 8
      if (collapsed === collapsedRef.current) return
      collapsedRef.current = collapsed
      setHeaderTitle(key, { title, collapsed, owner })
    },
    [key, title, owner]
  )

  useEffect(() => {
    if (!key || !title) return
    setHeaderTitle(key, { title, collapsed: collapsedRef.current, owner })
    return () => clearHeaderTitle(key, owner)
  }, [key, title, owner])

  useEffect(() => {
    const titleEl = titleRef.current
    const spacer = spacerRef.current
    if (!titleEl || !spacer || !key || !title) return
    const ro = new ResizeObserver(() => {
      thresholdRef.current = titleEl.getBoundingClientRect().bottom - spacer.getBoundingClientRect().bottom
      // A restored scroll position may already be past it.
      const scroller = spacer.parentElement
      if (scroller) evaluate(scroller.scrollTop)
    })
    ro.observe(titleEl)
    ro.observe(spacer)
    return () => ro.disconnect()
  }, [key, title, evaluate])

  const onScroll = useCallback((e: UIEvent<HTMLElement>) => evaluate(e.currentTarget.scrollTop), [evaluate])

  return { titleRef, spacerRef, onScroll }
}
