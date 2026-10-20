"use client"

/**
 * The roster's month — the page, not a toggle behind a list.
 *
 * Each day says WHAT it is (SBY, OFF, AL, TR602), not merely that something is
 * there: a dot per duty made the old calendar a picture of "busy / not busy"
 * that had to be tapped to be read. Two labels fit a phone-width cell; the rest
 * is a count. Tapping a day selects it, and the agenda below starts there.
 *
 * Weeks start on Sunday, like the logbook's calendar.
 */

import { memo, useEffect, useMemo, useRef, type KeyboardEvent } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { parseYMDLocal, formatLocalYMD } from "@/lib/utils/date"
import { itemLabel, type RosterItem } from "@/lib/utils/roster/roster-days"
import { DUTY_TYPE_COLORS } from "@/components/roster/duty-entry-card"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** A cell label's tint. Flights follow the logbook: magenta until flown. */
export function itemTone(item: RosterItem): string {
  if (item.kind === "duty") {
    const c = DUTY_TYPE_COLORS[item.entry.dutyType] ?? DUTY_TYPE_COLORS.other
    return cn(c.bg, c.text)
  }
  // -700 on the light theme for the sim: these labels are 9px, and a -600 on
  // its own 10% tint measured 4.1:1.
  // A flight still to fly is PLANNED, and planned is magenta — the accent, the
  // same as the logbook's scheduled card. Flown is the plain record, and the
  // simulator takes the one hue nothing else here uses.
  if (item.simulator) return "bg-teal-500/10 text-teal-700 dark:text-teal-300"
  return item.flown ? "bg-secondary text-foreground" : "bg-primary/10 text-primary"
}

interface RosterMonthProps {
  /** Any YYYY-MM-DD in the month to draw; the selected day. */
  selectedKey: string
  todayKey: string
  days: ReadonlyMap<string, RosterItem[]>
  onSelect: (dayKey: string) => void
  /** -1 / +1 month. */
  onStep: (delta: number) => void
  onToday: () => void
}

export const RosterMonth = memo(function RosterMonth({
  selectedKey,
  todayKey,
  days,
  onSelect,
  onStep,
  onToday,
}: RosterMonthProps) {
  const anchor = parseYMDLocal(selectedKey)
  const year = anchor.getFullYear()
  const month = anchor.getMonth()

  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const start = new Date(year, month, 1 - first.getDay())
    // Only as many weeks as the month spans (4–6), so the grid is no taller
    // than it needs to be and the agenda starts higher.
    const last = new Date(year, month + 1, 0)
    const weeks = Math.ceil((first.getDay() + last.getDate()) / 7)
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      return { key: formatLocalYMD(date), day: date.getDate(), inMonth: date.getMonth() === month }
    })
  }, [year, month])

  const title = anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  // Horizontal swipe steps the month. Tracked in refs — nothing renders from
  // it — and only a clearly horizontal gesture counts, so a vertical scroll
  // that starts on the grid is left to the page.
  const swipeRef = useRef<{ x: number; y: number } | null>(null)

  // Keyboard: ONE tab stop (the selected day), arrows move it — a day or a
  // week — across month boundaries too. Focus follows the selection only when
  // the keyboard moved it, so a tap never steals focus.
  const gridRef = useRef<HTMLDivElement>(null)
  const keyboardMoveRef = useRef(false)
  useEffect(() => {
    if (!keyboardMoveRef.current) return
    keyboardMoveRef.current = false
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${selectedKey}"]`)?.focus()
  }, [selectedKey])
  const onGridKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!step) return
    e.preventDefault()
    keyboardMoveRef.current = true
    onSelect(formatLocalYMD(new Date(year, month, anchor.getDate() + step)))
  }

  return (
    <section aria-label="Roster calendar" className="rounded-2xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="flex items-center">
          <button
            type="button"
            onClick={onToday}
            disabled={selectedKey === todayKey}
            className="h-9 rounded-full px-3 text-xs font-medium text-primary disabled:text-muted-foreground"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onStep(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-foreground hover:bg-secondary"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onStep(1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-foreground hover:bg-secondary"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 pb-1" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      <div
        ref={gridRef}
        role="group"
        aria-label={title}
        onKeyDown={onGridKeyDown}
        className="grid grid-cols-7 gap-1"
        style={{ touchAction: "pan-y" }}
        onPointerDown={(e) => {
          swipeRef.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const from = swipeRef.current
          swipeRef.current = null
          if (!from) return
          const dx = e.clientX - from.x
          const dy = e.clientY - from.y
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onStep(dx < 0 ? 1 : -1)
        }}
        onPointerCancel={() => {
          swipeRef.current = null
        }}
      >
        {cells.map((cell) => {
          const items = days.get(cell.key) ?? []
          const shown = items.slice(0, 2)
          const more = items.length - shown.length
          const isToday = cell.key === todayKey
          const isSelected = cell.key === selectedKey
          return (
            <button
              key={cell.key}
              type="button"
              data-day={cell.key}
              tabIndex={isSelected ? 0 : -1}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${parseYMDLocal(cell.key).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}${items.length ? `, ${items.map(itemLabel).join(", ")}` : ", nothing rostered"}`}
              onClick={() => onSelect(cell.key)}
              className={cn(
                "flex min-h-[3.75rem] min-w-0 flex-col items-stretch gap-0.5 rounded-lg p-0.5 text-left transition-colors",
                cell.inMonth ? "text-foreground" : "text-muted-foreground/60",
                isSelected ? "bg-secondary ring-2 ring-primary/70" : "hover:bg-secondary/60"
              )}
            >
              <span
                className={cn(
                  "mx-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
                  isToday && "bg-primary font-bold text-primary-foreground",
                  !isToday && items.length > 0 && cell.inMonth && "font-semibold"
                )}
              >
                {cell.day}
              </span>
              {shown.map((item) => (
                <span
                  key={item.id}
                  className={cn(
                    "truncate rounded px-0.5 text-center text-[9px] font-semibold leading-[14px] tracking-tight",
                    itemTone(item),
                    !cell.inMonth && "opacity-50"
                  )}
                >
                  {itemLabel(item)}
                </span>
              ))}
              {more > 0 && (
                <span className="text-center text-[9px] leading-[12px] text-muted-foreground">+{more}</span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
})
