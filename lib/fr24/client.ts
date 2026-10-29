/**
 * Browser helpers for the FR24 gateway, through `/api/fr24/[...path]`
 * (signed-in only; the Worker's secret stays on the server).
 *
 *   const answer = await fr24.aircraftFlights("9V-TNL")
 *   if (answer.ok) answer.data.flights
 *   else if (answer.status === 404) // nothing found → manual entry
 *   else                            // 502 / offline → try later
 *
 * Never throws. Offline, or past the timeout, the answer is `status: 0`.
 * Nothing here may name the data source in the UI — lookups are meant to be
 * transparent to the pilot.
 */

import type { Fr24Result, Fr24Route, Fr24Routes } from "./types"

const CLIENT_TIMEOUT_MS = 15000

export async function fr24Get<R extends Fr24Route>(
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
    const response = await fetch(`/api/fr24/${route}${qs ? `?${qs}` : ""}`, {
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

export const fr24 = {
  /** Aircraft by registration — every match, exact ones first. */
  aircraft: (reg: string, signal?: AbortSignal) => fr24Get("aircraft", { reg }, signal),
  /** The flights a registration has flown, newest first, with the airframe. */
  aircraftFlights: (reg: string, page = 1, limit = 25, signal?: AbortSignal) =>
    fr24Get("aircraft/flights", { reg, page, limit }, signal),
  /** Airport by ICAO or IATA. `timezone` may be "" — derive it, never assume UTC. */
  airport: (code: string, signal?: AbortSignal) => fr24Get("airport", { code }, signal),
  /** Details plus runways and current weather. */
  airportDetails: (code: string, signal?: AbortSignal) => fr24Get("airport/details", { code }, signal),
  /** An airport's departures or arrivals board; `timestamp` is epoch seconds. */
  airportSchedule: (
    code: string,
    mode: "arrivals" | "departures" = "departures",
    opts: { page?: number; limit?: number; timestamp?: number } = {},
    signal?: AbortSignal
  ) => fr24Get("airport/schedule", { code, mode, ...opts }, signal),
  airports: (signal?: AbortSignal) => fr24Get("airports", {}, signal),
  airlines: (signal?: AbortSignal) => fr24Get("airlines", {}, signal),
  search: (q: string, limit = 20, signal?: AbortSignal) => fr24Get("search", { q, limit }, signal),
  /** The flights a flight number has operated, newest first. */
  flightHistory: (number: string, page = 1, limit = 25, signal?: AbortSignal) =>
    fr24Get("flight", { number, page, limit }, signal),
  /** One live flight by its id from `live`. */
  liveFlight: (id: string, signal?: AbortSignal) => fr24Get("flight/details", { id }, signal),
  /** Live positions; give at least one filter. `bounds` is "N,S,W,E". */
  live: (filters: { reg?: string; airline?: string; type?: string; bounds?: string; limit?: number }, signal?: AbortSignal) =>
    fr24Get("live", filters, signal),
}
