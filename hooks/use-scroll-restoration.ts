"use client"

import { useCallback, useEffect, useRef, type RefCallback, type UIEvent } from "react"

const PREFIX = "scroll-pos:"

/**
 * Remembers a scroll container's position per key (typically the route pathname)
 * and restores it when the element re-mounts — so returning to a page lands you
 * back where you left off, without keeping the page mounted.
 *
 * Backed by sessionStorage, so positions reset when the PWA/tab is closed.
 *
 * Returns a `ref` to attach to the scroll element and an `onScroll` handler to
 * wire onto it. Both compose cleanly with a page's existing ref/onScroll.
 *
 * Restoration uses a double requestAnimationFrame (matching the proven pattern in
 * flight-form.tsx): the first waits for React's commit, the second for the browser
 * paint, so the content has laid out before we set scrollTop.
 *
 * @param key Stable key for this scroll context, or null to disable.
 */
export function useScrollRestoration(key: string | null) {
  const elRef = useRef<HTMLElement | null>(null)
  const latestTopRef = useRef(0)
  const rafPendingRef = useRef(false)
  const storageKey = key ? PREFIX + key : null

  // Restore on mount (and whenever the key changes).
  useEffect(() => {
    if (!storageKey) return

    const saved = sessionStorage.getItem(storageKey)
    const top = saved === null ? 0 : Number(saved)
    latestTopRef.current = Number.isFinite(top) ? top : 0

    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (elRef.current && latestTopRef.current > 0) {
          elRef.current.scrollTop = latestTopRef.current
        }
      })
    })

    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      // Flush the latest position on unmount so navigating away always saves.
      try {
        sessionStorage.setItem(storageKey, String(latestTopRef.current))
      } catch {
        // Ignore storage errors
      }
    }
  }, [storageKey])

  const ref = useCallback<RefCallback<HTMLElement>>((node) => {
    elRef.current = node
  }, [])

  const onScroll = useCallback(
    (e: UIEvent<HTMLElement>) => {
      if (!storageKey) return
      latestTopRef.current = e.currentTarget.scrollTop
      // Throttle writes to at most once per frame to avoid scroll jank.
      if (rafPendingRef.current) return
      rafPendingRef.current = true
      requestAnimationFrame(() => {
        rafPendingRef.current = false
        try {
          sessionStorage.setItem(storageKey, String(latestTopRef.current))
        } catch {
          // Ignore storage errors
        }
      })
    },
    [storageKey]
  )

  return { ref, onScroll }
}
