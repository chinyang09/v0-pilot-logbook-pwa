"use client"

import { useMemo, useSyncExternalStore } from "react"
import type { FlightLog } from "@/types/entities/flight.types"
import { useScheduleEntries } from "@/hooks/data"
import { useDayKey } from "@/hooks/use-day-key"
import { usePreferences } from "@/components/providers/preferences-provider"
import { buildCalendarSpans, type CalendarSpan } from "@/lib/utils/roster/calendar-bars"

/**
 * Two Duties switches — standby, ground, leave and days off on or off — one
 * for the CALENDARS and one for the logbook LIST. Simulator sessions are
 * logbook entries and stay either way.
 *
 * They are two because the owner asked for the month to keep showing the
 * roster while the list shows flights alone: a duty on the calendar is a
 * fact about the day, a duty card in the list is something to scroll past.
 *
 * Each is a module store persisted to localStorage (a per-device way of
 * looking, like the dashboard's view), hydrated in `subscribe` so there is no
 * setState in an effect and no first render with the wrong answer. The list's
 * switch starts from the calendar's stored answer: before they were split one
 * switch governed both.
 */
function booleanStore(key: string, fallbackKeys: string[] = []) {
  let value = true
  let hydrated = false
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const l of listeners) l()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    if (!hydrated) {
      hydrated = true
      try {
        let stored: string | null = null
        for (const k of [key, ...fallbackKeys]) {
          stored = window.localStorage.getItem(k)
          if (stored !== null) break
        }
        if (stored === "0" && value) {
          value = false
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
  const set = (next: boolean) => {
    if (next === value) return
    value = next
    try {
      window.localStorage.setItem(key, next ? "1" : "0")
    } catch {
      // Not remembering the choice is no reason to refuse it.
    }
    emit()
  }
  return { set, subscribe, get: () => value }
}

const serverTrue = () => true

const CALENDAR_KEY = "ooo:calendar-duties"
const calendarDuties = booleanStore(CALENDAR_KEY)
const listDuties = booleanStore("ooo:list-duties", [CALENDAR_KEY])

/** The calendars' switch: every calendar (logbook, dashboard) follows it. */
export const setCalendarDuties = calendarDuties.set
export function useCalendarDuties(): boolean {
  return useSyncExternalStore(calendarDuties.subscribe, calendarDuties.get, serverTrue)
}

/** The logbook list's switch: duty cards among the flights. */
export const setListDuties = listDuties.set
export function useListDuties(): boolean {
  return useSyncExternalStore(listDuties.subscribe, listDuties.get, serverTrue)
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
