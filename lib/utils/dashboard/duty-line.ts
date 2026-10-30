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
   * One line: the next leg's aeroplane ("9V-NCA · Landed 03:00Z · 30m ago ·
   * Gate D41 T1 · TR289 from DPS"), or what stands in for it — never a
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
    const lines = whereaboutsLines(w.whereabouts, w.checkedAt, display?.clockSeparator)
    return lines ? [reg, lines.primary, lines.secondary].filter(Boolean).join(" · ") : `${reg} · no earlier flight found`
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

