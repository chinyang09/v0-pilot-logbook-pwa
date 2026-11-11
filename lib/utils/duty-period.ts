/**
 * A duty PERIOD — "LOFF 12–15 Nov" — written as the days it covers.
 *
 * The roster stores ONE ENTRY PER DAY, and that stays: the company's report
 * lists each day on its own row, a re-import matches each day by date + code
 * (`bulkUpsertScheduleEntries`), each imported day has its own derived id so
 * two devices importing one report land on one record, and paragraph 5 counts
 * days off a day at a time. A period is how the pilot SEES and EDITS those
 * days — a run of them is one card in the list and one bar on the calendar —
 * not a different record.
 *
 * So editing a period is a plan over its days: every day from `from` to `to`
 * carries the period's fields; a day it lost is binned; a day it gained is
 * created — or, when a live duty with the same type and code already sits on
 * that day (the period grown into a neighbouring run), that one is adopted
 * rather than doubled.
 *
 * Pure: no IndexedDB. `planDutyPeriod` decides; the panel writes.
 */

import type { DutyType, ScheduleEntry } from "@/types/entities/roster.types"

/** The fields a period gives every one of its days. */
export interface DutyPeriodFields {
  dutyType: DutyType
  dutyCode: string
  dutyDescription?: string
  reportTime?: string
  debriefTime?: string
}

export interface DutyPeriodPlan {
  /** Days that exist and need their fields changed. */
  updates: { id: string; date: string; patch: Partial<ScheduleEntry> }[]
  /** Days to create. */
  creates: string[]
  /** Entries to bin: days the period no longer covers. */
  deletes: string[]
  /** The entry, existing or not yet created, on `from`: what the panel shows next. */
  firstId: string | null
}

/** The longest period one save writes: a year of leave is a lot of rows. */
export const MAX_PERIOD_DAYS = 366

/** Every YYYY-MM-DD from `from` to `to`, inclusive, on the calendar (no zone). */
export function daysBetween(from: string, to: string): string[] {
  if (!from || !to || to < from) return []
  const [y, m, d] = from.split("-").map(Number)
  const days: string[] = []
  for (let i = 0; days.length < MAX_PERIOD_DAYS + 1; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10)
    if (day > to) break
    days.push(day)
  }
  return days
}

const FIELD_KEYS = ["dutyType", "dutyCode", "dutyDescription", "reportTime", "debriefTime"] as const

/** What has to change on an entry for it to carry the period's fields. */
function patchFor(entry: ScheduleEntry, fields: DutyPeriodFields): Partial<ScheduleEntry> {
  const patch: Partial<ScheduleEntry> = {}
  for (const key of FIELD_KEYS) {
    const want = fields[key] || undefined
    const have = entry[key] || undefined
    if (want !== have) (patch as Record<string, unknown>)[key] = want ?? null
  }
  return patch
}

export function planDutyPeriod(args: {
  /** The entries being edited: the run, a single day, or none (a new duty). */
  editing: readonly ScheduleEntry[]
  /** Every LIVE roster entry, to adopt a same-duty day instead of doubling it. */
  all: readonly ScheduleEntry[]
  from: string
  to: string
  fields: DutyPeriodFields
}): DutyPeriodPlan {
  const { editing, all, from, to, fields } = args
  const days = daysBetween(from, to)
  const inRange = new Set(days)
  const byDate = new Map<string, ScheduleEntry>()
  for (const e of editing) if (!byDate.has(e.date)) byDate.set(e.date, e)
  const editingIds = new Set(editing.map((e) => e.id))
  const code = fields.dutyCode.trim().toUpperCase()

  const plan: DutyPeriodPlan = { updates: [], creates: [], deletes: [], firstId: null }
  for (const day of days) {
    const own = byDate.get(day)
    const adopted =
      own ??
      all.find(
        (e) =>
          e.date === day &&
          !editingIds.has(e.id) &&
          e.deletedAt == null &&
          e.dutyType === fields.dutyType &&
          (e.dutyCode ?? "").trim().toUpperCase() === code
      )
    if (adopted) {
      const patch = patchFor(adopted, fields)
      if (Object.keys(patch).length) plan.updates.push({ id: adopted.id, date: day, patch })
      if (day === from) plan.firstId = adopted.id
    } else {
      plan.creates.push(day)
    }
  }
  // A second entry the run held on one day (a duplicate a past import left)
  // is outside what the period now says, like any day it lost.
  const kept = new Set([...byDate.values()].filter((e) => inRange.has(e.date)).map((e) => e.id))
  for (const e of editing) if (!kept.has(e.id)) plan.deletes.push(e.id)
  return plan
}
