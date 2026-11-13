"use client"

import * as React from "react"
import { Calendar, SlidersHorizontal } from "lucide-react"

import { GlassButtonGroup, GlassGroupButton } from "@/components/ui/glass-icon-button"
import {
  PERIOD_PRESETS,
  useDashboardPeriod,
  type DashboardPreset,
} from "@/hooks/use-dashboard-period"
import {
  DASHBOARD_VIEWS,
  setDashboardView,
  useDashboardView,
} from "@/hooks/use-dashboard-view"
import { AlertsDropdown } from "./alerts-dropdown"
import { ChoicePicker, type MenuOption } from "@/components/ui/option-menu"
import { cn } from "@/lib/utils"

const PERIOD_HINTS: Record<DashboardPreset, string> = {
  "7d": "Last 7 days",
  "28d": "Last 28 days",
  "1y": "Last 12 months",
  all: "Whole logbook",
}
const PERIOD_OPTIONS: Array<MenuOption<string>> = PERIOD_PRESETS.map((p) => ({
  value: p.value,
  label: p.label,
  hint: PERIOD_HINTS[p.value],
}))

/**
 * The dashboard's header actions.
 *
 * The view toggle is ALWAYS present — it is how the two pages are reached, so
 * it cannot be behind anything. Everything else is scoped to the page it
 * belongs to: the calendar and the period pills only mean something on the
 * summary page, and carrying them onto the legal page would put two controls
 * with no effect beside a screen that is meant to be read in two seconds.
 *
 * That scoping is also what keeps the action bar narrow enough. The left action
 * group is anchored to the viewport edge and the nav pill is centred between
 * the groups, so a bar that grows — and the period pills expand — is the one
 * thing that can push a button under the pill.
 */
export function DashboardActions() {
  const {
    period,
    resolved,
    setPeriod,
    showCalendar,
    setShowCalendar,
  } = useDashboardPeriod()
  const view = useDashboardView()

  const activePreset: DashboardPreset | null =
    period.kind === "preset" ? period.preset : null

  const filterLabel = period.kind === "preset" ? resolved.shortLabel : "Custom"

  return (
    <>
      <GlassButtonGroup>
        {/* The two pages. A segmented pair rather than an icon: "Legal" and
            "Summary" are not things an icon says, and getting this wrong costs
            a tap plus a re-read of a whole screen. */}
        <div role="tablist" aria-label="Dashboard view" className="flex items-center gap-0.5">
          {DASHBOARD_VIEWS.map((v) => {
            const isActive = view === v.value
            return (
              <button
                key={v.value}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => setDashboardView(v.value)}
                className={cn(
                  "h-10 rounded-full px-3 text-xs font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-[var(--on-glass-active)] text-[var(--on-glass-active-fg)]"
                    : "text-foreground hover:bg-[var(--on-glass-fill-soft)]",
                )}
              >
                {v.label}
              </button>
            )
          })}
        </div>
      </GlassButtonGroup>

      {/* Period controls belong to the summary page only. */}
      {view === "summary" && (
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

          {/* The period is a MENU that grows out of its button, like the +
              and the calendar's Duties — not pills that expand inline. The
              left action group is anchored to the viewport edge and the nav
              pill is centred, so a bar that grew pushed its last buttons under
              the pill (the owner's iPad screenshot: 7d / 28d / 1y running into
              Dashboard). A menu keeps the bar the same width whatever is open. */}
          <ChoicePicker
            label="Period"
            value={activePreset ?? "custom"}
            options={PERIOD_OPTIONS}
            onValueChange={(v) => setPeriod({ kind: "preset", preset: v as DashboardPreset })}
            morph
            className={cn(
              "flex h-10 min-w-10 flex-col items-center justify-center rounded-full px-2 text-foreground transition-colors",
              "hover:bg-[var(--on-glass-fill-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <SlidersHorizontal className="h-[15px] w-[15px]" aria-hidden />
            <span className="mt-0.5 text-[10px] font-semibold leading-none tabular-nums">
              {filterLabel}
            </span>
          </ChoicePicker>
        </GlassButtonGroup>
      )}

      <GlassButtonGroup>
        <AlertsDropdown />
      </GlassButtonGroup>
    </>
  )
}
