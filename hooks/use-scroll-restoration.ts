"use client"

import { useCallback, useRef, type RefCallback, type UIEvent } from "react"

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
 * Restoration happens inside the ref callback, which React invokes during the
 * commit — AFTER the element's children (page content, rendered synchronously
 * from the SWR/Dexie cache) are in the DOM but BEFORE the browser paints. Setting
 * scrollTop there is invisible, so there is no flash at the top before jumping to
 * the saved offset. (The ref callback also never runs during SSR.)
 *
 * @param key Stable key for this scroll context, or null to disable.
 */
export function useScrollRestoration(key: string | null) {
  const elRef = useRef<HTMLElement | null>(null)
  const latestTopRef = useRef(0)
  const rafPendingRef = useRef(false)
  const didRestoreRef = useRef(false)
  const storageKey = key ? PREFIX + key : null

  const ref = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      if (node) {
        elRef.current = node
        // Restore once, synchronously, before the first paint of this mount.
        if (storageKey && !didRestoreRef.current) {
          didRestoreRef.current = true
          const saved = sessionStorage.getItem(storageKey)
          const top = saved === null ? 0 : Number(saved)
          latestTopRef.current = Number.isFinite(top) ? top : 0
          if (latestTopRef.current > 0) {
            node.scrollTop = latestTopRef.current
          }
        }
      } else {
        // Unmount: persist the final position so navigating away always saves.
        if (storageKey) {
          try {
            sessionStorage.setItem(storageKey, String(latestTopRef.current))
          } catch {
            // Ignore storage errors
          }
        }
        elRef.current = null
      }
    },
    [storageKey]
  )

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
