"use client"

/**
 * The duty timeline — a Gantt chart whose axis is TIME, in three lanes, each
 * bar labelled with how long it lasted and coloured by whether it is legal:
 *
 *            MON 3          TUE 4          WED 5
 *   DUTY     ▐█████▌ 8:30                  ▐████▌ 7:00      sign-on → sign-off
 *   FLIGHT    ▐██▌▐██▌ 4:00                 ▐█▌▐█▌ 3:30     block time
 *   REST             ▬▬▬▬▬▬▬▬▬ 14:20 ▬▬▬▬▬▬▬               rest between duties
 *
 * The point is two verdicts a pilot should not have to work out: did a duty's
 * FDP run past its Reg 14 maximum (red; amber in its last tenth), and did a
 * rest reach what para 3/4 required (red when short, amber within an hour).
 * Duties still to come are dashed in the planned yellow, as on the chart above.
 *
 * Swipe sideways to move along the dates; pinch (or the tabs) to step between
 * 24 hours, 7 days and 28 days. Tap a duty or a sector for its sign-on,
 * sign-off and sectors; tap a rest for the duties either side of it.
 *
 * Plain positioned elements, not a chart library, and only what is near the
 * view is rendered — a career is thousands of duties on one axis. Labels are
 * placed left to right and one that would overlap the last is left out, so a
 * dense view never prints a label on top of another.
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

type Zoom = "1" | "7" | "28"
/** In order of the span shown — pinching OUT steps left, IN steps right. */
const ZOOM_ORDER: Zoom[] = ["1", "7", "28"]
const ZOOMS: SegmentedTab<Zoom>[] = [
  { value: "1", label: "24 Hours" },
  { value: "7", label: "7 Days" },
  { value: "28", label: "28 Days" },
]

/** Geometry, px. Each lane is a label line over a bar. */
const AXIS_H = 26
const LANE_H = 46
const LABEL_Y = 2
const BAR_Y = 18
const BAR_H = 20
const LANE_TOP = { duty: AXIS_H, flight: AXIS_H + LANE_H, rest: AXIS_H + 2 * LANE_H }
const CHART_H = AXIS_H + 3 * LANE_H
/** The "Now" chip sits under the day and hour labels, above the lanes. */
const NOW_Y = 13
/** The narrowest a tap target gets, centred on a bar narrower than it. */
const HIT_MIN = 28
/** Labels are 11px semibold tabular figures; this is a character's width. */
const CHAR_PX = 6.6
const LABEL_GAP = 6

/** A pinch has to change the finger spread this much to step the zoom. */
const PINCH_STEP = 1.3
/** A trackpad pinch (ctrl + wheel) accumulates this much delta per step. */
const WHEEL_STEP = 60

const OVER = "var(--status-error)"
// Orange, not amber: the planned yellow is already on this page, and the
// rolling chart above marks 90% of a limit in this same colour.
const NEAR = "var(--status-critical)"
const REST_OK = "var(--muted-foreground)"

/** A colour at a share of its strength — works for a hex and a CSS variable. */
function tint(color: string, pct: number): string {
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`
}

function hatch(color: string): string {
  return `repeating-linear-gradient(135deg, ${tint(color, 70)} 0 3px, ${tint(color, 20)} 3px 6px)`
}

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

  // Each lane's labels, placed left to right; one that would overlap the
  // last placed is left out. A label may be wider than its bar — it sits
  // centred over it — so a duty a few pixels wide at 7 days still says how
  // long it was.
  const labels = useMemo(() => {
    const out: Label[] = []
    const lane = (items: Label[]) => {
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
    const flight: Label[] = []
    const rest: Label[] = []
    for (const b of visible) {
      const left = xOf(b.startMs)
      const w = xOf(b.endMs) - left
      const dur = duration(b.dutyMinutes)
      const name = b.kind === "flight" ? b.route : b.code
      const long = `${dur} · ${name}`
      duty.push({
        key: `d${b.id}`,
        lane: "duty",
        x: left + w / 2,
        text: name && w >= long.length * CHAR_PX + 8 ? long : b.kind === "flight" ? dur : `${b.code} ${dur}`,
        tone: b.limit,
      })

      // Flight: each sector's block where it has room, else — when no
      // sector does — the duty's total over the run of its sectors.
      const flown = b.sectors.filter((s) => !s.positioning)
      if (flown.length > 0) {
        const each = flown.map((s) => ({ s, text: duration((s.inMs - s.outMs) / MIN) }))
        const roomy = each.filter(({ s, text }) => xOf(s.inMs) - xOf(s.outMs) >= text.length * CHAR_PX + LABEL_GAP)
        if (roomy.length > 0) {
          for (const { s, text } of roomy) flight.push({ key: `f${s.id}`, lane: "flight", x: (xOf(s.outMs) + xOf(s.inMs)) / 2, text, tone: null })
        } else {
          const a = xOf(flown[0].outMs)
          const z = xOf(flown[flown.length - 1].inMs)
          flight.push({ key: `f${b.id}`, lane: "flight", x: (a + z) / 2, text: duration(b.flightMinutes), tone: null })
        }
      }

      const r = b.restBefore
      if (r) {
        const a = xOf(r.startMs)
        const z = xOf(b.startMs)
        const dur = duration(r.minutes)
        const need = r.requiredMinutes != null ? `${dur} · need ${duration(r.requiredMinutes)}` : dur
        const tone = r.status === "short" ? "over" : r.status === "tight" ? "near" : null
        rest.push({ key: `r${b.id}`, lane: "rest", x: (a + z) / 2, text: tone && z - a >= need.length * CHAR_PX + 8 ? need : dur, tone })
      }
    }
    lane(duty)
    lane(flight)
    lane(rest)
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
        <div className="flex">
          <SegmentedTabs tabs={ZOOMS} value={zoom} onChange={(z) => zoomTo(z)} />
        </div>
        <p className="px-1 text-xs font-medium text-muted-foreground tabular-nums">{rangeText}</p>

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

        <div className="flex overflow-hidden rounded-lg border border-border/60 bg-card">
          {/* Lane names: outside the scroller, so they stay put. */}
          <div className="w-14 shrink-0 border-r border-border/60" aria-hidden>
            <div style={{ height: AXIS_H }} />
            {(["Duty", "Flight", "Rest"] as const).map((name, i) => (
              <div
                key={name}
                className={cn("flex items-center px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", i > 0 && "border-t border-border/50")}
                style={{ height: LANE_H }}
              >
                {name}
              </div>
            ))}
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
                {/* Every other day banded, so a day reads as a column. */}
                {axis.shown.map((d) =>
                  Math.round((d - rangeStart) / DAY) % 2 === 1 ? (
                    <div key={`band${d}`} className="pointer-events-none absolute bottom-0 bg-foreground/[0.04]" style={{ left: xOf(d), width: DAY * pxPerMs, top: AXIS_H }} />
                  ) : null,
                )}
                <div className="pointer-events-none absolute inset-x-0 border-t border-border/50" style={{ top: LANE_TOP.duty }} />
                <div className="pointer-events-none absolute inset-x-0 border-t border-border/50" style={{ top: LANE_TOP.flight }} />
                <div className="pointer-events-none absolute inset-x-0 border-t border-border/50" style={{ top: LANE_TOP.rest }} />

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

                {visible.map((b) => (
                  <DutyBars
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
                    style={{ left: l.x, top: LANE_TOP[l.lane] + LABEL_Y, color: l.tone === "over" ? OVER : l.tone === "near" ? NEAR : "var(--foreground)" }}
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
        </div>

        {/* The key — colour is never the only carrier: planned is dashed, a
            label says a short rest's requirement, the verdict line counts. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground" aria-hidden>
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: tint(FDP_COLORS.duty, 85) }} />} label="Duty" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: hatch(FDP_COLORS.duty) }} />} label="Standby / Ground" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: tint(FDP_COLORS.flight, 85) }} />} label="Flight" />
          <Key swatch={<span className="h-1.5 w-3.5 rounded-full" style={{ background: tint(REST_OK, 45) }} />} label="Rest" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm border border-dashed" style={{ borderColor: FDP_COLORS.planned, background: tint(FDP_COLORS.planned, 30) }} />} label="Planned" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: NEAR }} />} label="Near Limit" />
          <Key swatch={<span className="h-2.5 w-3.5 rounded-sm" style={{ background: OVER }} />} label="Over Limit / Short Rest" />
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
  lane: "duty" | "flight" | "rest"
  x: number
  text: string
  tone: "over" | "near" | null
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

/** One duty across the three lanes: its bar, its sectors, the rest before it. */
function DutyBars({
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
  const base = future ? FDP_COLORS.planned : FDP_COLORS.duty
  const color = b.limit === "over" ? OVER : b.limit === "near" ? NEAR : base
  const flightColor = future ? FDP_COLORS.planned : FDP_COLORS.flight
  const left = xOf(b.startMs)
  const width = wOf(b.startMs, b.endMs)
  const h = hit(left, width)
  const name = b.kind === "flight" ? b.route || "Duty" : b.kind === "standby" ? "Standby" : `Ground duty ${b.code}`
  const ring = "ring-2 ring-primary ring-offset-1 ring-offset-card"
  const verdict = b.limit === "over" ? ", over the FDP limit" : b.limit === "near" ? ", near the FDP limit" : ""

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect("duty", b.id)}
        aria-pressed={dutySelected}
        aria-label={`${name}, ${clock(b.startMs)}–${clock(b.endMs)}, duty ${duration(b.dutyMinutes)}${verdict}${future ? ", planned" : ""}`}
        className="absolute"
        style={{ left: h.left, width: h.width, top: LANE_TOP.duty, height: LANE_H }}
      >
        <span
          className={cn("absolute rounded-md", future && "border-2 border-dashed", dutySelected && ring)}
          style={{
            left: h.inset,
            top: BAR_Y,
            height: BAR_H,
            width,
            borderColor: color,
            background: b.kind === "flight" ? tint(color, future ? 35 : 85) : hatch(color),
          }}
        />
      </button>

      {b.sectors.map((s) => {
        const sl = xOf(s.outMs)
        const sw = wOf(s.outMs, s.inMs)
        const sh = hit(sl, sw)
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect("duty", b.id)}
            aria-label={`${s.flightNumber || "Sector"} ${s.from}–${s.to}, ${clock(s.outMs)}–${clock(s.inMs)}, block ${duration((s.inMs - s.outMs) / MIN)}${s.positioning ? ", positioning" : ""}${s.planned ? ", scheduled" : ""}`}
            className="absolute"
            style={{ left: sh.left, width: sh.width, top: LANE_TOP.flight, height: LANE_H }}
          >
            <span
              className={cn("absolute rounded-md", (s.positioning || future) && "border-2 border-dashed", dutySelected && ring)}
              style={{
                left: sh.inset,
                top: BAR_Y,
                height: BAR_H,
                width: sw,
                borderColor: flightColor,
                background: s.positioning ? "transparent" : tint(flightColor, future ? 35 : 85),
              }}
            />
          </button>
        )
      })}

      {b.restBefore && (
        <RestBar rest={b.restBefore} signOnMs={b.startMs} future={future} selected={restSelected} xOf={xOf} wOf={wOf} duration={duration} onSelect={() => onSelect("rest", b.id)} />
      )}
    </>
  )
}

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
  // A rest still to come is grey and dashed: yellow on this chart means a
  // planned DUTY, and a rest has no colour of its own unless it is judged.
  const color = short ? OVER : rest.status === "tight" ? NEAR : REST_OK
  const plannedRest = future && color === REST_OK
  const owedEnd = short && rest.requiredMinutes != null ? rest.startMs + rest.requiredMinutes * MIN : null
  return (
    <>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Rest ${duration(rest.minutes)}${rest.requiredMinutes != null ? ` of ${duration(rest.requiredMinutes)} required` : ""}${short ? ", short" : rest.status === "tight" ? ", close to the minimum" : ""}`}
        className="absolute"
        style={{ left: h.left, width: h.width, top: LANE_TOP.rest, height: LANE_H }}
      >
        <span
          className={cn("absolute rounded-full", plannedRest && "border border-dashed", selected && "ring-2 ring-primary ring-offset-1 ring-offset-card")}
          style={{
            left: h.inset,
            top: BAR_Y + 4,
            height: BAR_H - 8,
            width,
            borderColor: REST_OK,
            background: tint(color, plannedRest ? 15 : color === REST_OK ? 45 : 85),
          }}
        />
      </button>
      {owedEnd != null && owedEnd > signOnMs && (
        // The rest still owed when the next duty signed on.
        <span
          className="pointer-events-none absolute rounded-r-full"
          style={{ left: xOf(signOnMs), width: wOf(signOnMs, owedEnd), top: LANE_TOP.rest + BAR_Y + 4, height: BAR_H - 8, background: `repeating-linear-gradient(135deg, ${OVER} 0 2px, transparent 2px 5px)` }}
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
        tag={b.isFuture ? <span className="ml-1.5 text-xs font-medium" style={{ color: FDP_COLORS.planned }}>Planned</span> : undefined}
        onClose={onClose}
        closeLabel="Close duty details"
      />
      <div className="overflow-hidden rounded-xl border bg-card">
        <ReadOnlyRow label="Sign-On" value={withScheduled(b.startMs, b.planned?.startMs, clock)} />
        <ReadOnlyRow label="Sign-Off" value={withScheduled(b.endMs, b.planned?.endMs, clock)} />
        <ReadOnlyRow label="Duty" value={duration(b.dutyMinutes)} />
        {fdp && <VerdictRow label="FDP" value={fdp} tone={b.limit} />}
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
        {rest.requiredMinutes != null && <ReadOnlyRow label="Required" value={duration(rest.requiredMinutes)} />}
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
