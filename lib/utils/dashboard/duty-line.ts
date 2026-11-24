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

/** What the duty band shows under the chain, from the duty's lookups. */
export interface DutyInfo {
  /** Each leg's departure and arrival gate, in leg order ("" until published). */
  legGates: { dep: string; arr: string }[]
  /**
   * One line: the next leg's aeroplane ("9V-NCA · TR289 from DPS · Gate D41 T1
   * · STD 00:10Z · Landed 03:00Z · 30m ago"), or what stands in for it — never a
   * "not published" that was really a failure or a question not yet asked.
   */
  line: string
  loading: boolean
  onRefresh: () => void
}

export function describeDuty(
  legs: FlightLog[],
  lookups: DutyLookups | null,
  loading: boolean,
  onRefresh: () => void,
  display?: DisplayPreferences,
): DutyInfo {
  const legGates = legs.map((f) => {
    const g = lookups?.gates[f.id]
    return g?.status === "done" ? { dep: g.gates.departure.gate, arr: g.gates.arrival.gate } : { dep: "", arr: "" }
  })
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


