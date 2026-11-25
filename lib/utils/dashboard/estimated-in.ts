/**
 * Where the duty is ACTUALLY heading — its estimated last on-blocks, from what
 * the logbook has recorded and what the sources say now (the owner, Nov 2026:
 * "have a line of estimated IN. That would be more reactive").
 *
 * Each leg, in the order flown, takes the best answer for each end:
 *
 * | | OUT | IN |
 * |---|---|---|
 * | 1 | the logbook's OUT (the pilot stamped it) | the logbook's IN |
 * | 2 | the source's actual departure | the source's actual arrival |
 * | 3 | the source's estimated departure | the source's estimated arrival (after the OUT) |
 * | 4 | the schedule, moved by the delay the leg before brings (a turnaround is not shortened) — or by the INBOUND aeroplane's arrival plus a turnaround (`MIN_TURN_MIN`), whichever is later | the OUT + the planned block |
 *
 * The source is the airport's own record for a Singapore end, the tracker
 * elsewhere (`FlightGates.times`). Pure, so it is tested (`estimated-in.test.ts`).
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { FlightTimesLive } from "@/lib/lookup/flight-suggest"
import { flightInstantMs } from "@/lib/airports/code-changes"
import { scheduledInMs, scheduledOutMs } from "@/lib/utils/flight-day"

const isClock = (t?: string | null) => !!t && /^\d{1,2}:\d{2}$/.test(t)
const MIN = 60_000
const isoMs = (iso: string | null | undefined) => {
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? ms : null
}

/**
 * The shortest turnaround assumed for a late inbound aeroplane — a rough
 * figure for a narrowbody on a quick turn, used ONLY to say "it cannot leave
 * before this", never to plan by.
 */
export const MIN_TURN_MIN = 30

export type EstimateKind = "actual" | "estimated" | "scheduled"

export interface LegEstimate {
  outMs: number | null
  outKind: EstimateKind
  inMs: number | null
  inKind: EstimateKind
  /** Minutes late at the IN against the schedule (negative early); null without a scheduled IN. */
  delayMin: number | null
}

export interface DutyInEstimate {
  /** The last leg's estimated on-blocks, ms. */
  ms: number
  /** Recorded, said by a source (or carried from one), or no more than the schedule. */
  kind: EstimateKind
  /** Minutes late against the last leg's scheduled IN; null without a schedule. */
  delayMin: number | null
  legs: LegEstimate[]
}

/**
 * Each leg's estimated OUT and IN, and the duty's last IN. `live` is by
 * flight id (a leg the sources do not know is absent). Null when no leg has a
 * time at all.
 */
export function estimateDutyIn(
  legs: readonly FlightLog[],
  live: Readonly<Record<string, FlightTimesLive | null | undefined>>,
  /** The aeroplane coming in for a leg not yet flown: its arrival, ms. */
  inbound: { legId: string; arrivalMs: number } | null = null,
): DutyInEstimate | null {
  const out: LegEstimate[] = []
  // The delay the previous leg hands on: its IN past its schedule.
  let carried = 0
  let carriedKind: EstimateKind = "scheduled"
  for (const f of legs) {
    const t = live[f.id] ?? null
    // The schedule against the OUT the flight is dated by: a red-eye off
    // blocks after midnight was scheduled the evening before its date.
    const schedOut = scheduledOutMs(f)
    const schedIn = scheduledInMs(f)
    const planned = schedOut !== null && schedIn !== null ? schedIn - schedOut : null

    let outMs: number | null = null
    let outKind: EstimateKind = "scheduled"
    if (isClock(f.outTime)) {
      outMs = flightInstantMs(f.date, f.outTime)
      outKind = "actual"
    } else if (isoMs(t?.actualDeparture) !== null) {
      outMs = isoMs(t?.actualDeparture)
      outKind = "actual"
    } else if (isoMs(t?.estimatedDeparture) !== null) {
      outMs = isoMs(t?.estimatedDeparture)
      outKind = "estimated"
    } else if (schedOut !== null) {
      // A late aeroplane cannot leave before it has turned round — whether it
      // is ours from the leg before, or the inbound landing from elsewhere.
      outMs = schedOut + Math.max(0, carried)
      outKind = carried > 0 ? carriedKind : "scheduled"
      const turned = inbound?.legId === f.id ? inbound.arrivalMs + MIN_TURN_MIN * MIN : null
      if (turned !== null && turned > outMs) {
        outMs = turned
        outKind = "estimated"
      }
    }

    let inMs: number | null = null
    let inKind: EstimateKind = "scheduled"
    const estIn = isoMs(t?.estimatedArrival)
    if (isClock(f.inTime)) {
      inMs = flightInstantMs(f.date, f.inTime, f.outTime || f.scheduledOut || null)
      inKind = "actual"
    } else if (isoMs(t?.actualArrival) !== null) {
      inMs = isoMs(t?.actualArrival)
      inKind = "actual"
    } else if (estIn !== null && (outMs === null || estIn > outMs)) {
      inMs = estIn
      inKind = "estimated"
    } else if (outMs !== null && planned !== null) {
      inMs = outMs + planned
      inKind = outKind === "actual" ? "estimated" : outKind
    } else if (schedIn !== null) {
      inMs = schedIn
    }

    const delayMin = inMs !== null && schedIn !== null ? Math.round((inMs - schedIn) / MIN) : null
    out.push({ outMs, outKind, inMs, inKind, delayMin })
    if (delayMin !== null) {
      carried = delayMin * MIN
      carriedKind = inKind === "scheduled" ? "scheduled" : "estimated"
    }
  }
  const last = out[out.length - 1]
  if (!last || last.inMs === null) return null
  return { ms: last.inMs, kind: last.inKind, delayMin: last.delayMin, legs: out }
}
