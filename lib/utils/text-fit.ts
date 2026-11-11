/**
 * How much a short label has to be CONDENSED to fit a width — for the month
 * calendar, where a day of ~43–50px has to hold "TR560 RPMD" on one line.
 *
 * Inter is a wide face: those ten characters are ~53–58px at 9px. The owner's
 * reference is a calendar app set in a condensed face, and the app keeps ONE
 * typeface, so the label is condensed horizontally (`scaleX`) by exactly what
 * it needs and no more — most labels by 10–20%, a duty's long name not at all.
 *
 * The width comes from canvas `measureText`, once per label (cached), so a
 * render measures nothing in the DOM. Until the web font has loaded the
 * fallback's widths are wrong, so the cache is cleared when it does and
 * `onFontsReady` lets a component draw again.
 */

const FONT = '600 9px "Inter", system-ui, -apple-system, sans-serif'
/** The calendar's bar text: 9px with -0.02em of tracking. */
const TRACKING_EM = -0.02
const FONT_PX = 9

let ctx: CanvasRenderingContext2D | null | undefined
const widths = new Map<string, number>()

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx
  if (typeof document === "undefined") return null
  ctx = document.createElement("canvas").getContext("2d")
  if (ctx) ctx.font = FONT
  return ctx
}

/** The label's natural width in px at the calendar's bar type, or null when unmeasurable. */
export function labelWidth(text: string): number | null {
  const cached = widths.get(text)
  if (cached !== undefined) return cached
  const c = context()
  if (!c) return null
  const w = c.measureText(text).width + TRACKING_EM * FONT_PX * Math.max(0, text.length - 1)
  widths.set(text, w)
  return w
}

/** The horizontal scale that fits `text` into `available` px: 1 when it fits, never below `floor`. */
export function fitScale(natural: number | null, available: number, floor = 0.7): number {
  if (natural == null || natural <= 0 || available <= 0) return 1
  return Math.max(floor, Math.min(1, available / natural))
}

let fontsReady = false
const waiting = new Set<() => void>()

/**
 * Call `fn` once the document's fonts have loaded (now, if they have). The
 * widths measured before then were the fallback face's, so they are dropped.
 */
export function onFontsReady(fn: () => void): () => void {
  if (fontsReady || typeof document === "undefined" || !document.fonts) return () => {}
  waiting.add(fn)
  if (waiting.size === 1) {
    void document.fonts.ready.then(() => {
      fontsReady = true
      widths.clear()
      if (ctx) ctx.font = FONT
      for (const f of waiting) f()
      waiting.clear()
    })
  }
  return () => {
    waiting.delete(fn)
  }
}
