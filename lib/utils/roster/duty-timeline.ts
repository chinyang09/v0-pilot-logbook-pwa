/**
 * The duty timeline: every duty as a block on ONE continuous time axis, the
 * rest between them as the gaps, and each block's sectors inside it.
 *
 * It answers three questions at a glance, which the rolling chart above it
 * cannot: how much have I flown, how much duty have I done, and how much rest
 * did I get between duties. The rolling chart answers "how close am I to a
 * limit" — a running total — and a total hides the shape of the days that
 * made it.
 *
 * Built from the FDP pipeline's duty periods (flown, and — through
 * `upcomingPlannedDuties` — the ones still rostered) plus the flight rows they
 * name, so a block shows the same duty the limits were computed from.
 */

import type { DutyPeriod } from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"
import { isPositioningEntry } from "@/lib/utils/entry-type"
import { hhmmToMinutes } from "@/lib/utils/time"

const MIN = 60_000
const DAY = 86_400_000

export interface TimelineSector {
  id: string
  flightNumber: string
  from: string
  to: string
  outMs: number
  inMs: number
  registration: string
  type: string
  /** Still to fly: no OUT/IN recorded, so these are its SCHEDULED times. */
  planned: boolean
  /** Carried as a passenger — duty, no flight time. */
  positioning: boolean
}

export interface DutyBlock {
  id: string
  /** Sign-on (the report) and sign-off (free of all duties), UTC ms. */
  startMs: number
  endMs: number
  dutyMinutes: number
  /** Block time of the sectors operated — positioning carries none. */
  flightMinutes: number
  sectors: TimelineSector[]
  /** WSSS-VTBS-WSSS: the stops in order, each said once. */
  route: string
  /** Each distinct ICAO type flown, in order. */
  types: string[]
  isFuture: boolean
  isStandby: boolean
  /** Reg 14's maximum for this duty (minutes), 0 when none applies. */
  maxFdpMinutes: number
  /**
   * The rest before this duty — the regulation's figure where the pipeline
   * computed one (it commences an hour after free of all duties), else the
   * plain gap since the last duty ended. Null for the first duty shown.
   */
  restBefore: { minutes: number; requiredMinutes: number | null; compliant: boolean | null } | null
}

function instant(date: string, hhmm: string): number {
  return Date.parse(`${date}T00:00:00Z`) + hhmmToMinutes(hhmm) * MIN
}

/** A sector's OUT→IN, actual where recorded, scheduled otherwise. */
function sectorOf(f: FlightLog): TimelineSector | null {
  const out = f.outTime || f.scheduledOut || ""
  const inn = f.inTime || f.scheduledIn || ""
  if (!f.date || !out || !inn) return null
  const outMs = instant(f.date, out)
  let inMs = instant(f.date, inn)
  if (inMs <= outMs) inMs += DAY // keyed on OUT's UTC date: an earlier IN is the next day
  return {
    id: f.id,
    flightNumber: f.flightNumber || "",
    from: f.departureIcao || f.departureIata || "",
    to: f.arrivalIcao || f.arrivalIata || "",
    outMs,
    inMs,
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

/**
 * Every duty in time order, as blocks. `flightsById` resolves the flight rows a
 * duty names; a duty whose rows are not on hand still draws, from its own
 * figures, with no sectors inside it.
 */
export function buildDutyTimeline(
  dutyPeriods: readonly DutyPeriod[],
  flightsById: ReadonlyMap<string, FlightLog>,
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
    blocks.push({
      id: dp.id,
      startMs,
      endMs,
      dutyMinutes: dp.dutyMinutes,
      flightMinutes: dp.dutyKind === "standby" ? 0 : dp.flightMinutes,
      sectors,
      route: routeOf(sectors, dp.route),
      types,
      isFuture: dp.isFuture,
      isStandby: dp.dutyKind === "standby",
      maxFdpMinutes: dp.maxFdpMinutes || 0,
      restBefore: null,
    })
  }
  blocks.sort((a, b) => a.startMs - b.startMs)

  // The rest between: the pipeline's own figure where it has one, so the
  // timeline and the limits can never disagree about it.
  const restOf = new Map(dutyPeriods.map((dp) => [dp.id, dp.restBefore]))
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i]
    const gap = Math.max(0, Math.round((b.startMs - blocks[i - 1].endMs) / MIN))
    const rp = restOf.get(b.id)
    b.restBefore = rp
      ? { minutes: rp.restMinutes, requiredMinutes: rp.requiredRestMinutes, compliant: rp.compliant }
      : { minutes: gap, requiredMinutes: null, compliant: null }
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
  for (const b of blocks) {
    if (b.endMs <= fromMs || b.startMs >= toMs) {
      continue
    }
    duties++
    const inside = Math.min(b.endMs, toMs) - Math.max(b.startMs, fromMs)
    const share = inside / (b.endMs - b.startMs)
    duty += inside / MIN
    flight += b.flightMinutes * share
    if (b.restBefore && b.startMs >= fromMs) {
      if (shortest === null || b.restBefore.minutes < shortest) shortest = b.restBefore.minutes
      if (b.restBefore.compliant === false) shortRests++
    }
  }
  return {
    flightMinutes: Math.round(flight),
    dutyMinutes: Math.round(duty),
    shortestRestMinutes: shortest,
    shortRests,
    duties,
  }
}
