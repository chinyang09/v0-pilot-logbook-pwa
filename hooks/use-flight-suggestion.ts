"use client"

/**
 * The flight a flight number and a date name (`lookup.flightSuggest`), asked
 * once the pair has settled for 700ms. `enabled` is the caller's say-so — the
 * flight form enables it only once the pilot has CHANGED the number or the
 * date, so opening a flight never spends a lookup.
 *
 * A `scheduled` answer is handed to `onScheduled` as it lands (from the
 * request's own callback, not an effect), which is where the form fills its
 * blanks. A `usual` one is only returned, for the form to offer.
 */

import { useEffect, useRef, useState } from "react"
import { lookup } from "@/lib/lookup/client"
import { normalizeFlightNumber, type FlightSuggestion } from "@/lib/lookup/flight-suggest"

const SETTLE_MS = 700

export function useFlightSuggestion(
  flightNumber: string | undefined,
  date: string | undefined,
  enabled: boolean,
  onScheduled?: (suggestion: FlightSuggestion) => void
) {
  const number = normalizeFlightNumber(flightNumber || "")
  const key = enabled && number.length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? `${number}|${date}` : null
  const [result, setResult] = useState<{ key: string; suggestion: FlightSuggestion | null; failed: boolean } | null>(null)

  const onScheduledRef = useRef(onScheduled)
  useEffect(() => {
    onScheduledRef.current = onScheduled
  })

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      const [n, d] = key.split("|")
      const answer = await lookup.flightSuggest(n, d, undefined, controller.signal)
      if (controller.signal.aborted) return
      const suggestion = answer.ok ? answer.data : null
      setResult({ key, suggestion, failed: !answer.ok && answer.status !== 404 })
      if (suggestion?.basis === "scheduled") onScheduledRef.current?.(suggestion)
    }, SETTLE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  const current = key && result?.key === key ? result : null
  return {
    suggestion: current?.suggestion ?? null,
    loading: !!key && !current,
    failed: current?.failed ?? false,
  }
}
