/**
 * Scroll a dynamically-measured virtual list to an index and STAY there —
 * clear of the floating header.
 *
 * Two things were wrong with a bare `scrollToIndex`:
 *
 * 1. It computes the offset from what the virtualizer currently believes each
 *    row measures. On a list with `measureElement` most rows have never been
 *    measured, so the offset is built from `estimateSize` and lands short —
 *    the further down the list, the further off. Re-issuing the scroll once
 *    the arriving rows HAVE been measured converges in a couple of frames.
 *    Bounded, because on a list whose rows genuinely differ every pass shifts
 *    the target slightly and it would otherwise never settle.
 *
 * 2. `align: "start"` means the top of the SCROLLER, and content scrolls UNDER
 *    the action buttons in this app — so the row you asked for was parked
 *    behind them. Backing off by `--chrome-top` puts it where a reader would
 *    say the top of the list is.
 *
 * The logbook needs neither: its rows are a fixed height, it deliberately does
 * not measure, and it reserves the chrome with an in-flow spacer.
 */
interface ScrollableVirtualizer {
  scrollToIndex: (
    index: number,
    options?: { align?: "start" | "center" | "end" | "auto"; behavior?: "auto" | "smooth" }
  ) => void
  scrollToOffset: (
    offset: number,
    options?: { align?: "start" | "center" | "end" | "auto"; behavior?: "auto" | "smooth" }
  ) => void
  getOffsetForIndex: (
    index: number,
    align?: "start" | "center" | "end" | "auto"
  ) => readonly [number, string] | undefined
  scrollOffset: number | null
  scrollElement: HTMLElement | Window | null
}

/** The floating header's height in px, read from the one CSS definition. */
function chromeTopPx(): number {
  if (typeof window === "undefined") return 0
  const probe = document.createElement("div")
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--chrome-top)"
  document.body.appendChild(probe)
  const h = probe.offsetHeight
  probe.remove()
  return h
}

export function scrollToIndexSettled(
  virtualizer: ScrollableVirtualizer,
  index: number,
  align: "start" | "center" | "end" = "start",
  passes = 6
): void {
  const el = virtualizer.scrollElement
  const inset = align === "start" ? chromeTopPx() : 0

  // The inset is applied LAST, on its own frame. `scrollToIndex` finishes
  // asynchronously — the virtualizer corrects the offset again once the rows
  // it scrolled to have measured — so subtracting in the same tick just got
  // overwritten by that correction.
  // Asked of the VIRTUALIZER rather than written onto the element: it owns the
  // scroll position and will correct it again on the next measurement pass, so
  // a raw `scrollTop -=` was simply undone a frame later.
  const insetOnce = () => {
    if (!inset) return
    requestAnimationFrame(() => {
      const at = virtualizer.getOffsetForIndex(index, "start")
      if (!at) return
      virtualizer.scrollToOffset(Math.max(0, at[0] - inset), { align: "start", behavior: "auto" })
    })
  }

  // Convergence is measured on the ELEMENT's scrollTop, not on
  // `virtualizer.scrollOffset`: that one is written by the scroll listener, so
  // reading it in the same tick as `scrollToIndex` always reports "unchanged"
  // and the loop gave up after a single pass — which is why the rail still
  // overshot by about a section.
  const offset = () => (el instanceof HTMLElement ? el.scrollTop : (virtualizer.scrollOffset ?? 0))

  virtualizer.scrollToIndex(index, { align, behavior: "auto" })
  let left = passes
  const again = () => {
    if (left-- <= 0) return insetOnce()
    const before = offset()
    virtualizer.scrollToIndex(index, { align, behavior: "auto" })
    // Settled — the measurements the last pass produced didn't move it.
    if (Math.abs(offset() - before) < 1) return insetOnce()
    requestAnimationFrame(again)
  }
  requestAnimationFrame(again)
}
