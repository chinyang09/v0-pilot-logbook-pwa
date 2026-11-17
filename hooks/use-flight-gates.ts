/**
 * How a flight's gates read: "D41 · T1 → 12 · Belt 5". The gates themselves
 * are asked by `useDutyLookups` — a gate is published late and moves, so it is
 * never stored.
 */

import type { GateState } from "@/hooks/use-duty-lookups"

/**
 * "D41 · T1" — a gate and its terminal, as far as either is known, and the
 * STAND where the airport gives one that is not the gate itself (a remote
 * stand: "B4 · T1 · Stand 512"). A contact stand named like its gate is the
 * gate said twice.
 */
export function gateLabel(gate: string, terminal: string, stand = ""): string {
  return [gate, terminal && `T${terminal.replace(/^T/i, "")}`, stand && stand !== gate && `Stand ${stand}`]
    .filter(Boolean)
    .join(" · ")
}

/** A gates answer as a row's value, or what stands in for it. `null` until asked. */
export function gatesValue(state: GateState | null | undefined): { primary: string; secondary?: string } | null {
  if (!state) return null
  if (state.status === "missing") return { primary: "No such flight that day" }
  if (state.status === "failed") return { primary: "Unavailable · tap to retry" }
  const { departure, arrival, inboundFlight, onwardFlight } = state.gates
  const dep = gateLabel(departure.gate, departure.terminal, departure.stand)
  const arr = gateLabel(arrival.gate, arrival.terminal, arrival.stand)
  if (!dep && !arr) return { primary: "Not published yet" }
  const belt = arrival.baggage ? ` · Belt ${arrival.baggage}` : ""
  return {
    primary: `${dep || "–"} → ${arr || "–"}${belt}`,
    // The rotation, where the airport names it: the flight this aeroplane
    // comes in on, or the one it goes on to.
    secondary: [
      `${departure.airport} → ${arrival.airport}`,
      inboundFlight && `Inbound ${inboundFlight}`,
      onwardFlight && `On to ${onwardFlight}`,
    ]
      .filter(Boolean)
      .join(" · "),
  }
}

