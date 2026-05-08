"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"

import { LogbookCalendar } from "@/components/logbook-calendar"
import { useFlights } from "@/hooks/data/use-flights"
import { useDashboardPeriod } from "@/hooks/use-dashboard-period"

/**
 * Range-mode wrapper around the logbook calendar.
 *
 * - When no tap is in progress, the picker mirrors the active period
 *   (preset or custom): the range pill spans `resolved.fromIso` →
 *   `resolved.toIso`. Switching preset in the action bar clears any
 *   in-progress pick and re-syncs the picker.
 * - First tap starts a new pick: the range pill clears and only the
 *   tapped day is highlighted while the user picks the other endpoint.
 * - Second tap completes the range, auto-orders, and commits to the period.
 *
 * The visible month and the day-grid / month-year view toggle live in
 * `DashboardPeriodProvider` so the action bar's "MMM YY" label can read
 * and write them.
 */
export function DashboardCalendarPanel() {
  const {
    resolved,
    period,
    setPeriod,
    showCalendar,
    selectedMonth,
    setSelectedMonth,
    monthYearView,
    setMonthYearView,
  } = useDashboardPeriod()
  const { flights } = useFlights()

  const [midPickStart, setMidPickStart] = React.useState<string | null>(null)

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
  }, [showCalendar, resolved.toIso, setSelectedMonth])

  const handleDateSelect = React.useCallback(
    (dateStr: string) => {
      if (midPickStart === null) {
        setMidPickStart(dateStr)
        return
      }
      const a = dateStr < midPickStart ? dateStr : midPickStart
      const b = dateStr < midPickStart ? midPickStart : dateStr
      setPeriod({ kind: "custom", from: a, to: b })
    },
    [midPickStart, setPeriod],
  )

  const displayStart = midPickStart ?? resolved.fromIso
  const displayEnd = midPickStart ? null : resolved.toIso

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
              view={monthYearView ? "monthYear" : "calendar"}
              onMonthSelect={(year, month) => {
                setSelectedMonth({ year, month })
                setMonthYearView(false)
              }}
              onYearChange={(year) =>
                setSelectedMonth({ year, month: selectedMonth.month })
              }
              glass
              cornerRadius={24}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
