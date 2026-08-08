"use client"

import { useEffect, useRef } from "react"

/**
 * Native-style overlay scroll indicator, inset below the floating header.
 *
 * iOS draws its own indicator across the scroller's full box — which in an
 * edge-to-edge app means it starts at the screen edge, riding over the status
 * bar. A native scroll view insets its indicator to the safe area
 * (`scrollIndicatorInsets`); CSS has no equivalent, so the native indicator is
 * hidden (`scrollbar-hide` on the scroller) and this draws the same affordance
 * inset to the chrome: the track runs from `--chrome-top` (below the action
 * buttons) down to the nav clearance, exactly like the reference native apps.
 *
 * Render it as the FIRST CHILD of the scroller. The mounted element is only a
 * zero-height marker used to find the scroller and to read the rubber-band
 * distance; the THUMB itself is a `position: fixed` element appended to
 * `document.body`, i.e. outside the scrolling content entirely.
 *
 * That last part is the load-bearing bit. The thumb used to live inside the
 * scroller on a sticky anchor, with its drift measured and cancelled every
 * frame. It pinned correctly while a finger was dragging, but the RELEASE of a
 * rubber-band is animated by the compositor: the correction is computed on the
 * main thread from scroll events that arrive coalesced and a frame late, so
 * the track visibly snapped back with the bounce. Nothing that lives inside
 * the scroller and corrects in JS can win that race — the thumb has to not be
 * in the scrolling content in the first place. A scroller's own box does not
 * move when its contents rubber-band, so a fixed thumb placed against that box
 * is simply always right.
 */
export function ScrollIndicator() {
  const anchorRef = useRef<HTMLDivElement>(null)
  const topProbeRef = useRef<HTMLDivElement>(null)
  const bottomProbeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const anchor = anchorRef.current
    const topProbe = topProbeRef.current
    const bottomProbe = bottomProbeRef.current
    const scroller = anchor?.parentElement
    if (!anchor || !topProbe || !bottomProbe || !scroller) return

    const thumb = document.createElement("div")
    thumb.setAttribute("aria-hidden", "true")
    thumb.style.cssText = [
      "position:fixed",
      "width:3px",
      "border-radius:2px",
      "background:color-mix(in srgb, var(--foreground) 35%, transparent)",
      "opacity:0",
      "transition:opacity 250ms ease",
      "pointer-events:none",
      // Under the floating chrome (header z-99, nav pill z-100) and every
      // dialog, so it can never sit on top of a modal.
      "z-index:30",
      "will-change:transform",
    ].join(";")
    document.body.appendChild(thumb)

    // The scroller's own box. Unaffected by its contents scrolling — but NOT
    // by the layout around it, and a cached copy was wrong in the one case
    // that matters: opening the sidebar SLIDES the main panel across without
    // changing its width, so a ResizeObserver never fires and the thumb stayed
    // at the closed layout's right edge, drawing a grey line down the middle of
    // the flight cards. It still tracked the scroll, which is what made it look
    // like a stray rule rather than a misplaced scrollbar.
    //
    // So it is re-read at the top of every update instead. That is one rect
    // read per scroll frame, in a rAF that is already reading `scrollTop` —
    // and it is only ever needed while the thumb is visible, which is only
    // while scrolling. The observers below keep it right for a resize that
    // happens with the thumb already on screen.
    let box = { top: 0, right: 0, height: 0 }
    const measureBox = () => {
      const r = scroller.getBoundingClientRect()
      box = { top: r.top, right: r.right, height: r.height }
      thumb.style.left = `${box.right - 6}px`
      thumb.style.top = `${box.top}px`
    }
    measureBox()

    let hideTimer = 0
    let raf = 0
    // Where the zero-height marker sits when nothing is rubber-banding. Used
    // ONLY to read the bounce distance on engines that clamp `scrollTop` to
    // the range — it never places anything.
    let restDrift = 0
    requestAnimationFrame(() => {
      restDrift = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    })


    // While the thumb is VISIBLE the layout can move under it without any
    // scroll happening at all: the sidebar morph slides the panel across over
    // ~300ms, and re-measuring only on scroll frames leaves the thumb sitting
    // at the old edge for that whole span — a grey line briefly crossing the
    // cards, which is the flash the owner saw. A ResizeObserver does not help;
    // the panel's SIZE never changes.
    //
    // So the box is followed frame by frame, but only for the ~800ms the thumb
    // is up and only while something is actually moving: `follow` stops as
    // soon as the thumb hides. It writes nothing unless the box has changed.
    let visible = false
    let last = ""
    const follow = () => {
      if (!visible) return
      const r = scroller.getBoundingClientRect()
      const key = `${r.right}|${r.top}|${r.height}`
      if (key !== last) {
        last = key
        box = { top: r.top, right: r.right, height: r.height }
        thumb.style.left = `${box.right - 6}px`
        thumb.style.top = `${box.top}px`
      }
      requestAnimationFrame(follow)
    }

    const update = () => {
      raf = 0
      // A keep-alive page that isn't the active route is `visibility: hidden`;
      // the thumb is in the body, so it would otherwise still be painted.
      if (getComputedStyle(scroller).visibility === "hidden") {
        thumb.style.opacity = "0"
        return
      }
      const { scrollTop, scrollHeight, clientHeight } = scroller
      const range = scrollHeight - clientHeight
      if (range <= 1) {
        thumb.style.opacity = "0"
        return
      }
      measureBox()
      const topInset = topProbe.offsetHeight
      const bottomInset = bottomProbe.offsetHeight + 6
      const track = box.height - topInset - bottomInset
      if (track <= 0) return

      const restH = Math.max(36, (track * clientHeight) / scrollHeight)

      // Native overscroll behaviour: at either end the indicator stays parked
      // at its end of the track and COMPRESSES against it, expanding back as
      // the bounce returns. iOS reports scrollTop past the ends during a
      // bounce; where an engine clamps it instead, the marker's own drift
      // inside the scroller gives the same distance.
      const overTop = Math.max(0, -scrollTop)
      const overBottom = Math.max(0, scrollTop - range)
      let over = overTop + overBottom
      // TOP only. The marker is sticky, so while the scroller is anywhere in
      // range it sits at the scrollport top and its drift is 0; it can only
      // move when a top rubber-band pushes its flow position below the
      // scrollport (sticky never pulls an element ABOVE its flow position).
      // At the bottom it stays pinned, so there is no signal to read there —
      // measuring anyway returns the whole scrolled distance and collapses
      // the thumb.
      if (over === 0 && scrollTop <= 0) {
        const drift = anchor.getBoundingClientRect().top - (box.top + restDrift)
        if (drift > 0) over = drift
      }
      // Asymptotic so a hard fling compresses a lot but never to nothing.
      const squash = 1 - (over / (over + 90)) * 0.62
      const thumbH = Math.max(12, restH * squash)

      // Progress is CLAMPED, so during a bounce the thumb is already parked at
      // its end; the compression then grows from that end rather than sliding.
      const progress = Math.min(1, Math.max(0, scrollTop / range))
      const y =
        overBottom > 0 || (over > 0 && progress > 0.5)
          ? topInset + track - thumbH
          : topInset + (track - thumbH) * progress

      thumb.style.transform = `translateY(${y}px)`
      thumb.style.height = `${thumbH}px`
      thumb.style.opacity = "1"
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        thumb.style.opacity = "0"
        visible = false
      }, 800)
      // The thumb is now on screen, so the box has to be tracked rather than
      // sampled — see `follow`.
      if (!visible) {
        visible = true
        requestAnimationFrame(follow)
      }
    }


    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }

    const ro = new ResizeObserver(measureBox)
    ro.observe(scroller)
    scroller.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", measureBox)
    window.addEventListener("orientationchange", measureBox)

    return () => {
      visible = false
      scroller.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", measureBox)
      window.removeEventListener("orientationchange", measureBox)
      ro.disconnect()
      window.clearTimeout(hideTimer)
      if (raf) cancelAnimationFrame(raf)
      thumb.remove()
    }
  }, [])

  return (
    // Sticky + zero height: it never affects layout and never scrolls out of
    // view, so a non-zero offset from the scroller's top edge means one thing
    // only — a top rubber-band is in progress.
    <div ref={anchorRef} aria-hidden style={{ position: "sticky", top: 0, height: 0 }}>
      {/* invisible probes resolving the CSS-var insets to px */}
      <div ref={topProbeRef} style={{ position: "absolute", width: 0, height: "var(--chrome-top)", visibility: "hidden" }} />
      <div ref={bottomProbeRef} style={{ position: "absolute", width: 0, height: "var(--nav-bottom-offset, 4px)", visibility: "hidden" }} />
    </div>
  )
}
