"use client"

/**
 * The duty timeline — a Gantt chart whose axis is TIME, in three lanes:
 *
 *            MON 3        TUE 4        WED 5
 *   DUTY     ▐█▓▓█▓▓█▌                 ▐▓▓█▓▓▌        sign-on → sign-off
 *            ▔▔▔▔▔▔▔                   ▔▔▔▔▔          as scheduled
 *   FLIGHT    ▐▓██▓▌ ▐▓██▓▌             ▐▓██▓▌        block, airborne inside
 *   REST              ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬|               rest, | = required
 *
 * Each lane draws what HAPPENED with what was SCHEDULED as a thin baseline
 * under it, so a late sign-off, a delayed sector or a short rest is a visible
 * difference between two bars. Duties still to come are drawn dashed in the
 * planned yellow, the same as the rolling chart above.
 *
 * Swipe sideways to move along the dates; pinch (or the tabs) to step between
 * 24 hours, 7 days and 28 days. Tap a duty or a sector for its sign-on,
 * sign-off and sectors; tap a rest for the duties either side of it.
 *
 * Plain positioned elements, not a chart library, and only what is near the
 * view is rendered — a career is thousands of duties on one axis.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow } from "@/components/ui/settings-row"
import { SegmentedTabs, type SegmentedTab } from "@/components/ui/segmented-tabs"
import { usePreferences } from "@/components/providers/preferences-provider"
import { FDP_COLORS } from "@/components/roster/fdp-colors"
import { formatInstant, tzFormatter } from "@/lib/utils/tz-format"
import { formatHHMMDisplay, minutesToHHMM } from "@/lib/utils/time"
import { summarizeTimeline, type DutyBlock, type Span } from "@/lib/utils/roster/duty-timeline"

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

type Zoom = "1" | "7" | "28"
/** In order of the span shown — pinching OUT steps left, IN steps right. */
const ZOOM_ORDER: Zoom[] = ["1", "7", "28"]
const ZOOMS: SegmentedTab<Zoom>[] = [
  { value: "1", label: "24 Hours" },
  { value: "7", label: "7 Days" },
  { value: "28", label: "28 Days" },
]

/** Geometry, px. Every lane is a caption line, the bar, then the baseline. */
const AXIS_H = 26
const LANE_H = 44
const REST_H = 40
const LABEL_Y = 1
const BAR_Y = 14
const BAR_H = 20
const BASE_Y = 37
const BASE_H = 4
const LANE_TOP = { duty: AXIS_H, flight: AXIS_H + LANE_H, rest: AXIS_H + 2 * LANE_H }
const CHART_H = AXIS_H + 2 * LANE_H + REST_H
/** The "Now" chip sits under the day and hour labels, above the lanes. */
const NOW_Y = 13
/** The narrowest a tap target gets, centred on a bar narrower than it. */
const HIT_MIN = 28
/** A baseline narrower than this is a dot, not a span — it is left out. */
const BASELINE_MIN = 8

/** A pinch has to change the finger spread this much to step the zoom. */
const PINCH_STEP = 1.3
/** A trackpad pinch (ctrl + wheel) accumulates this much delta per step. */
const WHEEL_STEP = 60

const REST_COLOR = "var(--muted-foreground)"
const SHORT_COLOR = "var(--status-error)"
const SCHEDULED_COLOR = "var(--muted-foreground)"

type Selection = { kind: "duty" | "rest"; id: string } | null

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Day starts from `from` to `to` in the display clock (UTC when Zulu). */
function dayStarts(from: number, to: number, zulu: boolean): number[] {
  const out: number[] = []
  if (zulu) {
    for (let t = Math.floor(from / DAY) * DAY; t <= to; t += DAY) out.push(t)
    return out
  }
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  while (d.getTime() <= to) {
    out.push(d.getTime())
    d.setDate(d.getDate() + 1) // calendar days, so a DST change is still one day
  }
  return out
}

export function DutyTimeline({ blocks }: { blocks: DutyBlock[] }) {
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

  // The axis: a day before the first duty (or now) to two days after the last.
  const days = useMemo(() => {
    const first = Math.min(blocks[0]?.startMs ?? nowMs, nowMs) - DAY
    const last = Math.max(blocks[blocks.length - 1]?.endMs ?? nowMs, nowMs) + 2 * DAY
    return dayStarts(first, last, zulu)
  }, [blocks, nowMs, zulu])
  const rangeStart = days[0] ?? nowMs
  const rangeEnd = (days[days.length - 1] ?? nowMs) + DAY
  const spanDays = Number(zoom)
  const span = spanDays * DAY
  const pxPerMs = width > 0 ? width / span : 0
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
  const zoomRef = useRef({ zoom, zoomTo })
  useEffect(() => {
    zoomRef.current = { zoom, zoomTo }
  })

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
      const { zoom: z, zoomTo: go } = zoomRef.current
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
  const summary = useMemo(() => summarizeTimeline(blocks, viewFrom, viewTo), [blocks, viewFrom, viewTo])
  const visible = useMemo(
    () => blocks.filter((b) => b.endMs > drawFrom && (b.restBefore?.startMs ?? b.startMs) < drawTo),
    [blocks, drawFrom, drawTo],
  )
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks])

  // The axis: midnight rules, and the ticks between them the zoom can carry.
  const axis = useMemo(() => {
    const dayPx = DAY * pxPerMs
    const shown = days.filter((d) => d + DAY > drawFrom && d < drawTo)
    // At 28 days a cell is ~11px: label every Nth day so labels never touch.
    const every = dayPx >= 40 ? 1 : Math.ceil(22 / Math.max(1, dayPx))
    const ticks: { ms: number; label: string }[] = []
    if (zoom !== "28") {
      const stepH = zoom === "1" ? 1 : 6
      for (const d of shown) for (let h = stepH; h < 24; h += stepH) ticks.push({ ms: d + h * HOUR, label: zoom === "1" && h % 6 === 0 ? fmt.hour(d + h * HOUR) : "" })
    }
    return { shown, every, ticks, full: dayPx >= 40 }
  }, [days, drawFrom, drawTo, fmt, pxPerMs, zoom])

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
      const left = xOf(b.startMs)
      const right = xOf(b.endMs)
      if (left < el.scrollLeft || right > el.scrollLeft + width) el.scrollTo({ left: Math.max(0, left - width * 0.2), behavior: "smooth" })
    },
    [pxPerMs, width, xOf],
  )

  const innerWidth = Math.max(width, (rangeEnd - rangeStart) * pxPerMs)
  const rangeText =
    zoom === "1"
      ? `${fmt.dayMonth(viewFrom)} ${clock(viewFrom)} – ${fmt.dayMonth(viewTo)} ${clock(viewTo)}`
      : `${fmt.dayMonth(viewFrom)} – ${fmt.dayMonth(viewTo - 1)}`

  return (
    <FormSection title="Duty Timeline">
      <div className="space-y-2 px-3 pb-3 pt-1">
        <div className="flex">
          <SegmentedTabs tabs={ZOOMS} value={zoom} onChange={(z) => zoomTo(z)} />
        </div>
        <p className="px-1 text-xs font-medium text-muted-foreground tabular-nums">{rangeText}</p>

        {/* The three questions, for what is in view. */}
        <div className="grid grid-cols-3 gap-2">
          <Figure value={duration(summary.flightMinutes)} caption="Flown" color={FDP_COLORS.flight} />
          <Figure value={duration(summary.dutyMinutes)} caption="Duty" color={FDP_COLORS.duty} />
          <Figure
            value={summary.shortestRestMinutes == null ? "—" : duration(summary.shortestRestMinutes)}
            caption={summary.shortRests > 0 ? `Shortest Rest · ${summary.shortRests} short` : "Shortest Rest"}
            alert={summary.shortRests > 0}
          />
        </div>

        <div className="flex overflow-hidden rounded-lg bg-muted/30">
          {/* Lane names: outside the scroller, so they stay put. */}
          <div className="w-12 shrink-0 border-r border-border/60" aria-hidden>
            <div style={{ height: AXIS_H }} />
            {(["Duty", "Flight"] as const).map((name) => (
              <div key={name} className="flex items-center px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground" style={{ height: LANE_H }}>
                {name}
              </div>
            ))}
            <div className="flex items-center px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground" style={{ height: REST_H }}>
              Rest
            </div>
          </div>

          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide"
            style={{ height: CHART_H, touchAction: "pan-x pan-y" }}
            role="group"
            aria-label="Duty timeline"
          >
            {pxPerMs > 0 && (
              <div className="relative h-full" style={{ width: innerWidth }}>
                {/* Lane dividers. */}
                <div className="pointer-events-none absolute inset-x-0 border-t border-border/40" style={{ top: LANE_TOP.flight }} />
                <div className="pointer-events-none absolute inset-x-0 border-t border-border/40" style={{ top: LANE_TOP.rest }} />

                {/* Minor ticks, then a rule at each midnight with the day above it. */}
                {axis.ticks.map((t) => (
                  <div key={t.ms} className="pointer-events-none absolute bottom-0 border-l border-border/25" style={{ left: xOf(t.ms), top: AXIS_H - 6 }}>
                    {t.label && (
                      <span className="absolute -translate-x-1/2 text-[10px] leading-[12px] tabular-nums text-muted-foreground/80" style={{ top: 1 - (AXIS_H - 6) }}>{t.label}</span>
                    )}
                  </div>
                ))}
                {axis.shown.map((d, i) => {
                  const labelled = axis.full || i % axis.every === 0
                  return (
                    <div key={d} className="pointer-events-none absolute inset-y-0 border-l border-border/60" style={{ left: xOf(d) }}>
                      {labelled && (
                        <span className="absolute left-1 top-px whitespace-nowrap text-[10px] font-medium uppercase leading-[12px] tracking-wide text-muted-foreground">
                          {axis.full ? fmt.day(d) : fmt.dayNumber(d)}
                        </span>
                      )}
                    </div>
                  )
                })}

                {visible.map((b) => (
                  <DutyLanes
                    key={b.id}
                    block={b}
                    xOf={xOf}
                    wOf={wOf}
                    clock={clock}
                    duration={duration}
                    dutySelected={selection?.kind === "duty" && selection.id === b.id}
                    restSelected={selection?.kind === "rest" && selection.id === b.id}
                    onDuty={toggle}
                  />
                ))}

                {/* Now — between what has happened and what is planned. */}
                {nowMs > drawFrom && nowMs < drawTo && (
                  <div className="pointer-events-none absolute bottom-0 z-10 border-l border-dashed border-foreground/70" style={{ left: xOf(nowMs), top: NOW_Y }}>
                    <span className="absolute -left-3 top-0 rounded bg-foreground px-1 text-[9px] font-semibold uppercase leading-[12px] text-background">
                      Now
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* The key — colour is never the only carrier: planned is dashed,
            scheduled is the thin bar beneath, a short rest is labelled. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground" aria-hidden>
          <Key swatch={<span className="h-2.5 w-3 rounded-sm border" style={{ borderColor: FDP_COLORS.duty, background: `${FDP_COLORS.duty}33` }} />} label="Duty" />
          <Key swatch={<span className="h-2.5 w-3 rounded-sm" style={{ background: hatch(FDP_COLORS.duty) }} />} label="Ground / Standby" />
          <Key swatch={<span className="h-2.5 w-3 rounded-sm" style={{ background: `${FDP_COLORS.flight}66` }} />} label="Block" />
          <Key swatch={<span className="h-2.5 w-3 rounded-sm" style={{ background: FDP_COLORS.flight }} />} label="Airborne" />
          <Key swatch={<span className="h-1 w-3 rounded-full" style={{ background: SCHEDULED_COLOR }} />} label="Scheduled" />
          <Key swatch={<span className="h-2.5 w-3 rounded-sm border border-dashed" style={{ borderColor: FDP_COLORS.planned, background: `${FDP_COLORS.planned}33` }} />} label="Planned" />
          <Key swatch={<span className="h-1.5 w-3 rounded-full" style={{ background: SHORT_COLOR }} />} label="Rest Short" />
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

function hatch(color: string): string {
  return `repeating-linear-gradient(135deg, ${color}59 0 3px, ${color}1a 3px 6px)`
}

function Figure({ value, caption, color, alert }: { value: string; caption: string; color?: string; alert?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={cn("text-lg font-semibold leading-tight tabular-nums", alert && "text-status-error")} style={!alert && color ? { color } : undefined}>
        {value}
      </div>
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{caption}</div>
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

/** The scheduled span, as the thin bar under a lane's actual one. */
function Baseline({ span, top, xOf, wOf }: { span: Span; top: number; xOf: (ms: number) => number; wOf: (a: number, b: number) => number }) {
  if (wOf(span.startMs, span.endMs) < BASELINE_MIN) return null
  return (
    <span
      className="pointer-events-none absolute rounded-full opacity-60"
      style={{ left: xOf(span.startMs), width: wOf(span.startMs, span.endMs), top: top + BASE_Y, height: BASE_H, background: SCHEDULED_COLOR }}
    />
  )
}

/** A tap target at least `HIT_MIN` wide, centred on the bar it opens. */
function hit(left: number, width: number): { left: number; width: number; inset: number } {
  if (width >= HIT_MIN) return { left, width, inset: 0 }
  const pad = (HIT_MIN - width) / 2
  return { left: left - pad, width: HIT_MIN, inset: pad }
}

/** A caption over a bar, while the bar is wide enough to hold it. */
function Caption({ text, left, width, top, strong }: { text: string; left: number; width: number; top: number; strong?: boolean }) {
  if (width < 30 || !text) return null
  return (
    <span
      className={cn(
        "pointer-events-none absolute truncate text-[10px] leading-[12px] tabular-nums",
        strong ? "font-semibold text-foreground" : "text-muted-foreground",
      )}
      style={{ left, width, top: top + LABEL_Y }}
    >
      {text}
    </span>
  )
}

/** One duty across the three lanes: its block, its sectors, the rest before it. */
function DutyLanes({
  block: b,
  xOf,
  wOf,
  clock,
  duration,
  dutySelected,
  restSelected,
  onDuty,
}: {
  block: DutyBlock
  xOf: (ms: number) => number
  wOf: (a: number, b: number) => number
  clock: (ms: number) => string
  duration: (min: number) => string
  dutySelected: boolean
  restSelected: boolean
  onDuty: (kind: "duty" | "rest", id: string) => void
}) {
  const future = b.isFuture
  const dutyColor = future ? FDP_COLORS.planned : FDP_COLORS.duty
  const flightColor = future ? FDP_COLORS.planned : FDP_COLORS.flight
  const left = xOf(b.startMs)
  const width = wOf(b.startMs, b.endMs)
  const name = b.kind === "flight" ? b.route || "Duty" : b.code
  const timeText = `${clock(b.startMs)}–${clock(b.endMs)}`
  const dutyText = width >= 150 ? `${duration(b.dutyMinutes)} · ${name} · ${timeText}` : width >= 70 ? `${duration(b.dutyMinutes)} · ${name}` : duration(b.dutyMinutes)
  const rest = b.restBefore
  const short = rest?.compliant === false
  const dutyHit = hit(left, width)

  return (
    <>
      {/* DUTY — sign-on to sign-off; a flight duty shows its sectors inside, so
          the ground part of the duty is the lighter fill between them. */}
      {b.planned && !future && <Baseline span={b.planned} top={LANE_TOP.duty} xOf={xOf} wOf={wOf} />}
      <Caption text={dutyText} left={left} width={Math.max(width, 0)} top={LANE_TOP.duty} strong={dutySelected} />
      <button
        type="button"
        onClick={() => onDuty("duty", b.id)}
        aria-pressed={dutySelected}
        aria-label={`${b.kind === "standby" ? "Standby" : b.kind === "ground" ? `Ground duty ${b.code}` : name}, ${timeText}, duty ${duration(b.dutyMinutes)}${b.kind === "flight" ? `, flight ${duration(b.flightMinutes)}` : ""}${future ? ", planned" : ""}`}
        className="absolute"
        // The tap target is the whole lane's height, the bar is drawn inside it.
        style={{ left: dutyHit.left, width: dutyHit.width, top: LANE_TOP.duty, height: LANE_H }}
      >
        <span
          className={cn(
            "absolute overflow-hidden rounded-md border",
            future && "border-dashed",
            dutySelected && "ring-2 ring-primary ring-offset-1 ring-offset-card",
          )}
          style={{
            left: dutyHit.inset,
            top: BAR_Y,
            height: BAR_H,
            width,
            borderColor: dutyColor,
            background: b.kind === "flight" ? `${dutyColor}33` : hatch(dutyColor),
          }}
        >
          {b.sectors.map((s) =>
            s.positioning ? (
              <span
                key={s.id}
                className="absolute inset-y-1 rounded-sm border border-dashed"
                style={{ left: xOf(s.outMs) - left, width: wOf(s.outMs, s.inMs), borderColor: flightColor }}
              />
            ) : (
              <span key={s.id} className="absolute inset-y-0" style={{ left: xOf(s.outMs) - left, width: wOf(s.outMs, s.inMs), background: `${flightColor}80` }}>
                {s.airborne && (
                  <span className="absolute inset-y-0" style={{ left: xOf(s.airborne.startMs) - xOf(s.outMs), width: wOf(s.airborne.startMs, s.airborne.endMs), background: flightColor }} />
                )}
              </span>
            ),
          )}
        </span>
      </button>

      {/* FLIGHT — each sector's block, airborne inside it, schedule beneath. */}
      {b.sectors.map((s) => {
        const sl = xOf(s.outMs)
        const sw = wOf(s.outMs, s.inMs)
        const sh = hit(sl, sw)
        return (
          <div key={s.id}>
            {s.scheduled && !s.planned && <Baseline span={s.scheduled} top={LANE_TOP.flight} xOf={xOf} wOf={wOf} />}
            <Caption text={sw >= 60 ? `${s.flightNumber} ${s.to}`.trim() : s.flightNumber} left={sl} width={sw} top={LANE_TOP.flight} />
            <button
              type="button"
              onClick={() => onDuty("duty", b.id)}
              aria-label={`${s.flightNumber || "Sector"} ${s.from}–${s.to}, ${clock(s.outMs)}–${clock(s.inMs)}${s.positioning ? ", positioning" : ""}${s.planned ? ", scheduled" : ""}`}
              className="absolute"
              style={{ left: sh.left, width: sh.width, top: LANE_TOP.flight, height: LANE_H }}
            >
              <span
                className={cn(
                  "absolute overflow-hidden rounded-md",
                  (s.positioning || s.planned) && "border border-dashed",
                  dutySelected && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                )}
                style={{
                  left: sh.inset,
                  top: BAR_Y,
                  height: BAR_H,
                  width: sw,
                  borderColor: flightColor,
                  background: s.positioning ? "transparent" : s.airborne ? `${flightColor}66` : `${flightColor}${s.planned ? "4d" : "cc"}`,
                }}
              >
                {!s.positioning && s.airborne && (
                  <span className="absolute inset-y-0" style={{ left: xOf(s.airborne.startMs) - sl, width: wOf(s.airborne.startMs, s.airborne.endMs), background: flightColor }} />
                )}
              </span>
            </button>
          </div>
        )
      })}

      {/* REST — from when it commenced to this sign-on; the tick is where the
          required rest would have ended, and a shortfall is the red past it. */}
      {rest && (
        <RestBar rest={rest} signOnMs={b.startMs} future={future} short={short} selected={restSelected} xOf={xOf} wOf={wOf} duration={duration} onSelect={() => onDuty("rest", b.id)} />
      )}
    </>
  )
}

function RestBar({
  rest,
  signOnMs,
  future,
  short,
  selected,
  xOf,
  wOf,
  duration,
  onSelect,
}: {
  rest: NonNullable<DutyBlock["restBefore"]>
  signOnMs: number
  future: boolean
  short: boolean
  selected: boolean
  xOf: (ms: number) => number
  wOf: (a: number, b: number) => number
  duration: (min: number) => string
  onSelect: () => void
}) {
  const left = xOf(rest.startMs)
  const width = wOf(rest.startMs, signOnMs)
  const requiredEnd = rest.requiredMinutes != null ? rest.startMs + rest.requiredMinutes * MIN : null
  const color = short ? SHORT_COLOR : future ? FDP_COLORS.planned : REST_COLOR
  const text = width >= 90 ? `Rest ${duration(rest.minutes)}` : duration(rest.minutes)
  const h = hit(left, width)
  return (
    <>
      <Caption text={text} left={left} width={width} top={LANE_TOP.rest} strong={short || selected} />
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Rest ${duration(rest.minutes)}${rest.requiredMinutes != null ? ` of ${duration(rest.requiredMinutes)} required` : ""}${short ? ", short" : ""}`}
        className="absolute"
        style={{ left: h.left, width: h.width, top: LANE_TOP.rest, height: REST_H }}
      >
        <span
          className={cn("absolute rounded-full", selected && "ring-2 ring-primary ring-offset-1 ring-offset-card")}
          style={{ left: h.inset, top: BAR_Y + 2, height: 8, width, background: color, opacity: short ? 1 : 0.45 }}
        />
      </button>
      {requiredEnd != null && short && (
        // The rest still owed when the duty signed on.
        <span
          className="pointer-events-none absolute rounded-full"
          style={{ left: xOf(signOnMs), width: wOf(signOnMs, requiredEnd), top: LANE_TOP.rest + BAR_Y + 2, height: 8, background: `repeating-linear-gradient(135deg, ${SHORT_COLOR} 0 2px, transparent 2px 5px)` }}
        />
      )}
      {requiredEnd != null && (
        <span
          className="pointer-events-none absolute w-0.5 rounded-full"
          style={{ left: xOf(requiredEnd) - 1, top: LANE_TOP.rest + BAR_Y - 2, height: 16, background: short ? SHORT_COLOR : "var(--foreground)", opacity: short ? 1 : 0.55 }}
        />
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

/** "22:13Z (sched 21:50Z)" — the schedule said only where it differs. */
function withScheduled(actual: number, scheduled: number | undefined, clock: (ms: number) => string): string {
  if (scheduled == null || Math.abs(actual - scheduled) < MIN) return clock(actual)
  return `${clock(actual)} · sched ${clock(scheduled)}`
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
  return (
    <div className="space-y-2 pt-1">
      <DetailHeader
        title={title}
        subtitle={`${clock(b.startMs)} – ${clock(b.endMs)}`}
        tag={b.isFuture ? <span className="ml-1.5 text-xs font-medium" style={{ color: FDP_COLORS.planned }}>Planned</span> : undefined}
        onClose={onClose}
        closeLabel="Close duty details"
      />
      <div className="overflow-hidden rounded-xl border bg-card">
        <ReadOnlyRow label="Sign-On" value={withScheduled(b.startMs, b.planned?.startMs, clock)} />
        <ReadOnlyRow label="Sign-Off" value={withScheduled(b.endMs, b.planned?.endMs, clock)} />
        <ReadOnlyRow
          label="Duty"
          value={b.maxFdpMinutes > 0 ? `${duration(b.dutyMinutes)} · FDP max ${duration(b.maxFdpMinutes)}` : duration(b.dutyMinutes)}
        />
        {b.kind === "flight" && <ReadOnlyRow label="Flight Time" value={duration(b.flightMinutes)} />}
        {b.kind === "flight" && <ReadOnlyRow label="Sectors" value={String(b.sectors.length)} />}
        {aircraft && <ReadOnlyRow label="Aircraft" value={aircraft} />}
        {rest && (
          <ReadOnlyRow
            label="Rest Before"
            value={rest.requiredMinutes ? `${duration(rest.minutes)} of ${duration(rest.requiredMinutes)} required` : duration(rest.minutes)}
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
                <p className="text-xs text-muted-foreground tabular-nums">
                  {duration((s.inMs - s.outMs) / MIN)}
                  {s.airborne && ` · air ${duration((s.airborne.endMs - s.airborne.startMs) / MIN)}`}
                </p>
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
  const short = rest.compliant === false
  const owed = rest.requiredMinutes != null ? rest.requiredMinutes - rest.minutes : null
  return (
    <div className="space-y-2 pt-1">
      <DetailHeader
        title={`Rest ${duration(rest.minutes)}`}
        subtitle={`${clock(rest.startMs)} – ${clock(after.startMs)}`}
        tag={short ? <span className="ml-1.5 text-xs font-semibold text-status-error">Short</span> : undefined}
        onClose={onClose}
        closeLabel="Close rest details"
      />
      <div className="overflow-hidden rounded-xl border bg-card">
        <ReadOnlyRow label="Rest" value={duration(rest.minutes)} />
        {rest.requiredMinutes != null && <ReadOnlyRow label="Required" value={duration(rest.requiredMinutes)} />}
        {short && owed != null && owed > 0 && <ReadOnlyRow label="Short By" value={duration(owed)} />}
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
