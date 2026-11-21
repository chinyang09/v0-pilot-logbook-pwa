"use client"

/**
 * Pages a tile swipes between (the destinations, the weather's airports, the
 * duty's legs) — and the page each was left on.
 */

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * The page a pager was left on, by a key — so a card opened from a tile
 * shows the page the tile was swiped to, and coming back to the page keeps
 * it. A key that changes (another duty) starts at `start`.
 */
const PAGES = new Map<string, number>()
export function useRememberedPage(key: string, start: number, count: number): [number, (i: number) => void] {
  const [, rerender] = React.useReducer((n: number) => n + 1, 0)
  const page = Math.max(0, Math.min(Math.max(0, count - 1), PAGES.get(key) ?? start))
  const set = React.useCallback(
    (i: number) => {
      PAGES.set(key, i)
      rerender()
    },
    [key],
  )
  return [page, set]
}

/**
 * Pages a tile can be SWIPED between (the owner: "allow the airport widget to
 * be swipable"), with a dot for each under them. A swipe is pointer events on
 * a transformed track, not a scroller — the tile is a button, and a scroller
 * inside one is not one every engine scrolls — and a swipe never opens the
 * card (its click is swallowed), nor starts the tile's long press. A vertical
 * move is left to the page. Controlled: `page` and `onPage`.
 */
export function Pager({
  count,
  page,
  onPage,
  children,
}: {
  count: number
  page: number
  onPage: (i: number) => void
  children: (i: number) => React.ReactNode
}) {
  const track = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ x0: number; y0: number; dx: number; w: number; active: boolean } | null>(null)
  const swiped = React.useRef(false)
  if (count < 2) return <>{children(0)}</>
  const settle = (to: number) => {
    const el = track.current
    if (el) {
      el.style.transition = ""
      el.style.transform = `translateX(${-to * 100}%)`
    }
    onPage(to)
  }
  return (
    <div
      className="relative overflow-hidden"
      data-pager
      style={{ touchAction: "pan-y" }}
      onPointerDown={(e) => {
        swiped.current = false
        drag.current = { x0: e.clientX, y0: e.clientY, dx: 0, w: e.currentTarget.getBoundingClientRect().width, active: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x0
        const dy = e.clientY - d.y0
        if (!d.active) {
          if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
            d.active = true
            e.currentTarget.setPointerCapture(e.pointerId)
          } else if (Math.abs(dy) > 8) drag.current = null
          return
        }
        // Past the first or last page it gives a little, no more.
        const edge = (page === 0 && dx > 0) || (page === count - 1 && dx < 0)
        d.dx = edge ? dx / 4 : dx
        swiped.current = true
        const el = track.current
        if (el) {
          el.style.transition = "none"
          el.style.transform = `translateX(calc(${-page * 100}% + ${d.dx}px))`
        }
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (!d?.active) return
        const next = d.dx < -d.w * 0.18 ? page + 1 : d.dx > d.w * 0.18 ? page - 1 : page
        settle(Math.max(0, Math.min(count - 1, next)))
      }}
      onPointerCancel={() => {
        if (drag.current?.active) settle(page)
        drag.current = null
      }}
      onClickCapture={(e) => {
        if (!swiped.current) return
        swiped.current = false
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div
        ref={track}
        className="flex transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ transform: `translateX(${-page * 100}%)` }}
      >
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="w-full shrink-0" aria-hidden={i !== page || undefined}>
            {children(i)}
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-1.5 flex justify-center gap-1">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={cn("h-1.5 w-1.5 rounded-full transition-colors", i === page ? "bg-foreground" : "bg-foreground/25")} />
        ))}
      </div>
    </div>
  )
}

