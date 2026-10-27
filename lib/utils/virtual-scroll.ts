import { elementScroll, type Virtualizer } from "@tanstack/react-virtual"

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

/**
 * How far down the scroller content is CLEAR of the header treatment, in px,
 * read from the one CSS definition. Not just the bar: a row parked at the
 * bar's edge sits in the blur's tail and reads as reachable when it is not.
 */
function chromeClearPx(): number {
  if (typeof window === "undefined") return 0
  const probe = document.createElement("div")
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--chrome-clear)"
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
  const inset = align === "start" ? chromeClearPx() : 0

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

type RectInstance = { scrollElement: Element | Window | null }

const attached = new WeakSet<object>()

/**
 * `scrollToFn` for a list whose virtualizer is created in the SAME component
 * as its scroller (so the scroller is always new when the virtualizer attaches).
 *
 * On attach, TanStack scrolls the element to its remembered offset — 0 for a
 * new list, which a new scroller is already at. `scrollTo` forces a layout,
 * and attaching happens in the layout phase of the commit that mounts the
 * page: 98ms at 4× on the first visit to Airports, to move nothing. The first
 * call per instance is skipped when it targets 0; every later one (and a
 * re-attach to another element, which restores a real offset) goes through.
 * Not for a list on a scroller it does not own — the roster agenda's is the
 * page's, which may already be scrolled.
 */
export function scrollAfterAttach<T extends Element>(
  offset: number,
  options: Parameters<typeof elementScroll>[1],
  instance: Virtualizer<T, Element>,
): void {
  if (!attached.has(instance)) {
    attached.add(instance)
    if (offset + (options.adjustments ?? 0) === 0) return
  }
  elementScroll(offset, options, instance)
}

/**
 * The scroller's size for `useVirtualizer`, taken ONLY from a ResizeObserver.
 *
 * TanStack's default (`observeElementRect`) reads `offsetWidth`/`offsetHeight`
 * synchronously when the virtualizer first attaches — inside React's layout
 * phase, on the commit that mounts the list, while the whole new page is still
 * dirty. That read is a forced layout of the app: ~240ms of the first visit to
 * Crew at a 4× throttle, and the same on every other virtualised list. The
 * observer's first callback reports the same box after the browser's own
 * layout, for free; until then `VIEWPORT_RECT` stands in.
 */
export function observeRectAfterLayout(
  instance: RectInstance,
  cb: (rect: { width: number; height: number }) => void,
): (() => void) | undefined {
  const el = instance.scrollElement
  if (!(el instanceof Element) || typeof ResizeObserver === "undefined") return
  const ro = new ResizeObserver(([entry]) => {
    const box = entry?.borderBoxSize?.[0]
    const width = box ? box.inlineSize : entry.contentRect.width
    const height = box ? box.blockSize : entry.contentRect.height
    cb({ width: Math.round(width), height: Math.round(height) })
  })
  ro.observe(el, { box: "border-box" })
  return () => ro.disconnect()
}

/**
 * The first-paint stand-in for the scroller's size: the viewport, which every
 * one of these lists' scrollers fills (or nearly). Too large costs a few extra
 * rows on the first frame; zero would render none until the observer reports.
 */
export function viewportRect(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 0, height: 0 }
  // CACHED, and refreshed from a resize listener. `innerWidth`/`innerHeight`
  // force a layout when the page is dirty, and this is evaluated on EVERY
  // render of every virtualised list (it is an argument expression), i.e. in
  // the middle of commits that have just changed the DOM — 111ms at 4× on the
  // tap that opens the FDP page, for a value the virtualizer reads only once.
  if (!cachedViewport) {
    cachedViewport = { width: window.innerWidth, height: window.innerHeight }
    window.addEventListener(
      "resize",
      () => {
        cachedViewport = { width: window.innerWidth, height: window.innerHeight }
      },
      { passive: true },
    )
  }
  return cachedViewport
}
let cachedViewport: { width: number; height: number } | null = null
