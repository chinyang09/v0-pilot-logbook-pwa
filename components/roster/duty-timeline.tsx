"use client"

/**
 * The duty timeline — a Gantt chart whose axis is TIME. Each duty is ONE bar
 * with its flying drawn inside it, and the rest that preceded it decked
 * straight underneath, so a single look says whether the next duty signs on
 * inside the minimum rest:
 *
 *          MON 3              TUE 4
 *   8:30 · max 12:15      ┊┈┈┈┈┈┈┈┈┐
 *   ▐░▓▓▓░░▓▓▓▓░░▌┈┈┈┈┈┈┈┈┊         duty, sectors inside, the maximum dotted
 *                 ▐████████▒▒▒▒▒░░░▌ rest: the minimum (solid), then the rest
 *                 14:20 · min 10:00    as provided, to the next sign-on
 *
 * The maximum is drawn for a duty still to come (rostered, or a Quick Check
 * what-if) — the latest sign-off its Reg 14 maximum allows; once a duty has
 * been flown its record is the fact, and the maximum is only said if it was
 * broken (the part past it hatched red). A rest whose minimum runs past the
 * next sign-on has that part hatched red, under the duty that signed on early.
 * Duties still to come are dashed in the planned yellow; a what-if is orange.
 *
 * The axis runs years either side of the logbook, drawn only near the view;
 * "Now" brings it back. Swipe sideways to move; pinch (or the tabs) to step
 * between 24 hours, 7 days and 28 days. Tap a duty for its sign-on, sign-off
 * and sectors; tap a rest for the duties either side of it.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronRight, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow } from "@/components/ui/settings-row"
import { SegmentedTabs, type SegmentedTab } from "@/components/ui/segmented-tabs"
import { usePreferences } from "@/components/providers/preferences-provider"
import { FDP_COLORS } from "@/components/roster/fdp-colors"
import { formatInstant, tzFormatter } from "@/lib/utils/tz-format"
import { formatHHMMDisplay, minutesToHHMM } from "@/lib/utils/time"
import { summarizeTimeline, type DutyBlock, type RestBefore } from "@/lib/utils/roster/duty-timeline"

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const YEAR = 365 * DAY

type Zoom = "1" | "7" | "28"
/** In order of the span shown — pinching OUT steps left, IN steps right. */
const ZOOM_ORDER: Zoom[] = ["1", "7", "28"]
const ZOOMS: SegmentedTab<Zoom>[] = [
  { value: "1", label: "24 Hours" },
  { value: "7", label: "7 Days" },
  { value: "28", label: "28 Days" },
]

/**
 * Geometry, px — one deck: the duty's label, the duty bar, the rest bar
 * directly under it (no gap), the rest's label.
 */
const AXIS_H = 26
const LABEL_H = 14
const DUTY_LABEL_Y = AXIS_H + 4
const DUTY_Y = DUTY_LABEL_Y + LABEL_H + 2
const DUTY_H = 24
const REST_Y = DUTY_Y + DUTY_H
const REST_H = 12
const REST_LABEL_Y = REST_Y + REST_H + 3
const CHART_H = REST_LABEL_Y + LABEL_H + 5
/** Sectors sit inside the duty bar, this far in from its top and bottom. */
const SECTOR_INSET = 5
/** The "Now" chip sits under the day and hour labels, above the deck. */
const NOW_Y = 13
/** The narrowest a tap target gets, centred on a bar narrower than it. */
const HIT_MIN = 28
/** Labels are 11px semibold tabular figures; this is a character's width. */
const CHAR_PX = 6.6
const LABEL_GAP = 6

/** How far the axis runs past the logbook (and now), either way. */
const AXIS_PAD = 3 * YEAR
/** The widest the scroller's content may be — past it, centred on now. */
const MAX_INNER_PX = 12_000_000

/** A pinch has to change the finger spread this much to step the zoom. */
const PINCH_STEP = 1.3
/** A trackpad pinch (ctrl + wheel) accumulates this much delta per step. */
const WHEEL_STEP = 60

const OVER = "var(--status-error)"
const REST = "var(--muted-foreground)"

/** A colour at a share of its strength — works for a hex and a CSS variable. */
function tint(color: string, pct: number): string {
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`
}

function hatch(color: string): string {
  return `repeating-linear-gradient(135deg, ${tint(color, 70)} 0 3px, ${tint(color, 20)} 3px 6px)`
}

/** What runs past a limit: red stripes over whatever is beneath. */
const BREACH = `repeating-linear-gradient(135deg, ${OVER} 0 2px, transparent 2px 5px)`

/** The Quick Check's what-if, as the timeline draws it. */
export interface TimelineScenario {
  /** Every duty as the scenario leaves it. */
  blocks: DutyBlock[]
  /** The duties it took out, drawn as outlines where they were. */
  removed: DutyBlock[]
  /** How many problems the check found. */
  problems: number
}

type Selection = { kind: "duty" | "rest"; id: string } | null

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function startOfDay(ms: number, zulu: boolean): number {
  if (zulu) return Math.floor(ms / DAY) * DAY
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Day starts from `from` to `to` in the display clock (UTC when Zulu). */
function dayStarts(from: number, to: number, zulu: boolean): number[] {
  const out: number[] = []
  if (zulu) {
    for (let t = startOfDay(from, true); t <= to; t += DAY) out.push(t)
    return out
  }
  const d = new Date(startOfDay(from, false))
  while (d.getTime() <= to) {
    out.push(d.getTime())
    d.setDate(d.getDate() + 1) // calendar days, so a DST change is still one day
  }
  return out
}

/** Alternate days, consistently wherever the view is (a midnight is within 14h of a UTC one). */
function isBandedDay(dayStart: number): boolean {
  return ((Math.round(dayStart / DAY) % 2) + 2) % 2 === 1
}

export function DutyTimeline({
  blocks: logged,
  scenario = null,
  onClearScenario,
}: {
  blocks: DutyBlock[]
  scenario?: TimelineScenario | null
  onClearScenario?: () => void
}) {
  const blocks = scenario?.blocks ?? logged
  const removed = useMemo(() => scenario?.removed ?? [], [scenario])
  const { preferences } = usePreferences()
  const display = preferences.display
  const zulu = display.useZuluTime ?? true
  const zone = zulu ? "UTC" : localZone()
  const clock = useCallback((ms: number) => formatInstant(ms, display, zone), [display, zone])
  const duration = useCallback(
    (min: number) => formatHHMMDisplay(minutesToHHMM(Math.max(0, Math.round(min))), display.timeFormat === "12h" ? "24h" : display.timeFormat),
    [display.timeFormat],
  )
  // "MON 3": the weekday first, as a pilot reads a roster. One formatter for
  // each half, because a locale's own order for the pair puts the day first.
  const fmt = useMemo(() => {
    const wd = tzFormatter(zone, { weekday: "short" }, "wd")
    const dn = tzFormatter(zone, { day: "numeric" }, "dn")
    const dm = tzFormatter(zone, { day: "numeric", month: "short" }, "d-mon")
    const hr = tzFormatter(zone, { hour: "2-digit", hourCycle: "h23" }, "hh")
    return {
      day: (ms: number) => `${wd.format(new Date(ms))} ${dn.format(new Date(ms))}`,
      dayNumber: (ms: number) => dn.format(new Date(ms)),
      dayMonth: (ms: number) => dm.format(new Date(ms)),
      hour: (ms: number) => hr.format(new Date(ms)),
    }
  }, [zone])

  const [zoom, setZoom] = useState<Zoom>("7")
  const [width, setWidth] = useState(0)
  const [selection, setSelection] = useState<Selection>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // One clock reading per mount: the "Now" line and the opening view. The
  // page is not kept alive, so it is current every time it is opened.
  const [nowMs] = useState(() => Date.now())

  const spanDays = Number(zoom)
  const span = spanDays * DAY
  const pxPerMs = width > 0 ? width / span : 0

  // The axis runs years past the logbook either way — as good as endless to
  // scroll, while only what is near the view is ever drawn. At the finest
  // scale a career could outgrow what a browser will lay out, so the width is
  // capped and the range centred on now.
  const { rangeStart, rangeEnd } = useMemo(() => {
    let lo = nowMs
    let hi = nowMs
    for (const b of blocks) {
      if (b.startMs < lo) lo = b.startMs
      if (b.endMs > hi) hi = b.endMs
    }
    let a = lo - AXIS_PAD
    let z = hi + AXIS_PAD
    if (pxPerMs > 0 && (z - a) * pxPerMs > MAX_INNER_PX) {
      const half = MAX_INNER_PX / pxPerMs / 2
      a = Math.max(a, nowMs - half)
      z = Math.min(z, nowMs + half)
    }
    return { rangeStart: startOfDay(a, zulu), rangeEnd: z }
  }, [blocks, nowMs, pxPerMs, zulu])
  const xOf = useCallback((ms: number) => (ms - rangeStart) * pxPerMs, [rangeStart, pxPerMs])
  const wOf = useCallback((a: number, b: number) => Math.max(2, (b - a) * pxPerMs), [pxPerMs])

  // Where the view starts — moved by the scroll, quantised (an hour at 24
  // hours, a day otherwise) so a scroll re-renders only when that changes.
  const quantum = zoom === "1" ? HOUR : DAY
  const [viewStart, setViewStart] = useState<number | null>(null)
  // A time to hold at an x in the view across a scale change: the opening
  // view (now, a little left of centre), the centre across a tab change, the
  // pinch's midpoint across a pinch.
  const anchorRef = useRef<{ ms: number; x: number } | null>(null)

  // Width from a ResizeObserver: its first callback runs after layout, so the
  // mount reads nothing in the middle of a commit.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      setWidth((prev) => (prev === w ? prev : w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const readView = useCallback(() => {
    const el = scrollerRef.current
    if (!el || pxPerMs === 0) return
    const t = rangeStart + el.scrollLeft / pxPerMs
    const next = Math.floor(t / quantum) * quantum
    setViewStart((prev) => (prev === next ? prev : next))
  }, [pxPerMs, quantum, rangeStart])

  // Apply a pending anchor once the scale it needs is known, then read the
  // view in a frame (a scroll event follows only if scrollLeft moved).
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || pxPerMs === 0) return
    const anchor = anchorRef.current ?? (viewStart == null ? { ms: nowMs, x: width * 0.35 } : null)
    if (anchor) {
      anchorRef.current = null
      el.scrollLeft = Math.max(0, xOf(anchor.ms) - anchor.x)
    }
    const raf = requestAnimationFrame(readView)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on a scale change only; viewStart is read for the first run
  }, [pxPerMs, width, xOf, readView, nowMs])

  const scrollRaf = useRef(0)
  const handleScroll = useCallback(() => {
    if (scrollRaf.current) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0
      readView()
    })
  }, [readView])
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), [])

  // Bring a time to a share of the way across the view.
  const scrollToTime = useCallback(
    (ms: number, share: number) => {
      const el = scrollerRef.current
      if (!el || pxPerMs === 0) return
      const left = Math.max(0, xOf(ms) - width * share)
      // A jump of more than a few views goes straight there: smooth across
      // months is a long wait for nothing worth watching.
      el.scrollTo({ left, behavior: Math.abs(left - el.scrollLeft) > 3 * width ? "instant" : "smooth" })
    },
    [pxPerMs, width, xOf],
  )

  // Step the zoom, holding the time under `x` (a position in the view) still.
  const zoomTo = useCallback(
    (next: Zoom, x?: number) => {
      const el = scrollerRef.current
      if (next === zoom) return
      if (el && pxPerMs > 0) {
        const at = x ?? width / 2
        anchorRef.current = { ms: rangeStart + (el.scrollLeft + at) / pxPerMs, x: at }
      }
      setZoom(next)
    },
    [pxPerMs, rangeStart, width, zoom],
  )
  const latest = useRef({ zoom, zoomTo, scrollToTime })
  useEffect(() => {
    latest.current = { zoom, zoomTo, scrollToTime }
  })

  // A new what-if is shown where it changed the roster.
  useEffect(() => {
    if (!scenario) return
    const changed = [...scenario.blocks.filter((b) => b.scenario), ...scenario.removed].sort((a, b) => a.startMs - b.startMs)
    if (changed[0]) latest.current.scrollToTime(changed[0].startMs, 0.3)
  }, [scenario])

  // Pinch: two fingers apart steps to a shorter span, together to a longer
  // one. Native listeners, because a passive React touchmove cannot stop the
  // browser zooming the page instead.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    let base = 0
    let wheel = 0
    const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const midX = (t: TouchList) => (t[0].clientX + t[1].clientX) / 2 - el.getBoundingClientRect().left
    const step = (dir: -1 | 1, x: number) => {
      const { zoom: z, zoomTo: go } = latest.current
      const i = ZOOM_ORDER.indexOf(z) + dir
      if (i >= 0 && i < ZOOM_ORDER.length) go(ZOOM_ORDER[i], x)
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) base = spread(e.touches)
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || base === 0) return
      e.preventDefault()
      const d = spread(e.touches)
      if (d / base >= PINCH_STEP) {
        step(-1, midX(e.touches))
        base = d
      } else if (base / d >= PINCH_STEP) {
        step(1, midX(e.touches))
        base = d
      }
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) base = 0
    }
    // A trackpad pinch arrives as a ctrl-wheel; a plain wheel scrolls the page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      wheel += e.deltaY
      if (Math.abs(wheel) >= WHEEL_STEP) {
        step(wheel > 0 ? 1 : -1, e.clientX - el.getBoundingClientRect().left)
        wheel = 0
      }
    }
    // Safari's own pinch gesture, which would otherwise zoom the page.
    const onGesture = (e: Event) => e.preventDefault()
    el.addEventListener("touchstart", onStart, { passive: true })
    el.addEventListener("touchmove", onMove, { passive: false })
    el.addEventListener("touchend", onEnd, { passive: true })
    el.addEventListener("touchcancel", onEnd, { passive: true })
    el.addEventListener("wheel", onWheel, { passive: false })
    el.addEventListener("gesturestart", onGesture)
    return () => {
      el.removeEventListener("touchstart", onStart)
      el.removeEventListener("touchmove", onMove)
      el.removeEventListener("touchend", onEnd)
      el.removeEventListener("touchcancel", onEnd)
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("gesturestart", onGesture)
    }
  }, [])

  const viewFrom = viewStart ?? nowMs - span * 0.35
  const viewTo = viewFrom + span
  const drawFrom = viewFrom - span
  const drawTo = viewTo + span
  const nowInView = nowMs >= viewFrom && nowMs <= viewTo
  const summary = useMemo(() => summarizeTimeline(blocks, viewFrom, viewTo), [blocks, viewFrom, viewTo])
  const visible = useMemo(
    () =>
      blocks.filter(
        (b) => Math.max(b.endMs, b.showMax ? (b.latestSignOffMs ?? 0) : 0) > drawFrom && (b.restBefore?.startMs ?? b.startMs) < drawTo,
      ),
    [blocks, drawFrom, drawTo],
  )
  const ghosts = useMemo(() => removed.filter((b) => b.endMs > drawFrom && b.startMs < drawTo), [removed, drawFrom, drawTo])
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks])

  // The axis: midnight rules, and the ticks between them the zoom can carry.
  const axis = useMemo(() => {
    const dayPx = DAY * pxPerMs
    const shown = pxPerMs > 0 ? dayStarts(Math.max(drawFrom, rangeStart), Math.min(drawTo, rangeEnd), zulu) : []
    // At 28 days a cell is ~11px: label every Nth day so labels never touch.
    const every = dayPx >= 40 ? 1 : Math.ceil(22 / Math.max(1, dayPx))
    const ticks: { ms: number; label: string }[] = []
    if (zoom !== "28") {
      const stepH = zoom === "1" ? 1 : 6
      for (const d of shown) for (let h = stepH; h < 24; h += stepH) ticks.push({ ms: d + h * HOUR, label: zoom === "1" && h % 6 === 0 ? fmt.hour(d + h * HOUR) : "" })
    }
    return { shown, every, ticks, full: dayPx >= 40 }
  }, [drawFrom, drawTo, fmt, pxPerMs, rangeEnd, rangeStart, zoom, zulu])

  const selectedDuty = selection?.kind === "duty" ? (byId.get(selection.id) ?? null) : null
  const restAfter = selection?.kind === "rest" ? (byId.get(selection.id) ?? null) : null
  const restBefore = restAfter?.restBefore ? (byId.get(restAfter.restBefore.previousId) ?? null) : null

  const toggle = useCallback(
    (kind: "duty" | "rest", id: string) => setSelection((cur) => (cur?.kind === kind && cur.id === id ? null : { kind, id })),
    [],
  )
  // From a rest's detail to one of its duties: select it and bring it into view.
  const showDuty = useCallback(
    (b: DutyBlock) => {
      setSelection({ kind: "duty", id: b.id })
      const el = scrollerRef.current
      if (!el || pxPerMs === 0) return
      if (xOf(b.startMs) < el.scrollLeft || xOf(b.endMs) > el.scrollLeft + width) scrollToTime(b.startMs, 0.2)
    },
    [pxPerMs, scrollToTime, width, xOf],
  )

  const innerWidth = Math.max(width, (rangeEnd - rangeStart) * pxPerMs)
  const rangeText =
    zoom === "1"
      ? `${fmt.dayMonth(viewFrom)} ${clock(viewFrom)} – ${fmt.dayMonth(viewTo)} ${clock(viewTo)}`
      : `${fmt.dayMonth(viewFrom)} – ${fmt.dayMonth(viewTo - 1)}`

  // Labels, placed left to right per row; one that would overlap the last
  // placed is left out. A label may be wider than its bar — it sits centred
  // over it — so a duty a few pixels wide at 7 days still says how long it
  // was. Each takes the longest of its forms that fits the room it has.
  const labels = useMemo(() => {
    const out: Label[] = []
    const place = (items: Label[]) => {
      items.sort((a, b) => a.x - b.x)
      let right = -Infinity
      for (const l of items) {
        const half = (l.text.length * CHAR_PX) / 2
        if (l.x - half < right + LABEL_GAP) continue
        out.push(l)
        right = l.x + half
      }
    }
    const fits = (forms: string[], room: number) => forms.find((t) => t.length * CHAR_PX + 8 <= room) ?? forms[forms.length - 1]
    const duty: Label[] = []
    const rest: Label[] = []
    for (const b of visible) {
      const left = xOf(b.startMs)
      const reach = b.showMax && b.latestSignOffMs != null ? Math.max(b.endMs, b.latestSignOffMs) : b.endMs
      const room = xOf(reach) - left
      const dur = duration(b.dutyMinutes)
      const max = b.showMax ? `max ${duration(b.maxFdpMinutes)}` : ""
      const flown = b.sectors.filter((s) => !s.positioning)
      // At 24 hours a sector carries its own block time inside the bar, so
      // the duty's label does not repeat it.
      const inside = flown.some((s) => xOf(s.inMs) - xOf(s.outMs) >= sectorText(s, duration).length * CHAR_PX + 6)
      const flight = flown.length > 0 && !inside ? `${duration(b.flightMinutes)} flight` : ""
      const name = b.kind === "flight" ? b.route : b.code
      const forms =
        b.kind === "flight"
          ? [
              [dur, flight, max, name].filter(Boolean).join(" · "),
              [dur, flight, max].filter(Boolean).join(" · "),
              [dur, max].filter(Boolean).join(" · "),
              dur,
            ]
          : [`${b.code} ${dur}`]
      duty.push({ key: `d${b.id}`, row: "duty", x: left + Math.min(room, xOf(b.endMs) - left) / 2, text: fits(forms, room), tone: b.limit === "over" ? "over" : null })

      const r = b.restBefore
      if (r) {
        const a = xOf(r.startMs)
        const z = xOf(b.startMs)
        const rd = duration(r.minutes)
        const short = r.status === "short"
        const forms = r.requiredMinutes != null ? [`${rd} · ${short ? "need" : "min"} ${duration(r.requiredMinutes)}`, rd] : [rd]
        rest.push({ key: `r${b.id}`, row: "rest", x: (a + z) / 2, text: fits(forms, z - a), tone: short ? "over" : null })
      }
    }
    place(duty)
    place(rest)
    return out
  }, [visible, xOf, duration])

  // The verdict for what is in view, said in words beside the figures.
  const nearCount = useMemo(
    () => blocks.filter((b) => b.startMs < viewTo && b.endMs > viewFrom && (b.limit === "near" || b.restBefore?.status === "tight")).length,
    [blocks, viewFrom, viewTo],
  )

  return (
    <FormSection title="Duty Timeline">
      <div className="space-y-2.5 px-3 pb-3 pt-1">
        <div className="flex items-center justify-between gap-2">
          <SegmentedTabs tabs={ZOOMS} value={zoom} onChange={(z) => zoomTo(z)} />
          <button
            type="button"
            onClick={() => scrollToTime(nowMs, 0.35)}
            disabled={nowInView}
            className="control-surface h-9 shrink-0 rounded-full px-3.5 text-sm font-medium transition-opacity disabled:opacity-40"
          >
            Now
          </button>
        </div>
        <p className="px-1 text-xs font-medium text-muted-foreground tabular-nums">{rangeText}</p>

        {scenario && (
          <div className="flex items-center justify-between gap-2 rounded-lg py-1 pl-3 pr-1" style={{ background: tint(FDP_COLORS.scenario, 14) }}>
            <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold" style={{ color: FDP_COLORS.scenario }}>
              {scenario.problems > 0 ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              <span className="truncate">
                What-If · {scenario.problems > 0 ? `${scenario.problems} problem${scenario.problems === 1 ? "" : "s"}` : "Legal"}
              </span>
            </p>
            {onClearScenario && (
              <button type="button" onClick={onClearScenario} className="control-surface h-9 shrink-0 rounded-full px-3.5 text-sm font-medium">
                Clear
              </button>
            )}
          </div>
        )}

        {/* How much, in view: flight, duty, and the shortest rest. */}
        <div className="grid grid-cols-3 gap-2 px-1">
          <Figure value={duration(summary.flightMinutes)} caption="Flight" color={FDP_COLORS.flight} />
          <Figure value={duration(summary.dutyMinutes)} caption="Duty" color={FDP_COLORS.duty} />
          <Figure
            value={summary.shortestRestMinutes == null ? "—" : duration(summary.shortestRestMinutes)}
            caption="Shortest Rest"
            alert={summary.shortRests > 0}
          />
        </div>
        <Verdict over={summary.overLimit} short={summary.shortRests} near={nearCount} duties={summary.duties} />

        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="relative overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-lg border border-border/60 bg-card scrollbar-hide"
          style={{ height: CHART_H, touchAction: "pan-x pan-y" }}
          role="group"
          aria-label="Duty timeline"
        >
          {pxPerMs > 0 && (
            <div className="relative h-full" style={{ width: innerWidth }}>
              {/* Every other day banded, so a day reads as a column. */}
              {axis.shown.map((d) =>
                isBandedDay(d) ? (
                  <div key={`band${d}`} className="pointer-events-none absolute bottom-0 bg-foreground/[0.04]" style={{ left: xOf(d), width: DAY * pxPerMs, top: AXIS_H }} />
                ) : null,
              )}
              <div className="pointer-events-none absolute inset-x-0 border-t border-border/50" style={{ top: AXIS_H }} />

              {axis.ticks.map((t) => (
                <div key={t.ms} className="pointer-events-none absolute border-l border-border/30" style={{ left: xOf(t.ms), top: AXIS_H - 5, height: 5 }}>
                  {t.label && (
                    <span className="absolute -translate-x-1/2 text-[10px] leading-[12px] tabular-nums text-muted-foreground" style={{ top: 1 - (AXIS_H - 5) }}>
                      {t.label}
                    </span>
                  )}
                </div>
              ))}
              {axis.shown.map((d, i) => (
                <div key={d} className="pointer-events-none absolute inset-y-0 border-l border-border/60" style={{ left: xOf(d) }}>
                  {(axis.full || i % axis.every === 0) && (
                    <span className="absolute left-1 top-px whitespace-nowrap text-[10px] font-semibold uppercase leading-[12px] tracking-wide text-muted-foreground">
                      {axis.full ? fmt.day(d) : fmt.dayNumber(d)}
                    </span>
                  )}
                </div>
              ))}

              {/* A duty the what-if took out — an outline where it was. */}
              {ghosts.map((b) => (
                <span
                  key={`x${b.id}`}
                  className="pointer-events-none absolute rounded-md border-2 border-dashed"
                  style={{ left: xOf(b.startMs), width: wOf(b.startMs, b.endMs), top: DUTY_Y, height: DUTY_H, borderColor: tint(FDP_COLORS.scenario, 70), background: `repeating-linear-gradient(135deg, ${tint(FDP_COLORS.scenario, 25)} 0 2px, transparent 2px 6px)` }}
                  aria-hidden
                />
              ))}

              {visible.map((b) => (
                <DutyDeck
                  key={b.id}
                  block={b}
                  xOf={xOf}
                  wOf={wOf}
                  clock={clock}
                  duration={duration}
                  dutySelected={selection?.kind === "duty" && selection.id === b.id}
                  restSelected={selection?.kind === "rest" && selection.id === b.id}
                  onSelect={toggle}
                />
              ))}

              {labels.map((l) => (
                <span
                  key={l.key}
                  className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold leading-[14px] tabular-nums"
                  style={{ left: l.x, top: l.row === "duty" ? DUTY_LABEL_Y : REST_LABEL_Y, color: l.tone === "over" ? OVER : l.row === "rest" ? "var(--muted-foreground)" : "var(--foreground)" }}
                >
                  {l.text}
                </span>
              ))}

              {/* Now — between what has happened and what is planned. */}
              {nowMs > drawFrom && nowMs < drawTo && (
                <div className="pointer-events-none absolute bottom-0 z-10 border-l-2 border-dashed border-foreground/60" style={{ left: xOf(nowMs), top: NOW_Y }}>
                  <span className="absolute -left-3.5 top-0 rounded bg-foreground px-1 text-[9px] font-semibold uppercase leading-[12px] text-background">
                    Now
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* The key. A limit is not a colour of its own: the maximum is a
            dotted outline, the minimum rest a solid bar, and what runs past
            either is struck red — the verdict line says it in words. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground" aria-hidden>
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: tint(FDP_COLORS.duty, 45) }} />} label="Duty" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: tint(FDP_COLORS.flight, 90) }} />} label="Flight" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm border-2 border-dotted" style={{ borderColor: FDP_COLORS.planned }} />} label="Max FDP" />
          <Key swatch={<span className="h-2 w-3.5 rounded-sm" style={{ background: tint(REST, 80) }} />} label="Minimum Rest" />
          <Key swatch={<span className="h-2 w-3.5 rounded-sm" style={{ background: tint(REST, 28) }} />} label="Rest" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm border border-dashed" style={{ borderColor: FDP_COLORS.planned, background: tint(FDP_COLORS.planned, 30) }} />} label="Planned" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: hatch(FDP_COLORS.duty) }} />} label="Standby / Ground" />
          {scenario && <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: tint(FDP_COLORS.scenario, 45) }} />} label="What-If" />}
        </div>

        {selectedDuty && <DutyDetail block={selectedDuty} clock={clock} duration={duration} onClose={() => setSelection(null)} />}
        {restAfter?.restBefore && (
          <RestDetail
            after={restAfter}
            before={restBefore}
            clock={clock}
            duration={duration}
            onDuty={showDuty}
            onClose={() => setSelection(null)}
          />
        )}
      </div>
    </FormSection>
  )
}

interface Label {
  key: string
  row: "duty" | "rest"
  x: number
  text: string
  tone: "over" | null
}

/** What a sector says inside the bar: its block time. */
function sectorText(s: DutyBlock["sectors"][number], duration: (min: number) => string): string {
  return duration((s.inMs - s.outMs) / MIN)
}

function Figure({ value, caption, color, alert }: { value: string; caption: string; color?: string; alert?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={cn("text-xl font-semibold leading-tight tabular-nums", alert && "text-status-error")} style={!alert && color ? { color } : undefined}>
        {value}
      </div>
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{caption}</div>
    </div>
  )
}

/** The view's verdict against the limits, in a sentence. */
function Verdict({ over, short, near, duties }: { over: number; short: number; near: number; duties: number }) {
  if (duties === 0) return <p className="px-1 text-xs text-muted-foreground">No duties in view.</p>
  const bad = [over > 0 ? `${over} ${over === 1 ? "duty" : "duties"} over the FDP limit` : "", short > 0 ? `${short} rest${short === 1 ? "" : "s"} short` : ""].filter(Boolean)
  if (bad.length > 0) {
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs font-semibold text-status-error">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {bad.join(" · ")}
      </p>
    )
  }
  return (
    <p className={cn("flex items-center gap-1.5 px-1 text-xs font-medium", near > 0 ? "text-status-critical" : "text-muted-foreground")}>
      {near > 0 ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-status-valid" aria-hidden />}
      {near > 0 ? `Within limits · ${near} close to a limit` : "Within limits · every rest met"}
    </p>
  )
}

function Key({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1">
      {swatch}
      {label}
    </span>
  )
}

/** A tap target at least `HIT_MIN` wide, centred on the bar it opens. */
function hit(left: number, width: number): { left: number; width: number; inset: number } {
  if (width >= HIT_MIN) return { left, width, inset: 0 }
  const pad = (HIT_MIN - width) / 2
  return { left: left - pad, width: HIT_MIN, inset: pad }
}

/**
 * One duty's deck: the duty bar with its sectors inside, its maximum dotted
 * round it while it is still to come, and the rest before it directly under.
 */
function DutyDeck({
  block: b,
  xOf,
  wOf,
  clock,
  duration,
  dutySelected,
  restSelected,
  onSelect,
}: {
  block: DutyBlock
  xOf: (ms: number) => number
  wOf: (a: number, b: number) => number
  clock: (ms: number) => string
  duration: (min: number) => string
  dutySelected: boolean
  restSelected: boolean
  onSelect: (kind: "duty" | "rest", id: string) => void
}) {
  const future = b.isFuture
  const base = b.scenario ? FDP_COLORS.scenario : future ? FDP_COLORS.planned : FDP_COLORS.duty
  const flightColor = b.scenario ? FDP_COLORS.scenario : future ? FDP_COLORS.planned : FDP_COLORS.flight
  // In-bar text: dark on the planned yellow and the what-if orange, light on the flown green.
  const inkOnFlight = b.scenario || future ? "#1c1917" : "#ffffff"
  const left = xOf(b.startMs)
  const width = wOf(b.startMs, b.endMs)
  const h = hit(left, width)
  const name = b.kind === "flight" ? b.route || "Duty" : b.kind === "standby" ? "Standby" : `Ground duty ${b.code}`
  const ring = "ring-2 ring-primary ring-offset-1 ring-offset-card"
  const verdict = b.limit === "over" ? ", over the FDP limit" : ""
  const latest = b.latestSignOffMs
  const breachFrom = latest != null && b.endMs > latest ? Math.max(latest, b.startMs) : null

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect("duty", b.id)}
        aria-pressed={dutySelected}
        aria-label={`${name}, ${clock(b.startMs)}–${clock(b.endMs)}, duty ${duration(b.dutyMinutes)}${b.flightMinutes > 0 ? `, flight ${duration(b.flightMinutes)}` : ""}${b.showMax && latest != null ? `, latest sign-off ${clock(latest)}` : ""}${verdict}${b.scenario ? ", what-if" : future ? ", planned" : ""}`}
        className="absolute"
        style={{ left: h.left, width: h.width, top: DUTY_LABEL_Y, height: DUTY_Y + DUTY_H - DUTY_LABEL_Y }}
      >
        <span
          className={cn("absolute rounded-md", (future || b.scenario) && "border border-dashed", dutySelected && ring)}
          style={{
            left: h.inset,
            top: DUTY_Y - DUTY_LABEL_Y,
            height: DUTY_H,
            width,
            borderColor: base,
            background: b.kind === "flight" ? tint(base, future || b.scenario ? 28 : 45) : hatch(base),
          }}
        />
      </button>

      {/* The flying, inside the duty. */}
      {b.sectors.map((s) => {
        const sl = xOf(s.outMs)
        const sw = wOf(s.outMs, s.inMs)
        const text = sectorText(s, duration)
        return (
          <span
            key={s.id}
            className={cn("pointer-events-none absolute flex items-center justify-center overflow-hidden rounded-sm", s.positioning && "border border-dashed")}
            style={{
              left: sl,
              width: sw,
              top: DUTY_Y + SECTOR_INSET,
              height: DUTY_H - 2 * SECTOR_INSET,
              borderColor: flightColor,
              background: s.positioning ? "transparent" : tint(flightColor, 90),
            }}
          >
            {!s.positioning && sw >= text.length * CHAR_PX + 6 && (
              <span className="text-[10px] font-semibold leading-none tabular-nums" style={{ color: inkOnFlight }}>
                {text}
              </span>
            )}
          </span>
        )
      })}

      {/* The maximum, dotted round the whole window it allows. */}
      {b.showMax && latest != null && latest > b.startMs && (
        <span
          className="pointer-events-none absolute rounded-md border-2 border-dotted"
          style={{ left, width: wOf(b.startMs, latest), top: DUTY_Y, height: DUTY_H, borderColor: base }}
          aria-hidden
        />
      )}
      {/* What ran past the maximum. */}
      {breachFrom != null && (
        <span className="pointer-events-none absolute rounded-r-md" style={{ left: xOf(breachFrom), width: wOf(breachFrom, b.endMs), top: DUTY_Y, height: DUTY_H, background: BREACH }} aria-hidden />
      )}

      {b.restBefore && (
        <RestBar rest={b.restBefore} signOnMs={b.startMs} future={future} selected={restSelected} xOf={xOf} wOf={wOf} duration={duration} onSelect={() => onSelect("rest", b.id)} />
      )}
    </>
  )
}

/**
 * The rest before a duty, decked under it: the minimum the regulation
 * required (solid), then the rest beyond it to the sign-on (light). A
 * minimum that runs past the sign-on is struck red there, directly under the
 * duty that came too soon.
 */
function RestBar({
  rest,
  signOnMs,
  future,
  selected,
  xOf,
  wOf,
  duration,
  onSelect,
}: {
  rest: RestBefore
  signOnMs: number
  future: boolean
  selected: boolean
  xOf: (ms: number) => number
  wOf: (a: number, b: number) => number
  duration: (min: number) => string
  onSelect: () => void
}) {
  const left = xOf(rest.startMs)
  const width = wOf(rest.startMs, signOnMs)
  const h = hit(left, width)
  const short = rest.status === "short"
  const minEnd = rest.minimumEndMs
  return (
    <>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Rest ${duration(rest.minutes)}${rest.requiredMinutes != null ? `, minimum ${duration(rest.requiredMinutes)}` : ""}${short ? ", short" : ""}`}
        className="absolute"
        style={{ left: h.left, width: h.width, top: REST_Y, height: REST_LABEL_Y + LABEL_H - REST_Y }}
      >
        <span
          className={cn("absolute rounded-b-sm", future && "border border-t-0 border-dashed", selected && "ring-2 ring-primary ring-offset-1 ring-offset-card")}
          style={{ left: h.inset, top: 0, height: REST_H, width, borderColor: REST, background: tint(REST, future ? 18 : 28) }}
        />
      </button>
      {minEnd != null && (
        <span
          className="pointer-events-none absolute rounded-bl-sm"
          style={{ left, width: wOf(rest.startMs, Math.min(minEnd, signOnMs)), top: REST_Y, height: REST_H, background: tint(REST, future ? 60 : 80) }}
          aria-hidden
        />
      )}
      {minEnd != null && minEnd > signOnMs && (
        // The rest still owed when the next duty signed on.
        <span className="pointer-events-none absolute rounded-br-sm" style={{ left: xOf(signOnMs), width: wOf(signOnMs, minEnd), top: REST_Y, height: REST_H, background: BREACH }} aria-hidden />
      )}
    </>
  )
}

function DetailHeader({ title, subtitle, tag, onClose, closeLabel }: { title: string; subtitle: string; tag?: React.ReactNode; onClose: () => void; closeLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">
          {title}
          {tag}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">{subtitle}</p>
      </div>
      <button type="button" onClick={onClose} aria-label={closeLabel} className="control-surface flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/** "22:13Z · sched 21:50Z" — the schedule said only where it differs. */
function withScheduled(actual: number, scheduled: number | undefined, clock: (ms: number) => string): string {
  if (scheduled == null || Math.abs(actual - scheduled) < MIN) return clock(actual)
  return `${clock(actual)} · sched ${clock(scheduled)}`
}

/** A row whose value carries a verdict colour. */
function VerdictRow({ label, value, tone }: { label: string; value: string; tone: "over" | "near" | null }) {
  return (
    <div className="row-divider flex items-center justify-between gap-3 px-4 py-3.5">
      <span className="shrink-0 text-foreground">{label}</span>
      <span className={cn("min-w-0 text-right", tone === "over" ? "font-semibold text-status-error" : tone === "near" ? "font-medium text-status-critical" : "text-muted-foreground")}>
        {value}
      </span>
    </div>
  )
}

function DutyDetail({
  block: b,
  clock,
  duration,
  onClose,
}: {
  block: DutyBlock
  clock: (ms: number) => string
  duration: (min: number) => string
  onClose: () => void
}) {
  const regs = Array.from(new Set(b.sectors.map((s) => s.registration).filter(Boolean)))
  const aircraft = [b.types.join(", "), regs.join(", ")].filter(Boolean).join(" · ")
  const rest = b.restBefore
  const title = b.kind === "flight" ? b.route || "Duty" : b.kind === "standby" ? "Standby" : b.code
  const fdp =
    b.maxFdpMinutes > 0
      ? `${duration(b.fdpMinutes)} of ${duration(b.maxFdpMinutes)} max${b.limit === "over" ? ` · over by ${duration(b.fdpMinutes - b.maxFdpMinutes)}` : ""}`
      : ""
  return (
    <div className="space-y-2 pt-1">
      <DetailHeader
        title={title}
        subtitle={`${clock(b.startMs)} – ${clock(b.endMs)}`}
        tag={
          b.scenario ? (
            <span className="ml-1.5 text-xs font-medium" style={{ color: FDP_COLORS.scenario }}>What-If</span>
          ) : b.isFuture ? (
            <span className="ml-1.5 text-xs font-medium" style={{ color: FDP_COLORS.planned }}>Planned</span>
          ) : undefined
        }
        onClose={onClose}
        closeLabel="Close duty details"
      />
      <div className="overflow-hidden rounded-xl border bg-card">
        <ReadOnlyRow label="Sign-On" value={withScheduled(b.startMs, b.planned?.startMs, clock)} />
        <ReadOnlyRow label="Sign-Off" value={withScheduled(b.endMs, b.planned?.endMs, clock)} />
        <ReadOnlyRow label="Duty" value={duration(b.dutyMinutes)} />
        {fdp && <VerdictRow label="FDP" value={fdp} tone={b.limit} />}
        {b.showMax && b.latestSignOffMs != null && <ReadOnlyRow label="Latest Sign-Off" value={clock(b.latestSignOffMs)} />}
        {b.kind === "standby" && b.limit === "over" && <VerdictRow label="Limit" value="Over the 18:00 standby cap" tone="over" />}
        {b.kind === "flight" && <ReadOnlyRow label="Flight Time" value={duration(b.flightMinutes)} />}
        {b.kind === "flight" && <ReadOnlyRow label="Sectors" value={String(b.sectors.length)} />}
        {aircraft && <ReadOnlyRow label="Aircraft" value={aircraft} />}
        {rest && (
          <VerdictRow
            label="Rest Before"
            value={rest.requiredMinutes ? `${duration(rest.minutes)} of ${duration(rest.requiredMinutes)} required` : duration(rest.minutes)}
            tone={rest.status === "short" ? "over" : rest.status === "tight" ? "near" : null}
          />
        )}
      </div>
      {b.sectors.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          {b.sectors.map((s) => (
            <div key={s.id} className="row-divider flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {s.flightNumber || "—"} <span className="text-muted-foreground">{s.from}–{s.to}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[s.type, s.registration, s.positioning ? "Positioning" : "", s.planned ? "Scheduled" : ""].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm tabular-nums">{clock(s.outMs)} – {clock(s.inMs)}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{duration((s.inMs - s.outMs) / MIN)}</p>
                {!s.planned && s.scheduled && (Math.abs(s.scheduled.startMs - s.outMs) >= MIN || Math.abs(s.scheduled.endMs - s.inMs) >= MIN) && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    sched {clock(s.scheduled.startMs)} – {clock(s.scheduled.endMs)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RestDetail({
  after,
  before,
  clock,
  duration,
  onDuty,
  onClose,
}: {
  after: DutyBlock
  before: DutyBlock | null
  clock: (ms: number) => string
  duration: (min: number) => string
  onDuty: (b: DutyBlock) => void
  onClose: () => void
}) {
  const rest = after.restBefore!
  const short = rest.status === "short"
  const owed = rest.requiredMinutes != null ? rest.requiredMinutes - rest.minutes : null
  return (
    <div className="space-y-2 pt-1">
      <DetailHeader
        title={`Rest ${duration(rest.minutes)}`}
        subtitle={`${clock(rest.startMs)} – ${clock(after.startMs)}`}
        tag={
          short ? (
            <span className="ml-1.5 text-xs font-semibold text-status-error">Short</span>
          ) : rest.status === "tight" ? (
            <span className="ml-1.5 text-xs font-semibold text-status-critical">Close to Minimum</span>
          ) : undefined
        }
        onClose={onClose}
        closeLabel="Close rest details"
      />
      <div className="overflow-hidden rounded-xl border bg-card">
        <VerdictRow label="Rest" value={duration(rest.minutes)} tone={short ? "over" : rest.status === "tight" ? "near" : null} />
        {rest.requiredMinutes != null && <ReadOnlyRow label="Minimum" value={duration(rest.requiredMinutes)} />}
        {rest.minimumEndMs != null && <ReadOnlyRow label="Minimum Until" value={clock(rest.minimumEndMs)} />}
        {short && owed != null && owed > 0 && <VerdictRow label="Short By" value={duration(owed)} tone="over" />}
        {!short && owed != null && <ReadOnlyRow label="Margin" value={duration(-owed)} />}
        <ReadOnlyRow label="Commenced" value={clock(rest.startMs)} />
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {before && <NeighbourRow caption="Before" block={before} when={`Sign-off ${clock(before.endMs)}`} onSelect={() => onDuty(before)} />}
        <NeighbourRow caption="After" block={after} when={`Sign-on ${clock(after.startMs)}`} onSelect={() => onDuty(after)} />
      </div>
    </div>
  )
}

function NeighbourRow({ caption, block: b, when, onSelect }: { caption: string; block: DutyBlock; when: string; onSelect: () => void }) {
  const name = b.kind === "flight" ? b.route || "Duty" : b.kind === "standby" ? "Standby" : b.code
  return (
    <button type="button" onClick={onSelect} className="row-divider flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{caption}</p>
        <p className="truncate text-sm font-medium">{name}</p>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground tabular-nums">
        {when}
        <ChevronRight className="h-4 w-4" />
      </span>
    </button>
  )
}
