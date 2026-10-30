"use client"

/**
 * A flight's gates, checked when the pilot asks (`check`) — never on open,
 * and never stored: a gate is published late and changes, so it is read
 * fresh each time. An answer belongs to the flight number and date it was
 * asked for, and reads as unasked once either changes.
 */

import { useCallback, useState } from "react"
import { lookup } from "@/lib/lookup/client"
import { normalizeFlightNumber, type FlightGates } from "@/lib/lookup/flight-suggest"

type GateState =
  | { status: "loading" }
  | { status: "done"; gates: FlightGates }
  | { status: "missing" }
  | { status: "failed" }

export function useFlightGates(flightNumber: string | undefined, date: string | undefined, scheduledOut?: string) {
  const key = `${normalizeFlightNumber(flightNumber || "")}|${date || ""}`
  const [state, setState] = useState<{ key: string; value: GateState } | null>(null)

  const check = useCallback(async () => {
    const [number, day] = key.split("|")
    if (number.length < 3 || !day) return
    setState({ key, value: { status: "loading" } })
    const answer = await lookup.flightGates(number, day, scheduledOut || undefined)
    setState((prev) =>
      prev?.key !== key
        ? prev
        : {
            key,
            value: answer.ok ? { status: "done", gates: answer.data } : answer.status === 404 ? { status: "missing" } : { status: "failed" },
          }
    )
  }, [key, scheduledOut])

  return { state: state?.key === key ? state.value : null, check }
}

/** "D41 · T1" — a gate and its terminal, as far as either is known. */
export function gateLabel(gate: string, terminal: string): string {
  return [gate, terminal && `T${terminal.replace(/^T/i, "")}`].filter(Boolean).join(" · ")
}

/**
 * A gates check as a row's value: "D41 · T1 → 12 · Belt 5", or what stands
 * in for it. `null` until checked.
 */
export function gatesValue(
  state: ReturnType<typeof useFlightGates>["state"]
): { primary: string; secondary?: string } | null {
  if (!state || state.status === "loading") return null
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
