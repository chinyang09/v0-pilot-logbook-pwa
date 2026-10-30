"use client"

/**
 * The flight a flight number and a date name (`lookup.flightSuggest`), asked
 * ONLY when the pilot asks — the flight form's Lookup button (or Enter in the
 * flight number). It used to ask by itself once the pair settled, which spent
 * a lookup per pause while a number was being typed.
 *
 * The answer is handed to `onAnswer` from the request's own callback (not an
 * effect), which is where the form writes its patch. A newer request
 * supersedes an older one still in flight.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { lookup } from "@/lib/lookup/client"
import { normalizeFlightNumber, type FlightSuggestion } from "@/lib/lookup/flight-suggest"

export type FlightLookupState =
  | { status: "loading"; number: string; date: string }
  | { status: "found"; number: string; date: string; suggestion: FlightSuggestion }
  | { status: "missing"; number: string; date: string }
  | { status: "failed"; number: string; date: string }

/** Whether a number and a date are complete enough to ask about. */
export function canLookUp(number: string | undefined, date: string | undefined): boolean {
  return normalizeFlightNumber(number || "").length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(date || "")
}

export function useFlightLookup(onAnswer: (suggestion: FlightSuggestion) => void) {
  const [state, setState] = useState<FlightLookupState | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const onAnswerRef = useRef(onAnswer)
  useEffect(() => {
    onAnswerRef.current = onAnswer
  })
  useEffect(() => () => controllerRef.current?.abort(), [])

  const run = useCallback(async (flightNumber: string, date: string, out?: string) => {
    if (!canLookUp(flightNumber, date)) return
    const number = normalizeFlightNumber(flightNumber)
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: "loading", number, date })
    const answer = await lookup.flightSuggest(number, date, out || undefined, controller.signal)
    if (controller.signal.aborted) return
    if (answer.ok) {
      setState({ status: "found", number, date, suggestion: answer.data })
      onAnswerRef.current(answer.data)
    } else {
      setState({ status: answer.status === 404 ? "missing" : "failed", number, date })
    }
  }, [])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    setState(null)
  }, [])

  return { state, run, reset }
}
