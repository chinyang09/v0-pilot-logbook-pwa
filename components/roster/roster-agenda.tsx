/**
 * The agenda under the roster's month: day by day, SOONEST FIRST, from the day
 * selected in the calendar (today unless you pick another) to the last day
 * anything is rostered.
 *
 * The old roster listed every date newest-first — a roster is read forwards,
 * "what is next", so the duty you need was at the bottom of the history.
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

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
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
}: RosterAgendaProps) {
  const rows = useMemo(() => flatten(agenda), [agenda])

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

  // TanStack Virtual returns a mutable instance the React Compiler cannot
  // reason about; that is the library's shape, not something to fix here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: (i) => (rows[i].kind === "header" ? HEADER_H : ITEM_H),
    getItemKey: (i) => rows[i].key,
    overscan: 8,
    scrollMargin,
  })

  return (
    <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
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
                  <Plus className="h-3.5 w-3.5" /> Add duty
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
