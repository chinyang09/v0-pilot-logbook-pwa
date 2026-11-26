"use client"

/**
 * The Flight Deck's TIMELINE (the owner, Nov 2026: "instead of timeline being
 * shown on a flight card, and selection of flights turning the pop up — a
 * working timeline, similar to that of FDP, but I want the look of the
 * timeline we have now. So we can scroll and select a duty. And the widgets
 * all work around the scrollable timeline").
 *
 * One strip across the top of the page, in the duty strip's look — a line an
 * hour behind the bars, every sixth bold; the rest before each duty solid to
 * where its minimum is met, a shortfall red; each duty from report to off duty
 * with its FDP darker inside it and its legs filled; the Reg 14 maximum a
 * dotted outline on a duty still to fly — scrolled sideways under a FIXED
 * POINTER at its centre, as the FDP page's chart is.
 *
 * | | |
 * |---|---|
 * | the duty the page is about | the one under the pointer, else the next after it (`selectAt`) — published as it changes (`setChosenDuty`), so the page re-renders only when the pointer crosses into another duty |
 * | the limits | read at the pointer, minute by minute (`useDeckPointer`) |
 * | a tap on a duty | brings it to the pointer |
 * | following now | until it is scrolled; back within ten minutes of now it follows again, and the header's Now brings it home |
 *
 * The hour lines are two repeating gradients on one element, not a node an
 * hour; the labels under them are drawn only around what is on screen.
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import type { DutyBlock } from "@/lib/utils/roster/duty-timeline"
import { deckRange, hourMarks, selectAt, type Selectable } from "@/lib/utils/dashboard/deck-timeline"
import { setChosenDuty } from "@/hooks/use-dashboard-duty"
import { requestDeckNow, setDeckPointer, setDeckSettled, useDeckNowRequest, useDeckPointer } from "@/hooks/use-deck-pointer"

const H = 3_600_000
const MIN = 60_000
/** How close to now a scroll comes to rest and follows the clock again. */
const NOW_SNAP_MS = 10 * MIN
/** The strip's scale: a phone shows about a day, a wide page a little more of it. */
const pxPerHourFor = (width: number) => Math.max(14, Math.min(30, width / 22))

export interface DeckTimelineProps {
  blocks: readonly DutyBlock[]
  /** The duties a pointer can select (flying and standby) — ground duties are drawn, not chosen. */
  selectable: ReadonlySet<string>
  /** The duty the page is about. */
  selectedId: string | null
  now: number
  zulu: boolean
  /** A point in time as the app writes one, and a day. */
  clock: (ms: number) => string
  day: (ms: number) => string
  /** The page is on screen: the timeline follows the clock only then. */
  active: boolean
}

export function DeckTimeline({ blocks, selectable, selectedId, now, zulu, clock, day, active }: DeckTimelineProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentBoxSize?.[0]?.inlineSize ?? e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pxH = pxPerHourFor(width || 360)
  const midnight = React.useCallback(
    (ms: number) => {
      const d = new Date(ms)
      if (zulu) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    },
    [zulu],
  )
  const hourOf = React.useCallback((ms: number) => (zulu ? new Date(ms).getUTCHours() : new Date(ms).getHours()), [zulu])
  // The range moves on only by the day, so a minute's tick does not move the strip.
  const nowDay = Math.floor(now / (24 * H))
  const { fromMs, toMs } = React.useMemo(
    () => deckRange(blocks, nowDay * 24 * H, midnight),
    [blocks, nowDay, midnight],
  )
  const pad = width / 2
  const xOf = React.useCallback((ms: number) => ((ms - fromMs) / H) * pxH, [fromMs, pxH])
  const tOf = React.useCallback((x: number) => fromMs + (x / pxH) * H, [fromMs, pxH])
  const inner = xOf(toMs)

  const choosable = React.useMemo<Selectable[]>(
    () => blocks.filter((b) => selectable.has(b.id)).map((b) => ({ id: b.id, startMs: b.startMs, endMs: b.endMs })),
    [blocks, selectable],
  )

  /* ── The pointer ─────────────────────────────────────────────────────── */
  const pointer = useDeckPointer()
  const pointerRef = React.useRef(pointer)
  React.useEffect(() => {
    pointerRef.current = pointer
  }, [pointer])
  const nowRef = React.useRef(now)
  React.useEffect(() => {
    nowRef.current = now
  }, [now])
  // A scroll the page made itself (following the clock, a resize) is not the pilot's.
  const ownScroll = React.useRef<number | null>(null)
  const placeAt = React.useCallback(
    (t: number, smooth = false) => {
      const el = scrollRef.current
      if (!el || !width) return
      const left = Math.max(0, Math.min(inner, xOf(t)))
      if (smooth) {
        el.scrollTo({ left, behavior: "smooth" })
        return
      }
      ownScroll.current = left
      el.scrollLeft = left
    },
    [width, inner, xOf],
  )

  // Where it starts, and where it stays through a resize or new data: the
  // pointer's instant (now while it follows the clock).
  React.useLayoutEffect(() => {
    placeAt(pointerRef.current ?? nowRef.current)
  }, [placeAt])
  // Following the clock: a minute's tick moves the strip under the pointer.
  React.useLayoutEffect(() => {
    if (pointerRef.current === null && active) placeAt(now)
  }, [now, active, placeAt])
  // The header's Now: home, smoothly — the scroll's own rest snaps it to now.
  const nowRequest = useDeckNowRequest()
  const firstRequest = React.useRef(nowRequest)
  React.useEffect(() => {
    if (nowRequest === firstRequest.current) return
    placeAt(nowRef.current, true)
  }, [nowRequest, placeAt])

  const idle = React.useRef(0)
  const raf = React.useRef(0)
  const lastChosen = React.useRef<string | null | undefined>(undefined)
  const onScroll = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (ownScroll.current !== null && Math.abs(el.scrollLeft - ownScroll.current) < 1) {
      ownScroll.current = null
      return
    }
    ownScroll.current = null
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const t = tOf(el.scrollLeft)
      setDeckPointer(t)
      const id = selectAt(choosable, t)
      if (id !== lastChosen.current) {
        lastChosen.current = id
        setChosenDuty(id)
      }
      window.clearTimeout(idle.current)
      idle.current = window.setTimeout(() => {
        const at = tOf(el.scrollLeft)
        // Come to rest by now: it follows the clock again.
        if (Math.abs(at - nowRef.current) < NOW_SNAP_MS) {
          lastChosen.current = undefined
          setDeckPointer(null)
          setDeckSettled(null)
          setChosenDuty(null)
          placeAt(nowRef.current)
          return
        }
        setDeckSettled(at)
      }, 140)
    })
  }, [tOf, choosable, placeAt])
  React.useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      window.clearTimeout(idle.current)
    },
    [],
  )

  /* ── What is drawn ───────────────────────────────────────────────────── */
  // Labels only around what is on screen: re-read when the view has moved on
  // by half a screen.
  const [view, setView] = React.useState(0)
  const viewOf = React.useCallback((x: number) => (width ? Math.floor(x / Math.max(1, width / 2)) : 0), [width])
  const onScrollLabels = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const v = viewOf(el.scrollLeft)
    setView((cur) => (cur === v ? cur : v))
  }, [viewOf])
  const labelFrom = tOf(Math.max(0, (view - 2) * (width / 2)))
  const labelTo = tOf((view + 4) * (width / 2))
  const marks = React.useMemo(
    () => (width ? hourMarks(Math.max(fromMs, labelFrom), Math.min(toMs, labelTo), midnight(fromMs), hourOf, pxH >= 20 ? 3 : 6) : []),
    [width, fromMs, toMs, labelFrom, labelTo, midnight, hourOf, pxH],
  )

  const gridLines = React.useMemo(() => {
    const minor = "color-mix(in oklch, var(--foreground) 14%, transparent)"
    const major = "color-mix(in oklch, var(--foreground) 42%, transparent)"
    // From a midnight of the display clock: every hour, every sixth bold.
    const offset = xOf(midnight(fromMs))
    return {
      backgroundImage: `repeating-linear-gradient(90deg, ${major} 0 1.5px, transparent 1.5px ${6 * pxH}px), repeating-linear-gradient(90deg, ${minor} 0 1px, transparent 1px ${pxH}px)`,
      backgroundPosition: `${offset - 0.75}px 0, ${offset - 0.5}px 0`,
    }
  }, [xOf, midnight, fromMs, pxH])

  const go = React.useCallback((b: DutyBlock) => placeAt(b.startMs + (b.endMs - b.startMs) / 2, true), [placeAt])

  return (
    <div className="relative shrink-0 overflow-hidden rounded-2xl border border-border bg-card" aria-label="Duty timeline">
      <div
        ref={scrollRef}
        onScroll={() => {
          onScroll()
          onScrollLabels()
        }}
        className="overflow-x-auto overflow-y-hidden overscroll-contain scrollbar-hide [mask-image:linear-gradient(90deg,transparent,black_18px,black_calc(100%-18px),transparent)]"
        style={{ touchAction: "pan-x" }}
        // A mouse wheel turns the strip as a trackpad's sideways swipe does.
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) scrollRef.current?.scrollBy({ left: e.deltaY })
        }}
        role="slider"
        tabIndex={0}
        aria-label="Scroll to choose a duty"
        aria-valuemin={fromMs}
        aria-valuemax={toMs}
        aria-valuenow={Math.round(pointer ?? now)}
        aria-valuetext={pointer === null ? "Now" : `${day(pointer)} ${clock(pointer)}`}
        onKeyDown={(e) => {
          const el = scrollRef.current
          if (!el) return
          const step = e.shiftKey ? 24 : 1
          if (e.key === "ArrowLeft") el.scrollBy({ left: -step * pxH })
          else if (e.key === "ArrowRight") el.scrollBy({ left: step * pxH })
          else if (e.key === "Home") requestDeckNow()
          else return
          e.preventDefault()
        }}
      >
        <div className="relative h-[60px]" style={{ width: inner + width }}>
          <div className="absolute inset-y-0" style={{ left: pad, width: inner }}>
            {/* The days, at their midnights. */}
            <DayLabels midnights={marks.filter((m) => m.midnight).map((m) => m.ms)} xOf={xOf} day={day} now={now} />
            {/* The hour lines, the bars over their top 18px. */}
            <div className="absolute inset-x-0 top-[17px] h-6" style={gridLines}>
              <Bars blocks={blocks} xOf={xOf} now={now} selectedId={selectedId} selectable={selectable} toMs={toMs} onPick={go} />
              {now > fromMs && now < toMs && (
                <span className="absolute -top-0.5 h-[22px] w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: xOf(now) }} />
              )}
            </div>
            <div className="absolute inset-x-0 top-[43px] h-3 text-[9px] tabular-nums text-muted-foreground">
              {marks.map((m) => (
                <span key={m.ms} className="absolute -translate-x-1/2" style={{ left: xOf(m.ms) }}>
                  {String(m.hour).padStart(2, "0")}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* The pointer: fixed at the centre, the instant under it named above. */}
      <span aria-hidden className="pointer-events-none absolute bottom-[14px] left-1/2 top-[14px] w-0.5 -translate-x-1/2 rounded-full bg-primary" />
      <PointerLabel clock={clock} day={day} now={now} />
    </div>
  )
}

/** Half the pointer label's width, and a gap either side of it. */
const POINTER_LABEL_HALF_PX = 54
/** A 9px uppercase day label's width per character. */
const DAY_CHAR_PX = 6

/**
 * The days at their midnights — but none UNDER the pointer's label, which
 * sits on the same line: a day label running in under it showed its last
 * letters past the label's edge ("17 Nov · 00:29Z V"). Reads the pointer off
 * the store, so only these few spans re-render as the strip scrolls.
 */
function DayLabels({ midnights, xOf, day, now }: { midnights: number[]; xOf: (ms: number) => number; day: (ms: number) => string; now: number }) {
  const pointer = useDeckPointer()
  const centre = xOf(pointer ?? now)
  return (
    <div className="absolute inset-x-0 top-0.5 h-3 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
      {midnights.map((ms) => {
        const text = day(ms + 12 * H)
        const left = xOf(ms)
        const right = left + 4 + text.length * DAY_CHAR_PX
        if (right > centre - POINTER_LABEL_HALF_PX && left < centre + POINTER_LABEL_HALF_PX) return null
        return (
          <span key={ms} className="absolute whitespace-nowrap pl-1" style={{ left }} suppressHydrationWarning>
            {text}
          </span>
        )
      })}
    </div>
  )
}

/** The instant under the pointer, read off the store so only this re-renders as the strip scrolls. */
function PointerLabel({ clock, day, now }: { clock: (ms: number) => string; day: (ms: number) => string; now: number }) {
  const pointer = useDeckPointer()
  const at = pointer ?? now
  return (
    <span
      className="pointer-events-none absolute left-1/2 top-0.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-card px-1.5 text-[10px] font-semibold tabular-nums text-foreground"
      suppressHydrationWarning
    >
      {pointer === null ? "Now" : day(at).replace(/^\w+,?\s*/, "")} · {clock(at)}
    </span>
  )
}

/**
 * Every duty and the rest before it, in the strip's look. Memoised: the
 * labels re-render as the view moves; the bars only when the duties, the
 * selection or the minute do.
 */
const Bars = React.memo(function Bars({
  blocks,
  xOf,
  now,
  selectedId,
  selectable,
  toMs,
  onPick,
}: {
  blocks: readonly DutyBlock[]
  xOf: (ms: number) => number
  now: number
  selectedId: string | null
  selectable: ReadonlySet<string>
  toMs: number
  onPick: (b: DutyBlock) => void
}) {
  const span = (a: number, b: number) => ({ left: xOf(a), width: Math.max(1, xOf(Math.max(a, b)) - xOf(a)) })
  return (
    <div aria-hidden className="absolute inset-x-0 top-0 h-[18px]">
      {blocks.map((b) => {
        const rest = b.restBefore
        const after = b.restAfter
        const selected = b.id === selectedId
        const choosable = selectable.has(b.id)
        const hatched = b.kind !== "flight" || b.code === "SIM" || b.code === "POS"
        const showMax = b.fdpLimitMs !== null && b.maxFdpMinutes > 0 && b.endMs > now
        const over = b.limit === "over" && b.fdpLimitMs !== null && b.fdpEndMs > b.fdpLimitMs
        return (
          <React.Fragment key={b.id}>
            {rest && (
              <>
                <span
                  className="absolute inset-y-[6px] rounded-l-[2px] bg-foreground/30"
                  style={span(rest.startMs, Math.min(rest.minimumEndMs ?? b.startMs, b.startMs))}
                />
                {rest.minimumEndMs !== null && b.startMs > rest.minimumEndMs && (
                  <span className="absolute inset-y-[6px] bg-foreground/12" style={span(rest.minimumEndMs, b.startMs)} />
                )}
                {rest.status === "short" && rest.minimumEndMs !== null && rest.minimumEndMs > b.startMs && (
                  <span className="absolute inset-y-[4px] bg-destructive" style={span(b.startMs, rest.minimumEndMs)} />
                )}
              </>
            )}
            {after && (
              <>
                <span className="absolute inset-y-[6px] rounded-l-[2px] bg-foreground/30" style={span(after.startMs, after.minimumEndMs)} />
                <span className="absolute inset-y-[6px] bg-foreground/12" style={span(after.minimumEndMs, toMs)} />
              </>
            )}
            <span
              onClick={choosable ? () => onPick(b) : undefined}
              className={cn(
                choosable && "cursor-pointer",
                "absolute inset-y-0 rounded-[3px] border",
                hatched
                  ? "border-foreground/25 bg-[repeating-linear-gradient(135deg,color-mix(in_oklch,var(--foreground)_16%,transparent)_0_3px,transparent_3px_6px)]"
                  : "border-foreground/30 bg-muted",
                // The duty the page is about: ringed, its legs still over it.
                selected && "outline outline-[1.5px] outline-offset-1 outline-foreground/80",
              )}
              style={span(b.startMs, b.endMs)}
            />
            {b.kind === "flight" && b.fdpEndMs > b.startMs && (
              <span className="pointer-events-none absolute inset-y-[1px] rounded-[2px] bg-foreground/10" style={span(b.startMs, b.fdpEndMs)} />
            )}
            {b.sectors.map((s) =>
              s.positioning || s.simulator ? null : (
                <span
                  key={s.id}
                  className={cn("pointer-events-none absolute inset-y-[3px] rounded-[2px]", s.planned ? "bg-primary" : "bg-foreground/55")}
                  style={span(s.outMs, s.inMs)}
                />
              ),
            )}
            {showMax && (
              <>
                <span
                  className="pointer-events-none absolute -inset-y-[3px] rounded-[4px] border border-dashed border-foreground/55"
                  style={span(b.startMs, b.fdpLimitMs!)}
                />
                <span className="pointer-events-none absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70" style={{ left: xOf(b.fdpLimitMs!) }} />
              </>
            )}
            {over && <span className="pointer-events-none absolute inset-y-[3px] bg-destructive" style={span(b.fdpLimitMs!, b.fdpEndMs)} />}
          </React.Fragment>
        )
      })}
    </div>
  )
})
