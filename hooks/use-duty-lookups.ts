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
import { whereaboutsAnswer, type WhereaboutsAnswer } from "@/hooks/use-aircraft-whereabouts"
import { dutyFlights, inboundLeg, legArrivalIso, legDepartureIso, outboundOf } from "@/lib/utils/dashboard/duty-flights"
import { normalizeRegistration } from "@/lib/utils/string"
import type { FlightLog } from "@/types/entities/flight.types"

export type GateState = { status: "done"; gates: FlightGates } | { status: "missing" } | { status: "failed" }
export interface DutyLookups {
  /** By flight id; a leg with no flight number is absent. */
  gates: Record<string, GateState>
  /** The aeroplane before `inboundFlightId` departs, or null when no leg names one. */
  inbound: WhereaboutsAnswer | null
  inboundRegistration: string
  inboundFlightId: string | null
  /**
   * Where the aeroplane goes after the duty's LAST leg — its `next` is the
   * flight that takes it over (the owner: to init the MCDU for that crew and
   * to know when they report at the aircraft, its STD less an hour, which
   * decides whether to secure it).
   */
  onward: WhereaboutsAnswer | null
  /**
   * The aeroplane a leg the logbook has no registration for is flying, found
   * through a CONNECTING flight (the owner, Nov 2026: "we already know the
   * connecting flight TR537, we can do a lookup on TR537 aircraft in use"):
   * the flight that brings it in or takes it on, as the airport's rotation
   * names them, asked for its registration on the day. By flight id.
   */
  viaConnection?: Record<string, { registration: string; via: string }>
}

const NO_FLIGHTS: FlightLog[] = []

async function fetchDutyLookups(legs: FlightLog[]): Promise<DutyLookups> {
  // 1. Every leg's gates — whose flight carries the registration assigned to
  //    it on the day, where a source has it.
  const gateAnswers = await Promise.all(
    legs.map(async (f): Promise<[string, GateState] | null> => {
      if (normalizeFlightNumber(f.flightNumber || "").length < 3 || !f.date) return null
      const answer = await lookup.flightGates(f.flightNumber, f.date, f.scheduledOut || undefined)
      return [f.id, answer.ok ? { status: "done", gates: answer.data } : { status: answer.status === 404 ? "missing" : "failed" }]
    }),
  )
  const gates: Record<string, GateState> = Object.fromEntries(gateAnswers.filter((e): e is [string, GateState] => !!e))
  const known = (f: FlightLog) => {
    const g = gates[f.id]
    return f.aircraftReg || (g?.status === "done" ? g.gates.flight.registration : "") || ""
  }

  // 2. A leg still without one: the flights its aeroplane connects with — the
  //    one bringing it in and the one taking it on, as the airport's rotation
  //    names them — asked for THEIR registration (the same aeroplane).
  const viaConnection: Record<string, { registration: string; via: string }> = {}
  await Promise.all(
    legs.map(async (f) => {
      if (known(f)) return
      const g = gates[f.id]
      if (g?.status !== "done") return
      const ours = normalizeFlightNumber(f.flightNumber || "")
      // The inbound flies the same day or the day before; the onward the same day or the next.
      // And a step further back (the owner: "we can even do a further
      // traceback"): an inbound RETURN (an odd number, TR537) is flown by the
      // aeroplane of its OUTBOUND (TR536), assigned earlier.
      const candidates = [
        { number: g.gates.inboundFlight, dates: [f.date, shiftDay(f.date, -1)] },
        { number: outboundOf(g.gates.inboundFlight), dates: [f.date, shiftDay(f.date, -1)] },
        { number: g.gates.onwardFlight, dates: [f.date, shiftDay(f.date, 1)] },
      ].filter((c): c is { number: string; dates: string[] } => !!c.number && normalizeFlightNumber(c.number) !== ours)
      for (const { number, dates } of candidates) {
        for (const date of dates) {
          const answer = await lookup.flightSuggest(number, date)
          const reg = answer.ok && answer.data.basis === "scheduled" ? answer.data.registration : ""
          if (reg) {
            viaConnection[f.id] = { registration: reg, via: number }
            return
          }
        }
      }
    }),
  )
  const regOf = (f: FlightLog | null | undefined) => (f ? known(f) || viaConnection[f.id]?.registration || "" : "")

  // 3. Where the aeroplane is: before the next leg still to fly, and after the last.
  const first = inboundLeg(legs, regOf)
  const last = legs[legs.length - 1]
  const firstReg = regOf(first)
  const lastReg = regOf(last) || firstReg
  const lastArrives = last ? legArrivalIso(last) : null
  const [inbound, onward] = await Promise.all([
    first && firstReg ? lookup.aircraftWhereabouts(firstReg, legDepartureIso(first) ?? undefined).then(whereaboutsAnswer) : null,
    // At the last leg's arrival the flight it last departed on is ours; the one after is the onward.
    lastReg && lastArrives ? lookup.aircraftWhereabouts(lastReg, lastArrives).then(whereaboutsAnswer) : null,
  ])
  return {
    gates,
    inbound,
    inboundRegistration: firstReg,
    inboundFlightId: first?.id ?? null,
    onward,
    viaConnection,
  }
}

const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export function useDutyLookups(atMs: number | null, opts: { active: boolean; fast?: boolean }) {
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
    dedupingInterval: (opts.fast ? 2 : 5) * 60_000,
    // A gate is published late: ask again every quarter hour while on screen —
    // every five minutes within three hours of the duty and on it, where a
    // delay (the estimated IN, `FlightGates.times`) moves by the minute.
    refreshInterval: (opts.fast ? 5 : 15) * 60_000,
  })
  const refresh = useCallback(() => void mutate(), [mutate])
  return {
    legs,
    lookups: data ?? null,
    loading: isValidating,
    refresh,
  }
}
