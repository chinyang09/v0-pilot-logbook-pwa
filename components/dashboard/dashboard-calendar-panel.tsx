"use client"

import * as React from "react"

import { CalendarPanel, PANEL_MS } from "@/components/calendar-panel"
import { useFlipPush } from "@/hooks/use-flip-push"
import { MORPH_EASE } from "@/lib/motion"
import { useFlights } from "@/hooks/data/use-flights"
import { useDashboardPeriod } from "@/hooks/use-dashboard-period"
import { pairStart, usePanelDualMonth } from "@/lib/layout/panel-mode"
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
export function DashboardCalendarPanel({
  onNaturalHeight,
}: {
  /** The calendar's measured height, so the page can make room for it. */
  onNaturalHeight?: (height: number) => void
} = {}) {
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

  // Two months are a FIXED odd|even pair, as on the logbook: every month the
  // calendar is sent to is anchored on its pair, or the pair shuffled by one
  // (Dec|Jan) and a step moved it out of phase.
  const showMonth = React.useCallback(
    (year: number, month: number) => setSelectedMonth({ year, month: dualMonth ? pairStart(month) : month }),
    [dualMonth, setSelectedMonth],
  )

  // Anchor the visible month on the active period's end whenever the picker
  // opens, the period changes externally, or the layout gains or loses its
  // second month.
  React.useEffect(() => {
    if (!showCalendar) return
    const anchor = new Date(`${resolved.toIso}T00:00:00`)
    showMonth(anchor.getFullYear(), anchor.getMonth())
  }, [showCalendar, resolved.toIso, showMonth])

  // Today moves the calendar to the month that holds it; it does not choose a
  // day — a tap here is one end of a range.
  const showToday = React.useCallback(() => {
    const now = new Date()
    showMonth(now.getFullYear(), now.getMonth())
  }, [showMonth])

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
    /* Absolute, over the top of the page, which reserves its height with a
       spacer — the same arrangement the logbook's list uses. Full panel width
       rather than the old `max-w-md` card. */
    <div
      className="z-40 absolute left-0 right-0"
      style={{ top: "var(--chrome-top)", contain: "layout style paint" }}
    >
      <CalendarPanel
        open={showCalendar}
        onNaturalHeight={onNaturalHeight}
        flights={flights}
        selectedMonth={selectedMonth}
        onMonthChange={showMonth}
        onDateSelect={handleDateSelect}
        rangeStart={displayStart}
        rangeEnd={displayEnd}
        dualMonth={dualMonth}
        splitLayout={isSplitLayout}
        monthYearView={monthYearView}
        onHeaderPress={() => {
          // Closing the wheels puts the pair back in phase; while they are up
          // the month being chosen is the LEFT pane, beside them.
          if (monthYearView) showMonth(selectedMonth.year, selectedMonth.month)
          setMonthYearView(!monthYearView)
        }}
        onMonthSelect={(year, month) => setSelectedMonth({ year, month })}
        onToday={showToday}
      />
    </div>
  )
}

/**
 * The room the summary page makes for the calendar: its measured height while
 * open, on the panel's own clock, so opening it and the page moving are one
 * movement. Its own component so only it reads the period context — the page
 * around it does not re-render with every period change.
 */
export function DashboardCalendarSpacer({ height, children }: { height: number; children: React.ReactNode }) {
  const { showCalendar } = useDashboardPeriod()
  // The page under it is slid on a transform (useFlipPush), not re-laid out
  // per frame by an animated height — the logbook's rule.
  const { spacerRef, pushedRef } = useFlipPush(true, PANEL_MS, MORPH_EASE)
  return (
    <>
      <div ref={spacerRef} aria-hidden style={{ height: showCalendar ? height : 0 }} />
      <div ref={pushedRef}>{children}</div>
    </>
  )
}
