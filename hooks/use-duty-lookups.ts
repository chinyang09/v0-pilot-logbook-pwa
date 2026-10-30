"use client"

/**
 * The gates of every leg of one duty, and where the aeroplane for its FIRST
 * leg is — the two things a pilot wants on the way in — in ONE cached answer
 * that the dashboard's duty band and the duty panel share.
 *
 * `auto` asks by itself (the band, while the duty is close enough for either
 * to be published: from 18 hours before its report to while it runs), and
 * again every quarter hour while it stays on screen; otherwise only `refresh`
 * asks. Nothing is stored: a gate is published late
 * and moves, and the aeroplane moves by the minute, so the answer lives in
 * SWR's memory only (`lookup:` keys, which a sync refresh does not touch) and
 * `refresh` reads it again.
 */

import { useCallback, useMemo } from "react"
import useSWR from "swr"
import { useFlights } from "@/hooks/data"
import { lookup } from "@/lib/lookup/client"
import { normalizeFlightNumber, type FlightGates } from "@/lib/lookup/flight-suggest"
import type { AircraftWhereabouts } from "@/lib/lookup/aircraft-whereabouts"
import { dutyFlights, legDepartureIso } from "@/lib/utils/dashboard/duty-flights"
import { normalizeRegistration } from "@/lib/utils/string"
import type { FlightLog } from "@/types/entities/flight.types"

export type GateState = { status: "done"; gates: FlightGates } | { status: "missing" } | { status: "failed" }
export type WhereaboutsState =
  | { status: "done"; whereabouts: AircraftWhereabouts; checkedAt: number }
  | { status: "missing" }
  | { status: "failed" }

export interface DutyLookups {
  /** By flight id; a leg with no flight number is absent. */
  gates: Record<string, GateState>
  /** The first leg's aeroplane before that leg departs, or null with no registration. */
  inbound: WhereaboutsState | null
  inboundRegistration: string
}

const NO_FLIGHTS: FlightLog[] = []

async function fetchDutyLookups(legs: FlightLog[]): Promise<DutyLookups> {
  const first = legs.find((f) => f.aircraftReg) ?? null
  const [gateAnswers, inbound] = await Promise.all([
    Promise.all(
      legs.map(async (f): Promise<[string, GateState] | null> => {
        if (normalizeFlightNumber(f.flightNumber || "").length < 3 || !f.date) return null
        const answer = await lookup.flightGates(f.flightNumber, f.date, f.scheduledOut || undefined)
        return [f.id, answer.ok ? { status: "done", gates: answer.data } : { status: answer.status === 404 ? "missing" : "failed" }]
      })
    ),
    (async (): Promise<WhereaboutsState | null> => {
      if (!first) return null
      const answer = await lookup.aircraftWhereabouts(first.aircraftReg, legDepartureIso(first) ?? undefined)
      if (answer.ok) return { status: "done", whereabouts: answer.data, checkedAt: Date.now() }
      return { status: answer.status === 404 ? "missing" : "failed" }
    })(),
  ])
  return {
    gates: Object.fromEntries(gateAnswers.filter((e): e is [string, GateState] => !!e)),
    inbound,
    inboundRegistration: first?.aircraftReg ?? "",
  }
}

export function useDutyLookups(atMs: number | null, opts: { auto: boolean }) {
  const { flights } = useFlights()
  const legs = useMemo(() => (atMs === null ? NO_FLIGHTS : dutyFlights(flights ?? NO_FLIGHTS, atMs)), [flights, atMs])
  // The key names what is asked, so a leg renumbered or re-tailed asks again.
  const key =
    legs.length > 0
      ? `lookup:duty:${legs
          .map((f) => `${normalizeFlightNumber(f.flightNumber || "")}|${f.date}|${f.scheduledOut || ""}|${normalizeRegistration(f.aircraftReg || "")}`)
          .join(",")}`
      : null
  const { data, isValidating, mutate } = useSWR(key, () => fetchDutyLookups(legs), {
    revalidateOnMount: opts.auto,
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60_000,
    // A gate is published late: ask again every quarter hour while on screen.
    refreshInterval: opts.auto ? 15 * 60_000 : 0,
  })
  const refresh = useCallback(() => void mutate(), [mutate])
  return {
    legs,
    lookups: data ?? null,
    loading: isValidating,
    refresh,
  }
}
