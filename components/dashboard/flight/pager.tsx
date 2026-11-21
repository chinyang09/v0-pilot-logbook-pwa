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
  fill = false,
}: {
  count: number
  page: number
  onPage: (i: number) => void
  children: (i: number) => React.ReactNode
  /** Fill the tile: each page its full height, the dots at its foot. */
  fill?: boolean
}) {
  const track = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ x0: number; y0: number; dx: number; w: number; active: boolean } | null>(null)
  const swiped = React.useRef(false)
  // Outside a fill (the airport card) each page is as tall as itself: the
  // window takes the page on show's height, so a short page does not leave
  // the tallest one's height under it. Read in a ResizeObserver, never in a commit.
  const [height, setHeight] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (fill || count < 2) return
    const el = track.current?.children[page] as HTMLElement | undefined
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      setHeight((prev) => (prev !== null && Math.abs(prev - h) < 0.5 ? prev : h))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fill, count, page])
  if (count < 2) return fill ? <div className="flex min-h-0 flex-1 flex-col">{children(0)}</div> : <>{children(0)}</>
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
      className={cn("relative overflow-hidden", fill && "flex min-h-0 flex-1 flex-col")}
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
        className={fill ? "flex min-h-0 flex-1 flex-col" : "overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"}
        style={!fill && height !== null ? { height } : undefined}
      >
        <div
          ref={track}
          className={cn("flex transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]", fill ? "min-h-0 flex-1" : "items-start")}
          style={{ transform: `translateX(${-page * 100}%)` }}
        >
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className={cn("w-full shrink-0", fill && "flex flex-col")} aria-hidden={i !== page || undefined}>
              {children(i)}
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className={cn("flex justify-center gap-1", fill ? "pt-1.5" : "mt-1.5")}>
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={cn("h-1.5 w-1.5 rounded-full transition-colors", i === page ? "bg-foreground" : "bg-foreground/25")} />
        ))}
      </div>
    </div>
  )
}

