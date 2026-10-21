"use client"

/**
 * The agenda under the roster's month: day by day, SOONEST FIRST, from the day
 * selected in the calendar (today unless you pick another).
 *
 * The old roster listed every date newest-first — a roster is read forwards,
 * "what is next", so the duty you need was at the bottom of the history.
 *
 * Duties are the roster's own rows: tap to edit, swipe to delete (into Recently
 * Deleted, like everything else). Flights are the logbook's and are read-only
 * here; tapping one opens it in the logbook.
 */

import { memo } from "react"
import Link from "next/link"
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

interface RosterAgendaProps {
  agenda: Array<{ dayKey: string; items: RosterItem[] }>
  todayKey: string
  display?: DisplayPreferences
  activations: ReadonlyMap<string, { at: string; standbyMinutes: number } | null>
  onEditDuty: (entry: ScheduleEntry) => void
  onDeleteDuty: (entry: ScheduleEntry) => void
  onAddDuty: () => void
}

/** One formatter for every day heading — `toLocaleDateString` builds one per call. */
const DAY_HEADING = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" })

export const RosterAgenda = memo(function RosterAgenda({
  agenda,
  todayKey,
  display,
  activations,
  onEditDuty,
  onDeleteDuty,
  onAddDuty,
}: RosterAgendaProps) {
  return (
    <div className="space-y-4">
      {agenda.map(({ dayKey, items }) => {
        const rel = relativeDay(dayKey, todayKey)
        return (
          <section key={dayKey} aria-labelledby={`roster-day-${dayKey}`} className="space-y-1.5">
            <div className="flex items-baseline justify-between px-1">
              <h3 id={`roster-day-${dayKey}`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {DAY_HEADING.format(parseYMDLocal(dayKey))}
              </h3>
              {rel && <span className={cn("text-[11px]", rel === "Today" ? "font-semibold text-primary" : "text-muted-foreground")}>{rel}</span>}
            </div>

            {items.length === 0 && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-3 py-3">
                <span className="text-sm text-muted-foreground">Nothing rostered</span>
                <button
                  type="button"
                  onClick={onAddDuty}
                  className="flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-primary hover:bg-secondary"
                >
                  <Plus className="h-3.5 w-3.5" /> Add duty
                </button>
              </div>
            )}

            {items.map((item) =>
              item.kind === "duty" ? (
                <SwipeableCard
                  key={item.id}
                  id={`roster-${item.id}`}
                  actions={[
                    {
                      icon: <Trash2 className="h-5 w-5" />,
                      ariaLabel: "Delete duty",
                      variant: "destructive",
                      onClick: () => onDeleteDuty(item.entry),
                    },
                  ]}
                >
                  <DutyRow
                    item={item}
                    display={display}
                    activation={activations.get(item.id) ?? null}
                    onClick={() => onEditDuty(item.entry)}
                  />
                </SwipeableCard>
              ) : (
                <FlightRow key={item.id} item={item} display={display} />
              )
            )}
          </section>
        )
      })}
    </div>
  )
})

const ROW = "flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"

function DutyRow({
  item,
  display,
  activation,
  onClick,
}: {
  item: Extract<RosterItem, { kind: "duty" }>
  display?: DisplayPreferences
  activation: { at: string; standbyMinutes: number } | null
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
      className={ROW}
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

function FlightRow({ item, display }: { item: Extract<RosterItem, { kind: "flight" }>; display?: DisplayPreferences }) {
  const f = item.flight
  const range = timeRange(item, display)
  const route = item.simulator
    ? "Simulator"
    : `${getDepartureDisplay(f, display?.airportIdentifier)} → ${getArrivalDisplay(f, display?.airportIdentifier)}`
  const aircraft = [f.aircraftReg, f.aircraftType].filter(Boolean).join(" · ")
  return (
    <Link href={`/logbook?selected=${encodeURIComponent(f.id)}`} className={ROW}>
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
    </Link>
  )
}
