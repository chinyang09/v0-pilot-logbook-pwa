"use client"

import { useEffect, type RefObject } from "react"

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keyboard focus for a modal the app draws itself (the date and time wheels,
 * `RegionSheet`, the context preview, the signature pad).
 *
 * They carried `role="dialog"` and `aria-modal` but left focus where it was:
 * opening one kept it on the row BEHIND, Tab walked the page underneath, and
 * closing dropped it on `<body>` — so a keyboard or switch user lost their
 * place every time (WCAG 2.4.3). Now:
 *
 * - on open, focus moves IN — to `initial` if given (a wheel), else the first
 *   focusable, else the dialog itself — one frame after the open has painted,
 *   so the focus's own style work never lands on the animation's first frame;
 * - Tab and Shift-Tab wrap inside the dialog;
 * - on close, focus goes back to whatever opened it, if that is still there.
 *
 * Deliberately NOT `inert` on the page behind: toggling it restyles the whole
 * app subtree (the keep-alive stack is ~1,400 elements), on exactly the frame
 * the dialog opens. `aria-modal` already hides the page from assistive tech,
 * and the wrap keeps a keyboard inside — the same result, for one keydown
 * listener.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  initial?: string,
): void {
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // The box as it was mounted — by the cleanup the ref may already be null.
    const mounted = ref.current
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const box = ref.current
        if (!box || box.contains(document.activeElement)) return
        const target =
          (initial && box.querySelector<HTMLElement>(initial)) ||
          box.querySelector<HTMLElement>(FOCUSABLE) ||
          box
        if (target === box && !box.hasAttribute("tabindex")) box.tabIndex = -1
        target.focus({ preventScroll: true })
      })
    })
    const onKey = (e: KeyboardEvent) => {
      const box = ref.current
      if (e.key !== "Tab" || !box) return
      // Read on the keypress, not kept: the dialog's contents change while it
      // is open (a field appears, a button disables).
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const at = document.activeElement
      // Focus in a layer of its own (an option menu the dialog opened, which
      // is portalled above it) is that layer's to move — leave it alone.
      if (at && at !== document.body && !box.contains(at)) return
      if (e.shiftKey && (at === first || !box.contains(at))) {
        e.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!e.shiftKey && (at === last || !box.contains(at))) {
        e.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("keydown", onKey, true)
      const at = document.activeElement
      const lost = !at || at === document.body || (mounted?.contains(at) ?? true)
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open, ref, initial])
}
