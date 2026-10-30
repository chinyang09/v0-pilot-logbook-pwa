/**
 * Browser helpers for every online reference lookup — the gateway Worker's
 * routes and the ones the door composes, through `/api/lookup/[...path]`
 * (signed-in only; the Worker's secret stays on the server), and the shared
 * pool at `/api/lookup/pool/*`. Nothing in the app fetches a lookup URL by
 * hand: a route is added in `lib/lookup/types.ts` and reached from here.
 *
 *   const answer = await lookup.aircraftFlights("9V-TNL")
 *   if (answer.ok) answer.data.flights
 *   else if (answer.status === 404) // nothing found → manual entry
 *   else                            // 502 / offline → try later
 *
 * Never throws. Offline, or past the timeout, the answer is `status: 0`.
 * Nothing here may name the data source in the UI — lookups are meant to be
 * transparent to the pilot.
 */

import type { Fr24Result } from "@/lib/fr24/types"
import type { EnrichedAirport, LookupRoute, LookupRoutes, PooledAircraft } from "./types"

const CLIENT_TIMEOUT_MS = 15000

export async function lookupGet<R extends LookupRoute>(
  route: R,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal
): Promise<Fr24Result<LookupRoutes[R]>> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value))
  }
  const qs = query.toString()

  try {
    const response = await fetch(`/api/lookup/${route}${qs ? `?${qs}` : ""}`, {
      signal: signal ?? AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    })
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: unknown; source?: string; error?: string }
      | null
    if (response.ok && body?.ok === true) {
      return { ok: true, status: response.status, data: body.data as LookupRoutes[R], source: body.source ?? "" }
    }
    return { ok: false, status: response.status, error: body?.error || `HTTP ${response.status}` }
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message }
  }
}

/**
 * The shared pool, keyed as the route keys it (an aircraft by
 * `normalizeRegistration`, an airport by the code asked). `null` when it could
 * not be asked — unreachable, or an error — which is not "nobody has it".
 */
async function poolPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<Record<string, T> | null> {
  try {
    const response = await fetch(`/api/lookup/pool/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { results?: Record<string, T> }
    return data.results ?? {}
  } catch {
    return null
  }
}

export const lookup = {
  /**
   * Every aircraft the text could be, each marked `exact`, exact first. Only an
   * exact one may be taken without the pilot choosing it.
   */
  aircraftCandidates: (q: string, signal?: AbortSignal) => lookupGet("aircraft/candidates", { q }, signal),
  /** That registration and no other — 404 when every source says so, 502 when one could not be asked. */
  aircraftExact: (reg: string, signal?: AbortSignal) => lookupGet("aircraft/candidates", { q: reg, exact: 1 }, signal),
  /** Every airport a partial code (or a name) could be. */
  airportCandidates: (q: string, signal?: AbortSignal) => lookupGet("airport/candidates", { q }, signal),
  /** Enriched aircraft other pilots added. */
  poolAircraft: (registrations: string[], signal?: AbortSignal) =>
    poolPost<PooledAircraft>("aircraft", { registrations }, signal),
  /** Enriched airports other pilots added; codes may mix ICAO and IATA. */
  poolAirports: (codes: string[], signal?: AbortSignal) => poolPost<EnrichedAirport>("airport", { codes }, signal),
  /** Aircraft by registration — the Worker's chain, every match, exact ones first. */
  aircraft: (reg: string, signal?: AbortSignal) => lookupGet("aircraft", { reg }, signal),
  /** The flights a registration has flown, newest first, with the airframe. */
  aircraftFlights: (reg: string, page = 1, limit = 25, signal?: AbortSignal) =>
    lookupGet("aircraft/flights", { reg, page, limit }, signal),
  /** Airport by ICAO or IATA. `timezone` may be "" — derive it, never assume UTC. */
  airport: (code: string, signal?: AbortSignal) => lookupGet("airport", { code }, signal),
  /** Details plus runways and current weather. */
  airportDetails: (code: string, signal?: AbortSignal) => lookupGet("airport/details", { code }, signal),
  /** An airport's departures or arrivals board; `timestamp` is epoch seconds. */
  airportSchedule: (
    code: string,
    mode: "arrivals" | "departures" = "departures",
    opts: { page?: number; limit?: number; timestamp?: number } = {},
    signal?: AbortSignal
  ) => lookupGet("airport/schedule", { code, mode, ...opts }, signal),
  airports: (signal?: AbortSignal) => lookupGet("airports", {}, signal),
  airlines: (signal?: AbortSignal) => lookupGet("airlines", {}, signal),
  search: (q: string, limit = 20, signal?: AbortSignal) => lookupGet("search", { q, limit }, signal),
  /** The flights a flight number has operated, newest first. */
  flightHistory: (number: string, page = 1, limit = 25, signal?: AbortSignal) =>
    lookupGet("flight", { number, page, limit }, signal),
  /** One live flight by its id from `live`. */
  liveFlight: (id: string, signal?: AbortSignal) => lookupGet("flight/details", { id }, signal),
  /**
   * A flight number on a UTC date (`FlightLog.date`). `basis: "scheduled"` is
   * that day's schedule and may fill a blank field; `"usual"` is another day's
   * times moved onto it and must only be OFFERED.
   */
  flightSuggest: (number: string, date: string, out?: string, signal?: AbortSignal) =>
    lookupGet("flight/suggest", { number, date, out }, signal),
  /** That flight's gates, terminals and belt — "" until published. */
  flightGates: (number: string, date: string, out?: string, signal?: AbortSignal) =>
    lookupGet("flight/gates", { number, date, out }, signal),
  /**
   * Where an aeroplane is before `at` (ISO UTC; now when omitted): the flight
   * bringing it in — landed, airborne or not yet left, and its arrival gate —
   * and the one it flies after that.
   */
  aircraftWhereabouts: (reg: string, at?: string, signal?: AbortSignal) =>
    lookupGet("aircraft/whereabouts", { reg, at }, signal),
  /** An airline's fleet by type; `code` is its IATA (2) or ICAO (3) designator. */
  airlineFleet: (code: string, signal?: AbortSignal) =>
    lookupGet("airline/fleet", code.trim().length === 3 ? { icao: code.trim() } : { iata: code.trim() }, signal),
  /** Every airport pair an airline flies. */
  airlineRoutes: (code: string, signal?: AbortSignal) =>
    lookupGet("airline/routes", code.trim().length === 3 ? { icao: code.trim() } : { iata: code.trim() }, signal),
  /** One airport's destinations on an airline, with the flight numbers serving each. */
  airlineRoutesFrom: (code: string, airportIata: string, signal?: AbortSignal) =>
    lookupGet("airline/routes/from", { ...(code.trim().length === 3 ? { icao: code.trim() } : { iata: code.trim() }), airport: airportIata }, signal),
  /** Live positions; give at least one filter. `bounds` is "N,S,W,E". */
  live: (filters: { reg?: string; airline?: string; type?: string; bounds?: string; limit?: number }, signal?: AbortSignal) =>
    lookupGet("live", filters, signal),
}
