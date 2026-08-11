"use client"

import { useCallback, useEffect, useRef } from "react"

/**
 * Make the SYSTEM BACK gesture close an overlay instead of leaving the app.
 *
 * On Android the edge-swipe is a history `back()`, and an overlay that only
 * listens for Escape is invisible to it: the router navigates to the previous
 * page and the overlay — portalled to `document.body`, so nothing unmounts it —
 * is left floating over a screen it has nothing to do with. That is what
 * happened to the flight card's context preview.
 *
 * The fix is a MARKER history entry, pushed at the same URL when the overlay
 * opens. It changes nothing about the route (Next's router integrates with
 * `pushState`, and the URL is the one already showing) — it exists only to give
 * the back gesture something of ours to consume.
 *
 * ── Every dismissal goes through `back()`, and that is the load-bearing part ──
 *
 * The obvious shape — "close the overlay, then pop our entry on the way out" —
 * has a race that bites exactly where it hurts most. Several of these overlays
 * dismiss by DOING something, and the something is usually a navigation: the
 * preview's Next Leg creates a flight and opens it, which is a `router.push`.
 * Pop-on-unmount would issue that push while our own `back()` was still queued,
 * and the back would then undo it — the user taps Next Leg and lands on the
 * logbook with the new flight closed.
 *
 * So `dismiss()` does not close anything directly. It calls `history.back()`,
 * and the `popstate` that follows is the single place the overlay closes and
 * any follow-up action runs. By then the entry is provably gone, so a
 * `router.push` from that action is building on a clean stack. The back gesture
 * lands in the same handler, so the two paths cannot drift.
 *
 * @param active   Whether the overlay is up. Pushing happens on the false→true
 *                 edge; the entry is released when it goes false or unmounts.
 * @param onDismiss Runs once the marker has been consumed. Start the close
 *                 animation here — it does NOT need to unmount synchronously.
 * @returns `dismiss(after?)` — call it from every other close path (scrim tap,
 *          Escape, an action button). `after` runs immediately after
 *          `onDismiss`, with the history entry already released.
 */
export function useBackDismiss(active: boolean, onDismiss: () => void) {
  // Written in an effect, not during render — the ref is only ever read from a
  // popstate handler or an event, both of which run after the commit.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  /** True while OUR marker entry is on the stack and not yet consumed. */
  const ownsEntryRef = useRef(false)
  /** Queued by `dismiss(after)`, run by the popstate handler. */
  const afterRef = useRef<(() => void) | null>(null)
  /**
   * Set the moment a dismissal starts, cleared never — the overlay is going.
   *
   * `history.back()` does not take effect synchronously; the `popstate` that
   * releases the entry arrives in a later task. So a caller that fires in
   * BURSTS would call `back()` several times before the first one landed and
   * walk the user back through unrelated history — and one does: the cascade
   * dismisses on `scroll`/`wheel`/`touchmove`.
   */
  const dismissingRef = useRef(false)
  /**
   * The URL the marker was pushed at.
   *
   * `back()` only takes the marker back while the marker is the TOP of the
   * stack. If something navigated in the meantime — the sidebar's
   * close-on-`pathname` effect is exactly this shape: a route change closes it,
   * which tears this down — the marker is buried one entry below the new page,
   * and `back()` would undo the navigation instead of releasing anything. So a
   * release only fires while we are still where we pushed. A buried marker is
   * left alone; it is a duplicate entry for a page the user was already on, so
   * passing back through it looks like nothing happened rather than like the
   * app refusing to navigate.
   */
  const hrefRef = useRef("")

  useEffect(() => {
    if (!active) return

    // Reset on the OPEN edge, not on close. A dialog wrapper stays mounted
    // across open/close cycles — its `active` merely goes false — so a
    // dismissal flag left set would make the SECOND open undismissable.
    dismissingRef.current = false
    afterRef.current = null

    // Same URL, so there is nothing to navigate to — `history.state` carries a
    // flag purely so this entry is identifiable in a debugger.
    window.history.pushState(
      { ...window.history.state, __overlay: true },
      "",
      window.location.href,
    )
    ownsEntryRef.current = true
    hrefRef.current = window.location.href

    const onPop = () => {
      // Our entry is gone — either the user swiped back or `dismiss()` popped
      // it. Both mean the same thing from here.
      ownsEntryRef.current = false
      const after = afterRef.current
      afterRef.current = null
      onDismissRef.current()
      after?.()
    }
    window.addEventListener("popstate", onPop)

    return () => {
      window.removeEventListener("popstate", onPop)
      // Torn down without going through `dismiss` (a parent dropped the
      // overlay outright). Take the marker back so it can't swallow the user's
      // next back press — but only while it is still the top of the stack, or
      // the `back()` undoes whatever navigated. See hrefRef.
      if (ownsEntryRef.current) {
        ownsEntryRef.current = false
        if (window.location.href === hrefRef.current) window.history.back()
      }
    }
  }, [active])

  return useCallback((after?: () => void) => {
    if (dismissingRef.current) return
    dismissingRef.current = true
    if (ownsEntryRef.current && window.location.href === hrefRef.current) {
      // Do NOT close here. `onPop` is the one place that closes, so the entry
      // is always released before anything downstream navigates.
      afterRef.current = after ?? null
      window.history.back()
      return
    }
    // No marker of ours on top — either it was never pushed or something
    // navigated past it. Close directly; popping here would navigate.
    ownsEntryRef.current = false
    onDismissRef.current()
    after?.()
  }, [])
}
