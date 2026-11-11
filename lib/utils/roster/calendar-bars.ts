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
 * | a flight inside one day | that day's cell, full width: "248 WMKP" |
 * | a RETURN pair (out and straight back) | ONE bar: "248/9 WMKP" — the turnaround airport |
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

import { groupDutyRuns, isWholeDayDuty } from "@/lib/utils/roster/duty-runs"
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
  /**
   * Lanes the bar fills: 1, or 2 when its label wanted a second line
   * ("456/7" over "WMKP") and the lane under it was free across its whole
   * range — never at the cost of another item.
   */
  height: 1 | 2
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

/**
 * A flight number without its airline: "TR0288" → "288". The calendar is the
 * pilot's own month, so the designator is the same on nearly every bar and
 * was a third of each label. An IATA designator (two characters, one of them
 * possibly a digit) or an ICAO one (three letters) is dropped, and the leading
 * zeros with it; anything that does not read as one is kept whole.
 */
export function shortFlightNumber(flightNumber: string | undefined): string {
  const fn = (flightNumber ?? "").trim().toUpperCase().replace(/\s+/g, "")
  const m = /^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])0*(\d{1,5}[A-Z]?)$/.exec(fn)
  return m ? m[1] : fn
}

/**
 * Two flight numbers as one: "248/9" — the second written as the digits it
 * does not share with the first, the way a crew roster writes a return. When
 * they share nothing ("199" and "200") or differ in length, both whole.
 */
export function pairedFlightNumber(a: string, b: string): string {
  if (!a) return b
  if (!b || a === b) return a
  if (a.length === b.length) {
    let common = 0
    while (common < a.length - 1 && a[common] === b[common]) common++
    if (common > 0) return `${a}/${b.slice(common)}`
  }
  return `${a}/${b}`
}

/** An airport as the calendar writes it: the ICAO code, else the IATA. */
function airportCode(icao: string | undefined, iata: string | undefined): string {
  return (icao || iata || "").trim().toUpperCase()
}

/** The label a FLIGHT bar carries: "248 WMKP" — number, then where it goes. */
export function flightBarLabel(f: Partial<Pick<FlightLog, "flightNumber" | "arrivalIcao" | "arrivalIata">>): string {
  const number = shortFlightNumber(f.flightNumber)
  const to = airportCode(f.arrivalIcao, f.arrivalIata)
  return [number, to].filter(Boolean).join(" ") || "Flight"
}

/** The longest turnaround a return pair may have on the ground (a duty's own break). */
const RETURN_TURNAROUND_MS = 8 * 3_600_000

/** An airline designator, when the number has one. */
function designator(flightNumber: string | undefined): string {
  return /^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])\d/.exec((flightNumber ?? "").trim().toUpperCase())?.[1] ?? ""
}

interface TimedFlight {
  flight: FlightLog
  startMs: number | null
  endMs: number | null
  state: "flown" | "planned" | "unlogged"
}

/**
 * Is `b` the way straight back from `a`? Out A→B, then B→A, `b` the very next
 * flight, on the same airline, leaving within a turnaround of `a`'s arrival.
 * A triangle (A→B→C→A) pairs nothing: its legs are not the next one's reverse.
 */
function isReturnOf(a: TimedFlight, b: TimedFlight): boolean {
  const out = { from: airportCode(a.flight.departureIcao, a.flight.departureIata), to: airportCode(a.flight.arrivalIcao, a.flight.arrivalIata) }
  const back = { from: airportCode(b.flight.departureIcao, b.flight.departureIata), to: airportCode(b.flight.arrivalIcao, b.flight.arrivalIata) }
  if (!out.from || !out.to || out.from === out.to) return false
  if (back.from !== out.to || back.to !== out.from) return false
  const da = designator(a.flight.flightNumber)
  const db = designator(b.flight.flightNumber)
  if (da && db && da !== db) return false
  if (a.startMs === null || b.startMs === null) return a.flight.date === b.flight.date
  const ground = b.startMs - (a.endMs ?? a.startMs)
  return ground >= 0 && ground <= RETURN_TURNAROUND_MS
}

/** One state for a pair: a gap in the record first, then what is still to fly. */
function pairState(a: TimedFlight["state"], b: TimedFlight["state"]): TimedFlight["state"] {
  if (a === "unlogged" || b === "unlogged") return "unlogged"
  if (a === "planned" || b === "planned") return "planned"
  return "flown"
}

/**
 * A duty's label: its code ("LOFF", "SBY1"), else its description, else its
 * kind. LEAVE reads its description first — "Paternal Leave" says what a run
 * of days is where "PL" does not, and a leave bar is long enough to hold it.
 */
export function dutyBarLabel(entry: Pick<ScheduleEntry, "dutyCode" | "dutyDescription" | "dutyType">): string {
  const said = (entry.dutyDescription ?? "").replace(/\s+/g, " ").trim()
  if (entry.dutyType === "leave" && said) return said
  const code = (entry.dutyCode ?? "").trim()
  if (code) return code.toUpperCase()
  if (said) return said
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
  /** Show the roster's duties — standby, ground, leave, off (the Duties toggle). */
  duties: boolean
  /** YYYY-MM-DD (UTC) — a past sector with no times is drawn as NOT LOGGED. */
  todayUtc: string
}

/**
 * Every span the month calendar draws, from the logbook's flights and the
 * roster's duties. With `duties` off only the logbook's own entries remain —
 * flights, positioning and simulator sessions.
 */
export function buildCalendarSpans(
  entries: readonly ScheduleEntry[],
  flights: readonly FlightLog[],
  display: RosterDisplayZone,
  options: CalendarSpanOptions
): CalendarSpan[] {
  const spans: CalendarSpan[] = []

  // Flights in the order they fly, so a leg can find the way back.
  const timed: TimedFlight[] = []
  for (const flight of flights) {
    const simulator = isSimulatorEntry(flight)
    const startMs = utcInstant(flight.date, flight.outTime || flight.scheduledOut)
    let endMs = utcInstant(flight.date, flight.inTime || flight.scheduledIn)
    if (startMs !== null && endMs !== null && endMs <= startMs) endMs += DAY_MS
    if (simulator) {
      // A simulator session is the logbook's own entry — shown whatever the
      // Duties toggle says, as the logbook list shows it.
      spans.push({
        id: flight.id,
        label: `SIM${flight.simSessionCode ? ` ${flight.simSessionCode}` : ""}`,
        tone: { kind: "flight", state: "sim" },
        ...(startMs === null
          ? { startDay: flight.date, endDay: flight.date, startHalf: 0 as const, endHalf: 2 as const }
          : timedSpan(startMs, endMs, display)),
        order: startMs ?? 0,
      })
      continue
    }
    const state = isFlownFlight(flight) ? "flown" : isUnloggedPast(flight, options.todayUtc) ? "unlogged" : "planned"
    timed.push({ flight, startMs, endMs, state })
  }
  timed.sort(
    (x, y) =>
      (x.startMs ?? Date.parse(`${x.flight.date}T00:00:00Z`)) - (y.startMs ?? Date.parse(`${y.flight.date}T00:00:00Z`)) ||
      x.flight.id.localeCompare(y.flight.id)
  )

  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]
    const b = timed[i + 1]
    // "248/9 WMKP": out and straight back is ONE bar, named for the
    // turnaround — a four-sector day of two returns is two bars, not four.
    const pair = b && isReturnOf(a, b) ? b : null
    if (pair) i++
    const last = pair ?? a
    const startMs = a.startMs
    const endMs = last.endMs ?? last.startMs
    const where =
      startMs === null
        ? { startDay: a.flight.date, endDay: last.flight.date, startHalf: 0 as const, endHalf: 2 as const }
        : timedSpan(startMs, endMs, display)
    const number = pair
      ? pairedFlightNumber(shortFlightNumber(a.flight.flightNumber), shortFlightNumber(pair.flight.flightNumber))
      : shortFlightNumber(a.flight.flightNumber)
    const to = airportCode(a.flight.arrivalIcao, a.flight.arrivalIata)
    spans.push({
      id: a.flight.id,
      label: number || flightBarLabel(a.flight),
      detail: number && to ? to : undefined,
      tone: { kind: "flight", state: pair ? pairState(a.state, pair.state) : a.state },
      ...where,
      order: startMs ?? 0,
    })
  }

  if (!options.duties) return spans

  // Timed duties are their own spans; whole-day duties — a day off or leave
  // whatever window it carries, or anything with no report time — are grouped
  // into runs by the rule the logbook's cards use (`groupDutyRuns`), so a
  // run is one bar here exactly when it is one card there.
  const wholeDay: ScheduleEntry[] = []
  for (const entry of entries) {
    if (entry.dutyType === "flight" || entry.deletedAt != null) continue
    const startMs = isWholeDayDuty(entry) ? null : utcInstant(entry.date, entry.reportTime)
    if (startMs === null) {
      wholeDay.push(entry)
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

  for (const run of groupDutyRuns(wholeDay)) {
    const entry = run.entries[0]
    spans.push({
      id: entry.id,
      label: dutyBarLabel(entry),
      tone: { kind: "duty", dutyType: entry.dutyType },
      startDay: run.startDate,
      endDay: run.endDate,
      startHalf: 0,
      endHalf: 2,
      order: -1,
    })
  }

  return spans
}

/**
 * One week row's bars. `days` are the seven YYYY-MM-DD keys of the row, in
 * order; `maxLanes` caps what is drawn, and what falls past it is counted per
 * day in `hidden` ("+2").
 */
export function layoutWeek(
  days: readonly string[],
  spans: readonly CalendarSpan[],
  maxLanes: number,
  /** Whether a bar would rather take two lines than condense onto one. */
  wantsTwoLines?: (bar: Pick<CalendarBar, "span" | "start" | "end" | "continuesLeft" | "continuesRight">) => boolean
): WeekLayout {
  const first = days[0]
  const last = days[days.length - 1]
  const index = new Map(days.map((d, i) => [d, i]))

  const placed: Omit<CalendarBar, "lane" | "height">[] = []
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
      bars.push({ ...p, lane, height: 1 })
    } else {
      for (let d = Math.floor(p.start / 2); d < Math.ceil(p.end / 2); d++) hidden[d]++
    }
  }

  // A second line only where the lane under a bar is EMPTY across its range:
  // the lanes are first packed one line each, so taking a line can never push
  // another item out of sight. Half-day occupancy, lane by lane.
  if (wantsTwoLines) {
    const taken = Array.from({ length: maxLanes }, () => new Array<boolean>(days.length * 2).fill(false))
    for (const b of bars) for (let c = b.start; c < b.end; c++) taken[b.lane][c] = true
    for (const b of bars) {
      const below = b.lane + 1
      if (below >= maxLanes || !wantsTwoLines(b)) continue
      let free = true
      for (let c = b.start; c < b.end && free; c++) free = !taken[below][c]
      if (!free) continue
      for (let c = b.start; c < b.end; c++) taken[below][c] = true
      b.height = 2
    }
  }
  return { bars, lanes: laneEnds.length, hidden }
}
