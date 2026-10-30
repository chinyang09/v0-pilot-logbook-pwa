/**
 * The agenda under the roster's month: every rostered day in date order, read
 * FORWARDS, scrolling under the month as the logbook's list scrolls under its
 * calendar. Tapping a day in the month scrolls that day's heading to just
 * under the month (`scrollToDay`); scrolling the list moves the month's
 * selection to the day at its top (`onTopDayChange`) — one list, two ways in.
 *
 * Duties are the roster's own rows: tap to edit, swipe to delete (into Recently
 * Deleted, like everything else). Flights are the logbook's and are read-only
 * here; tapping one opens it in the roster's own detail panel.
 *
 * VIRTUALISED, like the logbook, and on the logbook's rule: every row KIND has
 * one fixed height (`HEADER_H`, `ITEM_H`) and nothing is measured. A measured
 * row that disagrees with its estimate makes the virtualizer correct the
 * scroll offset, and a programmatic scroll cancels a momentum fling on touch.
 * The list shares the page's scroller with the month above it, so its offset
 * in that scroller is the virtualizer's `scrollMargin`, read in a
 * ResizeObserver callback (never mid-commit).
 */

import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { observeRectAfterLayout, viewportRect } from "@/lib/utils/virtual-scroll"
import { Plane, MonitorPlay, Trash2, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { parseYMDLocal } from "@/lib/utils/date"
import { formatInstant } from "@/lib/utils/tz-format"
import { getDepartureDisplay, getArrivalDisplay } from "@/lib/utils/airport-display"
import type { RosterItem } from "@/lib/utils/roster/roster-days"
import type { DisplayPreferences } from "@/types/db/stores.types"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import { SwipeableCard } from "@/components/swipeable-card"
import { DUTY_TYPE_ICONS } from "@/components/roster/duty-entry-card"
import { itemTone } from "@/components/roster/roster-month"

const DAY_MS = 86_400_000

/** A day heading: 16px of air above its 20px line. */
const HEADER_H = 36
/** A card (58px, fixed — two lines, `py-2.5`, the border) and the 6px under it. */
const ITEM_H = 64

function relativeDay(dayKey: string, todayKey: string): string | null {
  const diff = Math.round((parseYMDLocal(dayKey).getTime() - parseYMDLocal(todayKey).getTime()) / DAY_MS)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  if (diff === -1) return "Yesterday"
  if (diff > 1 && diff < 14) return `In ${diff} days`
  return null
}

function timeRange(item: RosterItem, display: DisplayPreferences | undefined): string | null {
  if (item.startMs === null) return null
  const start = formatInstant(item.startMs, display)
  if (item.endMs === null) return start
  const end = formatInstant(item.endMs, display)
  // An end on a later display day carries "+1", as a flight strip does.
  const zulu = display?.useZuluTime ?? true
  const dayOf = (ms: number) => (zulu ? Math.floor(ms / DAY_MS) : Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / DAY_MS))
  const plus = dayOf(item.endMs) - dayOf(item.startMs)
  return `${start} – ${end}${plus > 0 ? ` +${plus}` : ""}`
}

/** One row of the virtual list. */
type AgendaRow =
  | { kind: "header"; key: string; dayKey: string }
  | { kind: "empty"; key: string; dayKey: string }
  | { kind: "item"; key: string; item: RosterItem }

function flatten(agenda: Array<{ dayKey: string; items: RosterItem[] }>): AgendaRow[] {
  const rows: AgendaRow[] = []
  for (const { dayKey, items } of agenda) {
    rows.push({ kind: "header", key: `h:${dayKey}`, dayKey })
    if (items.length === 0) rows.push({ kind: "empty", key: `e:${dayKey}`, dayKey })
    for (const item of items) rows.push({ kind: "item", key: item.id, item })
  }
  return rows
}

/** How the page drives the list. */
export interface RosterAgendaHandle {
  /** Scroll so this day's heading sits just under the stuck month. */
  scrollToDay: (dayKey: string, behavior?: ScrollBehavior) => void
}

/** A programmatic scroll is "done" once no scroll event has come for this long. */
const SETTLE_MS = 160

interface RosterAgendaProps {
  agenda: Array<{ dayKey: string; items: RosterItem[] }>
  todayKey: string
  display?: DisplayPreferences
  activations: ReadonlyMap<string, { at: string; standbyMinutes: number } | null>
  /** The page's scroller, which the list shares with the month above it. */
  scrollElement: HTMLElement | null
  /** The duty or flight shown in the detail panel beside the agenda, if any. */
  selectedId?: string | null
  onEditDuty: (entry: ScheduleEntry) => void
  onDeleteDuty: (entry: ScheduleEntry) => void
  /** Open one of the logbook's flights in the roster's detail panel. */
  onOpenFlight: (flightId: string) => void
  /** Add a duty ON this day — an empty later day used to add it to the first. */
  onAddDuty: (dayKey: string) => void
  /** The sticky month above the list: the list reads where it ends. */
  stickyElement: HTMLElement | null
  /** The pilot scrolled a different day to the top of the list. */
  onTopDayChange: (dayKey: string) => void
  controlRef?: Ref<RosterAgendaHandle>
}

/** One formatter for every day heading — `toLocaleDateString` builds one per call. */
const DAY_HEADING = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" })

export const RosterAgenda = memo(function RosterAgenda({
  agenda,
  todayKey,
  display,
  activations,
  scrollElement,
  selectedId = null,
  onEditDuty,
  onDeleteDuty,
  onOpenFlight,
  onAddDuty,
  stickyElement,
  onTopDayChange,
  controlRef,
}: RosterAgendaProps) {
  const rows = useMemo(() => flatten(agenda), [agenda])
  // Every row's top in list coordinates, the day it belongs to and each day's
  // heading — fixed heights make these exact, so nothing is measured.
  const layout = useMemo(() => {
    const starts: number[] = []
    const dayOf: string[] = []
    const headings = new Map<string, number>()
    let y = 0
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      starts.push(y)
      const day = row.kind === "item" ? dayOf[i - 1] : row.dayKey
      dayOf.push(day)
      if (row.kind === "header") headings.set(day, i)
      y += row.kind === "header" ? HEADER_H : ITEM_H
    }
    const lastHeading = rows.length ? (headings.get(dayOf[rows.length - 1]) ?? 0) : 0
    return { starts, dayOf, headings, total: y, lastGroup: rows.length ? y - starts[lastHeading] : 0 }
  }, [rows])

  // Where the list starts inside the shared scroller. Re-read whenever
  // anything above it changes height (the month grows a sixth week) — the
  // parent holds both, so observing it covers that.
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  useEffect(() => {
    const list = listRef.current
    if (!list || !scrollElement) return
    const ro = new ResizeObserver(() => {
      const top = list.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop
      setScrollMargin((prev) => (Math.abs(prev - top) < 0.5 ? prev : top))
    })
    if (list.parentElement) ro.observe(list.parentElement)
    ro.observe(list)
    return () => ro.disconnect()
  }, [scrollElement])

  // Where the stuck month ends, from the scroller's top: its `top` plus its
  // height. Read in a ResizeObserver callback (the month grows a sixth week),
  // with how much of the scroller is left under it — the tail spacer lets the
  // LAST day reach the top too, or a tap on it could never be answered.
  const stuckBottomRef = useRef(0)
  const stickyHeightRef = useRef(0)
  const [roomUnder, setRoomUnder] = useState(0)
  useEffect(() => {
    if (!stickyElement || !scrollElement) return
    const read = () => {
      const top = Number.parseFloat(getComputedStyle(stickyElement).top) || 0
      stickyHeightRef.current = stickyElement.offsetHeight
      stuckBottomRef.current = top + stickyElement.offsetHeight
      const room = Math.max(0, scrollElement.clientHeight - stuckBottomRef.current)
      setRoomUnder((prev) => (Math.abs(prev - room) < 1 ? prev : room))
    }
    const ro = new ResizeObserver(read)
    ro.observe(stickyElement)
    ro.observe(scrollElement)
    return () => ro.disconnect()
  }, [stickyElement, scrollElement])

  const layoutRef = useRef(layout)
  const marginRef = useRef(scrollMargin)
  const onTopRef = useRef(onTopDayChange)
  useLayoutEffect(() => {
    layoutRef.current = layout
    marginRef.current = scrollMargin
    onTopRef.current = onTopDayChange
  })

  // The day under the month's lower edge, and how far into its group the edge is.
  const anchorAt = useCallback((scrollTop: number): { day: string; delta: number } | null => {
    const { starts, dayOf, headings } = layoutRef.current
    if (!starts.length) return null
    const y = scrollTop + stuckBottomRef.current - marginRef.current + 1
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= y) lo = mid
      else hi = mid - 1
    }
    const day = dayOf[lo]
    return { day, delta: y - 1 - starts[headings.get(day) ?? lo] }
  }, [])

  // A scroll WE started is not the pilot moving the list: the month already
  // shows the day it is heading for, and reading days off it on the way would
  // walk the selection through every day in between.
  const programmaticRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<{ day: string; delta: number } | null>(null)
  const reportedRef = useRef<string | null>(null)
  const settle = useCallback(() => {
    if (programmaticRef.current) clearTimeout(programmaticRef.current)
    programmaticRef.current = setTimeout(() => {
      programmaticRef.current = null
    }, SETTLE_MS)
  }, [])

  useEffect(() => {
    if (!scrollElement) return
    let frame = 0
    const onScroll = () => {
      if (programmaticRef.current) settle()
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const top = scrollElement.scrollTop
        // The month's cover over the header band shows only once it is stuck:
        // its natural place is right above the list.
        const stickyTop = stuckBottomRef.current - stickyHeightRef.current
        const naturalTop = marginRef.current - stickyHeightRef.current
        stickyElement?.toggleAttribute("data-stuck", top + stickyTop >= naturalTop - 0.5)
        const at = anchorAt(top)
        anchorRef.current = at
        if (!at || programmaticRef.current || at.day === reportedRef.current) return
        reportedRef.current = at.day
        onTopRef.current(at.day)
      })
    }
    scrollElement.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      scrollElement.removeEventListener("scroll", onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scrollElement, stickyElement, anchorAt, settle])

  // Rows arriving or leaving ABOVE the top day (a sync, a tapped empty day)
  // would move the list under the reader; keep that day where it was. The
  // offsets are exact, so this is one write, not a correction loop.
  const prevLayoutRef = useRef(layout)
  useLayoutEffect(() => {
    const before = prevLayoutRef.current
    prevLayoutRef.current = layout
    const at = anchorRef.current
    if (!scrollElement || !at || before === layout) return
    const oldHeading = before.headings.get(at.day)
    const newHeading = layout.headings.get(at.day)
    if (oldHeading === undefined || newHeading === undefined) return
    const shift = layout.starts[newHeading] - before.starts[oldHeading]
    if (shift !== 0) scrollElement.scrollTop += shift
  }, [layout, scrollElement])

  const handle = useRef<RosterAgendaHandle | null>(null)
  useImperativeHandle(
    controlRef,
    () => (handle.current = {
      scrollToDay(dayKey, behavior = "smooth") {
        if (!scrollElement) return
        // Asked before the ResizeObservers have reported (the page's first
        // open): wait a frame or two rather than read layout mid-commit.
        if (!stuckBottomRef.current || !marginRef.current) {
          let tries = 0
          const retry = () => {
            if (stuckBottomRef.current && marginRef.current) handle.current?.scrollToDay(dayKey, behavior)
            else if (++tries < 10) requestAnimationFrame(retry)
          }
          requestAnimationFrame(retry)
          return
        }
        const { starts, headings, dayOf } = layoutRef.current
        let index = headings.get(dayKey)
        if (index === undefined) {
          // The nearest day after it, else the last.
          const next = dayOf.findIndex((d) => d >= dayKey)
          index = headings.get(dayOf[next === -1 ? dayOf.length - 1 : next])
        }
        if (index === undefined) return
        reportedRef.current = dayOf[index]
        anchorRef.current = { day: dayOf[index], delta: 0 }
        const top = Math.max(0, marginRef.current + starts[index] - stuckBottomRef.current)
        if (Math.abs(scrollElement.scrollTop - top) < 1) return
        settle()
        scrollElement.scrollTo({ top, behavior })
      },
    }),
    [scrollElement, settle]
  )

  // Stable, or the virtualizer rebuilds every row's measurement on each render.
  const getItemKey = useCallback((i: number) => rows[i].key, [rows])

  // TanStack Virtual returns a mutable instance the React Compiler cannot
  // reason about; that is the library's shape, not something to fix here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    // Sized from a ResizeObserver, not a synchronous read mid-commit (see
    // `observeRectAfterLayout`).
    observeElementRect: observeRectAfterLayout,
    initialRect: viewportRect(),
    estimateSize: (i) => (rows[i].kind === "header" ? HEADER_H : ITEM_H),
    getItemKey,
    overscan: 8,
    scrollMargin,
  })

  return (
    <div
      ref={listRef}
      className="relative w-full"
      // The tail lets the last day reach the top under the month.
      style={{ height: virtualizer.getTotalSize() + Math.max(0, roomUnder - layout.lastGroup) }}
    >
      {virtualizer.getVirtualItems().map((v) => {
        const row = rows[v.index]
        return (
          <div
            key={v.key}
            data-roster-row=""
            className="absolute inset-x-0 top-0"
            style={{ height: v.size, transform: `translateY(${v.start - scrollMargin}px)` }}
          >
            {row.kind === "header" ? (
              <DayHeading dayKey={row.dayKey} todayKey={todayKey} />
            ) : row.kind === "empty" ? (
              <div className="flex h-[58px] items-center justify-between gap-3 rounded-xl border border-dashed border-border px-3">
                <span className="text-sm text-muted-foreground">Nothing rostered</span>
                <button
                  type="button"
                  onClick={() => onAddDuty(row.dayKey)}
                  className="control-surface flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Duty
                </button>
              </div>
            ) : row.item.kind === "duty" ? (
              <SwipeableCard
                id={`roster-${row.item.id}`}
                actions={[
                  {
                    icon: <Trash2 className="h-5 w-5" />,
                    ariaLabel: "Delete duty",
                    variant: "destructive",
                    onClick: () => onDeleteDuty((row.item as Extract<RosterItem, { kind: "duty" }>).entry),
                  },
                ]}
              >
                <DutyRow
                  item={row.item}
                  display={display}
                  activation={activations.get(row.item.id) ?? null}
                  selected={row.item.id === selectedId}
                  onClick={() => onEditDuty((row.item as Extract<RosterItem, { kind: "duty" }>).entry)}
                />
              </SwipeableCard>
            ) : (
              <FlightRow
                item={row.item}
                display={display}
                selected={`flight:${row.item.flight.id}` === selectedId}
                onOpen={onOpenFlight}
              />
            )}
          </div>
        )
      })}
    </div>
  )
})

function DayHeading({ dayKey, todayKey }: { dayKey: string; todayKey: string }) {
  const rel = relativeDay(dayKey, todayKey)
  return (
    <div className="flex items-baseline justify-between px-1 pt-4">
      <h3 className="text-[11px] font-semibold uppercase leading-5 tracking-wider text-muted-foreground">
        {DAY_HEADING.format(parseYMDLocal(dayKey))}
      </h3>
      {rel && <span className={cn("text-[11px] leading-5", rel === "Today" ? "font-semibold text-primary" : "text-muted-foreground")}>{rel}</span>}
    </div>
  )
}

// Fixed height: the virtual list depends on it (see HEADER_H / ITEM_H).
const ROW = "flex h-[58px] w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"

function DutyRow({
  item,
  display,
  activation,
  selected,
  onClick,
}: {
  item: Extract<RosterItem, { kind: "duty" }>
  display?: DisplayPreferences
  activation: { at: string; standbyMinutes: number } | null
  selected: boolean
  onClick: () => void
}) {
  const { entry } = item
  const Icon = DUTY_TYPE_ICONS[entry.dutyType] ?? DUTY_TYPE_ICONS.other
  const range = timeRange(item, display)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      aria-current={selected || undefined}
      className={cn(ROW, selected && "border-primary/40 bg-primary/10")}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", itemTone(item))}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{entry.dutyCode || entry.dutyType}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {entry.dutyDescription || entry.dutyType}
          {activation ? ` · called out ${activation.at}Z` : ""}
        </span>
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">{range ?? "All day"}</span>
    </div>
  )
}

function FlightRow({
  item,
  display,
  selected,
  onOpen,
}: {
  item: Extract<RosterItem, { kind: "flight" }>
  display?: DisplayPreferences
  selected: boolean
  onOpen: (flightId: string) => void
}) {
  const f = item.flight
  const range = timeRange(item, display)
  const route = item.simulator
    ? "Simulator"
    : `${getDepartureDisplay(f, display?.airportIdentifier)} → ${getArrivalDisplay(f, display?.airportIdentifier)}`
  const aircraft = [f.aircraftReg, f.aircraftType].filter(Boolean).join(" · ")
  return (
    // Opens in the ROSTER's detail panel. It was a link into the logbook, so
    // Back from the flight left the roster for the logbook.
    <button
      type="button"
      onClick={() => onOpen(f.id)}
      aria-current={selected || undefined}
      className={cn(ROW, selected && "border-primary/40 bg-primary/10")}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", itemTone(item))}>
        {item.simulator ? <MonitorPlay className="h-4 w-4" /> : <Plane className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {f.flightNumber ? `${f.flightNumber} · ` : ""}
          {route}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {item.flown ? "Flown" : "Scheduled"}
          {aircraft ? ` · ${aircraft}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">{range ?? ""}</span>
    </button>
  )
}
