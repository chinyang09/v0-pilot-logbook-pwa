/**
 * The online half of the airport lookup, for the browser — called once the
 * local reference table has answered "not here".
 *
 *   1. The shared pool — `lookup.poolAirports` (POST /api/lookup/pool/airport,
 *      MongoDB, Node)
 *   2. The gateway — `lookup.airport` (GET /api/lookup/airport, EDGE)
 *   3. A blank timezone derived from the coordinates — GET /api/timezone
 *
 * The pool is asked first so an airport another pilot already added never
 * costs a gateway call. The two are separate routes because the gateway call
 * must run on the Edge runtime (see `app/api/lookup/[...path]/route.ts`) and
 * the MongoDB driver cannot.
 *
 * Step 3 matters because callers store a blank timezone as "UTC", which puts
 * every local time at that airport out. FR24's position-only sources carry no
 * zone; geo-tz cannot run on Edge, so it is derived here.
 *
 * Never throws. A failure at any step falls through to the next; `null`
 * means nobody could answer (manual entry).
 */

import { lookup, withTimeout } from "@/lib/lookup/client"
import type { EnrichedAirport } from "@/lib/lookup/types"

export type OnlineAirportSource = "cache" | "fr24"

export interface OnlineAirport {
  result: EnrichedAirport
  source: OnlineAirportSource
}

const TIMEOUT_MS = 12000
const timeoutSignal = (signal?: AbortSignal) => withTimeout(signal, TIMEOUT_MS)

async function fromPool(code: string, signal?: AbortSignal): Promise<EnrichedAirport | null> {
  const hit = (await lookup.poolAirports([code], timeoutSignal(signal)))?.[code]
  return hit?.icao ? hit : null
}

async function fromGateway(code: string, signal?: AbortSignal): Promise<EnrichedAirport | null> {
  const answer = await lookup.airport(code, timeoutSignal(signal))
  if (!answer.ok || !answer.data?.icao) return null
  const { timezoneOffsetSeconds: _offset, ...airport } = answer.data
  return airport
}

/** Fill a blank timezone from the coordinates. Returns the airport unchanged when it cannot. */
export async function deriveTimezone<T extends { timezone: string; latitude: number; longitude: number }>(
  airport: T,
  signal?: AbortSignal
): Promise<T> {
  if (airport.timezone) return airport
  const { latitude, longitude } = airport
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return airport
  if (latitude === 0 && longitude === 0) return airport
  try {
    const res = await fetch(`/api/timezone?lat=${latitude}&lng=${longitude}`, {
      signal: timeoutSignal(signal),
    })
    if (!res.ok) return airport
    const data = (await res.json()) as { tz?: string }
    return data.tz ? { ...airport, timezone: data.tz } : airport
  } catch {
    return airport
  }
}

/**
 * The gateway alone, its timezone filled — for a caller that has already asked
 * the pool (the import enricher asks it for every code in one request).
 */
export async function lookupAirportLive(code: string, signal?: AbortSignal): Promise<EnrichedAirport | null> {
  const live = await fromGateway(code.trim().toUpperCase(), signal)
  return live ? deriveTimezone(live, signal) : null
}

export async function lookupAirportOnline(code: string, signal?: AbortSignal): Promise<OnlineAirport | null> {
  const key = code.trim().toUpperCase()
  if (key.length < 3) return null

  const pooled = await fromPool(key, signal)
  if (pooled) return { result: await deriveTimezone(pooled, signal), source: "cache" }
  if (signal?.aborted) return null

  const live = await lookupAirportLive(key, signal)
  return live ? { result: live, source: "fr24" } : null
}
