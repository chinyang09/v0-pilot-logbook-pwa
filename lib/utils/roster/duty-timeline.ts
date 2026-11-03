/**
 * The duty timeline: a Gantt chart whose axis is time, in three lanes —
 *
 *   DUTY    sign-on → sign-off, every duty (flight, standby, ground)
 *   FLIGHT  each sector's block time (OUT→IN)
 *   REST    the gap between consecutive duties
 *
 * — each labelled with its DURATION and judged against its LIMIT: a duty
 * whose FDP runs past its Reg 14 maximum, and a rest short of what para 3/4
 * required, are the two things the chart exists to make obvious.
 *
 * Built from the FDP pipeline's duty periods (flown, and — through
 * `upcomingPlannedDuties` — the ones still rostered) plus the flight rows they
 * name, so a block shows the same duty the limits were computed from, and the
 * rest is the pipeline's own figure. Ground duties (training, office) come from
 * the roster's schedule entries: the pipeline does not count them, but they are
 * duty, and a pilot reading the week needs to see them.
 */

import { DEFAULT_FTL_LIMITS, type DutyPeriod, type ScheduleEntry } from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"
import { isPositioningEntry } from "@/lib/utils/entry-type"
import { hhmmToMinutes } from "@/lib/utils/time"
import { fdpMinutesOf, isDutyExceedingLimits } from "@/lib/utils/roster/fdp-calculator"
import {
  POST_FLIGHT_CHECK_MIN,
  PRE_FLIGHT_CHECK_MIN,
  REST_STARTS_AFTER_DUTY_MIN,
} from "@/lib/utils/roster/regulation-definitions"

const MIN = 60_000
const DAY = 86_400_000

export interface Span {
  startMs: number
  endMs: number
}

export interface TimelineSector {
  id: string
  flightNumber: string
  from: string
  to: string
  /** What is drawn: actual OUT→IN where recorded, scheduled otherwise. */
  outMs: number
  inMs: number
  /** The scheduled OUT→IN, when the row carries one. */
  scheduled: Span | null
  registration: string
  type: string
  /** Still to fly: no OUT/IN recorded, so these are its SCHEDULED times. */
  planned: boolean
  /** Carried as a passenger — duty, no flight time. */
  positioning: boolean
}

export type DutyBlockKind = "flight" | "standby" | "ground"

export interface DutyBlock {
  id: string
  kind: DutyBlockKind
  /** Sign-on (the report) and sign-off (free of all duties), UTC ms. */
  startMs: number
  endMs: number
  /**
   * The duty as SCHEDULED: an hour before the first scheduled OUT to half an
   * hour after the last scheduled IN (para 7(2)'s checks). Null when a sector
   * carries no schedule, or for a duty that is not made of sectors.
   */
  planned: Span | null
  dutyMinutes: number
  /** Block time of the sectors operated — positioning carries none. */
  flightMinutes: number
  sectors: TimelineSector[]
  /** WSSS-VTBS-WSSS: the stops in order, each said once. */
  route: string
  /** The roster's code for a standby or ground duty ("SBY1", "EBT1"). */
  code: string
  /** Each distinct ICAO type flown, in order. */
  types: string[]
  isFuture: boolean
  isStandby: boolean
  /** Reg 14's maximum for this duty (minutes), 0 when none applies. */
  maxFdpMinutes: number
  /** The FDP as the limits measure it — report to last on-blocks. */
  fdpMinutes: number
  /**
   * Against its limit: `over` when the FDP (or a standby's own 18-hour cap)
   * is exceeded, `near` within the last tenth of the FDP maximum.
   */
  limit: "over" | "near" | null
  /**
   * The rest before this duty — the regulation's figure where the pipeline
   * computed one (it commences an hour after free of all duties), else the
   * plain gap since the last duty ended. Null for the first duty, and for a
   * standby or ground duty (rest runs through an un-called standby).
   */
  restBefore: RestBefore | null
}

export interface RestBefore {
  /** When the rest commenced, and its length to this duty's sign-on. */
  startMs: number
  minutes: number
  requiredMinutes: number | null
  compliant: boolean | null
  /** `short` below the requirement, `tight` within an hour of it. */
  status: "short" | "tight" | "ok" | null
  /** The duty the rest follows. */
  previousId: string
}

/** A rest within this much of its requirement is called tight. */
const TIGHT_REST_MIN = 60
/** An FDP within this share of its maximum is called near. */
const NEAR_FDP_SHARE = 0.9

function restStatus(minutes: number, required: number | null, compliant: boolean | null): RestBefore["status"] {
  if (compliant === false) return "short"
  if (required == null) return null
  if (minutes < required) return "short"
  return minutes - required < TIGHT_REST_MIN ? "tight" : "ok"
}

function limitOf(dp: DutyPeriod): DutyBlock["limit"] {
  if (isDutyExceedingLimits(dp, DEFAULT_FTL_LIMITS).exceeds) return "over"
  if (dp.dutyKind !== "standby" && dp.maxFdpMinutes > 0 && fdpMinutesOf(dp) >= dp.maxFdpMinutes * NEAR_FDP_SHARE) return "near"
  return null
}

function instant(date: string, hhmm: string): number {
  return Date.parse(`${date}T00:00:00Z`) + hhmmToMinutes(hhmm) * MIN
}

/** `to` on or after `from` — a time earlier in the day is the next day. */
function after(from: number, date: string, hhmm: string): number {
  let t = instant(date, hhmm)
  while (t < from) t += DAY
  return t
}

/** A sector's times, actual where recorded, scheduled otherwise. */
function sectorOf(f: FlightLog): TimelineSector | null {
  const out = f.outTime || f.scheduledOut || ""
  const inn = f.inTime || f.scheduledIn || ""
  if (!f.date || !out || !inn) return null
  // Keyed on OUT's UTC date: anything earlier in the day than OUT is the next day.
  const outMs = instant(f.date, out)
  let inMs = after(outMs, f.date, inn)
  if (inMs === outMs) inMs += DAY

  let scheduled: Span | null = null
  if (f.scheduledOut && f.scheduledIn) {
    // A scheduled OUT before an early actual (a pushback before midnight UTC
    // on a flight keyed to the next day) is the same day; past a 12-hour
    // separation from the drawn OUT it is the neighbouring day.
    let s = instant(f.date, f.scheduledOut)
    if (s - outMs > DAY / 2) s -= DAY
    else if (outMs - s > DAY / 2) s += DAY
    scheduled = { startMs: s, endMs: after(s + 1, f.date, f.scheduledIn) }
  }

  return {
    id: f.id,
    flightNumber: f.flightNumber || "",
    from: f.departureIcao || f.departureIata || "",
    to: f.arrivalIcao || f.arrivalIata || "",
    outMs,
    inMs,
    scheduled,
    registration: f.aircraftReg || "",
    type: f.aircraftType || "",
    planned: !(f.outTime && f.inTime),
    positioning: isPositioningEntry(f),
  }
}

function routeOf(sectors: TimelineSector[], fallback?: string): string {
  if (sectors.length === 0) return (fallback ?? "").split("/")[0] ?? ""
  const stops: string[] = []
  for (const s of sectors) {
    if (stops[stops.length - 1] !== s.from && s.from) stops.push(s.from)
    if (s.to) stops.push(s.to)
  }
  return stops.join("-")
}

/** The duty as rostered — only when every sector carries its schedule. */
function plannedDuty(sectors: TimelineSector[]): Span | null {
  if (sectors.length === 0 || sectors.some((s) => !s.scheduled)) return null
  const first = Math.min(...sectors.map((s) => s.scheduled!.startMs))
  const last = Math.max(...sectors.map((s) => s.scheduled!.endMs))
  return { startMs: first - PRE_FLIGHT_CHECK_MIN * MIN, endMs: last + POST_FLIGHT_CHECK_MIN * MIN }
}

/**
 * A ground duty or training session off the roster, in UTC. Entries in a
 * local frame are left out rather than drawn a timezone wrong — the import
 * writes ground duties in UTC.
 */
function groundBlock(e: ScheduleEntry, today: string): DutyBlock | null {
  if (e.dutyType !== "ground" && e.dutyType !== "training") return null
  if (e.timeReference !== "UTC" || !e.reportTime || !e.debriefTime) return null
  const startMs = instant(e.date, e.reportTime)
  let endMs = after(startMs, e.date, e.debriefTime)
  if (endMs === startMs) return null
  if (endMs - startMs > DAY) endMs -= DAY
  return {
    id: e.id,
    kind: "ground",
    startMs,
    endMs,
    planned: null,
    dutyMinutes: Math.round((endMs - startMs) / MIN),
    flightMinutes: 0,
    sectors: [],
    route: "",
    code: e.dutyCode || (e.dutyType === "training" ? "Training" : "Ground"),
    types: [],
    isFuture: e.date > today,
    isStandby: false,
    maxFdpMinutes: 0,
    fdpMinutes: 0,
    limit: null,
    restBefore: null,
  }
}

/**
 * Every duty in time order, as blocks. `flightsById` resolves the flight rows a
 * duty names; a duty whose rows are not on hand still draws, from its own
 * figures, with no sectors inside it.
 */
export function buildDutyTimeline(
  dutyPeriods: readonly DutyPeriod[],
  flightsById: ReadonlyMap<string, FlightLog>,
  scheduleEntries: readonly ScheduleEntry[] = [],
): DutyBlock[] {
  const blocks: DutyBlock[] = []
  for (const dp of dutyPeriods) {
    if (!dp.date || !dp.reportTime || !(dp.dutyMinutes > 0)) continue
    const startMs = instant(dp.date, dp.reportTime)
    const endMs = startMs + dp.dutyMinutes * MIN
    const sectors = dp.flightIds
      .map((id) => flightsById.get(id))
      .filter((f): f is FlightLog => !!f)
      .map(sectorOf)
      .filter((s): s is TimelineSector => !!s)
      .sort((a, b) => a.outMs - b.outMs)
    const types: string[] = []
    for (const s of sectors) if (s.type && !s.positioning && !types.includes(s.type)) types.push(s.type)
    const standby = dp.dutyKind === "standby"
    blocks.push({
      id: dp.id,
      kind: standby ? "standby" : "flight",
      startMs,
      endMs,
      planned: standby ? null : plannedDuty(sectors),
      dutyMinutes: dp.dutyMinutes,
      flightMinutes: standby ? 0 : dp.flightMinutes,
      sectors,
      route: routeOf(sectors, dp.route),
      code: standby ? "SBY" : "",
      types,
      isFuture: dp.isFuture,
      isStandby: standby,
      maxFdpMinutes: dp.maxFdpMinutes || 0,
      fdpMinutes: standby ? 0 : fdpMinutesOf(dp),
      limit: limitOf(dp),
      restBefore: null,
    })
  }

  const today = new Date().toISOString().slice(0, 10)
  const taken = new Set(blocks.map((b) => b.id))
  for (const e of scheduleEntries) {
    if (taken.has(e.id) || e.deletedAt != null) continue
    const g = groundBlock(e, today)
    if (g) blocks.push(g)
  }
  blocks.sort((a, b) => a.startMs - b.startMs)

  // The rest between FLIGHT duties: the pipeline's own figure where it has
  // one, so the timeline and the limits can never disagree about it. It runs
  // straight through an un-called standby and ignores a ground duty, as the
  // pipeline's does, so it is measured from the last flight duty.
  const restOf = new Map(dutyPeriods.map((dp) => [dp.id, dp.restBefore]))
  let previous: DutyBlock | null = null
  for (const b of blocks) {
    if (b.kind !== "flight") continue
    if (previous) {
      const rp = restOf.get(b.id)
      const gap = Math.max(0, Math.round((b.startMs - previous.endMs) / MIN) - REST_STARTS_AFTER_DUTY_MIN)
      const minutes = rp ? rp.restMinutes : gap
      const requiredMinutes = rp ? rp.requiredRestMinutes : null
      const compliant = rp ? rp.compliant : null
      b.restBefore = {
        startMs: b.startMs - minutes * MIN,
        minutes,
        requiredMinutes,
        compliant,
        status: restStatus(minutes, requiredMinutes, compliant),
        previousId: previous.id,
      }
    }
    previous = b
  }
  return blocks
}

export interface TimelineSummary {
  /** Block time flown (or to be flown) inside the range. */
  flightMinutes: number
  /** Duty inside the range — a duty crossing an edge counts the part inside. */
  dutyMinutes: number
  /** The shortest rest that ENDS inside the range, and how many fell short. */
  shortestRestMinutes: number | null
  shortRests: number
  /** Duties whose FDP (or standby cap) is exceeded. */
  overLimit: number
  duties: number
}

/**
 * What the range [fromMs, toMs) holds. A duty that straddles an edge counts
 * only its part inside, and its flight time in the same proportion, so
 * scrolling the timeline never counts a duty twice across two views.
 */
export function summarizeTimeline(blocks: readonly DutyBlock[], fromMs: number, toMs: number): TimelineSummary {
  let flight = 0
  let duty = 0
  let duties = 0
  let shortest: number | null = null
  let shortRests = 0
  let overLimit = 0
  for (const b of blocks) {
    if (b.endMs <= fromMs || b.startMs >= toMs) continue
    duties++
    if (b.limit === "over") overLimit++
    const inside = Math.min(b.endMs, toMs) - Math.max(b.startMs, fromMs)
    const share = inside / (b.endMs - b.startMs)
    duty += inside / MIN
    flight += b.flightMinutes * share
    if (b.restBefore && b.startMs >= fromMs) {
      if (shortest === null || b.restBefore.minutes < shortest) shortest = b.restBefore.minutes
      if (b.restBefore.status === "short") shortRests++
    }
  }
  return {
    flightMinutes: Math.round(flight),
    dutyMinutes: Math.round(duty),
    shortestRestMinutes: shortest,
    shortRests,
    overLimit,
    duties,
  }
}
