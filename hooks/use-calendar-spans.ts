"use client"

import { useMemo, useSyncExternalStore } from "react"
import type { FlightLog } from "@/types/entities/flight.types"
import { useScheduleEntries } from "@/hooks/data"
import { useDayKey } from "@/hooks/use-day-key"
import { usePreferences } from "@/components/providers/preferences-provider"
import { buildCalendarSpans, type CalendarSpan } from "@/lib/utils/roster/calendar-bars"

/**
 * Where the roster's duties show — standby, ground, leave and days off:
 *
 * | | calendar | logbook list |
 * |---|---|---|
 * | `off` | — | — |
 * | `calendar` (default) | ✓ | — |
 * | `all` | ✓ | ✓ (duty cards among the flights) |
 *
 * ONE control, in the calendar's header, because the combinations are not
 * equal: the month with its leave and standby while the list shows flights
 * alone is the common case, and duty cards in the list with the calendar's
 * duties hidden is one nobody asks for. Two independent switches offered it
 * anyway and made the common case two taps. Simulator sessions are logbook
 * entries and show in every state.
 *
 * A module store persisted to localStorage (a per-device way of looking, like
 * the dashboard's view), hydrated in `subscribe` so there is no setState in an
 * effect and no first render with the wrong answer.
 */
export type DutiesView = "off" | "calendar" | "all"

const VIEW_KEY = "ooo:duties-view"
let view: DutiesView = "calendar"
let hydrated = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function readStored(): DutiesView | null {
  const stored = window.localStorage.getItem(VIEW_KEY)
  if (stored === "off" || stored === "calendar" || stored === "all") return stored
  // Before there was one control there were two switches (and before that,
  // one): the calendar's off means off; the list's on, set by hand, means all.
  if (window.localStorage.getItem("ooo:calendar-duties") === "0") return "off"
  if (window.localStorage.getItem("ooo:list-duties") === "1") return "all"
  return null
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!hydrated) {
    hydrated = true
    try {
      const stored = readStored()
      if (stored && stored !== view) {
        view = stored
        emit()
      }
    } catch {
      // Storage unavailable: the default stands.
    }
  }
  return () => {
    listeners.delete(listener)
  }
}

export function setDutiesView(next: DutiesView) {
  if (next === view) return
  view = next
  try {
    window.localStorage.setItem(VIEW_KEY, next)
  } catch {
    // Not remembering the choice is no reason to refuse it.
  }
  emit()
}

const getView = () => view
const serverView = (): DutiesView => "calendar"

export function useDutiesView(): DutiesView {
  return useSyncExternalStore(subscribe, getView, serverView)
}

/** Duties on the calendars. */
export function useCalendarDuties(): boolean {
  return useDutiesView() !== "off"
}

/** Duty cards in the logbook list. */
export function useListDuties(): boolean {
  return useDutiesView() === "all"
}

/**
 * The spans a month calendar draws: the logbook's flights and the roster's
 * duties, in the clock the pilot reads (Zulu → UTC days), filtered by the
 * Duties toggle.
 */
export function useCalendarSpans(flights: readonly FlightLog[]): CalendarSpan[] {
  const { scheduleEntries } = useScheduleEntries()
  const { preferences } = usePreferences()
  const zulu = preferences.display.useZuluTime ?? true
  const duties = useCalendarDuties()
  const todayUtc = useDayKey().split("|")[1] ?? ""
  return useMemo(
    () => buildCalendarSpans(scheduleEntries, flights, { zulu }, { duties, todayUtc }),
    [scheduleEntries, flights, zulu, duties, todayUtc]
  )
}
