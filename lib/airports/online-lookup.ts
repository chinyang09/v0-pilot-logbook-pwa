/**
 * The online half of the airport lookup, for the browser — called once the
 * local reference table has answered "not here".
 *
 *   1. The shared pool — POST /api/search/airport/batch (MongoDB, Node)
 *   2. FR24 — GET /api/search/airport (EDGE, FR24 only)
 *   3. A blank timezone derived from the coordinates — GET /api/timezone
 *
 * The pool is asked first so an airport another pilot already added never
 * costs an FR24 call. The two are separate routes because the FR24 call must
 * run on the Edge runtime (see `app/api/search/airport/route.ts`) and the
 * MongoDB driver cannot.
 *
 * Step 3 matters because callers store a blank timezone as "UTC", which puts
 * every local time at that airport out. FR24's position-only sources carry no
 * zone; geo-tz cannot run on Edge, so it is derived here.
 *
 * Never throws. A failure at any step falls through to the next; `null`
 * means nobody could answer (manual entry).
 */

import type { EnrichedAirport } from "@/app/api/search/airport/shared"

export type OnlineAirportSource = "cache" | "fr24"

export interface OnlineAirport {
  result: EnrichedAirport
  source: OnlineAirportSource
}

const TIMEOUT_MS = 12000

/** The caller's signal OR the timeout. By hand: `AbortSignal.any` needs Safari 17.4. */
function timeoutSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  if (!signal) return timeout
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal.aborted) abort()
  signal.addEventListener("abort", abort, { once: true })
  timeout.addEventListener("abort", abort, { once: true })
  return controller.signal
}

async function fromPool(code: string, signal?: AbortSignal): Promise<EnrichedAirport | null> {
  try {
    const res = await fetch("/api/search/airport/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codes: [code] }),
      signal: timeoutSignal(signal),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { results?: Record<string, EnrichedAirport> }
    const hit = data.results?.[code]
    return hit?.icao ? hit : null
  } catch {
    return null
  }
}

async function fromFr24(code: string, signal?: AbortSignal): Promise<EnrichedAirport | null> {
  try {
    const res = await fetch(`/api/search/airport?q=${encodeURIComponent(code)}`, {
      signal: timeoutSignal(signal),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { result?: EnrichedAirport | null }
    return data.result?.icao ? data.result : null
  } catch {
    return null
  }
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

export async function lookupAirportOnline(code: string, signal?: AbortSignal): Promise<OnlineAirport | null> {
  const key = code.trim().toUpperCase()
  if (key.length < 3) return null

  const pooled = await fromPool(key, signal)
  if (pooled) return { result: await deriveTimezone(pooled, signal), source: "cache" }
  if (signal?.aborted) return null

  const live = await fromFr24(key, signal)
  if (live) return { result: await deriveTimezone(live, signal), source: "fr24" }
  return null
}
