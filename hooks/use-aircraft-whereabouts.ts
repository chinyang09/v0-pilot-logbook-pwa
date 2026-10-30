"use client"

/**
 * Where an aeroplane is before a flight, checked when the pilot asks
 * (`check`) — never on open, and never stored: it is a moving picture. The
 * answer belongs to the registration and time it was asked for, reads as
 * unasked once either changes, and keeps the instant it landed so "30m ago"
 * is said relative to the check, not to a clock read during render.
 */

import { useCallback, useState } from "react"
import { lookup } from "@/lib/lookup/client"
import { whereaboutsLines, type AircraftWhereabouts } from "@/lib/lookup/aircraft-whereabouts"
import type { Fr24Result } from "@/lib/fr24/types"
import { normalizeRegistration } from "@/lib/utils/string"

/** A whereabouts answer as it is shown: found, nothing found (404), or not asked (anything else). */
export type WhereaboutsAnswer =
  | { status: "done"; whereabouts: AircraftWhereabouts; checkedAt: number }
  | { status: "missing" }
  | { status: "failed" }

export type WhereaboutsState = { status: "loading" } | WhereaboutsAnswer

/** The answer kept with the instant it landed, so "30m ago" is said relative to the check. */
export function whereaboutsAnswer(answer: Fr24Result<AircraftWhereabouts>): WhereaboutsAnswer {
  if (answer.ok) return { status: "done", whereabouts: answer.data, checkedAt: Date.now() }
  return { status: answer.status === 404 ? "missing" : "failed" }
}

export function useAircraftWhereabouts(registration: string | undefined, atIso?: string | null) {
  const key = `${normalizeRegistration(registration || "")}|${atIso || ""}`
  const [state, setState] = useState<{ key: string; value: WhereaboutsState } | null>(null)

  const check = useCallback(async () => {
    if (!registration || normalizeRegistration(registration).length < 3) return
    setState({ key, value: { status: "loading" } })
    const value = whereaboutsAnswer(await lookup.aircraftWhereabouts(registration, atIso || undefined))
    setState((prev) => (prev?.key !== key ? prev : { key, value }))
  }, [key, registration, atIso])

  return { state: state?.key === key ? state.value : null, check }
}

/** A whereabouts check as a row's value. `null` until checked. */
export function whereaboutsValue(
  state: WhereaboutsState | null | undefined,
  clockSeparator: "colon" | "none" = "colon",
  opts: { gate?: boolean } = {}
): { primary: string; secondary?: string } | null {
  if (!state || state.status === "loading") return null
  if (state.status === "missing") return { primary: "No recent flights found" }
  if (state.status === "failed") return { primary: "Unavailable · tap to retry" }
  return whereaboutsLines(state.whereabouts, state.checkedAt, clockSeparator, opts) ?? { primary: "No earlier flight found" }
}
