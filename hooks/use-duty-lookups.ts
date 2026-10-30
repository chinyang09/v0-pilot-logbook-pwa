"use client"

/**
 * The gates of every leg of one duty, and where the aeroplane for its FIRST
 * leg is — the two things a pilot wants on the way in — in ONE cached answer
 * that the dashboard's duty band and the duty panel share.
 *
 * It asks only while `active` (the band: on screen, and the duty close
 * enough for either to be published — from 18 hours before its report to
 * while it runs): on arriving, deduplicated to once in five minutes, again
 * every quarter hour while it stays up, and on `refresh`. A hidden page asks
 * nothing, and coming back to it asks about the duty as it now stands rather
 * than showing a stale "nothing yet".
 *
 * The aeroplane asked after is the next leg still to fly (`inboundLeg`) — on
 * duty, a later leg can be another tail. Nothing is stored: a gate is published late
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
import { dutyFlights, inboundLeg, legDepartureIso } from "@/lib/utils/dashboard/duty-flights"
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
  /** The aeroplane before `inboundFlightId` departs, or null when no leg names one. */
  inbound: WhereaboutsState | null
  inboundRegistration: string
  inboundFlightId: string | null
}

const NO_FLIGHTS: FlightLog[] = []

async function fetchDutyLookups(legs: FlightLog[]): Promise<DutyLookups> {
  const first = inboundLeg(legs)
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
    inboundFlightId: first?.id ?? null,
  }
}

export function useDutyLookups(atMs: number | null, opts: { active: boolean }) {
  const { flights } = useFlights()
  const legs = useMemo(() => (atMs === null ? NO_FLIGHTS : dutyFlights(flights ?? NO_FLIGHTS, atMs)), [flights, atMs])
  // The key names what is asked, so a leg renumbered, re-tailed or pushed
  // back (the inbound moves to the next leg) asks again. No key while
  // inactive: a hidden page asks nothing.
  const key =
    opts.active && legs.length > 0
      ? `lookup:duty:${legs
          .map(
            (f) =>
              `${normalizeFlightNumber(f.flightNumber || "")}|${f.date}|${f.scheduledOut || ""}|${normalizeRegistration(f.aircraftReg || "")}|${f.outTime ? "off" : ""}`
          )
          .join(",")}`
      : null
  const { data, isValidating, mutate } = useSWR(key, () => fetchDutyLookups(legs), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60_000,
    // A gate is published late: ask again every quarter hour while on screen.
    refreshInterval: 15 * 60_000,
  })
  const refresh = useCallback(() => void mutate(), [mutate])
  return {
    legs,
    lookups: data ?? null,
    loading: isValidating,
    refresh,
  }
}
