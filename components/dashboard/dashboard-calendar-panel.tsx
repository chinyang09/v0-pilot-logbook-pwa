"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"

import { LogbookCalendar } from "@/components/logbook-calendar"
import { Button } from "@/components/ui/button"
import { useFlights } from "@/hooks/data/use-flights"
import { useDashboardPeriod } from "@/hooks/use-dashboard-period"

function todayMonth() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() }
}

/**
 * Range-mode wrapper around the logbook calendar. Tapping a day sets the
 * range start; tapping a second day sets the end (auto-ordered). A third
 * tap resets to a new start.
 *
 * Rendered inside the dashboard page body and absolute-positioned to drop
 * down beneath the action bar — same pattern the logbook page uses for its
 * single-month picker, so the calendar can never overflow the viewport.
 */
export function DashboardCalendarPanel() {
  const { resolved, setPeriod, showCalendar, setShowCalendar } =
    useDashboardPeriod()
  const { flights } = useFlights()

  const [draftStart, setDraftStart] = React.useState<string | null>(
    resolved.fromIso,
  )
  const [draftEnd, setDraftEnd] = React.useState<string | null>(
    resolved.toIso,
  )
  const [selectedMonth, setSelectedMonth] = React.useState(todayMonth)

  // Reset draft state to mirror the live period whenever the panel opens.
  React.useEffect(() => {
    if (showCalendar) {
      setDraftStart(resolved.fromIso)
      setDraftEnd(resolved.toIso)
      const end = new Date(`${resolved.toIso}T00:00:00`)
      setSelectedMonth({ year: end.getFullYear(), month: end.getMonth() })
    }
  }, [showCalendar, resolved.fromIso, resolved.toIso])

  const handleDateSelect = React.useCallback(
    (dateStr: string) => {
      // Two-tap range logic: if no start, or both already set → start fresh.
      if (!draftStart || (draftStart && draftEnd)) {
        setDraftStart(dateStr)
        setDraftEnd(null)
        return
      }
      // Otherwise complete the range, auto-ordering.
      if (dateStr < draftStart) {
        setDraftEnd(draftStart)
        setDraftStart(dateStr)
      } else {
        setDraftEnd(dateStr)
      }
    },
    [draftStart, draftEnd],
  )

  const canApply = !!draftStart
  const handleApply = () => {
    if (!draftStart) return
    const from = draftStart
    const to = draftEnd ?? draftStart
    setPeriod({ kind: "custom", from, to })
    setShowCalendar(false)
  }

  return (
    <AnimatePresence initial={false}>
      {showCalendar && (
        <motion.div
          key="dashboard-calendar"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 360, damping: 32 }}
          className="overflow-hidden"
        >
          <div className="mx-auto mt-2 max-w-md rounded-2xl border border-border/60 bg-card/95 shadow-lg backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2 px-3 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {draftStart && draftEnd
                  ? "Tap any day to start a new range"
                  : draftStart
                    ? "Tap second day to set end"
                    : "Tap a day to start"}
              </p>
              <button
                type="button"
                onClick={() => setShowCalendar(false)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <LogbookCalendar
              flights={flights}
              selectedMonth={selectedMonth}
              onMonthChange={(year, month) => setSelectedMonth({ year, month })}
              onDateSelect={handleDateSelect}
              rangeStart={draftStart}
              rangeEnd={draftEnd}
            />
            <div className="flex items-center justify-between gap-2 border-t border-border/40 px-3 py-2">
              <p className="font-mono tabular-nums text-xs text-muted-foreground">
                {draftStart ?? "—"}
                {draftEnd ? `  →  ${draftEnd}` : ""}
              </p>
              <Button size="sm" onClick={handleApply} disabled={!canApply}>
                Apply
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
