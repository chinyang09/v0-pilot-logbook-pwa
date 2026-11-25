/**
 * Where an aeroplane is, relative to a flight it is about to operate — read
 * off its registration's flight list (the Worker's `/aircraft/flights`, newest
 * first, the day's assigned flights included).
 *
 *   inbound  the last flight it DEPARTS on before `at` (our departure): has it
 *            landed, is it in the air, or has it not left yet — and at which
 *            gate it arrives, which is usually where the crew joins it
 *   next     the flight after that one — normally ours; for a leg being
 *            planned (`at` = the previous leg's arrival) the one it flies next
 *
 * Pure, so the door (Edge) and the tests share it; the gate is added by the
 * composite route, which asks the live flight or the arrivals board.
 */

import type { Fr24Flight } from "@/lib/fr24/types"
import { formatClockDisplay } from "@/lib/utils/time"
import { suggestedAirport, type SuggestedAirport } from "./flight-suggest"

export interface AircraftMovement {
  flightNumber: string
  origin: SuggestedAirport | null
  destination: SuggestedAirport | null
  scheduledDeparture: string | null
  scheduledArrival: string | null
  actualDeparture: string | null
  actualArrival: string | null
  estimatedArrival: string | null
  /** Landed (an actual arrival), airborne (an actual departure), or not yet left. */
  status: "landed" | "airborne" | "scheduled"
  /** The arrival time that matters: actual once landed, else estimated, else scheduled. */
  arrival: string | null
}

export interface AircraftWhereabouts {
  registration: string
  typecode: string
  /** The instant the question was asked about (ISO UTC). */
  at: string
  inbound: (AircraftMovement & { arrivalGate: string; arrivalTerminal: string }) | null
  next: AircraftMovement | null
}

/** When a flight left or leaves: actual, then estimated, then scheduled. */
export function departureMs(f: Fr24Flight): number | null {
  const iso = f.actualDeparture ?? f.estimatedDeparture ?? f.scheduledDeparture
  return iso ? Date.parse(iso) : null
}

export function movementOf(f: Fr24Flight): AircraftMovement {
  const status = f.actualArrival ? "landed" : f.actualDeparture || f.live ? "airborne" : "scheduled"
  return {
    flightNumber: f.flightNumber,
    origin: suggestedAirport(f.origin),
    destination: suggestedAirport(f.destination),
    scheduledDeparture: f.scheduledDeparture,
    scheduledArrival: f.scheduledArrival,
    actualDeparture: f.actualDeparture,
    actualArrival: f.actualArrival,
    estimatedArrival: f.estimatedArrival,
    status,
    arrival: f.actualArrival ?? f.estimatedArrival ?? f.scheduledArrival,
  }
}

/**
 * Twenty minutes before `at`: a departure inside it is the flight AT `at`
 * (ours, pushing back a little early), not the one bringing the aeroplane in.
 */
const OWN_FLIGHT_MARGIN_MS = 20 * 60_000

/** The inbound flight's row and the one after it, out of the registration's list. */
export function pickWhereabouts(flights: Fr24Flight[], atMs: number): { inbound: Fr24Flight | null; next: Fr24Flight | null } {
  const dated = flights
    .map((f) => ({ f, dep: departureMs(f) }))
    .filter((x): x is { f: Fr24Flight; dep: number } => x.dep !== null)
    .sort((a, b) => a.dep - b.dep)
  let i = -1
  for (let k = 0; k < dated.length; k++) if (dated[k].dep <= atMs - OWN_FLIGHT_MARGIN_MS) i = k
  return { inbound: i >= 0 ? dated[i].f : null, next: dated[i + 1]?.f ?? null }
}

/** "30m", "1h 05m". */
function span(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

/**
 * The inbound flight in two lines, relative to `nowMs` — what it is doing, and
 * which flight it is with its own STD and arrival gate (the owner: the gate
 * means little without the flight it belongs to):
 *
 *   Landed 03:00Z · 30m ago          TR289 from DPS · STD 00:10Z · Gate D41
 *   Landing 03:00Z · in 30m          TR289 from DPS · STD 00:10Z · Gate D41
 *   Due 03:00Z · not departed yet    TR289 from DPS · STD 00:10Z
 *
 * The parts are returned too, for a caller that lays them out itself.
 */
export function whereaboutsLines(
  w: AircraftWhereabouts,
  nowMs: number,
  clockSeparator: "colon" | "none" = "colon",
  opts: { gate?: boolean } = {}
): { primary: string; secondary: string; flight: string; std: string; gate: string } | null {
  const inbound = w.inbound
  if (!inbound) return null
  const zulu = (iso: string) => `${formatClockDisplay(iso.slice(11, 16), clockSeparator)}Z`
  const at = inbound.arrival ? Date.parse(inbound.arrival) : null
  const clock = inbound.arrival ? zulu(inbound.arrival) : "time unknown"
  const primary =
    inbound.status === "landed"
      ? `Landed ${clock}${at !== null ? ` · ${span(nowMs - at)} ago` : ""}`
      : inbound.status === "airborne"
        ? at !== null && at < nowMs
          ? `Landing ${clock} · due now`
          : `Landing ${clock}${at !== null ? ` · in ${span(at - nowMs)}` : ""}`
        : `Due ${clock} · not departed yet`
  const from = inbound.origin ? ` from ${inbound.origin.iata || inbound.origin.icao}` : ""
  const flight = `${inbound.flightNumber || "Flight"}${from}`
  const std = inbound.scheduledDeparture ? `STD ${zulu(inbound.scheduledDeparture)}` : ""
  // The gate alone (the owner, Nov 2026: "remove all terminal … gate number is good enough").
  const gate = opts.gate === false || !inbound.arrivalGate ? "" : `Gate ${inbound.arrivalGate}`
  return { primary, secondary: [flight, std, gate].filter(Boolean).join(" · "), flight, std, gate }
}

/** The next crew reports at the aircraft an hour before its scheduled off (the owner's rule). */
const NEXT_CREW_BEFORE_MS = 3600_000

/**
 * The flight that takes the aeroplane OVER after ours (the owner, Nov 2026:
 * to init the MCDU for them, and to know when their crew reports at the
 * aircraft — its STD less an hour — which decides whether to secure it):
 *
 *   TR290 to DPS · STD 06:30Z · crew 05:30Z
 *
 * Null when the list has no flight after ours.
 */
export function onwardLines(
  w: AircraftWhereabouts,
  clockSeparator: "colon" | "none" = "colon",
): { flight: string; std: string; crew: string; line: string } | null {
  const next = w.next
  if (!next || !next.flightNumber) return null
  const zulu = (ms: number) => `${formatClockDisplay(new Date(ms).toISOString().slice(11, 16), clockSeparator)}Z`
  const to = next.destination ? ` to ${next.destination.iata || next.destination.icao}` : ""
  const stdMs = next.scheduledDeparture ? Date.parse(next.scheduledDeparture) : NaN
  const flight = `${next.flightNumber}${to}`
  const std = Number.isFinite(stdMs) ? `STD ${zulu(stdMs)}` : ""
  const crew = Number.isFinite(stdMs) ? `crew ${zulu(stdMs - NEXT_CREW_BEFORE_MS)}` : ""
  return { flight, std, crew, line: [flight, std, crew].filter(Boolean).join(" · ") }
}
