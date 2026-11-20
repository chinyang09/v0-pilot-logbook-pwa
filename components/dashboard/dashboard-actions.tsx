"use client"

import * as React from "react"
import { Calendar, CalendarClock, Check, SlidersHorizontal } from "lucide-react"

import { GlassButtonGroup, GlassGroupButton } from "@/components/ui/glass-icon-button"
import {
  PERIOD_PRESETS,
  useDashboardPeriod,
  type DashboardPreset,
} from "@/hooks/use-dashboard-period"
import { AlertsDropdown } from "./alerts-dropdown"
import { setArranging, useArranging } from "@/hooks/use-dashboard-layout"
import { setChosenDuty, useChosenDuty, useDutyMenu } from "@/hooks/use-dashboard-duty"
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

/** A group button that opens a menu: an icon over a small label, like the period's. */
const MENU_BUTTON = cn(
  "flex h-10 min-w-10 flex-col items-center justify-center rounded-full px-2 text-foreground transition-colors",
  "hover:bg-[var(--on-glass-fill-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
)

/**
 * The FLIGHT DECK's header (the owner, Nov 2026: the flight dashboard and the
 * summary are two pages now, each with its own header).
 *
 * | | |
 * |---|---|
 * | the DUTY menu | which duty the page is about — the one in progress or next, else a later one ("Next · 21 Nov" in the button). It was a menu laid over the flights tile's date line, which the tile's card did not carry, so the duty could not be changed once the card was open |
 * | Done | only while arranging — a long press on a tile enters Arrange |
 * | the bell | import notes |
 */
export function FlightDeckActions() {
  const menu = useDutyMenu()
  const chosen = useChosenDuty()
  const arranging = useArranging()
  return (
    <>
      {menu && menu.options.length > 0 && (
        <GlassButtonGroup>
          <ChoicePicker
            label="Duty"
            value={chosen === null ? menu.options[0].value : String(chosen)}
            options={menu.options}
            onValueChange={(v) => setChosenDuty(v === menu.options[0].value ? null : Number(v))}
            morph
            disabled={menu.options.length < 2}
            className={cn(MENU_BUTTON, "min-w-14")}
          >
            <CalendarClock className="h-[15px] w-[15px]" aria-hidden />
            <span className="mt-0.5 text-[10px] font-semibold leading-none tabular-nums" suppressHydrationWarning>
              {menu.day}
            </span>
          </ChoicePicker>
        </GlassButtonGroup>
      )}
      <GlassButtonGroup>
        {arranging && (
          <GlassGroupButton ariaLabel="Done arranging" ariaPressed active onClick={() => setArranging(false)}>
            <Check className="h-5 w-5" />
          </GlassGroupButton>
        )}
        <AlertsDropdown />
      </GlassButtonGroup>
    </>
  )
}

/**
 * The SUMMARY's header: the date range (its calendar), the period, the bell.
 *
 * NO month label: the calendar's own header is the date selector — a second
 * one in the action bar says the same thing twice, and it is what grew the
 * left action group into the centred nav pill on the logbook. The period is a
 * MENU that grows out of its button, not pills that expand inline: the left
 * group is anchored to the viewport edge and the nav pill is centred, so a
 * bar that grew pushed its last buttons under the pill.
 */
export function SummaryActions() {
  const { period, resolved, setPeriod, showCalendar, setShowCalendar } = useDashboardPeriod()
  const activePreset: DashboardPreset | null = period.kind === "preset" ? period.preset : null
  const filterLabel = period.kind === "preset" ? resolved.shortLabel : "Custom"
  return (
    <>
      <GlassButtonGroup>
        <GlassGroupButton
          ariaLabel="Date range"
          ariaPressed={showCalendar}
          active={showCalendar || period.kind === "custom"}
          onClick={() => setShowCalendar(!showCalendar)}
        >
          <Calendar className="h-5 w-5" />
        </GlassGroupButton>
        <ChoicePicker
          label="Period"
          value={activePreset ?? "custom"}
          options={PERIOD_OPTIONS}
          onValueChange={(v) => setPeriod({ kind: "preset", preset: v as DashboardPreset })}
          morph
          className={MENU_BUTTON}
        >
          <SlidersHorizontal className="h-[15px] w-[15px]" aria-hidden />
          <span className="mt-0.5 text-[10px] font-semibold leading-none tabular-nums">{filterLabel}</span>
        </ChoicePicker>
      </GlassButtonGroup>
      <GlassButtonGroup>
        <AlertsDropdown />
      </GlassButtonGroup>
    </>
  )
}
