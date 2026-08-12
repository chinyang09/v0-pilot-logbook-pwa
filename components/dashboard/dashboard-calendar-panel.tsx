"use client"

import * as React from "react"

import { CalendarPanel } from "@/components/calendar-panel"
import { useFlights } from "@/hooks/data/use-flights"
import { useDashboardPeriod } from "@/hooks/use-dashboard-period"
import { usePanelDualMonth } from "@/lib/layout/panel-mode"
import { useIsDesktop } from "@/hooks/use-is-desktop"

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
 * `DashboardPeriodProvider`; the month/year picker opens from the CALENDAR's
 * own header, the same as the logbook's. The action bar used to carry an
 * expanding "MMM YYYY" label as well, which said the same thing twice and is
 * exactly what the logbook removed.
 *
 * Everything visual — the collapse, the width, the radius, the glass, the dual
 * month — comes from the shared `CalendarPanel`, so the two pages cannot drift
 * apart again.
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
  const dualMonth = usePanelDualMonth()
  const isSplitLayout = useIsDesktop()

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
    /* Absolute, so the dashboard's grid scrolls behind it — the same
       arrangement the logbook's list uses, and what the glass needs to have
       something to see through. Full panel width rather than the old
       `max-w-md` card. */
    <div
      className="z-40 absolute left-0 right-0"
      style={{ top: "var(--chrome-top)", contain: "layout style paint" }}
    >
      <CalendarPanel
        open={showCalendar}
        flights={flights}
        selectedMonth={selectedMonth}
        onMonthChange={(year, month) => setSelectedMonth({ year, month })}
        onDateSelect={handleDateSelect}
        rangeStart={displayStart}
        rangeEnd={displayEnd}
        dualMonth={dualMonth}
        splitLayout={isSplitLayout}
        monthYearView={monthYearView}
        onHeaderPress={() => setMonthYearView(!monthYearView)}
        onMonthSelect={(year, month) => {
          setSelectedMonth({ year, month })
          setMonthYearView(false)
        }}
        onYearChange={(year) =>
          setSelectedMonth({ year, month: selectedMonth.month })
        }
      />
    </div>
  )
}
