"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"

import { LogbookCalendar } from "@/components/logbook-calendar"
import { useFlights } from "@/hooks/data/use-flights"
import { useDashboardPeriod } from "@/hooks/use-dashboard-period"

function todayMonth() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() }
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "…"
  const d = new Date(`${iso}T00:00:00`)
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d)
}

/**
 * Range-mode wrapper around the logbook calendar.
 *
 * - When no tap is in progress, the picker mirrors the active period
 *   (preset or custom): the range pill spans `resolved.fromIso` →
 *   `resolved.toIso` and the header shows the same. Switching preset in
 *   the action bar instantly updates the picker.
 * - First tap starts a new pick: the range pill clears and only the tapped
 *   day is highlighted while the user picks the other endpoint.
 * - Second tap completes the range, auto-orders, and commits to the period.
 * - Date range header is injected inside the glass material so it visually
 *   belongs to the picker.
 */
export function DashboardCalendarPanel() {
  const { resolved, period, setPeriod, showCalendar } = useDashboardPeriod()
  const { flights } = useFlights()

  const [midPickStart, setMidPickStart] = React.useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = React.useState(todayMonth)

  // Clearing rules:
  // - Closing the picker discards any in-progress pick.
  // - Externally changing the period (preset selection from the action bar,
  //   or the second-tap commit) also discards mid-pick state so the picker
  //   re-syncs with the live period.
  React.useEffect(() => {
    if (!showCalendar) setMidPickStart(null)
  }, [showCalendar])

  React.useEffect(() => {
    setMidPickStart(null)
  }, [period])

  // Anchor the visible month on the active period's end whenever the picker
  // opens or the period changes externally.
  React.useEffect(() => {
    if (!showCalendar) return
    const anchor = new Date(`${resolved.toIso}T00:00:00`)
    setSelectedMonth({ year: anchor.getFullYear(), month: anchor.getMonth() })
  }, [showCalendar, resolved.toIso])

  const handleDateSelect = React.useCallback(
    (dateStr: string) => {
      if (midPickStart === null) {
        // First tap of a new range — pause range pill, mark the start.
        setMidPickStart(dateStr)
        return
      }
      // Second tap completes the range, auto-ordering. Commit to the period;
      // the period-change effect above clears midPickStart.
      const a = dateStr < midPickStart ? dateStr : midPickStart
      const b = dateStr < midPickStart ? midPickStart : dateStr
      setPeriod({ kind: "custom", from: a, to: b })
    },
    [midPickStart, setPeriod],
  )

  // What the calendar visualises: when a tap is in progress, only the start
  // of the new pick. Otherwise the live period.
  const displayStart = midPickStart ?? resolved.fromIso
  const displayEnd = midPickStart ? null : resolved.toIso

  const headerLabel = (
    <div className="relative flex items-center justify-center gap-2 px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="text-foreground tabular-nums">
        {formatShortDate(displayStart)}
      </span>
      <span aria-hidden>→</span>
      <span className="text-foreground tabular-nums">
        {formatShortDate(displayEnd)}
      </span>
    </div>
  )

  return (
    <AnimatePresence initial={false}>
      {showCalendar && (
        <motion.div
          key="dashboard-calendar"
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -16, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="pointer-events-none absolute inset-x-0 top-16 z-[60] flex justify-center px-2"
        >
          <div className="pointer-events-auto w-full max-w-md">
            <LogbookCalendar
              flights={flights}
              selectedMonth={selectedMonth}
              onMonthChange={(year, month) => setSelectedMonth({ year, month })}
              onDateSelect={handleDateSelect}
              rangeStart={displayStart}
              rangeEnd={displayEnd}
              header={headerLabel}
              glass
              cornerRadius={24}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
