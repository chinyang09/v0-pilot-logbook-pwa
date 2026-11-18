"use client"

import { useEffect } from "react"

/**
 * The few things the browser does that an app never does — the owner's ask
 * (Nov 2026): "remove zoom … mimic closely a native app".
 *
 * - **No page zoom.** The viewport forbids it (`app/layout.tsx`), which Chrome
 *   honours; WebKit ignores `user-scalable=no` since iOS 10, and stops a pinch
 *   only when its `gesturestart` is cancelled. A pinch the APP handles (the FDP
 *   timeline) reads pointer events, which this leaves alone.
 * - **No long-press menu on TOUCH** ("Open in new tab", "Save image") outside
 *   a text field or anything marked `data-selectable` — a press-and-hold is
 *   the app's own gesture (the flight card's preview, the nav's lens). A mouse
 *   keeps its right-click.
 *
 * Both are listeners on `document`, so nothing here renders.
 */
export function NativeFeel() {
  useEffect(() => {
    const stopGesture = (e: Event) => e.preventDefault()
    const editable = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest("input, textarea, [contenteditable='true'], [data-selectable]")
    const coarse = window.matchMedia("(pointer: coarse)")
    const stopMenu = (e: MouseEvent) => {
      const touch = "pointerType" in e ? (e as PointerEvent).pointerType === "touch" : coarse.matches
      if (touch && !editable(e.target)) e.preventDefault()
    }
    document.addEventListener("gesturestart", stopGesture, { passive: false })
    document.addEventListener("gesturechange", stopGesture, { passive: false })
    document.addEventListener("contextmenu", stopMenu)
    return () => {
      document.removeEventListener("gesturestart", stopGesture)
      document.removeEventListener("gesturechange", stopGesture)
      document.removeEventListener("contextmenu", stopMenu)
    }
  }, [])
  return null
}
