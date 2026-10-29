/**
 * Browser helpers for the reference-lookup gateway, through
 * `/api/lookup/[...path]` (signed-in only; the Worker's secret stays on the
 * server).
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

import type { Fr24Result, Fr24Route, Fr24Routes } from "@/lib/fr24/types"

const CLIENT_TIMEOUT_MS = 15000

export async function lookupGet<R extends Fr24Route>(
  route: R,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal
): Promise<Fr24Result<Fr24Routes[R]>> {
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
      return { ok: true, status: response.status, data: body.data as Fr24Routes[R], source: body.source ?? "" }
    }
    return { ok: false, status: response.status, error: body?.error || `HTTP ${response.status}` }
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message }
  }
}

export const lookup = {
  /** Aircraft by registration — every match, exact ones first. */
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
  /** Live positions; give at least one filter. `bounds` is "N,S,W,E". */
  live: (filters: { reg?: string; airline?: string; type?: string; bounds?: string; limit?: number }, signal?: AbortSignal) =>
    lookupGet("live", filters, signal),
}
