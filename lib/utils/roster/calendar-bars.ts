/**
 * The month calendar as BARS — what each week row draws.
 *
 * One calendar for the logbook, the roster and the dashboard: a grid of day
 * cells with the day's flights and duties laid over it as bars, the way a
 * desktop calendar draws events. A day says what it IS ("TR560 RPMD", "LOFF"),
 * and a thing that lasts longer than a day LOOKS longer than a day:
 *
 * | | Drawn as |
 * |---|---|
 * | a flight inside one day | that day's cell, full width |
 * | a flight (or timed duty) across midnight | from the MIDDLE of its first day to the MIDDLE of its last — half of each cell, so the crossover is a picture |
 * | an all-day duty on consecutive days (leave, LOFF) | ONE bar across them, the days merged |
 *
 * A bar that leaves a week row continues on the next one; `continuesLeft` /
 * `continuesRight` say so, so the renderer can square that end off.
 *
 * Positions are in HALF-DAYS within the week (0–14), so a midnight crossover is
 * exact without measuring anything. Lanes are assigned greedily, longest-first
 * among equal starts, so a week's multi-day bars stack on top.
 *
 * Pure: no React, no IndexedDB. The day of an instant comes from
 * `dayKeyAt` in the display zone, the same rule the roster's agenda uses.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { DutyType, ScheduleEntry } from "@/types/entities/roster.types"
import { isFlownFlight } from "@/lib/utils/flight-calculations"
import { isSimulatorEntry } from "@/lib/utils/entry-type"
import { isUnloggedPast } from "@/lib/utils/logbook-now"
import { dayKeyAt, utcInstant, type RosterDisplayZone } from "@/lib/utils/roster/roster-days"

export type BarTone =
  | { kind: "flight"; state: "flown" | "planned" | "unlogged" | "sim" }
  | { kind: "duty"; dutyType: DutyType }

export interface CalendarSpan {
  /** The flight's or the (first) duty's id — what a tap on the bar opens. */
  id: string
  label: string
  /**
   * A flight's destination ("RPMD"), kept apart from its number so a narrow
   * cell (a dual-month pane) can drop it and still say which flight.
   */
  detail?: string
  tone: BarTone
  /** YYYY-MM-DD of the first and last day the span touches, in the display zone. */
  startDay: string
  endDay: string
  /** 0 = starts at the first day's left edge, 1 = at its middle (a crossover). */
  startHalf: 0 | 1
  /** 2 = ends at the last day's right edge, 1 = at its middle (a crossover). */
  endHalf: 1 | 2
  /** Sort key within a day (epoch ms; all-day spans sort first). */
  order: number
}

export interface CalendarBar {
  /** Unique within the week: a span split across rows appears once per row. */
  key: string
  span: CalendarSpan
  /** Half-day columns, [start, end), 0–14. */
  start: number
  end: number
  lane: number
  continuesLeft: boolean
  continuesRight: boolean
}

export interface WeekLayout {
  /** Bars in visible lanes only. */
  bars: CalendarBar[]
  /** Lanes the week needs (before the cap). */
  lanes: number
  /** Per day (0–6): how many spans that day has in lanes past the cap. */
  hidden: number[]
}

const DAY_MS = 86_400_000

/** YYYY-MM-DD → the next day's key, on the calendar (no zone involved). */
export function nextDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** The label a FLIGHT bar carries: "TR560 RPMD" — number, then where it goes. */
export function flightBarLabel(f: Partial<Pick<FlightLog, "flightNumber" | "arrivalIcao" | "arrivalIata">>): string {
  const number = (f.flightNumber ?? "").trim().toUpperCase()
  const to = (f.arrivalIcao || f.arrivalIata || "").trim().toUpperCase()
  return [number, to].filter(Boolean).join(" ") || "Flight"
}

/**
 * A duty's label: its code ("LOFF", "SBY1"), else its description, else its
 * kind. LEAVE reads its description first — "Paternal Leave" says what a run
 * of days is where "PL" does not, and a leave bar is long enough to hold it.
 */
export function dutyBarLabel(entry: Pick<ScheduleEntry, "dutyCode" | "dutyDescription" | "dutyType">): string {
  if (entry.dutyType === "leave" && entry.dutyDescription?.trim()) return entry.dutyDescription.trim()
  const code = (entry.dutyCode ?? "").trim()
  if (code) return code.toUpperCase()
  const description = (entry.dutyDescription ?? "").trim()
  if (description) return description
  return entry.dutyType.charAt(0).toUpperCase() + entry.dutyType.slice(1)
}

/**
 * A timed thing as a span: one day → the whole cell; across midnight → from
 * the middle of the first day to the middle of the last.
 */
function timedSpan(
  startMs: number,
  endMs: number | null,
  display: RosterDisplayZone
): Pick<CalendarSpan, "startDay" | "endDay" | "startHalf" | "endHalf"> {
  const startDay = dayKeyAt(startMs, display)
  // An end exactly on midnight belongs to the day before it.
  const endDay = endMs !== null && endMs > startMs ? dayKeyAt(endMs - 1, display) : startDay
  if (endDay <= startDay) return { startDay, endDay: startDay, startHalf: 0, endHalf: 2 }
  return { startDay, endDay, startHalf: 1, endHalf: 1 }
}

export interface CalendarSpanOptions {
  /** Show standby, ground, leave, off and simulator sessions (the Duties toggle). */
  duties: boolean
  /** YYYY-MM-DD (UTC) — a past sector with no times is drawn as NOT LOGGED. */
  todayUtc: string
}

/**
 * Every span the month calendar draws, from the logbook's flights and the
 * roster's duties. With `duties` off only operated flights and positioning
 * remain — the logbook's own picture.
 */
export function buildCalendarSpans(
  entries: readonly ScheduleEntry[],
  flights: readonly FlightLog[],
  display: RosterDisplayZone,
  options: CalendarSpanOptions
): CalendarSpan[] {
  const spans: CalendarSpan[] = []

  for (const flight of flights) {
    const simulator = isSimulatorEntry(flight)
    if (simulator && !options.duties) continue
    const startMs = utcInstant(flight.date, flight.outTime || flight.scheduledOut)
    let endMs = utcInstant(flight.date, flight.inTime || flight.scheduledIn)
    if (startMs !== null && endMs !== null && endMs <= startMs) endMs += DAY_MS
    const where =
      startMs === null
        ? { startDay: flight.date, endDay: flight.date, startHalf: 0 as const, endHalf: 2 as const }
        : timedSpan(startMs, endMs, display)
    const state = simulator
      ? "sim"
      : isFlownFlight(flight)
        ? "flown"
        : isUnloggedPast(flight, options.todayUtc)
          ? "unlogged"
          : "planned"
    const number = (flight.flightNumber ?? "").trim().toUpperCase()
    const to = (flight.arrivalIcao || flight.arrivalIata || "").trim().toUpperCase()
    spans.push({
      id: flight.id,
      label: simulator
        ? `SIM${flight.simSessionCode ? ` ${flight.simSessionCode}` : ""}`
        : number || flightBarLabel(flight),
      detail: !simulator && number && to ? to : undefined,
      tone: { kind: "flight", state },
      ...where,
      order: startMs ?? 0,
    })
  }

  if (!options.duties) return spans

  // Timed duties are their own spans; all-day duties (no report time) on
  // consecutive days with the same code merge into one bar.
  const allDay: ScheduleEntry[] = []
  for (const entry of entries) {
    if (entry.dutyType === "flight") continue
    const startMs = utcInstant(entry.date, entry.reportTime)
    if (startMs === null) {
      allDay.push(entry)
      continue
    }
    let endMs = utcInstant(entry.date, entry.debriefTime)
    if (endMs !== null && endMs <= startMs) endMs += DAY_MS
    spans.push({
      id: entry.id,
      label: dutyBarLabel(entry),
      tone: { kind: "duty", dutyType: entry.dutyType },
      ...timedSpan(startMs, endMs, display),
      order: startMs,
    })
  }

  allDay.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)))
  const open = new Map<string, CalendarSpan>()
  for (const entry of allDay) {
    const label = dutyBarLabel(entry)
    const key = `${entry.dutyType}|${label}`
    const run = open.get(key)
    if (run && nextDayKey(run.endDay) === entry.date) {
      run.endDay = entry.date
      continue
    }
    const span: CalendarSpan = {
      id: entry.id,
      label,
      tone: { kind: "duty", dutyType: entry.dutyType },
      startDay: entry.date,
      endDay: entry.date,
      startHalf: 0,
      endHalf: 2,
      order: -1,
    }
    open.set(key, span)
    spans.push(span)
  }

  return spans
}

/**
 * One week row's bars. `days` are the seven YYYY-MM-DD keys of the row, in
 * order; `maxLanes` caps what is drawn, and what falls past it is counted per
 * day in `hidden` ("+2").
 */
export function layoutWeek(days: readonly string[], spans: readonly CalendarSpan[], maxLanes: number): WeekLayout {
  const first = days[0]
  const last = days[days.length - 1]
  const index = new Map(days.map((d, i) => [d, i]))

  const placed: Omit<CalendarBar, "lane">[] = []
  for (const span of spans) {
    if (span.endDay < first || span.startDay > last) continue
    const continuesLeft = span.startDay < first
    const continuesRight = span.endDay > last
    const start = continuesLeft ? 0 : index.get(span.startDay)! * 2 + span.startHalf
    const end = continuesRight ? days.length * 2 : index.get(span.endDay)! * 2 + span.endHalf
    if (end <= start) continue
    placed.push({ key: `${span.id}@${first}`, span, start, end, continuesLeft, continuesRight })
  }

  placed.sort(
    (a, b) =>
      a.start - b.start ||
      b.end - b.start - (a.end - a.start) ||
      a.span.order - b.span.order ||
      a.span.id.localeCompare(b.span.id)
  )

  const laneEnds: number[] = []
  const bars: CalendarBar[] = []
  const hidden = new Array(days.length).fill(0)
  for (const p of placed) {
    let lane = laneEnds.findIndex((end) => end <= p.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(p.end)
    } else {
      laneEnds[lane] = p.end
    }
    if (lane < maxLanes) {
      bars.push({ ...p, lane })
    } else {
      for (let d = Math.floor(p.start / 2); d < Math.ceil(p.end / 2); d++) hidden[d]++
    }
  }
  return { bars, lanes: laneEnds.length, hidden }
}
