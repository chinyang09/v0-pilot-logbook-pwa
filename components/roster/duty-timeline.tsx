"use client"

/**
 * The duty timeline — one continuous axis in time, each duty a block raised
 * off the baseline from sign-on to sign-off, its sectors drawn inside it as
 * the flight time, and the rest between duties as the gaps along the line:
 *
 *      MON   TUE   WED   THU   FRI
 *        ┌─────┐       ┌───────┐
 *        │DUTY │       │ DUTY  │
 *   ─────┘     └───────┘       └────
 *          REST 14:20     REST 11:05
 *
 * Three questions, read at a glance: how much have I flown, how much duty
 * have I done, and how much rest did I have between duties. The figures over
 * the strip answer them for the days IN VIEW, and follow the scroll.
 *
 * Plain positioned elements, not a chart library: the axis is time, the
 * blocks are boxes, and only the days near the view are rendered — a career
 * is thousands of duties on one axis.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow } from "@/components/ui/settings-row"
import { SegmentedTabs, type SegmentedTab } from "@/components/ui/segmented-tabs"
import { usePreferences } from "@/components/providers/preferences-provider"
import { FDP_COLORS } from "@/components/roster/fdp-colors"
import { formatInstant, tzFormatter } from "@/lib/utils/tz-format"
import { formatHHMMDisplay, minutesToHHMM } from "@/lib/utils/time"
import { summarizeTimeline, type DutyBlock } from "@/lib/utils/roster/duty-timeline"

const HOUR = 3_600_000
const DAY = 24 * HOUR

type Zoom = "3" | "7" | "14"
const ZOOMS: SegmentedTab<Zoom>[] = [
  { value: "3", label: "3 Days" },
  { value: "7", label: "Week" },
  { value: "14", label: "2 Weeks" },
]

/** The strip's vertical geometry, px. */
const STRIP_H = 128
const DAY_LABEL_H = 18
const BASE_Y = 100 // the baseline: rest runs along it, duty rises off it
const BLOCK_TOP = 36
const FLIGHT_TOP = 70 // sectors fill the block's lower part, down to the base

/** A block narrower than this shows no text — a tap still opens it. */
const LABEL_MIN_PX = 42

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
    (min: number) => formatHHMMDisplay(minutesToHHMM(min), display.timeFormat === "12h" ? "24h" : display.timeFormat),
    [display.timeFormat],
  )
  // "MON 3": the weekday first, as a pilot reads a roster. One formatter for
  // each half, because a locale's own order for the pair puts the day first.
  const dayLabel = useMemo(() => {
    const wd = tzFormatter(zone, { weekday: "short" }, "wd")
    const dn = tzFormatter(zone, { day: "numeric" }, "dn")
    return (ms: number) => `${wd.format(new Date(ms))} ${dn.format(new Date(ms))}`
  }, [zone])
  const rangeLabel = useMemo(() => tzFormatter(zone, { day: "numeric", month: "short" }, "d-mon"), [zone])

  const [zoom, setZoom] = useState<Zoom>("7")
  const [width, setWidth] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // One clock reading per mount: the "Now" line and the default view. The
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
  const pxPerMs = width > 0 ? width / (spanDays * DAY) : 0
  const xOf = useCallback((ms: number) => (ms - rangeStart) * pxPerMs, [rangeStart, pxPerMs])

  // Which day the view starts on — moved by the scroll, in whole days, so a
  // scroll re-renders only when the days in view change.
  const [viewDay, setViewDay] = useState(0)
  const pendingCenterRef = useRef<number | null>(nowMs + spanDays * DAY * 0.15)

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

  // Put a pending centre (the opening view, or the centre kept across a zoom)
  // in the middle of the view, once the scale it needs is known.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    const center = pendingCenterRef.current
    if (!el || center == null || pxPerMs === 0) return
    pendingCenterRef.current = null
    el.scrollLeft = Math.max(0, xOf(center) - width / 2)
  }, [pxPerMs, width, xOf])

  const dayPx = DAY * pxPerMs
  const onScroll = useRef<number>(0)
  const handleScroll = useCallback(() => {
    if (onScroll.current) return
    onScroll.current = requestAnimationFrame(() => {
      onScroll.current = 0
      const el = scrollerRef.current
      if (!el || dayPx === 0) return
      const next = Math.max(0, Math.floor(el.scrollLeft / dayPx))
      setViewDay((prev) => (prev === next ? prev : next))
    })
  }, [dayPx])
  useEffect(() => () => cancelAnimationFrame(onScroll.current), [])

  const changeZoom = useCallback(
    (next: Zoom) => {
      const el = scrollerRef.current
      if (el && pxPerMs > 0) pendingCenterRef.current = rangeStart + (el.scrollLeft + width / 2) / pxPerMs
      setZoom(next)
    },
    [pxPerMs, rangeStart, width],
  )

  // The days in view, for the figures; a view's worth either side is drawn.
  const viewFrom = days[Math.min(viewDay, days.length - 1)] ?? rangeStart
  const viewTo = viewFrom + spanDays * DAY
  const drawFrom = viewFrom - spanDays * DAY
  const drawTo = viewTo + spanDays * DAY
  const summary = useMemo(() => summarizeTimeline(blocks, viewFrom, viewTo), [blocks, viewFrom, viewTo])
  // Each drawn block with the end of the duty before it — where its rest began.
  const visibleBlocks = useMemo(() => {
    const out: { b: DutyBlock; prevEnd: number | null }[] = []
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (b.endMs > drawFrom && b.startMs < drawTo) out.push({ b, prevEnd: i > 0 ? blocks[i - 1].endMs : null })
    }
    return out
  }, [blocks, drawFrom, drawTo])
  const visibleDays = useMemo(() => days.filter((d) => d + DAY > drawFrom && d < drawTo), [days, drawFrom, drawTo])
  const selected = useMemo(() => blocks.find((b) => b.id === selectedId) ?? null, [blocks, selectedId])

  const innerWidth = Math.max(width, (rangeEnd - rangeStart) * pxPerMs)

  return (
    <FormSection title="Duty Timeline">
      <div className="space-y-2 px-3 pb-3 pt-1">
        {/* What the days in view add up to — the three questions. */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {rangeLabel.format(new Date(viewFrom))} – {rangeLabel.format(new Date(viewTo - 1))}
          </span>
          <SegmentedTabs tabs={ZOOMS} value={zoom} onChange={changeZoom} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Figure value={duration(summary.flightMinutes)} caption="Flown" color={FDP_COLORS.flight} />
          <Figure value={duration(summary.dutyMinutes)} caption="Duty" color={FDP_COLORS.duty} />
          <Figure
            value={summary.shortestRestMinutes == null ? "—" : duration(summary.shortestRestMinutes)}
            caption={summary.shortRests > 0 ? `Shortest Rest · ${summary.shortRests} short` : "Shortest Rest"}
            alert={summary.shortRests > 0}
          />
        </div>

        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="relative overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide rounded-lg bg-muted/30"
          style={{ height: STRIP_H }}
          role="group"
          aria-label="Duty timeline"
        >
          {pxPerMs > 0 && (
            <div className="relative h-full" style={{ width: innerWidth }}>
              {/* Days: a rule at each midnight, its name above it. */}
              {visibleDays.map((d) => (
                <div key={d} className="absolute inset-y-0 border-l border-border/60" style={{ left: xOf(d) }}>
                  <span className="absolute left-1 top-0.5 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {dayLabel(d)}
                  </span>
                </div>
              ))}

              {/* The baseline the rest runs along. */}
              <div className="absolute inset-x-0 h-px bg-border" style={{ top: BASE_Y }} />

              {/* Rest between duties — a figure in each gap wide enough to hold it. */}
              {visibleBlocks.map(({ b, prevEnd }) => {
                if (prevEnd == null || !b.restBefore) return null
                const left = xOf(prevEnd)
                const gap = xOf(b.startMs) - left
                if (gap < 30) return null
                const short = b.restBefore.compliant === false
                return (
                  <span
                    key={`rest-${b.id}`}
                    className={cn(
                      "absolute truncate text-center text-[10px] tabular-nums",
                      short ? "font-semibold text-status-error" : "text-muted-foreground",
                    )}
                    style={{ left, width: gap, top: BASE_Y + 6 }}
                  >
                    {gap >= 70 ? "Rest " : ""}
                    {duration(b.restBefore.minutes)}
                  </span>
                )
              })}

              {/* "Now" — the line between what has happened and what is planned. */}
              {nowMs > drawFrom && nowMs < drawTo && (
                <div className="pointer-events-none absolute z-10 border-l border-dashed border-foreground/70" style={{ left: xOf(nowMs), top: DAY_LABEL_H, bottom: 0 }}>
                  <span className="absolute -left-3 -top-0.5 rounded bg-foreground px-1 text-[9px] font-semibold uppercase text-background">
                    Now
                  </span>
                </div>
              )}

              {visibleBlocks.map(({ b }) => (
                <DutyBlockView
                  key={b.id}
                  block={b}
                  left={xOf(b.startMs)}
                  width={Math.max(3, xOf(b.endMs) - xOf(b.startMs))}
                  xOf={xOf}
                  selected={b.id === selectedId}
                  label={`${clock(b.startMs)}–${clock(b.endMs)}`}
                  duration={duration}
                  onSelect={() => setSelectedId((cur) => (cur === b.id ? null : b.id))}
                />
              ))}
            </div>
          )}
        </div>

        {/* The key — colour is never the only carrier: planned is dashed. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground" aria-hidden>
          <Key swatch={<span className="h-2.5 w-3 rounded-sm border" style={{ borderColor: FDP_COLORS.duty, background: `${FDP_COLORS.duty}40` }} />} label="Duty" />
          <Key swatch={<span className="h-2.5 w-3 rounded-sm" style={{ background: FDP_COLORS.flight }} />} label="Flight" />
          <Key swatch={<span className="h-2.5 w-3 rounded-sm border border-dashed" style={{ borderColor: FDP_COLORS.planned, background: `${FDP_COLORS.planned}33` }} />} label="Planned" />
          <Key swatch={<span className="text-status-error font-semibold">10:00</span>} label="Rest short" />
        </div>

        {selected && (
          <DutyDetail block={selected} clock={clock} duration={duration} onClose={() => setSelectedId(null)} />
        )}
      </div>
    </FormSection>
  )
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

function DutyBlockView({
  block: b,
  left,
  width,
  xOf,
  selected,
  label,
  duration,
  onSelect,
}: {
  block: DutyBlock
  left: number
  width: number
  xOf: (ms: number) => number
  selected: boolean
  label: string
  duration: (min: number) => string
  onSelect: () => void
}) {
  const color = b.isFuture ? FDP_COLORS.planned : FDP_COLORS.duty
  const name = b.isStandby ? "Standby" : b.route || "Duty"
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${name}, ${label}, duty ${duration(b.dutyMinutes)}${b.isStandby ? "" : `, flight ${duration(b.flightMinutes)}`}`}
      className={cn(
        "absolute overflow-hidden rounded-t-md border border-b-0 text-left transition-[box-shadow]",
        b.isFuture && "border-dashed",
        selected && "ring-2 ring-primary ring-offset-1 ring-offset-card",
      )}
      style={{
        left,
        width,
        top: BLOCK_TOP,
        height: BASE_Y - BLOCK_TOP,
        borderColor: color,
        background: b.isStandby
          ? `repeating-linear-gradient(135deg, ${color}26 0 4px, transparent 4px 8px)`
          : `${color}33`,
      }}
    >
      {/* What the block is, while it is wide enough to say. */}
      {width >= LABEL_MIN_PX && (
        <span className="absolute inset-x-1 top-0.5 block truncate text-[10px] font-semibold leading-tight text-foreground">
          {b.isStandby ? "SBY" : duration(b.dutyMinutes)}
          {width >= 90 && !b.isStandby && b.route && (
            <span className="font-normal text-muted-foreground"> · {b.route}</span>
          )}
        </span>
      )}
      {width >= 120 && (
        <span className="absolute inset-x-1 top-3.5 block truncate text-[10px] leading-tight text-muted-foreground tabular-nums">{label}</span>
      )}
      {/* The sectors: the flight time inside the duty. */}
      {b.sectors.map((s) =>
        s.positioning ? null : (
          <span
            key={s.id}
            className="absolute bottom-0 rounded-t-sm"
            style={{
              left: xOf(s.outMs) - left,
              width: Math.max(2, xOf(s.inMs) - xOf(s.outMs)),
              top: FLIGHT_TOP - BLOCK_TOP,
              background: b.isFuture ? FDP_COLORS.planned : FDP_COLORS.flight,
              opacity: b.isFuture ? 0.55 : 0.9,
            }}
          />
        ),
      )}
    </button>
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
  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {b.isStandby ? "Standby" : b.route || "Duty"}
            {b.isFuture && <span className="ml-1.5 text-xs font-medium" style={{ color: FDP_COLORS.planned }}>Planned</span>}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {clock(b.startMs)} – {clock(b.endMs)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close duty details"
          className="control-surface flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <ReadOnlyRow label="Sign-On" value={clock(b.startMs)} />
        <ReadOnlyRow label="Sign-Off" value={clock(b.endMs)} />
        <ReadOnlyRow
          label="Duty"
          value={b.maxFdpMinutes > 0 ? `${duration(b.dutyMinutes)} · FDP max ${duration(b.maxFdpMinutes)}` : duration(b.dutyMinutes)}
        />
        {!b.isStandby && <ReadOnlyRow label="Flight Time" value={duration(b.flightMinutes)} />}
        {!b.isStandby && <ReadOnlyRow label="Sectors" value={String(b.sectors.length)} />}
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
                <p className="text-xs text-muted-foreground tabular-nums">{duration(Math.round((s.inMs - s.outMs) / 60_000))}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
