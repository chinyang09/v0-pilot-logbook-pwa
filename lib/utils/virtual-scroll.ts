/**
 * Scroll a dynamically-measured virtual list so a given row sits at the top of
 * the visible area — below the floating header, not behind it.
 *
 * Two earlier attempts at this were both indirect, and both were unreliable
 * for the same underlying reason: on a list with `measureElement`, most rows
 * have never been measured, so every offset the virtualizer can compute is
 * built from `estimateSize` and is wrong by however much the estimate is off,
 * multiplied by the number of unmeasured rows in between. Asking it to scroll
 * again (`scrollToIndex` in a loop) only converges if its numbers improve, and
 * asking it where the row is (`getOffsetForIndex`) returns the same estimate.
 *
 * So this does not ask. It scrolls roughly into place, then MEASURES the row in
 * the DOM and corrects by the difference — which is exact the moment the row is
 * rendered, regardless of what the virtualizer believes. A few frames of that
 * converge on the real position even when the estimate was far out, because
 * each correction brings the true row into the viewport where it can be
 * measured.
 *
 * The logbook needs none of this: its rows are a fixed height, it deliberately
 * does not measure, and it reserves the chrome with an in-flow spacer.
 */
interface ScrollableVirtualizer {
  scrollToIndex: (
    index: number,
    options?: { align?: "start" | "center" | "end" | "auto"; behavior?: "auto" | "smooth" }
  ) => void
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

/** How close is close enough to stop correcting. */
const TOLERANCE_PX = 1
const MAX_FRAMES = 12

export function scrollToIndexSettled(
  virtualizer: ScrollableVirtualizer,
  index: number,
  align: "start" | "center" | "end" = "start"
): void {
  const el = virtualizer.scrollElement
  if (!(el instanceof HTMLElement)) {
    virtualizer.scrollToIndex(index, { align, behavior: "auto" })
    return
  }
  const inset = align === "start" ? chromeTopPx() : 0

  // The rough move: gets the target row rendered so it can be measured.
  virtualizer.scrollToIndex(index, { align, behavior: "auto" })

  let frames = MAX_FRAMES
  const correct = () => {
    if (frames-- <= 0) return
    // `data-index` is on every row already — the virtualizer's own
    // `measureElement` keys off it.
    const row = el.querySelector<HTMLElement>(`[data-index="${index}"]`)
    if (!row) {
      // Not rendered yet (or the rough move landed far away): nudge the
      // virtualizer again and look on the next frame.
      virtualizer.scrollToIndex(index, { align, behavior: "auto" })
      requestAnimationFrame(correct)
      return
    }
    const delta = row.getBoundingClientRect().top - (el.getBoundingClientRect().top + inset)
    if (Math.abs(delta) <= TOLERANCE_PX) return
    el.scrollTop += delta
    requestAnimationFrame(correct)
  }
  requestAnimationFrame(correct)
}

/** Scroll a list back to the very top (the pinned favourites/recent block). */
export function scrollToTop(virtualizer: ScrollableVirtualizer): void {
  const el = virtualizer.scrollElement
  if (el instanceof HTMLElement) el.scrollTo({ top: 0, behavior: "auto" })
}
