/**
 * RUNS of whole-day duties — "LOFF 12–15 Nov", a week of leave — decided in
 * ONE place, for the calendar's bars and the logbook's cards alike.
 *
 * The two used to decide separately and disagreed:
 *
 * | | calendar (was) | list (was) |
 * |---|---|---|
 * | a whole day | no report time | off or leave, or no report time |
 * | the same run | type + its LABEL (leave's description) | type + code + description |
 * | two entries on one day | two overlapping bars | one card |
 *
 * so a day off carrying a window read "all day" on its card and a timed bar on
 * the calendar, and two codes sharing a description ("PL"/"AL" both
 * "Paternal Leave") were one bar but two cards. Pure.
 */

import type { ScheduleEntry } from "@/types/entities/roster.types"

/**
 * A day off or leave is the whole day, whatever window a report put round it;
 * so is any duty recorded without a report time.
 */
export function isWholeDayDuty(entry: Pick<ScheduleEntry, "dutyType" | "reportTime">): boolean {
  return entry.dutyType === "off" || entry.dutyType === "leave" || !entry.reportTime
}

/**
 * The days a pilot RESTS on — days off and every kind of leave (annual, sick,
 * parental). One hue on the calendar and the cards, because the question the
 * colour answers is "am I working that day".
 */
export function isRestDay(entry: Pick<ScheduleEntry, "dutyType">): boolean {
  return entry.dutyType === "off" || entry.dutyType === "leave"
}

/** What makes two days the same duty: its kind, code and (whitespace-folded) description. */
export function dutyRunKey(entry: Pick<ScheduleEntry, "dutyType" | "dutyCode" | "dutyDescription">): string {
  const description = (entry.dutyDescription ?? "").replace(/\s+/g, " ").trim()
  return `${entry.dutyType}|${(entry.dutyCode ?? "").trim().toUpperCase()}|${description}`
}

/** The day after a YYYY-MM-DD, on the calendar (no zone involved). */
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export interface DutyRun {
  /** The first day's entry first; a day holding two copies keeps both. */
  entries: ScheduleEntry[]
  startDate: string
  endDate: string
}

/**
 * Whole-day duties grouped into runs: the same duty on consecutive days (or
 * twice on one day — a past import's duplicate) is one run. In date order.
 * Timed duties are not grouped; pass only whole-day ones.
 */
export function groupDutyRuns(entries: readonly ScheduleEntry[]): DutyRun[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const runs: DutyRun[] = []
  const open = new Map<string, DutyRun>()
  for (const entry of sorted) {
    const key = dutyRunKey(entry)
    const run = open.get(key)
    if (run && (run.endDate === entry.date || nextDay(run.endDate) === entry.date)) {
      run.endDate = entry.date
      run.entries.push(entry)
      continue
    }
    const fresh: DutyRun = { entries: [entry], startDate: entry.date, endDate: entry.date }
    open.set(key, fresh)
    runs.push(fresh)
  }
  return runs
}
