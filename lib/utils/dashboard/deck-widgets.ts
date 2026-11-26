/**
 * The tiles a pilot can ADD to the Flight Deck (the owner, Nov 2026: "the
 * ability to add and remove widget … we need more relevant widgets") — each
 * about the duty the timeline has chosen, like every other tile:
 *
 * | Tile | Answers |
 * |---|---|
 * | Sun & Night | is each take-off and landing by day or night, how much of each leg is night, and when the sun next rises and sets where the duty goes |
 * | Days Off | where the duty sits in the run since the last day off (para 5(4)(a)'s seven dates), when the next one is, how many in the 14 and 28 days to it, and any para 5 finding near it |
 * | Briefing | each leg's OFP in brief — cruise level, trip time and fuel, block fuel, the first alternate, take-off weight against its maximum, the NOTAMs |
 * | Logbook | the duty's month in the logbook — block, sectors, landings, night — and what is still to be logged |
 *
 * Pure, so each is tested (`deck-widgets.test.ts`).
 */

import { interpolateGreatCircle, isNight } from "@/lib/utils/night-time"
import { hhmmToMinutes } from "@/lib/utils/time"
import { isOperatedFlight } from "@/lib/utils/entry-type"
import { isUnloggedPast } from "@/lib/utils/logbook-now"
import { journalOf } from "@/lib/briefing/journal"
import type { Briefing } from "@/lib/briefing/types"
import type { DayOff, DaysOffFinding, DaysOffResult } from "@/lib/utils/roster/days-off"
import type { FlightLog } from "@/types/entities/flight.types"

const MIN = 60_000
const H = 60 * MIN
const DAY = 24 * H

/* ── Sun & Night ─────────────────────────────────────────────────────────── */

export interface GeoPoint {
  lat: number
  lon: number
}

export interface LegSunInput {
  id: string
  flight: string
  departMs: number | null
  arriveMs: number | null
  from: GeoPoint | null
  to: GeoPoint | null
}

export interface LegSun {
  id: string
  flight: string
  /** By day or night at the airport, at the moment — null where the position or time is unknown. */
  takeoff: "day" | "night" | null
  landing: "day" | "night" | null
  /** Minutes of the leg flown in the dark along the great circle (civil twilight, as the logbook counts night). */
  nightMinutes: number | null
  blockMinutes: number | null
}

const dayOrNight = (ms: number | null, p: GeoPoint | null): "day" | "night" | null =>
  ms === null || !p ? null : isNight(new Date(ms), p.lat, p.lon) ? "night" : "day"

/** Each leg by day or night: its ends, and the night along it, a sample a minute. */
export function legSun(l: LegSunInput): LegSun {
  const block = l.departMs !== null && l.arriveMs !== null && l.arriveMs > l.departMs ? Math.round((l.arriveMs - l.departMs) / MIN) : null
  let night: number | null = null
  if (block !== null && l.from && l.to) {
    night = 0
    for (let i = 0; i < block; i++) {
      const f = block > 1 ? i / (block - 1) : 0
      const [lat, lon] = interpolateGreatCircle(l.from.lat, l.from.lon, l.to.lat, l.to.lon, f)
      if (isNight(new Date(l.departMs! + i * MIN), lat, lon)) night++
    }
  }
  return {
    id: l.id,
    flight: l.flight,
    takeoff: dayOrNight(l.departMs, l.from),
    landing: dayOrNight(l.arriveMs, l.to),
    nightMinutes: night,
    blockMinutes: block,
  }
}

export interface SunEvent {
  kind: "sunrise" | "sunset"
  atMs: number
}

/**
 * The next sunrises and sunsets at a place after `fromMs` (civil twilight —
 * the night the logbook counts), to the minute: scanned in five-minute steps,
 * each crossing then found to the minute. Within 36 hours, at most `count`.
 */
export function sunEvents(p: GeoPoint, fromMs: number, count = 2): SunEvent[] {
  const out: SunEvent[] = []
  const step = 5 * MIN
  let t = Math.floor(fromMs / MIN) * MIN
  let dark = isNight(new Date(t), p.lat, p.lon)
  const end = t + 36 * H
  while (t < end && out.length < count) {
    const next = t + step
    const d = isNight(new Date(next), p.lat, p.lon)
    if (d !== dark) {
      let at = next
      for (let m = t + MIN; m <= next; m += MIN) {
        if (isNight(new Date(m), p.lat, p.lon) !== dark) {
          at = m
          break
        }
      }
      out.push({ kind: d ? "sunset" : "sunrise", atMs: at })
      dark = d
    }
    t = next
  }
  return out
}

/* ── Days off (para 5) ───────────────────────────────────────────────────── */

/** Singapore's offset — para 5 counts SGT dates (`days-off.ts`). */
const SGT = 8 * H
const sgtDay = (ms: number) => Math.floor((ms + SGT) / DAY)

export interface DaysOffAt {
  /** The day off last before the duty, and the next after it. */
  lastOff: DayOff | null
  nextOff: DayOff | null
  /** Which SGT date of the run since the last day off the duty ends on — para 5(4)(a) allows seven. */
  runDay: number | null
  /** Days off in the 14 and 28 SGT dates ending on the duty's (para 5(4)(b), (c): two and eight). */
  in14: number
  in28: number
  /** Para 5 findings within four weeks either side of the duty. */
  findings: DaysOffFinding[]
}

/**
 * Where a duty — `startMs` to `endMs`, among `duties` (every duty's span, in
 * any order) — sits against para 5, read off the analysis of the timeline.
 */
export function daysOffAt(
  result: DaysOffResult,
  duties: ReadonlyArray<{ startMs: number; endMs: number }>,
  startMs: number,
  endMs: number,
): DaysOffAt {
  const offs = [...result.daysOff].sort((a, b) => a.startMs - b.startMs)
  let lastOff: DayOff | null = null
  let nextOff: DayOff | null = null
  for (const d of offs) {
    if (d.endMs <= startMs) lastOff = d
    else if (d.startMs >= endMs && !nextOff) nextOff = d
  }
  // The run: from the first duty after the last day off to this one's end.
  const since = lastOff?.endMs ?? -Infinity
  const first = duties.filter((d) => d.startMs >= since && d.startMs <= startMs).reduce<number | null>((m, d) => (m === null || d.startMs < m ? d.startMs : m), null)
  const runDay = first !== null && Number.isFinite(since) ? sgtDay(endMs) - sgtDay(first) + 1 : null
  const day = sgtDay(endMs)
  const within = (n: number) => offs.filter((d) => sgtDay(d.endMs - 1) <= day && sgtDay(d.endMs - 1) > day - n).length
  return {
    lastOff,
    nextOff,
    runDay,
    in14: within(14),
    in28: within(28),
    findings: result.findings.filter((f) => Math.abs(f.atMs - startMs) <= 28 * DAY),
  }
}

/* ── Briefing ────────────────────────────────────────────────────────────── */

export interface OfpBrief {
  flight: string
  route: string
  /** "FL350". */
  cruise: string | null
  /** "1:07". */
  tripTime: string
  tripKg: number | null
  blockKg: number | null
  alternate: string
  tow: { planned: number | null; max: number | null }
  /** Take-off weight within 1% of its maximum: worth a look. */
  towTight: boolean
  notams: number
}

/** A leg's OFP in brief (`journalOf`, the figures the briefing page reads). */
export function ofpBrief(b: Briefing): OfpBrief {
  const j = journalOf(b)
  const { planned, max } = j.initB.tow
  return {
    flight: b.flight.number,
    route: `${b.flight.dep}-${b.flight.arr}`,
    cruise: j.initA.crzFl ? `FL${j.initA.crzFl}` : null,
    tripTime: j.flight,
    tripKg: j.initB.trip,
    blockKg: j.initB.block,
    alternate: j.initA.altn,
    tow: { planned, max },
    towTight: planned !== null && max !== null && max > 0 && planned >= max * 0.99,
    notams: b.notams?.items?.filter((n) => !n.duplicate).length ?? 0,
  }
}

/** "3.2t" — kilograms as the MCDU's tonnes, to a tenth. */
export function tonnes(kg: number | null): string {
  return kg === null ? "—" : `${(kg / 1000).toFixed(1)}t`
}

/* ── Logbook ─────────────────────────────────────────────────────────────── */

export interface LogbookMonth {
  /** "2026-11". */
  month: string
  blockMinutes: number
  nightMinutes: number
  sectors: number
  landings: number
  /** Sectors in the month still ahead. */
  rostered: number
  /** Past sectors with no times, the last 90 days — the oldest first. */
  unlogged: Array<{ id: string; flight: string; date: string }>
}

/** The month of `atMs` (UTC) in the logbook, and what is still to log (`todayUtc`, "YYYY-MM-DD"). */
export function logbookMonth(flights: readonly FlightLog[], atMs: number, todayUtc: string): LogbookMonth {
  const month = new Date(atMs).toISOString().slice(0, 7)
  const out: LogbookMonth = { month, blockMinutes: 0, nightMinutes: 0, sectors: 0, landings: 0, rostered: 0, unlogged: [] }
  const from = new Date(Date.parse(`${todayUtc}T00:00:00Z`) - 90 * DAY).toISOString().slice(0, 10)
  for (const f of flights) {
    if (!f.date || f.deletedAt) continue
    if (f.date >= from && isUnloggedPast(f, todayUtc)) out.unlogged.push({ id: f.id, flight: f.flightNumber || "", date: f.date })
    if (!f.date.startsWith(month) || !isOperatedFlight(f)) continue
    if (f.outTime && f.inTime) {
      out.sectors++
      out.blockMinutes += hhmmToMinutes(f.blockTime || "0:00")
      out.nightMinutes += hhmmToMinutes(f.nightTime || "0:00")
      out.landings += (f.dayLandings || 0) + (f.nightLandings || 0)
    } else if (f.date >= todayUtc) out.rostered++
  }
  out.unlogged.sort((a, b) => a.date.localeCompare(b.date))
  return out
}
