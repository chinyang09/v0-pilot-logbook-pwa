"use client"

/**
 * The FDP page's timeline — the rolling limits and the duties that make them,
 * on ONE time axis, read at ONE pointer:
 *
 *    3 Nov          4 Nov          5 Nov            ← dates; gridlines full height
 *   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  90h       ← the limit
 *        ╱‾‾‾‾‾‾‾‾╲___╱‾‾‾‾‾┆‾ ‾ ‾ ‾ ‾             ← the rolling total, flown then scheduled
 *   ▐░▓▓▓░▓▓▓░▌┈┈┈┈┈┊       ┆ ▐░▓▓▓░▌               ← duty, its sectors inside, max FDP dotted
 *   ▒▒▒▒▒████████▒▒▒▒▒▒▒▒▒▒┆▒                      ← rest: the minimum solid, then the rest
 *                          ┆
 *                       pointer — everything above is read HERE, to the minute
 *
 * The rolling total is the pipeline's window at an INSTANT (`rolling-at.ts`):
 * a duty in progress counts as far as it has gone, so the line is exact at any
 * zoom, and the pointer reads it to the minute. Both halves sit in one
 * scroller, so they cannot fall out of step.
 *
 * Swipe to move; pinch (ctrl-wheel on a trackpad, or − / +) to zoom smoothly,
 * holding the time under the fingers still. "Now" brings the pointer back to
 * the present. Tap a duty or a rest to open it under the chart; tap the
 * rolling chart to bring that time to the pointer.
 *
 * Plain positioned elements and one SVG, not a chart library, and only what is
 * within a view either side of the screen is drawn — a career is thousands of
 * duties on one axis.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { AlertTriangle, ChevronRight, Minus, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow } from "@/components/ui/settings-row"
import { usePreferences } from "@/components/providers/preferences-provider"
import { FDP_COLORS } from "@/components/roster/fdp-colors"
import { formatInstant, tzFormatter } from "@/lib/utils/tz-format"
import { formatHHMMDisplay, minutesToHHMM } from "@/lib/utils/time"
import { pointerState, REST_RULE_LABEL, type DutyBlock, type RestBefore } from "@/lib/utils/roster/duty-timeline"
import { createRollingIndex, rollingAt, rollingSeries, type RollingIndex, type RollingKind } from "@/lib/utils/roster/rolling-at"
import { analyseDaysOff } from "@/lib/utils/roster/days-off"
import type { ForecastResult, FTLLimits } from "@/types/entities/roster.types"

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const YEAR = 365 * DAY

/** How much time the view spans, and the bounds of a zoom. */
const DEFAULT_SPAN = 7 * DAY
const MIN_SPAN = 3 * HOUR
const MAX_SPAN = 180 * DAY

/** Geometry, px — the date header, the rolling chart, then the duty deck. */
const AXIS_H = 22
const ROLL_TOP = AXIS_H + 10
const ROLL_H = 120
const DUTY_Y = ROLL_TOP + ROLL_H + 10
const DUTY_H = 36
const REST_Y = DUTY_Y + DUTY_H
const REST_H = 14
const LABEL_H = 14
const REST_LABEL_Y = REST_Y + REST_H + 3
const CHART_H = REST_LABEL_Y + LABEL_H + 5
/** Where the rolling chart's own floor sits in its fill, which carries on fainter behind the duties. */
const ROLL_FLOOR = ROLL_H / (CHART_H - ROLL_TOP)
/** The narrowest a tap target gets, centred on a bar narrower than it. */
const HIT_MIN = 28
/** Labels are 11px semibold tabular figures; this is a character's width. */
const CHAR_PX = 6.6
const LABEL_GAP = 6
/** The fewest pixels between two labelled gridlines. */
const TICK_MIN_PX = 42

/** How far the axis runs past the logbook (and now), either way. */
const AXIS_PAD = 3 * YEAR
/** The widest the scroller's content may be — past it, centred on now. */
const MAX_INNER_PX = 12_000_000

/** A trackpad pinch (ctrl + wheel): how strongly a unit of delta zooms. */
const WHEEL_ZOOM = 0.004

/** Para 13(1)(c) and para 3(2): what a pilot-in-command's discretion can cover. */
const PIC_FDP_DISCRETION_MIN = 3 * 60
const PIC_REST_DISCRETION_MIN = 2 * 60

/** A duty that is not a flight duty period, by the code the timeline gives it. */
const NOT_FDP: Record<string, string | undefined> = { SIM: "Simulator", POS: "Positioning" }

const OVER = "var(--status-error)"
const SGT_ZONE = "Asia/Singapore"
const REST = "var(--muted-foreground)"
const NEAR_LIMIT = "#b08040"

/** A colour at a share of its strength — works for a hex and a CSS variable. */
function tint(color: string, pct: number): string {
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`
}

function hatch(color: string): string {
  return `repeating-linear-gradient(135deg, ${tint(color, 70)} 0 3px, ${tint(color, 20)} 3px 6px)`
}

/** What runs past a limit: red stripes over whatever is beneath. */
const BREACH = `repeating-linear-gradient(135deg, ${OVER} 0 2px, transparent 2px 5px)`

/** Text over a bar: the foreground, lifted off whatever colour is under it. */
const ON_BAR = { color: "var(--foreground)", textShadow: "0 0 3px var(--background), 0 0 1px var(--background)" }

/** The Quick Check's what-if, as the timeline draws it. */
export interface TimelineScenario {
  /** Every duty as the scenario leaves it. */
  blocks: DutyBlock[]
  /** The duties it took out, drawn as outlines where they were. */
  removed: DutyBlock[]
  /** How many problems the check found. */
  problems: number
}

interface RollingView {
  key: RollingKind
  label: string
  /** The limit, minutes. */
  limit: number
  limitName: string
  color: string
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

/** A day's number — consecutive across the axis (a midnight is within 14h of a UTC one). */
const dayNumber = (dayStart: number) => Math.round(dayStart / DAY)

/** The gridline step: the finest that leaves room for a label. */
const STEPS_H = [1, 2, 3, 6, 12, 24, 48, 24 * 7, 24 * 14, 24 * 28]
function gridStepHours(pxPerMs: number): number {
  return STEPS_H.find((h) => h * HOUR * pxPerMs >= TICK_MIN_PX) ?? STEPS_H[STEPS_H.length - 1]
}

/** A tiny store for the pointer's instant: the readouts follow it, the chart does not re-render for it. */
function createPointerStore(initial: number) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (v: number) => {
      if (v === value) return
      value = v
      for (const l of listeners) l()
    },
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}
type PointerStore = ReturnType<typeof createPointerStore>

function usePointer(store: PointerStore): number {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function DutyTimeline({
  blocks: logged,
  limits,
  forecast,
  scenario = null,
  onClearScenario,
}: {
  blocks: DutyBlock[]
  limits: FTLLimits
  forecast?: ForecastResult
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
  // The other clock beside the pointer's: Singapore time beside Zulu (the
  // home base, and the clock local nights are read in), Zulu beside local.
  const otherClock = useCallback(
    (ms: number) =>
      zulu
        ? `${formatInstant(ms, { ...display, useZuluTime: false }, SGT_ZONE)} SGT`
        : formatInstant(ms, { ...display, useZuluTime: true }),
    [display, zulu],
  )
  const duration = useCallback(
    (min: number) => formatHHMMDisplay(minutesToHHMM(Math.max(0, Math.round(min))), display.timeFormat === "12h" ? "24h" : display.timeFormat),
    [display.timeFormat],
  )
  const sep = display.clockSeparator === "none" ? "" : ":"
  const fmt = useMemo(() => {
    const dm = tzFormatter(zone, { day: "numeric", month: "short" }, "d-mon")
    const hr = tzFormatter(zone, { hour: "2-digit", hourCycle: "h23" }, "hh")
    return {
      dayMonth: (ms: number) => dm.format(new Date(ms)),
      hour: (ms: number) => `${hr.format(new Date(ms))}${sep}00`,
    }
  }, [zone, sep])

  const views: RollingView[] = useMemo(
    () => [
      { key: "duty14", label: "14D Duty", limit: limits.maxDuty14Days * 60, limitName: "14-day duty", color: FDP_COLORS.duty },
      { key: "duty28", label: "28D Duty", limit: limits.maxDuty28Days * 60, limitName: "28-day duty", color: "#8a7aa5" },
      { key: "flight28", label: "28D Flight", limit: limits.maxFlight28Days * 60, limitName: "28-day flight", color: FDP_COLORS.flight },
      { key: "flight365", label: "12M Flight", limit: limits.maxFlight365Days * 60, limitName: "12-month flight", color: "#6fa3b0" },
    ],
    [limits],
  )
  const [series, setSeries] = useState<RollingKind>("duty14")
  const view = views.find((v) => v.key === series) ?? views[0]

  const index = useMemo(() => createRollingIndex(blocks), [blocks])
  const loggedIndex = useMemo(() => (scenario ? createRollingIndex(logged) : null), [scenario, logged])

  const [span, setSpan] = useState(DEFAULT_SPAN)
  const [width, setWidth] = useState(0)
  const [selection, setSelection] = useState<Selection>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // One clock reading per mount: the "Now" line and the opening view. The
  // page is not kept alive, so it is current every time it is opened.
  const [nowMs] = useState(() => Date.now())
  const [pointer] = useState(() => createPointerStore(Math.floor(nowMs / MIN) * MIN))

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

  // Where the view starts, quantised to a quarter of it, so a scroll
  // re-renders the chart only when what is drawn needs to move on. The
  // pointer reads the exact scroll on every frame without re-rendering it.
  const quantum = span / 4
  const [viewStart, setViewStart] = useState<number | null>(null)
  /** A time to hold at an x in the view across a scale change. */
  const anchorRef = useRef<{ ms: number; x: number } | null>(null)
  /** The exact instant at the centre — the store holds it floored to the minute. */
  const centreRef = useRef(nowMs)

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
    const left = rangeStart + el.scrollLeft / pxPerMs
    centreRef.current = left + width / 2 / pxPerMs
    pointer.set(Math.floor(centreRef.current / MIN) * MIN)
    const next = Math.floor(left / quantum) * quantum
    setViewStart((prev) => (prev === next ? prev : next))
  }, [pointer, pxPerMs, quantum, rangeStart, width])

  // Apply a pending anchor once the scale it needs is known: the opening
  // view puts NOW at the pointer, a zoom holds the time under the fingers,
  // and anything else that moves the axis — new data shifting where it
  // starts, a resize — holds the pointer's own time where it was.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || pxPerMs === 0) return
    const anchor = anchorRef.current ?? (viewStart == null ? { ms: nowMs, x: width / 2 } : { ms: centreRef.current, x: width / 2 })
    anchorRef.current = null
    el.scrollLeft = Math.max(0, xOf(anchor.ms) - anchor.x)
    readView()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on a scale change only; viewStart is read for the first run
  }, [pxPerMs, width, xOf, nowMs])

  const scrollRaf = useRef(0)
  const handleScroll = useCallback(() => {
    if (scrollRaf.current) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0
      readView()
    })
  }, [readView])
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), [])

  /** Bring a time to the pointer. */
  const scrollToTime = useCallback(
    (ms: number) => {
      const el = scrollerRef.current
      if (!el || pxPerMs === 0) return
      const left = Math.max(0, xOf(ms) - width / 2)
      // A jump of more than a few views goes straight there: smooth across
      // months is a long wait for nothing worth watching.
      el.scrollTo({ left, behavior: Math.abs(left - el.scrollLeft) > 3 * width ? "instant" : "smooth" })
    },
    [pxPerMs, width, xOf],
  )

  /** Zoom to `next`, holding the time at `x` (a position in the view) still. */
  const zoomTo = useCallback(
    (next: number, x?: number, heldMs?: number) => {
      const el = scrollerRef.current
      const clamped = Math.min(MAX_SPAN, Math.max(MIN_SPAN, next))
      if (el && pxPerMs > 0) {
        const at = x ?? width / 2
        anchorRef.current = { ms: heldMs ?? rangeStart + (el.scrollLeft + at) / pxPerMs, x: at }
      }
      setSpan(clamped)
    },
    [pxPerMs, rangeStart, width],
  )
  // Read by the native gesture listeners. Written in the LAYOUT phase, beside
  // the scroll it pairs with — a passive effect left a frame in which the
  // new scrollLeft met the old scale, and a pinch held the wrong time still.
  const latest = useRef({ span, zoomTo, scrollToTime, pxPerMs, rangeStart })
  useLayoutEffect(() => {
    latest.current = { span, zoomTo, scrollToTime, pxPerMs, rangeStart }
  })

  // A new what-if is shown where it changed the roster — once per what-if,
  // not on every data refresh that rebuilds the same one.
  const firstChange = useMemo(() => {
    if (!scenario) return null
    const changed = [...scenario.blocks.filter((b) => b.scenario), ...scenario.removed]
    return changed.length ? Math.min(...changed.map((b) => b.startMs)) : null
  }, [scenario])
  useEffect(() => {
    if (firstChange != null) latest.current.scrollToTime(firstChange)
  }, [firstChange])

  // Pinch: the span follows the fingers' spread continuously, and the time
  // that was under them stays under them (so a pinch can also pan). Native
  // listeners, because a passive React touchmove cannot stop the browser
  // zooming the page instead. Applied once per frame.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    let pinch: { spread: number; span: number; ms: number } | null = null
    /** A wheel gesture's own running span and held time — the render may not have caught up between events. */
    let wheel: { span: number; ms: number; at: number } | null = null
    let pending: { span: number; x: number; ms: number } | null = null
    let raf = 0
    const flush = () => {
      raf = 0
      if (!pending) return
      latest.current.zoomTo(pending.span, pending.x, pending.ms)
      pending = null
    }
    const queue = (p: { span: number; x: number; ms: number }) => {
      pending = p
      if (!raf) raf = requestAnimationFrame(flush)
    }
    const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const midX = (t: TouchList) => (t[0].clientX + t[1].clientX) / 2 - el.getBoundingClientRect().left
    const msAt = (x: number) => {
      const { pxPerMs: k, rangeStart: r } = latest.current
      return k > 0 ? r + (el.scrollLeft + x) / k : 0
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { spread: spread(e.touches), span: latest.current.span, ms: msAt(midX(e.touches)) }
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch) return
      e.preventDefault()
      const d = spread(e.touches)
      if (d > 0) queue({ span: (pinch.span * pinch.spread) / d, x: midX(e.touches), ms: pinch.ms })
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null
    }
    // A trackpad pinch arrives as a ctrl-wheel; a plain wheel scrolls the page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const x = e.clientX - el.getBoundingClientRect().left
      const now = performance.now()
      const going = wheel && now - wheel.at < 250 ? wheel : null
      const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, (going?.span ?? latest.current.span) * Math.exp(e.deltaY * WHEEL_ZOOM)))
      wheel = { span, ms: going?.ms ?? msAt(x), at: now }
      queue({ span, x, ms: wheel.ms })
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
      cancelAnimationFrame(raf)
      el.removeEventListener("touchstart", onStart)
      el.removeEventListener("touchmove", onMove)
      el.removeEventListener("touchend", onEnd)
      el.removeEventListener("touchcancel", onEnd)
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("gesturestart", onGesture)
    }
  }, [])

  const viewFrom = viewStart ?? nowMs - span / 2
  const drawFrom = viewFrom - span
  const drawTo = viewFrom + 2 * span
  const visible = useMemo(
    () =>
      blocks.filter(
        (b) => Math.max(b.endMs, b.showMax ? (b.fdpLimitMs ?? 0) : 0) > drawFrom && (b.restBefore?.startMs ?? b.startMs) < drawTo,
      ),
    [blocks, drawFrom, drawTo],
  )
  const ghosts = useMemo(() => removed.filter((b) => b.endMs > drawFrom && b.startMs < drawTo), [removed, drawFrom, drawTo])
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks])

  // The axis: a gridline per step, full height, midnights stronger. A step
  // under a day labels hours and puts the date on each midnight; a step of a
  // day or more labels dates.
  const axis = useMemo(() => {
    if (pxPerMs === 0) return { lines: [] as { ms: number; midnight: boolean; label: string }[], bands: [] as number[] }
    const stepH = gridStepHours(pxPerMs)
    const days = dayStarts(Math.max(drawFrom, rangeStart), Math.min(drawTo, rangeEnd), zulu)
    const lines: { ms: number; midnight: boolean; label: string }[] = []
    if (stepH < 24) {
      for (const d of days) {
        lines.push({ ms: d, midnight: true, label: fmt.dayMonth(d) })
        for (let h = stepH; h < 24; h += stepH) lines.push({ ms: d + h * HOUR, midnight: false, label: fmt.hour(d + h * HOUR) })
      }
    } else {
      const every = stepH / 24
      for (const d of days) if (dayNumber(d) % every === 0) lines.push({ ms: d, midnight: true, label: fmt.dayMonth(d) })
    }
    const bands = DAY * pxPerMs >= 6 ? days.filter((d) => dayNumber(d) % 2 === 1) : []
    return { lines, bands }
  }, [drawFrom, drawTo, fmt, pxPerMs, rangeEnd, rangeStart, zulu])

  // The rolling line across what is drawn, exact between its breakpoints.
  const chart = useMemo(() => {
    if (pxPerMs === 0) return null
    const points = rollingSeries(index, series, drawFrom, drawTo, [nowMs])
    const before = loggedIndex ? rollingSeries(loggedIndex, series, drawFrom, drawTo, [nowMs]) : null
    const peak = Math.max(view.limit * 1.1, ...points.map((p) => p.v), ...(before ?? []).map((p) => p.v))
    const yOf = (v: number) => ROLL_TOP + ROLL_H - (v / peak) * ROLL_H
    const left = xOf(drawFrom)
    const path = (pts: { t: number; v: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${(xOf(p.t) - left).toFixed(1)} ${yOf(p.v).toFixed(1)}`).join("")
    // The fill runs on down BEHIND the duty and rest rows to the chart's
    // floor, so the chart reads as one picture rather than stopping in a hard
    // edge above the duties.
    const area = (pts: { t: number; v: number }[]) =>
      pts.length < 2 ? "" : `${path(pts)}L${(xOf(pts[pts.length - 1].t) - left).toFixed(1)} ${CHART_H}L${(xOf(pts[0].t) - left).toFixed(1)} ${CHART_H}Z`
    const flown = points.filter((p) => p.t <= nowMs)
    const ahead = points.filter((p) => p.t >= nowMs)
    return {
      left,
      width: xOf(drawTo) - left,
      flown: path(flown),
      flownArea: area(flown),
      ahead: path(ahead),
      aheadArea: area(ahead),
      before: before ? path(before.filter((p) => p.t >= nowMs)) : "",
      limitY: yOf(view.limit),
      nearY: yOf(view.limit * 0.9),
    }
  }, [drawFrom, drawTo, index, loggedIndex, nowMs, pxPerMs, series, view.limit, xOf])

  const selectedDuty = selection?.kind === "duty" ? (byId.get(selection.id) ?? null) : null
  const restAfter = selection?.kind === "rest" ? (byId.get(selection.id) ?? null) : null
  const restBefore = restAfter?.restBefore ? (byId.get(restAfter.restBefore.previousId) ?? null) : null

  const toggle = useCallback(
    (kind: "duty" | "rest", id: string) => setSelection((cur) => (cur?.kind === kind && cur.id === id ? null : { kind, id })),
    [],
  )
  // From a rest's detail to one of its duties: select it and bring it to the pointer.
  const showDuty = useCallback(
    (b: DutyBlock) => {
      setSelection({ kind: "duty", id: b.id })
      scrollToTime((b.startMs + b.endMs) / 2)
    },
    [scrollToTime],
  )

  const innerWidth = Math.max(width, (rangeEnd - rangeStart) * pxPerMs)

  // Labels, placed left to right per row; one that would overlap the last
  // placed is left out. A duty says its FDP against its maximum (or its
  // length, where no maximum applies), a sector its block time, a rest its
  // length against its minimum — each in the pilot's duration format.
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
    const duty: Label[] = []
    const sector: Label[] = []
    const rest: Label[] = []
    for (const b of visible) {
      const left = xOf(b.startMs)
      const w = xOf(b.endMs) - left
      const text =
        b.kind === "flight" && b.maxFdpMinutes > 0
          ? `${duration(b.fdpMinutes)}/${duration(b.maxFdpMinutes)}`
          : b.kind === "standby"
            ? `SBY ${duration(b.dutyMinutes)}`
            : b.kind === "ground"
              ? `${b.code} ${duration(b.dutyMinutes)}`
              : duration(b.dutyMinutes)
      // Only where the label fits its own bar: zoomed out, a figure per duty
      // was a "x:xx/xx:xx" over every few pixels, and the pointer's row
      // already reads the duty it is on.
      if (fits(w, text)) duty.push({ key: `d${b.id}`, y: DUTY_Y + 3, x: left + w / 2, text, tone: b.limit === "over" ? "over" : null, onBar: true })
      for (const s of b.sectors) {
        if (s.positioning || s.simulator) continue
        const sw = xOf(s.inMs) - xOf(s.outMs)
        const st = duration((s.inMs - s.outMs) / MIN)
        if (fits(sw, st)) sector.push({ key: `s${s.id}`, y: DUTY_Y + DUTY_H - LABEL_H - 2, x: xOf(s.outMs) + sw / 2, text: st, tone: null, onBar: true })
      }
      const r = b.restBefore
      if (r) {
        const text = r.requiredMinutes != null ? `${duration(r.minutes)}/${duration(r.requiredMinutes)}` : duration(r.minutes)
        if (fits(xOf(b.startMs) - xOf(r.startMs), text)) rest.push({ key: `r${b.id}`, y: REST_LABEL_Y, x: (xOf(r.startMs) + xOf(b.startMs)) / 2, text, tone: r.status === "short" ? "over" : null, onBar: false })
      }
    }
    place(duty)
    place(sector)
    place(rest)
    return out
  }, [visible, xOf, duration])

  // A breach of ANY limit, not only the tab being drawn — one hidden behind
  // another tab was not shown at all. The first date per limit: a breach runs
  // on day after day, and three rows of the same one said nothing more.
  const exceedances = useMemo(() => {
    const out: { view: RollingView; date: string; projected: number; limit: number; regulation: string }[] = []
    for (const e of forecast?.exceedances ?? []) {
      const v = views.find((x) => e.limitName.startsWith(x.limitName))
      if (!v || out.some((o) => o.view.key === v.key)) continue
      out.push({ view: v, date: e.date, projected: e.projected, limit: e.limit, regulation: e.limitName.match(/\((Reg [^)]+)\)/)?.[1] ?? "" })
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  }, [forecast, views])

  // Para 5 — days off — read off the same blocks the chart draws (the what-if's
  // when there is one). Listed from four weeks back: what is still to be flown,
  // and the month a pilot is about to account for.
  const daysOffState = useMemo(() => analyseDaysOff(scenario?.blocks ?? blocks), [scenario, blocks])
  // One list, in date order: what the schedule is heading for and what the
  // roster breaks are the same question — "what is wrong, and when".
  const findings = useMemo(() => {
    const rows: { key: string; atMs: number; severity: "violation" | "caution"; text: string; source: string; series?: RollingKind }[] = []
    for (const e of exceedances) {
      const at = Date.parse(`${e.date}T12:00:00Z`)
      rows.push({
        key: e.view.key,
        atMs: at,
        severity: "violation",
        text: `${e.view.label} ${duration(e.projected * 60)}/${duration(e.limit * 60)}`,
        source: e.regulation,
        series: e.view.key,
      })
    }
    for (const f of daysOffState.findings) {
      if (f.atMs < nowMs - 28 * DAY) continue
      rows.push({ key: `${f.rule}${f.atMs}`, atMs: f.atMs, severity: f.severity, text: f.label, source: `Para ${f.rule}` })
    }
    return rows.sort((a, b) => a.atMs - b.atMs).slice(0, 6)
  }, [exceedances, daysOffState, nowMs, duration])
  /** A breach row switches to its limit's tab; every row brings its date to the pointer. */
  const openFinding = (f: { atMs: number; series?: RollingKind }) => {
    if (f.series) setSeries(f.series)
    scrollToTime(f.atMs)
  }

  return (
    <FormSection>
      <div className="space-y-2.5 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <PointerClock store={pointer} clock={clock} otherClock={otherClock} dayMonth={fmt.dayMonth} />
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => zoomTo(span * 1.6)} aria-label="Zoom out" className="control-surface flex h-9 w-9 items-center justify-center rounded-full">
              <Minus className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => zoomTo(span / 1.6)} aria-label="Zoom in" className="control-surface flex h-9 w-9 items-center justify-center rounded-full">
              <Plus className="h-4 w-4" />
            </button>
            <NowButton store={pointer} nowMs={nowMs} span={span} onNow={() => scrollToTime(nowMs)} />
          </div>
        </div>

        <PointerStateRow store={pointer} blocks={blocks} clock={clock} dayMonth={fmt.dayMonth} duration={duration} />

        <RollingTabs store={pointer} index={index} views={views} value={series} onChange={setSeries} duration={duration} />

        {scenario && (
          <div className="flex items-center justify-between gap-2 rounded-lg py-1 pl-3 pr-1" style={{ background: tint(FDP_COLORS.scenario, 14) }}>
            <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold" style={{ color: FDP_COLORS.scenario }}>
              {scenario.problems > 0 && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
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

        <div className="relative overflow-hidden rounded-lg border border-border/60 bg-card">
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="relative overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide"
            style={{ height: CHART_H, touchAction: "pan-x pan-y" }}
            role="group"
            aria-label="Duty timeline"
          >
            {pxPerMs > 0 && (
              <div className="relative h-full" style={{ width: innerWidth }}>
                {/* Every other day banded, so a day reads as a column. */}
                {axis.bands.map((d) => (
                  <div key={`band${d}`} className="pointer-events-none absolute bottom-0 bg-foreground/[0.035]" style={{ left: xOf(d), width: DAY * pxPerMs, top: AXIS_H }} />
                ))}
                {/* Gridlines the full height, so where a bar ends can be read off the axis. */}
                {/* Each label is centred ON its line — the line is the instant, so a
                    label beside it read as the hour after. The line starts as a
                    tick under the label rather than running through it. */}
                {axis.lines.map((l) => (
                  <div
                    key={`g${l.ms}`}
                    className={cn("pointer-events-none absolute bottom-0 border-l", l.midnight ? "border-border" : "border-border/40")}
                    style={{ left: xOf(l.ms), top: AXIS_H - 5 }}
                  >
                    <span
                      className={cn(
                        "absolute left-0 -translate-x-1/2 whitespace-nowrap text-[11px] leading-[14px] tabular-nums",
                        l.midnight ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                      style={{ top: -(AXIS_H - 8) }}
                    >
                      {l.label}
                    </span>
                  </div>
                ))}
                <div className="pointer-events-none absolute inset-x-0 border-t border-border/50" style={{ top: AXIS_H }} />

                {/* The rolling total: flown, then scheduled; tap to bring a time to the pointer. */}
                {chart && (
                  <svg
                    className="absolute top-0 cursor-pointer"
                    style={{ left: chart.left, width: chart.width, height: CHART_H }}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      scrollToTime(drawFrom + (e.clientX - r.left) / pxPerMs)
                    }}
                    aria-hidden
                  >
                    <defs>
                      {/* In chart space, so the fade is the same at every height of line. */}
                      <linearGradient id="roll-flown" gradientUnits="userSpaceOnUse" x1="0" y1={ROLL_TOP} x2="0" y2={CHART_H}>
                        <stop offset="0%" stopColor={view.color} stopOpacity={0.4} />
                        <stop offset={ROLL_FLOOR} stopColor={view.color} stopOpacity={0.14} />
                        <stop offset="100%" stopColor={view.color} stopOpacity={0.04} />
                      </linearGradient>
                      <linearGradient id="roll-ahead" gradientUnits="userSpaceOnUse" x1="0" y1={ROLL_TOP} x2="0" y2={CHART_H}>
                        <stop offset="0%" stopColor={scenario ? FDP_COLORS.scenario : FDP_COLORS.planned} stopOpacity={0.3} />
                        <stop offset={ROLL_FLOOR} stopColor={scenario ? FDP_COLORS.scenario : FDP_COLORS.planned} stopOpacity={0.1} />
                        <stop offset="100%" stopColor={scenario ? FDP_COLORS.scenario : FDP_COLORS.planned} stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <line x1={0} x2={chart.width} y1={chart.nearY} y2={chart.nearY} stroke={NEAR_LIMIT} strokeDasharray="3 3" strokeOpacity={0.6} />
                    <line x1={0} x2={chart.width} y1={chart.limitY} y2={chart.limitY} stroke={FDP_COLORS.violation} strokeWidth={1.5} />
                    <path d={chart.flownArea} fill="url(#roll-flown)" />
                    <path d={chart.aheadArea} fill="url(#roll-ahead)" />
                    {chart.before && <path d={chart.before} fill="none" stroke={FDP_COLORS.planned} strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.6} />}
                    <path d={chart.flown} fill="none" stroke={view.color} strokeWidth={2} />
                    <path d={chart.ahead} fill="none" stroke={scenario ? FDP_COLORS.scenario : FDP_COLORS.planned} strokeWidth={2} strokeDasharray="5 3" />
                  </svg>
                )}

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
                    style={{
                      left: l.x,
                      top: l.y,
                      ...(l.onBar ? ON_BAR : { color: "var(--muted-foreground)" }),
                      ...(l.tone === "over" ? { color: OVER } : null),
                    }}
                  >
                    {l.text}
                  </span>
                ))}

                {/* Now — between what has happened and what is scheduled. */}
                {nowMs > drawFrom && nowMs < drawTo && (
                  <div className="pointer-events-none absolute bottom-0 border-l-2 border-dashed border-foreground/50" style={{ left: xOf(nowMs), top: AXIS_H }}>
                    <span className="absolute left-1 top-1 rounded bg-foreground/80 px-1 text-[9px] font-semibold uppercase leading-[12px] text-background">Now</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Outside the scroller, so they stay put: the limit's figure, and the pointer. */}
          {chart && (
            <span
              className="pointer-events-none absolute left-1.5 -translate-y-full rounded bg-card/80 px-1 text-[10px] font-semibold tabular-nums"
              style={{ top: chart.limitY - 1, color: FDP_COLORS.violation }}
            >
              {duration(view.limit)}
            </span>
          )}
          <div className="pointer-events-none absolute bottom-0 left-1/2 z-10 -translate-x-1/2" style={{ top: AXIS_H }} aria-hidden>
            <div className="h-full w-0.5 bg-primary" />
            <div className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-primary" />
          </div>
        </div>

        {/* The key — a limit is drawn, not coloured: the maximum dotted, the
            minimum rest solid, what runs past either struck red. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground" aria-hidden>
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: tint(FDP_COLORS.duty, 24) }} />} label="Duty" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: tint(FDP_COLORS.duty, 50) }} />} label="FDP" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: tint(FDP_COLORS.flight, 90) }} />} label="Flight" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm border-2 border-dotted" style={{ borderColor: FDP_COLORS.planned }} />} label="Max FDP" />
          <Key swatch={<span className="h-2 w-3.5 rounded-sm" style={{ background: tint(REST, 80) }} />} label="Minimum Rest" />
          <Key swatch={<span className="h-2 w-3.5 rounded-sm" style={{ background: tint(REST, 28) }} />} label="Rest" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm border border-dashed" style={{ borderColor: FDP_COLORS.planned, background: tint(FDP_COLORS.planned, 30) }} />} label="Scheduled" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: hatch(FDP_COLORS.duty) }} />} label="Standby / Ground" />
          {scenario && <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: tint(FDP_COLORS.scenario, 45) }} />} label="What-If" />}
        </div>

        {/* What the schedule is heading for — a rolling breach, a pattern of
            days off it breaks (para 5). One row shape for both; a tap brings
            it to the pointer. */}
        {findings.length > 0 && (
          <div className="space-y-1">
            {findings.map((f) => (
              <FindingRow key={f.key} severity={f.severity} text={`${fmt.dayMonth(f.atMs)} · ${f.text}`} source={f.source} onClick={() => openFinding(f)} />
            ))}
          </div>
        )}

        {selectedDuty && <DutyDetail block={selectedDuty} clock={clock} duration={duration} onClose={() => setSelection(null)} />}
        {restAfter?.restBefore && (
          <RestDetail
            after={restAfter}
            before={restBefore}
            daysOff={daysOffState.daysOff.filter((o) => o.startMs >= restAfter.restBefore!.signOffMs && o.endMs <= restAfter.startMs).length}
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

/** One thing the roster breaks, as a row: what and when, then the rule. */
function FindingRow({
  severity,
  text,
  source,
  onClick,
}: {
  severity: "violation" | "caution"
  text: string
  source: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-xs",
        severity === "violation" ? "bg-status-error/10 text-status-error" : "bg-status-warning/10 text-status-warning",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="tabular-nums">{text}</span>
      </span>
      {source && <span className="shrink-0 opacity-80">{source}</span>}
    </button>
  )
}

interface Label {
  key: string
  y: number
  x: number
  text: string
  tone: "over" | null
  /** Drawn over a bar rather than on the chart's ground. */
  onBar: boolean
}

/** When the pointer is — the instant, to the minute. */
function PointerClock({
  store,
  clock,
  otherClock,
  dayMonth,
}: {
  store: PointerStore
  clock: (ms: number) => string
  otherClock: (ms: number) => string
  dayMonth: (ms: number) => string
}) {
  const t = usePointer(store)
  return (
    // Two lines, inside the controls' height: beside them a phone had no room.
    <p className="flex min-w-0 flex-col px-1 tabular-nums">
      <span className="truncate text-lg font-semibold leading-tight">
        {dayMonth(t)} {clock(t)}
      </span>
      <span className="truncate text-xs font-medium leading-tight text-muted-foreground">{otherClock(t)}</span>
    </p>
  )
}

interface StateCell {
  caption: string
  value: string
  over?: boolean
  muted?: boolean
}

/** The leg at `t`: the one in the air or at the gate, else the next to fly, else the last. */
function legAt(b: DutyBlock, t: number): string {
  const legs = b.sectors.filter((x) => x.from || x.to).slice().sort((x, y) => x.outMs - y.outMs)
  const leg = legs.find((x) => t < x.inMs) ?? legs[legs.length - 1]
  return leg ? `${leg.from}-${leg.to}` : b.route || "Duty"
}

/** The three cells of the state row, at the instant `t`. */
/** A rest this long is read in days, not hours and minutes. */
const LONG_REST_MIN = 100 * 60

/** "19d 21h" — whole hours, for a rest long enough that minutes are noise. */
function daysHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function stateCells(
  blocks: readonly DutyBlock[],
  t: number,
  clock: (ms: number) => string,
  dayMonth: (ms: number) => string,
  duration: (min: number) => string,
): [StateCell, StateCell, StateCell] {
  const s = pointerState(blocks, t)
  const none: StateCell = { caption: "", value: "—", muted: true }
  // A duty ahead: when it signs on, and the FDP it asks for against its max.
  const ahead = (next: DutyBlock | null): [StateCell, StateCell] => {
    if (!next) return [{ caption: "Next Duty", value: "None", muted: true }, { ...none, caption: "FDP" }]
    // The date only when it is not the pointer's own day — "Nov 5 01:00Z"
    // did not fit a phone's third of the row.
    const when = dayMonth(next.startMs) === dayMonth(t) ? clock(next.startMs) : `${dayMonth(next.startMs)} ${clock(next.startMs)}`
    if (next.kind !== "flight" || next.maxFdpMinutes <= 0) {
      // Not an FDP: what it is, and how long it runs.
      const what = next.kind === "standby" ? "Standby" : NOT_FDP[next.code] ?? (next.code || "Duty")
      return [{ caption: "Next Duty", value: when, muted: true }, { caption: what, value: duration(next.dutyMinutes), muted: true }]
    }
    // The next duty's FDP is what it will ASK, not a clock running now — so it
    // reads dimmed beside the rest, which is.
    return [
      { caption: "Next Duty", value: when, muted: true },
      { caption: "Next FDP", value: `${duration(next.fdpMinutes)}/${duration(next.maxFdpMinutes)}`, over: next.fdpMinutes > next.maxFdpMinutes, muted: true },
    ]
  }
  if (s.kind === "duty") {
    const b = s.block
    // The caption says what kind of duty it is; the value says WHERE in it the
    // pointer is — the leg being flown, or the next one to fly, or the duty's
    // own code — rather than restating "On Duty".
    const state = b.scenario ? "What-If" : b.isFuture ? "Scheduled" : "On Duty"
    if (b.kind === "flight" && b.maxFdpMinutes > 0) {
      return [
        { caption: state, value: legAt(b, t) },
        { caption: "FDP", value: `${duration(s.fdpMinutes)}/${duration(b.maxFdpMinutes)}`, over: s.fdpMinutes > b.maxFdpMinutes },
        { caption: "Flight", value: duration(s.flightMinutes) },
      ]
    }
    if (b.kind === "standby") {
      return [{ caption: "Standby", value: b.code || "SBY" }, { caption: "Elapsed", value: `${duration(s.dutyMinutes)}/${duration(18 * 60)}` }, { ...none, caption: "Flight" }]
    }
    if (b.kind === "ground") {
      return [{ caption: "Ground Duty", value: b.code || "Ground" }, { caption: "Elapsed", value: duration(s.dutyMinutes) }, { ...none, caption: "Flight" }]
    }
    return [
      { caption: NOT_FDP[b.code] ?? state, value: b.code === "POS" ? legAt(b, t) : b.sectors[0]?.flightNumber || b.code },
      { caption: "Elapsed", value: duration(s.dutyMinutes) },
      // A simulator or positioning duty flies nothing.
      { ...none, caption: "Flight" },
    ]
  }
  if (s.kind === "rest") {
    const req = s.rest.requiredMinutes
    // Past 100 hours "x:xx/xx:xx" no longer fits a third of a phone's row
    // ("477:23/11…"), so a long rest reads in days and hours and its minimum
    // moves up into the caption.
    const long = s.minutes >= LONG_REST_MIN
    const rest: StateCell =
      s.minutes < 0
        ? { caption: "Rest", value: `In ${duration(-s.minutes)}`, muted: true }
        : long
          ? { caption: req != null ? `Rest · Min ${duration(req)}` : "Rest", value: daysHours(s.minutes), over: s.rest.status === "short" }
          : { caption: "Rest", value: req != null ? `${duration(s.minutes)}/${duration(req)}` : duration(s.minutes), over: s.rest.status === "short" }
    return [...ahead(s.block), rest]
  }
  return [...ahead(s.next), { ...none, caption: "Rest" }]
}

/**
 * What the pilot was doing at the pointer, in a row of three that never
 * changes height: on duty, the duty / its FDP against the maximum / flight so
 * far; at rest, the next duty / its FDP against the maximum / rest against
 * its minimum. A line of prose wrapped onto a second row as it changed, and
 * the card's height moved under the reader.
 */
function PointerStateRow({
  store,
  blocks,
  clock,
  dayMonth,
  duration,
}: {
  store: PointerStore
  blocks: DutyBlock[]
  clock: (ms: number) => string
  dayMonth: (ms: number) => string
  duration: (min: number) => string
}) {
  const t = usePointer(store)
  const cells = stateCells(blocks, t, clock, dayMonth, duration)
  return (
    <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-1 rounded-lg bg-muted/50 px-1 py-1">
      {cells.map((c, i) => (
        <div key={i} className="min-w-0 px-1.5">
          <span className="block truncate text-[10px] font-medium leading-tight text-muted-foreground">{c.caption || "\u00a0"}</span>
          <span
            className={cn(
              "block truncate text-sm font-semibold leading-tight tabular-nums",
              c.over ? "text-status-error" : c.muted ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {c.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Back to the present — needed only once the pointer has left it. */
function NowButton({ store, nowMs, span, onNow }: { store: PointerStore; nowMs: number; span: number; onNow: () => void }) {
  const t = usePointer(store)
  const atNow = Math.abs(t - nowMs) < Math.max(MIN, span / 200)
  return (
    <button
      type="button"
      onClick={onNow}
      disabled={atNow}
      className="control-surface h-9 shrink-0 rounded-full px-3.5 text-sm font-medium transition-opacity disabled:opacity-40"
    >
      Now
    </button>
  )
}

/** The four rolling limits as at the pointer; the chosen one is drawn. */
function RollingTabs({
  store,
  index,
  views,
  value,
  onChange,
  duration,
}: {
  store: PointerStore
  index: RollingIndex
  views: RollingView[]
  value: RollingKind
  onChange: (k: RollingKind) => void
  duration: (min: number) => string
}) {
  const t = usePointer(store)
  return (
    <div className="grid grid-cols-4 gap-1" role="tablist" aria-label="Rolling limit">
      {views.map((v) => {
        const used = rollingAt(index, v.key, t)
        const pct = v.limit > 0 ? (used / v.limit) * 100 : 0
        const bar = pct >= 100 ? "bg-status-error" : pct >= 90 ? "bg-status-critical" : pct >= 75 ? "bg-status-warning" : "bg-status-valid"
        const active = v.key === value
        return (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v.key)}
            className={cn("min-w-0 border-b-2 px-1 pb-1 pt-0.5 text-left transition-colors", active ? "text-foreground" : "border-transparent text-muted-foreground")}
            style={active ? { borderBottomColor: v.color } : undefined}
          >
            <span className="block truncate text-[10px] font-medium leading-tight">{v.label}</span>
            <span className="block truncate text-xs font-bold leading-tight tabular-nums text-foreground">{duration(used)}</span>
            <span className="block truncate text-[10px] leading-tight tabular-nums text-muted-foreground">/{duration(v.limit)}</span>
            <span className="mt-0.5 block h-1 rounded-full bg-muted">
              <span className={cn("block h-full rounded-full", bar)} style={{ width: `${Math.min(pct, 100)}%` }} />
            </span>
          </button>
        )
      })}
    </div>
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

/** Whether a label fits inside a span `width` px wide, with a little air. */
const fits = (width: number, text: string) => width >= text.length * CHAR_PX + 8

/** A tap target at least `HIT_MIN` wide, centred on the bar it opens. */
function hit(left: number, width: number): { left: number; width: number; inset: number } {
  if (width >= HIT_MIN) return { left, width, inset: 0 }
  const pad = (HIT_MIN - width) / 2
  return { left: left - pad, width: HIT_MIN, inset: pad }
}

/**
 * One duty's deck: the duty bar the full height of its row, its sectors
 * inside it top to bottom, its maximum dotted round it while it is still to
 * come, and the rest before it directly under.
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
  const left = xOf(b.startMs)
  const width = wOf(b.startMs, b.endMs)
  const h = hit(left, width)
  const name = b.kind === "flight" ? NOT_FDP[b.code] ?? (b.route || "Duty") : b.kind === "standby" ? "Standby" : `Ground duty ${b.code}`
  const ring = "ring-2 ring-primary ring-offset-1 ring-offset-card"
  const limitAt = b.fdpLimitMs
  // The FDP is what is limited, so a breach runs from where it reached its
  // maximum to its own end — the last on-blocks — never into the post-flight
  // half hour after it, which is duty but not FDP.
  const breachFrom = limitAt != null && b.fdpEndMs > limitAt ? Math.max(limitAt, b.startMs) : null
  const isFdp = b.kind === "flight" && b.maxFdpMinutes > 0
  const fdpEnd = Math.max(b.startMs, Math.min(b.fdpEndMs, b.endMs))

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect("duty", b.id)}
        aria-pressed={dutySelected}
        aria-label={`${name}, ${clock(b.startMs)}–${clock(b.endMs)}, duty ${duration(b.dutyMinutes)}${b.maxFdpMinutes > 0 ? `, FDP ${duration(b.fdpMinutes)} of ${duration(b.maxFdpMinutes)}` : ""}${b.limit === "over" ? ", over the FDP limit" : ""}${b.scenario ? ", what-if" : future ? ", scheduled" : ""}`}
        className="absolute"
        style={{ left: h.left, width: h.width, top: DUTY_Y, height: DUTY_H }}
      >
        <span
          className={cn("absolute inset-y-0 rounded-md", (future || b.scenario) && "border border-dashed", dutySelected && ring)}
          style={{ left: h.inset, width, borderColor: base, background: b.kind === "flight" ? tint(base, future || b.scenario ? 16 : 24) : hatch(base) }}
        />
      </button>

      {/* The FDP inside the duty: sign-on to the last on-blocks. What is left
          of the duty after it is the post-flight checks — duty, not FDP. */}
      {isFdp && fdpEnd > b.startMs && (
        <span
          className="pointer-events-none absolute rounded-l-md"
          style={{ left, width: wOf(b.startMs, fdpEnd), top: DUTY_Y, height: DUTY_H, background: tint(base, future || b.scenario ? 30 : 50) }}
          aria-hidden
        />
      )}

      {/* The flying, inside the duty, its full height. */}
      {b.sectors.map((s) => (
        <span
          key={s.id}
          className={cn("pointer-events-none absolute rounded-[3px]", (s.positioning || s.simulator) && "border border-dashed")}
          style={{
            left: xOf(s.outMs),
            width: wOf(s.outMs, s.inMs),
            top: DUTY_Y + 1,
            height: DUTY_H - 2,
            borderColor: flightColor,
            background: s.positioning ? "transparent" : s.simulator ? hatch(flightColor) : tint(flightColor, future || b.scenario ? 75 : 85),
          }}
        />
      ))}

      {/* The FDP maximum, dotted round the window it allows: sign-on to the
          latest on-blocks. */}
      {b.showMax && limitAt != null && limitAt > b.startMs && (
        <span
          className="pointer-events-none absolute rounded-md border-2 border-dotted"
          style={{ left, width: wOf(b.startMs, limitAt), top: DUTY_Y, height: DUTY_H, borderColor: base }}
          aria-hidden
        />
      )}
      {/* The FDP past its maximum, ending at the last on-blocks. */}
      {breachFrom != null && (
        <span className="pointer-events-none absolute" style={{ left: xOf(breachFrom), width: wOf(breachFrom, b.fdpEndMs), top: DUTY_Y, height: DUTY_H, background: BREACH, borderRight: `2px solid ${OVER}` }} aria-hidden />
      )}

      {b.restBefore && (
        <RestBar rest={b.restBefore} signOnMs={b.startMs} future={future} selected={restSelected} xOf={xOf} wOf={wOf} duration={duration} onSelect={() => onSelect("rest", b.id)} />
      )}
    </>
  )
}

/**
 * The rest before a duty, decked under it from when the rest COMMENCES — an
 * hour after the duty before is free of all duties (First Schedule); the hour
 * itself is neither duty nor rest, so nothing is drawn there. Then the minimum
 * the regulation required (solid), then the rest beyond it to the sign-on. A
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
          className="pointer-events-none absolute"
          style={{ left: xOf(rest.startMs), width: wOf(rest.startMs, Math.min(minEnd, signOnMs)), top: REST_Y, height: REST_H, background: tint(REST, future ? 60 : 80) }}
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
  const notFdp = b.kind === "flight" ? NOT_FDP[b.code] : undefined
  const title = notFdp ?? (b.kind === "flight" ? b.route || "Duty" : b.kind === "standby" ? "Standby" : b.code)
  const fdp =
    b.maxFdpMinutes > 0
      ? `${duration(b.fdpMinutes)} of ${duration(b.maxFdpMinutes)} max${b.limit === "over" ? ` · over by ${duration(b.fdpMinutes - b.maxFdpMinutes)}` : ""}`
      : ""
  const over = b.maxFdpMinutes > 0 ? b.fdpMinutes - b.maxFdpMinutes : 0
  // Para 13: the commander may extend an FDP by up to 3 hours in UNFORESEEN
  // operational circumstances — never for a duty still to be flown, which is
  // a schedule over its maximum.
  const discretion =
    over <= 0
      ? null
      : b.isFuture || b.scenario
        ? { value: "None for a schedule (para 13)", tone: "over" as const }
        : over <= PIC_FDP_DISCRETION_MIN
          ? { value: "Within the PIC's 3:00 (para 13)", tone: "near" as const }
          : { value: "Beyond the PIC's 3:00 (para 13)", tone: "over" as const }
  return (
    <div className="space-y-2 pt-1">
      <DetailHeader
        title={title}
        subtitle={`${clock(b.startMs)} – ${clock(b.endMs)}`}
        tag={
          b.scenario ? (
            <span className="ml-1.5 text-xs font-medium" style={{ color: FDP_COLORS.scenario }}>What-If</span>
          ) : b.isFuture ? (
            <span className="ml-1.5 text-xs font-medium" style={{ color: FDP_COLORS.planned }}>Scheduled</span>
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
        {discretion && <VerdictRow label="Discretion" value={discretion.value} tone={discretion.tone} />}
        {notFdp && <ReadOnlyRow label="FDP" value="Not a flight duty period" />}
        {b.kind === "flight" && b.maxFdpMinutes > 0 && <ReadOnlyRow label="FDP End" value={`${clock(b.fdpEndMs)} · last on-blocks`} />}
        {b.showMax && b.fdpLimitMs != null && <ReadOnlyRow label="Latest On-Blocks" value={clock(b.fdpLimitMs)} />}
        {b.kind === "standby" && b.limit === "over" && <VerdictRow label="Limit" value="Over the 18:00 standby cap" tone="over" />}
        {b.kind === "flight" && !notFdp && <ReadOnlyRow label="Flight Time" value={duration(b.flightMinutes)} />}
        {b.kind === "flight" && !notFdp && (
          <ReadOnlyRow label="Sectors" value={String(b.sectors.filter((s) => !s.positioning && !s.simulator).length)} />
        )}
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
                  {[s.type, s.registration, s.positioning ? "Positioning" : "", s.simulator ? "Simulator" : "", s.planned ? "Scheduled" : ""].filter(Boolean).join(" · ")}
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
  daysOff,
  clock,
  duration,
  onDuty,
  onClose,
}: {
  after: DutyBlock
  before: DutyBlock | null
  /** Days off (para 5) this rest holds. */
  daysOff: number
  clock: (ms: number) => string
  duration: (min: number) => string
  onDuty: (b: DutyBlock) => void
  onClose: () => void
}) {
  const rest = after.restBefore!
  const short = rest.status === "short"
  const owed = rest.requiredMinutes != null ? rest.requiredMinutes - rest.minutes : null
  // Para 3(2): the commander may reduce a minimum rest by no more than 2 hours
  // in unforeseen circumstances, "if the requirement for a local night, where
  // required, is satisfied" — and never on a schedule.
  const nightRequired = rest.rule === "3d" || rest.rule === "4a" || rest.rule === "4b"
  const discretion =
    !short || owed == null || owed <= 0
      ? null
      : after.isFuture || after.scenario
        ? { value: "None for a schedule (para 3(2))", tone: "over" as const }
        : owed <= PIC_REST_DISCRETION_MIN && (!nightRequired || rest.includesLocalNight)
          ? { value: "Within the PIC's 2:00 (para 3(2))", tone: "near" as const }
          : { value: "Beyond the PIC's 2:00 (para 3(2))", tone: "over" as const }
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
        {rest.rule && <ReadOnlyRow label="Rule" value={REST_RULE_LABEL[rest.rule]} />}
        {rest.includesLocalNight != null && <ReadOnlyRow label="Local Night (SGT)" value={rest.includesLocalNight ? "Included" : "Not included"} />}
        {short && owed != null && owed > 0 && <VerdictRow label="Short By" value={duration(owed)} tone="over" />}
        {discretion && <VerdictRow label="Discretion" value={discretion.value} tone={discretion.tone} />}
        {daysOff > 0 && <ReadOnlyRow label="Days Off (Para 5)" value={String(daysOff)} />}
        {!short && owed != null && <ReadOnlyRow label="Margin" value={duration(-owed)} />}
        <ReadOnlyRow label="Signed Off" value={clock(rest.signOffMs)} />
        <ReadOnlyRow label="Rest Commenced" value={clock(rest.startMs)} />
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {before && <NeighbourRow caption="Before" block={before} when={`Sign-off ${clock(before.endMs)}`} onSelect={() => onDuty(before)} />}
        <NeighbourRow caption="After" block={after} when={`Sign-on ${clock(after.startMs)}`} onSelect={() => onDuty(after)} />
      </div>
    </div>
  )
}

function NeighbourRow({ caption, block: b, when, onSelect }: { caption: string; block: DutyBlock; when: string; onSelect: () => void }) {
  const name = b.kind === "flight" ? NOT_FDP[b.code] ?? (b.route || "Duty") : b.kind === "standby" ? "Standby" : b.code
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
