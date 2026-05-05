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

function formatShortDate(iso: string | null): string {
  if (!iso) return "…"
  const d = new Date(`${iso}T00:00:00`)
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d)
}

/**
 * Range-mode wrapper around the logbook calendar. Tapping a day sets the
 * range start; tapping a second day sets the end (auto-ordered) and applies
 * the custom period immediately. A third tap starts a new range.
 *
 * Anchored as `position: absolute` to the dashboard's main-panel relative
 * container (NOT the viewport), so on split-pane layouts the picker stays
 * centered over the dashboard panel and never overlaps the detail panel.
 * Positioned at `top: 4rem` to drop down beneath the AppShell action bar.
 */
export function DashboardCalendarPanel() {
  const { resolved, period, setPeriod, showCalendar } = useDashboardPeriod()
  const { flights } = useFlights()

  const [draftStart, setDraftStart] = React.useState<string | null>(
    period.kind === "custom" ? resolved.fromIso : null,
  )
  const [draftEnd, setDraftEnd] = React.useState<string | null>(
    period.kind === "custom" ? resolved.toIso : null,
  )
  const [selectedMonth, setSelectedMonth] = React.useState(todayMonth)

  React.useEffect(() => {
    if (!showCalendar) return
    if (period.kind === "custom") {
      setDraftStart(resolved.fromIso)
      setDraftEnd(resolved.toIso)
    } else {
      setDraftStart(null)
      setDraftEnd(null)
    }
    const anchor = new Date(`${resolved.toIso}T00:00:00`)
    setSelectedMonth({ year: anchor.getFullYear(), month: anchor.getMonth() })
  }, [showCalendar, period.kind, resolved.fromIso, resolved.toIso])

  const handleDateSelect = React.useCallback(
    (dateStr: string) => {
      if (draftStart && draftEnd) {
        setDraftStart(dateStr)
        setDraftEnd(null)
        return
      }
      if (!draftStart) {
        setDraftStart(dateStr)
        return
      }
      const a = dateStr < draftStart ? dateStr : draftStart
      const b = dateStr < draftStart ? draftStart : dateStr
      setDraftStart(a)
      setDraftEnd(b)
      setPeriod({ kind: "custom", from: a, to: b })
    },
    [draftStart, draftEnd, setPeriod],
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
            <div className="flex items-center justify-center gap-2 px-3 pt-1 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="text-foreground tabular-nums">
                {formatShortDate(draftStart)}
              </span>
              <span aria-hidden>→</span>
              <span className="text-foreground tabular-nums">
                {formatShortDate(draftEnd)}
              </span>
            </div>
            <LogbookCalendar
              flights={flights}
              selectedMonth={selectedMonth}
              onMonthChange={(year, month) => setSelectedMonth({ year, month })}
              onDateSelect={handleDateSelect}
              rangeStart={draftStart}
              rangeEnd={draftEnd}
              glass
              cornerRadius={24}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
