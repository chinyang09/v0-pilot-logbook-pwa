"use client"

import { useMemo, useSyncExternalStore } from "react"
import type { FlightLog } from "@/types/entities/flight.types"
import { useScheduleEntries } from "@/hooks/data"
import { useDayKey } from "@/hooks/use-day-key"
import { usePreferences } from "@/components/providers/preferences-provider"
import { buildCalendarSpans, type CalendarSpan } from "@/lib/utils/roster/calendar-bars"

/**
 * The calendars' Duties toggle — standby, ground, leave, off and simulator
 * sessions on or off. Off, the roster is the logbook's own picture: the
 * flights and nothing else.
 *
 * ONE answer for every calendar and the roster's agenda, so the logbook, the
 * roster and the dashboard never disagree about what a month holds. A module
 * store persisted to localStorage (a per-device way of looking, like the
 * dashboard's view), hydrated in `subscribe` so there is no setState in an
 * effect and no first render with the wrong answer.
 */
const STORAGE_KEY = "ooo:calendar-duties"
let showDuties = true
let hydrated = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!hydrated) {
    hydrated = true
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === "0" && showDuties) {
        showDuties = false
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

export function setCalendarDuties(next: boolean) {
  if (next === showDuties) return
  showDuties = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
  } catch {
    // Not remembering the choice is no reason to refuse it.
  }
  emit()
}

export function useCalendarDuties(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => showDuties,
    () => true
  )
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
