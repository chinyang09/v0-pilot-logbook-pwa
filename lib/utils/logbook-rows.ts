/**
 * The logbook's rows — its flights, and (with the Duties toggle on) the
 * roster's duties beside them, in ONE newest-first order.
 *
 * The logbook and the roster were two pages over one record: the roster drew
 * the logbook's flights anyway, so they read as duplicates, and a flight could
 * be added on one and a duty only on the other. Now the logbook IS the roster
 * with its duties switched on.
 *
 * A duty sorts as a flight would: by its UTC date, then its report time (the
 * flight's out time), latest first; an all-day duty (no report time) goes to
 * the END of its day, as an untimed flight does. On a tie the flight comes
 * first. `flights` must already be in `compareFlights` order — the merge keeps
 * it, so a flight's place never depends on whether duties are shown.
 *
 * A RUN of whole-day duties — the same leave, the same day off, on
 * consecutive days — is ONE row, as it is one bar on the calendar: a week of
 * leave was seven identical cards. It sits at its LAST day (the list reads
 * newest first) and carries every entry, so deleting it bins them all.
 *
 * Pure: no React, no IndexedDB.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import { effectiveOutTime } from "@/lib/utils/flight-sort"

/**
 * A duty's selection id and row key. Namespaced, because the detail panel's
 * one selection id has to say which kind of record it names, and a flight's
 * plain id must keep meaning a flight (links, `?selected=`, the flight form).
 */
export const DUTY_KEY_PREFIX = "duty:"
export const dutyRowKey = (entryId: string) => `${DUTY_KEY_PREFIX}${entryId}`
/** The id of the duty a row key or selection names, or null for a flight. */
export function dutyIdOf(key: string | null | undefined): string | null {
  return key?.startsWith(DUTY_KEY_PREFIX) ? key.slice(DUTY_KEY_PREFIX.length) : null
}
/** A NEW duty's selection: `duty:new:<YYYY-MM-DD>` — the day it starts on. */
export const NEW_DUTY_PREFIX = `${DUTY_KEY_PREFIX}new:`
export const newDutyKey = (date: string) => `${NEW_DUTY_PREFIX}${date}`
/**
 * ONE day of a period, opened on its own: `duty:day:<id>`. A card for "LOFF
 * 12–15 Nov" opens the period; a day picked from its list opens just that day,
 * so 13 Nov can be changed without the other three.
 */
export const DUTY_DAY_PREFIX = `${DUTY_KEY_PREFIX}day:`
export const dutyDayKey = (entryId: string) => `${DUTY_DAY_PREFIX}${entryId}`

export type LogbookRow =
  | { kind: "flight"; key: string; date: string; startDate: string; flight: FlightLog }
  | {
      kind: "duty"
      key: string
      /** The LAST day the row covers — where it sits in the list. */
      date: string
      /** The first day — the date a run's card shows. */
      startDate: string
      /** The first entry: what a tap opens. */
      entry: ScheduleEntry
      /** Every entry the row stands for (one, or a run of whole days). */
      entries: ScheduleEntry[]
    }

/** Does the row cover this day? A run covers every day from its first to its last. */
export function rowCoversDate(row: Pick<LogbookRow, "date" | "startDate">, date: string): boolean {
  return row.startDate <= date && date <= row.date
}

/** The roster's own duties: not flights (those are the logbook's), not binned. */
export function isRosterDuty(entry: ScheduleEntry): boolean {
  return entry.dutyType !== "flight" && entry.deletedAt == null
}

type DutyRow = Extract<LogbookRow, { kind: "duty" }>

/** A day off or leave is the whole day, whatever window the report put round it. */
export function isWholeDayDuty(entry: Pick<ScheduleEntry, "dutyType" | "reportTime">): boolean {
  return entry.dutyType === "off" || entry.dutyType === "leave" || !entry.reportTime
}

/** The day after a YYYY-MM-DD, on the calendar. */
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** Whole-day duties on consecutive days with the same kind, code and description, as runs. */
function dutyRows(duties: readonly ScheduleEntry[]): DutyRow[] {
  const live = duties.filter(isRosterDuty).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const rows: DutyRow[] = []
  const open = new Map<string, DutyRow>()
  for (const entry of live) {
    if (!isWholeDayDuty(entry)) {
      rows.push({ kind: "duty", key: dutyRowKey(entry.id), date: entry.date, startDate: entry.date, entry, entries: [entry] })
      continue
    }
    const runKey = `${entry.dutyType}|${(entry.dutyCode ?? "").trim().toUpperCase()}|${(entry.dutyDescription ?? "").trim()}`
    const run = open.get(runKey)
    if (run && (nextDay(run.date) === entry.date || run.date === entry.date)) {
      run.date = entry.date
      run.entries.push(entry)
      continue
    }
    const row: DutyRow = { kind: "duty", key: dutyRowKey(entry.id), date: entry.date, startDate: entry.date, entry, entries: [entry] }
    open.set(runKey, row)
    rows.push(row)
  }
  // Newest first, as `compareFlights`: the (last) day, the report time ("" —
  // a whole day — last), then id.
  return rows.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (b.entry.reportTime || "").localeCompare(a.entry.reportTime || "") ||
      a.entry.id.localeCompare(b.entry.id)
  )
}

/** Does the duty row come BEFORE the flight in the newest-first list? */
function dutyFirst(row: DutyRow, flight: FlightLog): boolean {
  if (row.date !== flight.date) return row.date > flight.date
  return (row.entry.reportTime || "") > effectiveOutTime(flight)
}

export function buildLogbookRows(flights: readonly FlightLog[], duties: readonly ScheduleEntry[]): LogbookRow[] {
  const sorted = dutyRows(duties)
  const rows: LogbookRow[] = []
  let d = 0
  for (const flight of flights) {
    while (d < sorted.length && dutyFirst(sorted[d], flight)) rows.push(sorted[d++])
    rows.push({ kind: "flight", key: flight.id, date: flight.date, startDate: flight.date, flight })
  }
  for (; d < sorted.length; d++) rows.push(sorted[d])
  return rows
}

/**
 * The entries of the period (the run) an entry belongs to — the whole run for
 * a day off in "LOFF 12–15 Nov", the entry alone for a timed duty. Null when
 * the entry is not a live roster duty.
 */
export function dutyRunOf(entryId: string, duties: readonly ScheduleEntry[]): ScheduleEntry[] | null {
  for (const row of dutyRows(duties)) if (row.entries.some((e) => e.id === entryId)) return row.entries
  return null
}

/** The words a search term is matched against, lowercased, one per field. */
export function dutySearchFields(entry: ScheduleEntry): string[] {
  return [entry.dutyCode, entry.dutyDescription, entry.dutyType, entry.date]
    .filter((v): v is string => !!v)
    .map((v) => v.toLowerCase())
}
