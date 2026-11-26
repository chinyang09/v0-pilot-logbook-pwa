/**
 * What the duty band shows under its sector chain: each leg's gates (drawn
 * under the stops) and ONE line — the next leg's aeroplane, or what stands in
 * for it. Pure, so the wording is tested: a failure must never read as "not
 * published yet", nor a question not yet asked as an answer.
 */

import { whereaboutsLines } from "@/lib/lookup/aircraft-whereabouts"
import type { DutyLookups } from "@/hooks/use-duty-lookups"
import type { DisplayPreferences } from "@/types/db/stores.types"
import type { FlightLog } from "@/types/entities/flight.types"
import { scheduledInMs, scheduledOutMs } from "@/lib/utils/flight-day"
import { normalizeRegistration } from "@/lib/utils/string"

/** What the duty band shows under the chain, from the duty's lookups. */
export interface DutyInfo {
  /**
   * Each leg's departure and arrival gate, in leg order ("" until published);
   * a gate taken across a short turn (`acrossTurns`) names the flight it is
   * that flight's gate (`depFrom` / `arrFrom`).
   */
  legGates: LegGates[]
  /**
   * One line: the next leg's aeroplane ("9V-NCA · TR289 from DPS · Gate D41 T1
   * · STD 00:10Z · Landed 03:00Z · 30m ago"), or what stands in for it — never a
   * "not published" that was really a failure or a question not yet asked.
   */
  line: string
  loading: boolean
  onRefresh: () => void
}

export interface LegGates {
  dep: string
  arr: string
  /** The departure gate is the leg before's ARRIVAL gate — this flight number arrives there. */
  depFrom?: string
  /** The arrival gate is the leg after's DEPARTURE gate — this flight number leaves from it. */
  arrFrom?: string
}

/** A turn short enough that the aeroplane stays on its stand: up to this long on the ground. */
export const SAME_STAND_TURN_MIN = 180

/**
 * The gates across each short TURN (the owner, Nov 2026: "If 698 goes into
 * 699 and 699 is B14 we can safely assume that 698 will go into B14 … having
 * B14 is better than no bay"). Where a leg arrives where the next one leaves,
 * on the same aeroplane (or one not yet named), and the scheduled turn is
 * at most `SAME_STAND_TURN_MIN`, an arrival gate not yet published is the
 * next leg's departure gate, and a departure gate not yet published the
 * leg before's arrival gate — marked with the flight it was taken from, never
 * stated as published.
 */
export function acrossTurns(legs: FlightLog[], gates: LegGates[]): LegGates[] {
  const out = gates.map((g) => ({ ...g }))
  for (let i = 0; i + 1 < legs.length; i++) {
    const a = legs[i]
    const b = legs[i + 1]
    if (!a.arrivalIcao || a.arrivalIcao !== b.departureIcao) continue
    const ra = normalizeRegistration(a.aircraftReg || "")
    const rb = normalizeRegistration(b.aircraftReg || "")
    if (ra && rb && ra !== rb) continue
    const inMs = scheduledInMs(a)
    const outMs = scheduledOutMs(b)
    if (inMs === null || outMs === null) continue
    const turn = (outMs - inMs) / 60_000
    if (turn < 0 || turn > SAME_STAND_TURN_MIN) continue
    if (!out[i].arr && gates[i + 1]?.dep) {
      out[i].arr = gates[i + 1].dep
      out[i].arrFrom = b.flightNumber || "the next leg"
    }
    if (!out[i + 1].dep && gates[i]?.arr) {
      out[i + 1].dep = gates[i].arr
      out[i + 1].depFrom = a.flightNumber || "the leg before"
    }
  }
  return out
}

export function describeDuty(
  legs: FlightLog[],
  lookups: DutyLookups | null,
  loading: boolean,
  onRefresh: () => void,
  display?: DisplayPreferences,
): DutyInfo {
  const legGates = acrossTurns(
    legs,
    legs.map((f) => {
      const g = lookups?.gates[f.id]
      return g?.status === "done" ? { dep: g.gates.departure.gate, arr: g.gates.arrival.gate } : { dep: "", arr: "" }
    }),
  )
  return { legGates, line: dutyLine(legs, lookups, loading, display), loading, onRefresh }
}

function dutyLine(legs: FlightLog[], lookups: DutyLookups | null, loading: boolean, display?: DisplayPreferences): string {
  if (!lookups) return loading ? "Checking gates and aircraft…" : "Gates and aircraft not checked yet"
  const reg = lookups.inboundRegistration
  const w = lookups.inbound
  if (w?.status === "done") {
    // The gate is already drawn under the stop the leg leaves from; saying it
    // again here is the same fact twice. Only while that gate is not
    // published yet does the inbound's arrival gate stand in for it.
    const leg = lookups.inboundFlightId ? lookups.gates[lookups.inboundFlightId] : undefined
    const gateShown = leg?.status === "done" && !!leg.gates.departure.gate
    const lines = whereaboutsLines(w.whereabouts, w.checkedAt, display?.clockSeparator, { gate: !gateShown })
    // The flight first, with its own gate and STD beside it, then what it is
    // doing — a gate said apart from its flight was the owner's question.
    return lines
      ? [reg, lines.flight, lines.gate, lines.std, lines.primary].filter(Boolean).join(" · ")
      : `${reg} · no earlier flight found`
  }
  if (w?.status === "missing") return `${reg} · no recent flights found`
  const gates = legs.map((f) => lookups.gates[f.id]).filter(Boolean)
  const failed = w?.status === "failed" || (gates.length > 0 && gates.every((g) => g.status === "failed"))
  if (failed) return "Gates and aircraft unavailable · refresh to try again"
  const published = gates.some(
    (g) => g.status === "done" && (g.gates.departure.gate || g.gates.arrival.gate),
  )
  return published ? "Gates on the route above" : "Gates not published yet"
}


