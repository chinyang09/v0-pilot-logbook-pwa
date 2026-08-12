"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Calendar, ChevronDown, SlidersHorizontal } from "lucide-react"

import { GlassButtonGroup, GlassGroupButton } from "@/components/ui/glass-icon-button"
import {
  PERIOD_PRESETS,
  useDashboardPeriod,
  type DashboardPreset,
} from "@/hooks/use-dashboard-period"
import { AlertsDropdown } from "./alerts-dropdown"
import { cn } from "@/lib/utils"

// Bouncy spring for the OPEN (expand) of the period pills + month label.
const SPRING = { type: "spring" as const, stiffness: 340, damping: 24 }
// The COLLAPSE uses a deterministic tween instead: a spring eases toward its
// width:auto→0 target and is considered "done" within a rest threshold, so the
// last ~10% of width vanishes instantly when AnimatePresence unmounts the
// element (the visible "stuck then snap"). A tween reaches exactly 0 at the end.
const COLLAPSE = { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const }

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

export function DashboardActions() {
  const {
    period,
    resolved,
    setPeriod,
    showFilter,
    setShowFilter,
    showCalendar,
    setShowCalendar,
    selectedMonth,
    monthYearView,
    setMonthYearView,
  } = useDashboardPeriod()

  const activePreset: DashboardPreset | null =
    period.kind === "preset" ? period.preset : null

  const filterLabel =
    period.kind === "preset" ? resolved.shortLabel : "Custom"

  return (
    <>
      {/* Calendar first, then period filter — matches the logbook header order. */}
      <GlassButtonGroup>
          <GlassGroupButton
            ariaLabel="Date range"
            ariaPressed={showCalendar}
            active={showCalendar || period.kind === "custom"}
            onClick={() => setShowCalendar(!showCalendar)}
          >
            <Calendar className="h-5 w-5" />
          </GlassGroupButton>

          {/* NO month label here. The calendar's own header is the date
              selector and the thing that opens the month/year picker — a second
              one in the action bar says the same thing twice, and it is what
              grew the left action group into the centred nav pill on the
              logbook before it was removed there. */}

          <button
            type="button"
            aria-label="Period filter"
            aria-expanded={showFilter}
            onClick={() => setShowFilter(!showFilter)}
            className={cn(
              // h-9, like every other control in a GlassButtonGroup: the group
              // is h-11 with px-1, so a 48px child overflows a 44px box and the
              // glass — which clips — cut the icon off top and bottom.
              "flex h-9 min-w-9 flex-col items-center justify-center rounded-full px-2 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              showFilter
                ? "bg-[var(--on-glass-active)] text-[var(--on-glass-active-fg)]"
                : "text-foreground hover:bg-[var(--on-glass-fill-soft)]",
            )}
          >
            <SlidersHorizontal className="h-[15px] w-[15px]" />
            <span className="mt-0.5 text-[10px] font-semibold leading-none tabular-nums">
              {filterLabel}
            </span>
          </button>

          <AnimatePresence initial={false}>
            {showFilter && (
              <motion.div
                key="period-pills"
                role="tablist"
                aria-label="Dashboard period"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "auto", opacity: 1 }}
                exit={{ width: 0, opacity: 0, transition: COLLAPSE }}
                transition={SPRING}
                className="flex items-center gap-0.5 overflow-hidden whitespace-nowrap pr-1"
              >
                {PERIOD_PRESETS.map((p) => {
                  const isActive = activePreset === p.value
                  return (
                    <button
                      key={p.value}
                      role="tab"
                      type="button"
                      aria-selected={isActive}
                      onClick={() => setPeriod({ kind: "preset", preset: p.value })}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-[var(--on-glass-fill-soft)]",
                      )}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </motion.div>
            )}
          </AnimatePresence>
      </GlassButtonGroup>

      <GlassButtonGroup>
        <AlertsDropdown />
      </GlassButtonGroup>
    </>
  )
}
