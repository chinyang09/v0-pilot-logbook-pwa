/**
 * The touch INK — the Android half of the app's look.
 *
 * The app is two materials on purpose (CLAUDE.md, "Press feedback"):
 *
 * | where | what a press does |
 * |---|---|
 * | floating GLASS chrome (header, nav) | the iOS answer: the glass blooms, a spotlight follows the finger, a ripple of LIGHT on release (`GlassContainer`) |
 * | everything else you press — `.control-surface` capsules and the rows and cards marked `data-ink` | the Material answer: an ink circle spreads from the point the finger landed, under a state layer (`.control-surface::after`) |
 *
 * Cheap by construction:
 * - ONE delegated listener set on the window, not a handler per control;
 * - the ink is two spans appended to the pressed element, animated with WAAPI
 *   on `transform` and `opacity` only — composited, nothing re-laid-out;
 * - the only layout read is the pressed element's rect, at pointerdown, when
 *   the page is clean;
 * - a press that turns into a scroll (`pointercancel`, a move past the slop, a
 *   scroll event) fades the ink straight away, so a fling through a list never
 *   leaves a trail of circles.
 *
 * The element must be POSITIONED (`.control-surface` is; tag a row `relative`
 * as well as `data-ink`). An unpositioned one is skipped rather than given
 * `position: relative` behind its back, which would move any absolutely
 * placed child it has.
 */

const SELECTOR = ":is(button, a, [role=button], label).control-surface, [data-ink]"
/** A touch waits this long before inking, so a scroll that starts on a row
 *  cancels before anything is drawn (Android's tap timeout does the same). */
const TOUCH_DELAY_MS = 60
/** Movement that makes a press a drag or a scroll. */
const SLOP_PX = 8
const SPREAD_MS = 420
/** The ink stays at least this long, so a quick tap still reads. */
const MIN_VISIBLE_MS = 150
const FADE_MS = 220
const EASE = "cubic-bezier(0.2, 0, 0, 1)"

interface Ink {
  host: HTMLSpanElement
  bornAt: number
}

interface Press {
  el: HTMLElement
  x: number
  y: number
  timer: ReturnType<typeof setTimeout> | null
  ink: Ink | null
}

function inert(el: HTMLElement): boolean {
  return (
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute("aria-disabled") === "true" ||
    el.closest("[data-no-ink]") !== null
  )
}

function spawn(el: HTMLElement, x: number, y: number): Ink | null {
  if (!el.isConnected || getComputedStyle(el).position === "static") return null
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const px = x - rect.left
  const py = y - rect.top
  // Far enough to cover the farthest corner from the touch.
  const r = Math.hypot(Math.max(px, rect.width - px), Math.max(py, rect.height - py))
  const host = document.createElement("span")
  host.className = "press-ink-host"
  host.setAttribute("aria-hidden", "true")
  const dot = document.createElement("span")
  dot.className = "press-ink"
  dot.style.width = dot.style.height = `${r * 2}px`
  dot.style.left = `${px - r}px`
  dot.style.top = `${py - r}px`
  host.appendChild(dot)
  el.appendChild(host)
  dot.animate([{ transform: "scale(0.15)" }, { transform: "scale(1)" }], {
    duration: SPREAD_MS,
    easing: EASE,
    fill: "forwards",
  })
  return { host, bornAt: performance.now() }
}

function fade(ink: Ink, immediate: boolean): void {
  const wait = immediate ? 0 : Math.max(0, MIN_VISIBLE_MS - (performance.now() - ink.bornAt))
  const a = ink.host.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: immediate ? 120 : FADE_MS,
    delay: wait,
    easing: "linear",
    fill: "forwards",
  })
  a.onfinish = () => ink.host.remove()
  a.oncancel = () => ink.host.remove()
}

/** Install once for the page; returns the uninstaller. */
export function installPressInk(): () => void {
  if (typeof window === "undefined") return () => {}
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
  let press: Press | null = null

  const end = (asTap: boolean) => {
    const p = press
    if (!p) return
    press = null
    detach()
    if (p.timer) {
      clearTimeout(p.timer)
      // A tap shorter than the touch delay still gets its ink — that is the
      // feedback a tap is owed. A cancelled press gets none.
      if (asTap) {
        const ink = spawn(p.el, p.x, p.y)
        if (ink) fade(ink, false)
      }
      return
    }
    if (p.ink) fade(p.ink, !asTap)
  }

  const onUp = () => end(true)
  const onCancel = () => end(false)
  const onMove = (e: PointerEvent) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP_PX) end(false)
  }

  const attach = () => {
    window.addEventListener("pointerup", onUp, true)
    window.addEventListener("pointercancel", onCancel, true)
    window.addEventListener("pointermove", onMove, { capture: true, passive: true })
    window.addEventListener("scroll", onCancel, { capture: true, passive: true })
    // A capture-phase guard elsewhere (the `…` cascade's swallow) can stop a
    // pointerup before it reaches us; the click, or the page going away,
    // still ends the press.
    window.addEventListener("click", onUp, true)
    document.addEventListener("visibilitychange", onCancel)
  }
  const detach = () => {
    window.removeEventListener("pointerup", onUp, true)
    window.removeEventListener("pointercancel", onCancel, true)
    window.removeEventListener("pointermove", onMove, true)
    window.removeEventListener("scroll", onCancel, true)
    window.removeEventListener("click", onUp, true)
    document.removeEventListener("visibilitychange", onCancel)
  }

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || e.button !== 0 || reduce.matches) return
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>(SELECTOR) : null
    end(false)
    if (!target || inert(target)) return
    const p: Press = { el: target, x: e.clientX, y: e.clientY, timer: null, ink: null }
    press = p
    attach()
    if (e.pointerType === "touch") {
      p.timer = setTimeout(() => {
        p.timer = null
        if (press === p) p.ink = spawn(p.el, p.x, p.y)
      }, TOUCH_DELAY_MS)
    } else {
      p.ink = spawn(target, e.clientX, e.clientY)
    }
  }

  window.addEventListener("pointerdown", onDown, { capture: true, passive: true })
  return () => {
    end(false)
    window.removeEventListener("pointerdown", onDown, true)
  }
}
