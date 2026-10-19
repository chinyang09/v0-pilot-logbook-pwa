/**
 * The roster as DAYS — what the calendar draws and the agenda lists.
 *
 * Two sources feed it, and they stay where they live:
 *
 * | | Source | Why it is here |
 * |---|---|---|
 * | duties | `scheduleEntries` (standby, ground, leave, off) | the roster's own table |
 * | flights | the logbook (`flights`) | a roster without its flights is half a roster — read-only here, the logbook still owns them |
 *
 * ── Which day does an item belong to ────────────────────────────────────────
 *
 * Both tables key a row on the UTC date of its start. A pilot reads a roster in
 * the clock they have set: with Zulu on that IS the UTC date, but in local time
 * a 06:00 standby in Singapore starts at 22:00Z the day before and used to sit
 * on the wrong square. So when an item has a start time, its day is the day
 * that instant falls on in the display zone; with no time (leave, a day off)
 * the stored date is the only fact there is.
 *
 * Pure: no IndexedDB, no React, and the zone is a parameter — the calendar
 * passes the device's, the tests pass their own.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import { isFlownFlight } from "@/lib/utils/flight-calculations"
import { isSimulatorEntry } from "@/lib/utils/entry-type"
import { tzFormatter } from "@/lib/utils/tz-format"

export type RosterItem =
  | {
      kind: "duty"
      id: string
      entry: ScheduleEntry
      /** Epoch ms, or null for an all-day duty (leave, off). */
      startMs: number | null
      endMs: number | null
    }
  | {
      kind: "flight"
      id: string
      flight: FlightLog
      startMs: number | null
      endMs: number | null
      /** Both gate times are in — the sector happened. */
      flown: boolean
      simulator: boolean
    }

export interface RosterDisplayZone {
  /** Show UTC days (the app's Zulu setting). */
  zulu: boolean
  /** IANA zone for "local"; defaults to the device's. */
  zone?: string
}

const HHMM = /^(\d{1,2}):(\d{2})/

/** `date` (YYYY-MM-DD, UTC) + `HH:MM` (UTC) → epoch ms, or null. */
export function utcInstant(date: string, time: string | undefined | null): number | null {
  if (!date || !time) return null
  const m = HHMM.exec(time.trim())
  const [y, mo, d] = date.split("-").map(Number)
  if (!m || !y || !mo || !d) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return Date.UTC(y, mo - 1, d, h, min)
}

/** An end at or before its start is the next day — a duty or sector past midnight. */
function endAfter(startMs: number | null, date: string, time: string | undefined | null): number | null {
  const end = utcInstant(date, time)
  if (end === null || startMs === null) return end
  return end <= startMs ? end + 86_400_000 : end
}

/** YYYY-MM-DD of an instant in the display zone. */
export function dayKeyAt(ms: number, display: RosterDisplayZone): string {
  const zone = display.zulu
    ? "UTC"
    : display.zone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const parts = tzFormatter(
    zone,
    { year: "numeric", month: "2-digit", day: "2-digit" },
    "ymd"
  ).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function dayOf(storedDate: string, startMs: number | null, display: RosterDisplayZone): string {
  return startMs === null ? storedDate : dayKeyAt(startMs, display)
}

/**
 * Every item, bucketed by display day and ordered within the day: all-day
 * duties first (they describe the day), then by start time.
 */
export function buildRosterDays(
  entries: readonly ScheduleEntry[],
  flights: readonly FlightLog[],
  display: RosterDisplayZone
): Map<string, RosterItem[]> {
  const days = new Map<string, RosterItem[]>()
  const add = (key: string, item: RosterItem) => {
    const list = days.get(key)
    if (list) list.push(item)
    else days.set(key, [item])
  }

  for (const entry of entries) {
    const startMs = utcInstant(entry.date, entry.reportTime)
    add(dayOf(entry.date, startMs, display), {
      kind: "duty",
      id: entry.id,
      entry,
      startMs,
      endMs: endAfter(startMs, entry.date, entry.debriefTime),
    })
  }

  for (const flight of flights) {
    const flown = isFlownFlight(flight)
    const startMs = utcInstant(flight.date, flight.outTime || flight.scheduledOut)
    add(dayOf(flight.date, startMs, display), {
      kind: "flight",
      id: flight.id,
      flight,
      startMs,
      endMs: endAfter(startMs, flight.date, flight.inTime || flight.scheduledIn),
      flown,
      simulator: isSimulatorEntry(flight),
    })
  }

  for (const list of days.values()) {
    list.sort((a, b) => {
      if (a.startMs === null && b.startMs !== null) return -1
      if (b.startMs === null && a.startMs !== null) return 1
      return (a.startMs ?? 0) - (b.startMs ?? 0) || a.id.localeCompare(b.id)
    })
  }
  return days
}

/**
 * The agenda: days that have something on them, SOONEST FIRST, from `fromKey`
 * on. The day asked for is always included — empty or not — so selecting a
 * quiet day says so rather than silently jumping to the next busy one.
 */
export function agendaFrom(
  days: ReadonlyMap<string, RosterItem[]>,
  fromKey: string,
  maxDays = 30
): Array<{ dayKey: string; items: RosterItem[] }> {
  const keys = [...days.keys()].filter((k) => k > fromKey).sort()
  const out = [{ dayKey: fromKey, items: days.get(fromKey) ?? [] }]
  for (const key of keys) {
    if (out.length >= maxDays) break
    out.push({ dayKey: key, items: days.get(key)! })
  }
  return out
}

/** The short label a calendar cell shows for an item — the day at a glance. */
export function itemLabel(item: RosterItem): string {
  if (item.kind === "duty") {
    return (item.entry.dutyCode || item.entry.dutyType).toUpperCase().slice(0, 5)
  }
  if (item.simulator) return "SIM"
  const f = item.flight
  return (f.flightNumber || f.arrivalIata || f.arrivalIcao || "FLT").toUpperCase().slice(0, 6)
}
