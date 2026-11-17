/**
 * The schedule report's "Total Hours and Statistics", and the same figures
 * worked out from the logbook — a second, independent account of what the
 * month came to, so a duty or block hour the app stores wrongly shows up as a
 * difference the moment a report is imported.
 *
 * What eCrew's figures MEAN was established against a real report (October
 * 2026, generated 7 Oct) and the flights it lists:
 *
 * | Figure | Is |
 * |---|---|
 * | Block Hours | every sector's block — ACTUAL where flown, SCHEDULED where not (actual + planned). A return to ramp counts |
 * | Duty Hours | every flight duty, report → debrief, plus every training day's session |
 * | Time Away From Base | report → debrief of each trip, from leaving base to coming back |
 * | Off Days | days off and every kind of leave |
 * | Flight Days / Training Days | days on which a flight / training duty REPORTED |
 * | Landings | sectors that went somewhere — a return to ramp lands nowhere |
 *
 * Days are local-base days (the report's own calendar). A report is a plan
 * from the day it was generated: a flight swapped afterwards is a difference
 * the app is right about, which is why the comparison says when the report
 * was generated rather than calling every difference an error.
 */

import type { DutyPeriod, ScheduleEntry } from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"
import { getEntryType } from "@/lib/utils/entry-type"
import { isReturnToRamp } from "@/lib/utils/flight-calculations"
import { isRestDay } from "@/lib/utils/roster/duty-runs"
import { DEFAULT_HOME_BASE } from "@/lib/utils/roster/days-off"
import { hhmmToMinutes } from "@/lib/utils/time"

export interface ReportTotals {
  blockMinutes: number
  dutyMinutes: number
  awayMinutes: number
  offDays: number
  flightDays: number
  trainingDays: number
  landings: number
}

export type ReportTotalKey = keyof ReportTotals

/** The report's labels, in the order its row prints them. */
const LABELS: Array<[ReportTotalKey, string]> = [
  ["blockMinutes", "Block Hours"],
  ["dutyMinutes", "Duty Hours"],
  ["awayMinutes", "Time Away From Base"],
  ["offDays", "Off Days"],
  ["flightDays", "Flight Days"],
  ["trainingDays", "Training Days"],
  ["landings", "Landings"],
]

const isDuration = (k: ReportTotalKey) => k === "blockMinutes" || k === "dutyMinutes" || k === "awayMinutes"

function readValue(key: ReportTotalKey, token: string): number | null {
  if (isDuration(key)) {
    const m = /^(\d{1,4}):(\d{2})$/.exec(token)
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  return /^\d+$/.test(token) ? Number(token) : null
}

/**
 * The totals row, read off the rows of a schedule report (PDF or CSV). The
 * labels are found by NAME in the header row and the values taken in the same
 * order: the PDF extractor merges two cells ("Off Days Flight Days" over
 * "22 5"), so neither row's columns can be trusted. Null when the block is
 * missing or does not read cleanly — a half-read total would be a false alarm.
 */
export function readReportTotals(rows: ReadonlyArray<{ raw: string }>): ReportTotals | null {
  const at = rows.findIndex((r) => r.raw.includes("Block Hours") && r.raw.includes("Landings"))
  if (at < 0) return null
  const header = rows[at].raw
  const present = LABELS.filter(([, label]) => header.includes(label)).sort(
    (a, b) => header.indexOf(a[1]) - header.indexOf(b[1]),
  )
  const valuesRow = rows.slice(at + 1).find((r) => r.raw.replace(/[,\s]/g, "") !== "")
  if (!valuesRow || present.length !== LABELS.length) return null
  const tokens = valuesRow.raw.split(/[,\s]+/).filter(Boolean)
  if (tokens.length !== present.length) return null

  const out: Partial<ReportTotals> = {}
  for (let i = 0; i < present.length; i++) {
    const [key] = present[i]
    const value = readValue(key, tokens[i])
    if (value === null) return null
    out[key] = value
  }
  return out as ReportTotals
}

// ============================================================
// The logbook's own account
// ============================================================

const SGT_MINUTES = 8 * 60

function localDay(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

function instantMs(date: string, hhmm: string): number | null {
  if (!date || !/^\d{1,2}:\d{2}$/.test(hhmm || "")) return null
  const ms = Date.parse(`${date}T${hhmm.padStart(5, "0")}:00Z`)
  return Number.isNaN(ms) ? null : ms
}

function spanMinutes(from: string, to: string): number {
  const d = hhmmToMinutes(to) - hhmmToMinutes(from)
  return d < 0 ? d + 1440 : d
}

function endsOf(route: string | undefined): { first: string; last: string } {
  const codes = (route || "").split(/[-/\s]+/).filter(Boolean)
  return { first: (codes[0] || "").toUpperCase(), last: (codes[codes.length - 1] || "").toUpperCase() }
}

const isFlightDuty = (dp: DutyPeriod) => !dp.dutyKind || dp.dutyKind === "flight"

export interface LogbookTotalsInput {
  /** The flight rows — flown and scheduled — in the logbook. */
  flights: ReadonlyArray<FlightLog>
  scheduleEntries: ReadonlyArray<ScheduleEntry>
  /** The FDP pipeline's duties (`runFDPPipeline(...).allDutyPeriods`). */
  dutyPeriods: ReadonlyArray<DutyPeriod>
  /** The report's dates, local base, inclusive. */
  range: { start: string; end: string }
  /** The base's offset from UTC, minutes. Singapore by default. */
  baseOffsetMinutes?: number
  homeBase?: ReadonlyArray<string>
}

/** The report's figures, worked out from what the app stores. */
export function logbookTotals(input: LogbookTotalsInput): ReportTotals {
  const offset = input.baseOffsetMinutes ?? SGT_MINUTES
  const base = new Set((input.homeBase ?? DEFAULT_HOME_BASE).map((c) => c.toUpperCase()))
  const inRange = (day: string) => day >= input.range.start && day <= input.range.end

  let blockMinutes = 0
  let landings = 0
  const trainingDays = new Set<string>()
  for (const f of input.flights) {
    if (f.deletedAt != null) continue
    const kind = getEntryType(f)
    const out = f.outTime || f.scheduledOut
    const at = instantMs(f.date, out)
    if (at === null || !inRange(localDay(at, offset))) continue
    if (kind === "simulator") {
      trainingDays.add(localDay(at, offset))
      continue
    }
    if (kind !== "flight") continue
    blockMinutes +=
      f.outTime && f.inTime
        ? hhmmToMinutes(f.blockTime || "00:00") || spanMinutes(f.outTime, f.inTime)
        : f.scheduledOut && f.scheduledIn
          ? spanMinutes(f.scheduledOut, f.scheduledIn)
          : 0
    const dep = (f.departureIcao || f.departureIata || "").toUpperCase()
    const arr = (f.arrivalIcao || f.arrivalIata || "").toUpperCase()
    if (!isReturnToRamp(f) && dep && arr && dep !== arr) landings++
  }

  let dutyMinutes = 0
  let awayMinutes = 0
  const flightDays = new Set<string>()
  let tripStart: number | null = null
  const duties = [...input.dutyPeriods]
    .map((dp) => ({ dp, at: instantMs(dp.date, dp.reportTime) }))
    .filter((d): d is { dp: DutyPeriod; at: number } => d.at !== null)
    .sort((a, b) => a.at - b.at)
  for (const { dp, at } of duties) {
    const day = localDay(at, offset)
    if (!inRange(day)) continue
    const end = at + dp.dutyMinutes * 60_000
    if (isFlightDuty(dp)) {
      dutyMinutes += dp.dutyMinutes
      flightDays.add(day)
      // A trip runs from the report of a duty leaving base to the debrief of
      // the one that comes back; a turnaround is a trip of one duty.
      const { first, last } = endsOf(dp.route)
      if (tripStart === null || base.has(first)) tripStart = at
      if (base.has(last) || !last) {
        awayMinutes += Math.round((end - tripStart) / 60_000)
        tripStart = null
      }
    } else if (dp.dutyKind === "training") {
      dutyMinutes += dp.dutyMinutes
      trainingDays.add(day)
    }
  }

  let offDays = 0
  for (const e of input.scheduleEntries) {
    if (e.deletedAt != null) continue
    if (!inRange(e.date)) continue
    if (isRestDay(e)) offDays++
    else if (e.dutyType === "training") trainingDays.add(e.date)
  }

  return {
    blockMinutes,
    dutyMinutes,
    awayMinutes,
    offDays,
    flightDays: flightDays.size,
    trainingDays: trainingDays.size,
    landings,
  }
}

// ============================================================
// The comparison
// ============================================================

export interface TotalsRow {
  key: ReportTotalKey
  label: string
  report: number
  logbook: number
  /** Logbook − report, in the figure's own unit. */
  delta: number
  /** Whether the figure is a length of time (minutes) or a count. */
  duration: boolean
}

export interface TotalsComparison {
  rows: TotalsRow[]
  /** True when every figure agrees. */
  matches: boolean
}

export function compareReportTotals(report: ReportTotals, logbook: ReportTotals): TotalsComparison {
  const rows = LABELS.map(([key, label]) => ({
    key,
    label,
    report: report[key],
    logbook: logbook[key],
    delta: logbook[key] - report[key],
    duration: isDuration(key),
  }))
  return { rows, matches: rows.every((r) => r.delta === 0) }
}
