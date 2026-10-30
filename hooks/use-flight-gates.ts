/**
 * How a flight's gates read: "D41 · T1 → 12 · Belt 5". The gates themselves
 * are asked by `useDutyLookups` — a gate is published late and moves, so it is
 * never stored.
 */

import type { GateState } from "@/hooks/use-duty-lookups"

/** "D41 · T1" — a gate and its terminal, as far as either is known. */
export function gateLabel(gate: string, terminal: string): string {
  return [gate, terminal && `T${terminal.replace(/^T/i, "")}`].filter(Boolean).join(" · ")
}

/** A gates answer as a row's value, or what stands in for it. `null` until asked. */
export function gatesValue(state: GateState | null | undefined): { primary: string; secondary?: string } | null {
  if (!state) return null
  if (state.status === "missing") return { primary: "No such flight that day" }
  if (state.status === "failed") return { primary: "Unavailable · tap to retry" }
  const dep = gateLabel(state.gates.departure.gate, state.gates.departure.terminal)
  const arr = gateLabel(state.gates.arrival.gate, state.gates.arrival.terminal)
  if (!dep && !arr) return { primary: "Not published yet" }
  const belt = state.gates.arrival.baggage ? ` · Belt ${state.gates.arrival.baggage}` : ""
  return {
    primary: `${dep || "–"} → ${arr || "–"}${belt}`,
    secondary: `${state.gates.departure.airport} → ${state.gates.arrival.airport}`,
  }
}
